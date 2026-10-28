import json
import os
from contextlib import asynccontextmanager
from html import escape
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qsl

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from loguru import logger
import httpx
import uvicorn

load_dotenv(override=True)

import db
import diagnostics
import vobiz_api
from agent import run_vobiz_agent
from dialer import dialer

BASE_DIR = Path(__file__).parent
PORT = int(os.getenv("PORT", os.getenv("HTTP_PORT", "8000")))
PUBLIC_URL = os.getenv("PUBLIC_URL", "").rstrip("/")
STREAM_CONTENT_TYPE = os.getenv("STREAM_CONTENT_TYPE", "audio/x-l16;rate=16000")

# XML escape text for valid Vobiz response XML
def xml_escape(value: str) -> str:
    return escape(str(value), quote=True)

# Generate WebSocket URL pointing to this server
def get_ws_url(path_with_query: str) -> str:
    base = PUBLIC_URL.replace("https://", "wss://").replace("http://", "ws://")
    full_url = f"{base}{path_with_query}"
    return xml_escape(full_url)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database and agent components...")
    db.get_collection()
    logger.info(f"Pipecat Vobiz Server active at {PUBLIC_URL or f'http://127.0.0.1:{PORT}'}")
    yield
    logger.info("Server shutting down cleanly...")

app = FastAPI(title="Pipecat Vobiz Gemini Live Voice Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the Swargaseema AI Telephony Console UI
@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    index_file = BASE_DIR / "templates" / "index.html"
    if index_file.exists():
        return HTMLResponse(content=index_file.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>UI Template Not Found</h1>", status_code=404)

# Health status endpoint
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "pipecat-vobiz-gemini-live",
        "public_url": PUBLIC_URL,
    }

# Extract request parameters from forms, json, or query parameters
async def parse_params(request: Request) -> Dict[str, Any]:
    params: Dict[str, Any] = dict(request.query_params)
    if request.method == "POST":
        body = (await request.body()).decode(errors="replace")
        content_type = request.headers.get("content-type", "")
        if "json" in content_type:
            try:
                params.update(json.loads(body or "{}"))
            except json.JSONDecodeError:
                pass
        else:
            params.update(dict(parse_qsl(body)))
    return params

# Vobiz answer webhook returning bidirectional stream XML
@app.api_route("/answer", methods=["GET", "POST"])
async def answer_call(request: Request):
    params = await parse_params(request)
    call_uuid = (
        params.get("CallUUID")
        or params.get("call_uuid")
        or params.get("callUUID")
        or params.get("CallId")
        or params.get("callId")
        or ""
    )
    to_number = params.get("To") or params.get("to") or ""
    from_number = params.get("From") or params.get("from") or ""

    logger.info(f"Vobiz Answer Callback: call_uuid={call_uuid}, to={to_number}, from={from_number}")
    batch_id = params.get("batch_id") or (dialer.active_call.get("batch_id") if dialer.active_call else None) or dialer.current_batch_id
    db.record_call_start(call_uuid, phone_number=to_number, batch_id=batch_id, metadata=params)
    dialer.set_call_status(call_uuid, "in_call")
    tracer = diagnostics.get_tracer(call_uuid, phone_number=to_number, batch_id=batch_id)
    tracer.record_event("call_answered", {"to": to_number, "from": from_number, "call_id": call_uuid})

    status_callback = xml_escape(f"{PUBLIC_URL}/stream-status")
    rec_callback = xml_escape(f"{PUBLIC_URL}/recording-callback?batch_id={batch_id or ''}&to={to_number}")
    ws_stream_url = get_ws_url(f"/ws?call_uuid={call_uuid}&to={to_number}&batch_id={batch_id or ''}")

    xml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Record recordSession="true" maxLength="3600" redirect="false" callbackUrl="{rec_callback}" callbackMethod="POST"/>
    <Stream bidirectional="true"
            audioTrack="inbound"
            keepCallAlive="true"
            contentType="{xml_escape(STREAM_CONTENT_TYPE)}"
            statusCallbackUrl="{status_callback}"
            statusCallbackMethod="POST">
        {ws_stream_url}
    </Stream>
    <Hangup/>
</Response>"""
    return Response(content=xml_content, media_type="application/xml")

# Vobiz stream status webhook
@app.post("/stream-status")
async def stream_status(request: Request):
    params = await parse_params(request)
    call_uuid = params.get("CallUUID") or params.get("call_uuid") or ""
    status_name = params.get("Status") or params.get("status") or params.get("Event") or ""
    stream_err = params.get("Error") or params.get("error") or ""
    logger.info(f"Stream status update: {params}")
    if call_uuid:
        tracer = diagnostics.get_tracer(call_uuid)
        tracer.record_event("vobiz_stream_status", {"status": status_name, "error": stream_err})
    return {"status": "ok"}

# Vobiz recording completion callback
@app.api_route("/recording-callback", methods=["GET", "POST"])
async def recording_callback(request: Request):
    params = await parse_params(request)
    call_uuid = params.get("CallUUID") or params.get("call_uuid") or ""
    rec_url = params.get("RecordUrl") or params.get("RecordingUrl") or params.get("recording_url", "")
    logger.info(f"Vobiz Recording callback for {call_uuid}: {rec_url}")
    if call_uuid and rec_url:
        db.update_call(call_uuid, {"recording_url": rec_url})
        tracer = diagnostics.get_tracer(call_uuid)
        tracer.record_event("recording_ready", {"recording_url": rec_url})
    return {"status": "ok"}

# Vobiz hangup callback
@app.post("/hangup")
async def hangup_webhook(request: Request):
    params = await parse_params(request)
    call_uuid = params.get("CallUUID", "") or params.get("call_uuid", "")
    batch_id = params.get("batch_id") or (dialer.active_call.get("batch_id") if dialer.active_call else None) or dialer.current_batch_id
    to_number = params.get("To") or params.get("to") or ""
    hangup_cause = params.get("HangupCause") or params.get("hangup_cause") or "NORMAL_CLEARING"
    hangup_source = params.get("HangupSource") or params.get("hangup_source") or ""
    duration = params.get("Duration") or params.get("duration")
    logger.info(f"Vobiz Hangup callback for {call_uuid}: cause={hangup_cause}, source={hangup_source}, batch={batch_id}")
    if call_uuid:
        tracer = diagnostics.get_tracer(call_uuid, phone_number=to_number, batch_id=batch_id)
        if not any(e.get("event") == "call_answered" for e in tracer.events):
            carrier_details = {
                "cause": hangup_cause,
                "source": hangup_source,
                "telephony_status": "Handset declined or line engaged before answer" if hangup_cause in ("USER_BUSY", "17") else (
                    "Handset rang out without answering" if hangup_cause in ("NO_ANSWER", "19", "NO_USER_RESPONDING") else (
                        "Call rejected by carrier or network" if hangup_cause in ("CALL_REJECTED", "21") else hangup_cause
                    )
                ),
            }
            tracer.record_event("carrier_signaling", carrier_details)
        tracer.record_hangup(cause=hangup_cause, source=hangup_source, duration=duration)
        db.finalize_call(call_uuid, status="hung_up", batch_id=batch_id)
        dialer.on_call_ended(call_uuid)
    return {"status": "ok"}

# Real-time WebSocket endpoint bridged to Pipecat agent
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    query_params = dict(websocket.query_params)
    call_uuid = query_params.get("call_uuid", "unknown_call")
    to_number = query_params.get("to", "")
    batch_id = query_params.get("batch_id") or (dialer.active_call.get("batch_id") if dialer.active_call else None) or dialer.current_batch_id
    dialer.set_call_status(call_uuid, "in_call")
    tracer = diagnostics.get_tracer(call_uuid, phone_number=to_number, batch_id=batch_id)

    try:
        await run_vobiz_agent(
            websocket=websocket,
            call_uuid=call_uuid,
            phone_number=to_number,
            batch_id=batch_id,
        )
        tracer.record_ws_close(1000, "Normal Closure")
    except WebSocketDisconnect as ws_disc:
        logger.info(f"WebSocket disconnected by Vobiz for {call_uuid} (code: {ws_disc.code})")
        tracer.record_ws_close(ws_disc.code, ws_disc.reason or "Client disconnected")
    except Exception as exc:
        logger.error(f"WebSocket session error for {call_uuid}: {exc}")
        tracer.record_error("websocket_error", str(exc))
        tracer.record_ws_close(1006, str(exc))
    finally:
        dialer.on_call_ended(call_uuid)

# Trigger single test dial (compatible with UI dial button)
@app.post("/api/dial")
@app.post("/outbound")
async def trigger_dial(request: Request):
    payload = await parse_params(request)
    to_number = payload.get("to") or payload.get("phone_number")
    if not to_number:
        return Response(content='{"ok": false, "error": "Missing phone number"}', status_code=400, media_type="application/json")

    answer_url = f"{PUBLIC_URL}/answer"
    hangup_url = f"{PUBLIC_URL}/hangup"
    from_number = payload.get("from")

    try:
        result = await vobiz_api.place_call(
            to_number=to_number,
            answer_url=answer_url,
            hangup_url=hangup_url,
            from_number=from_number,
        )
        call_uuid = result.get("request_uuid") or result.get("call_uuid") or ""
        dialer.set_active_call(
            call_uuid=call_uuid,
            phone_number=to_number,
            customer_name=payload.get("customer_name", ""),
            status="dialing",
        )
        return {"ok": True, "status": "call_initiated", "call_uuid": call_uuid, "vobiz_response": result}
    except Exception as exc:
        return Response(content=f'{{"ok": false, "error": "{str(exc)}"}}', status_code=500, media_type="application/json")

# Retrieve dialer and campaign status for UI HUD
@app.get("/api/campaign/status")
async def get_campaign_status():
    return dialer.get_status_payload()

# Fetch CRM pending missed calls
@app.get("/api/crm/pending-calls")
async def get_crm_pending_calls(start_date: Optional[str] = None, end_date: Optional[str] = None):
    calls = dialer.fetch_crm_pending(start_date, end_date)
    return {"ok": True, "calls": calls, "total": len(calls)}

# Queue selected leads into outbound campaign
@app.post("/api/campaign/leads")
async def queue_campaign_leads(request: Request):
    payload = await request.json()
    leads = payload.get("leads", [])
    batch_name = payload.get("batch_name")
    source_filter = payload.get("source_filter")
    batch_id = dialer.queue_leads(leads, batch_name=batch_name, source_filter=source_filter)
    return {"ok": True, "batch_id": batch_id, "queued": len(leads)}

# Start OBD automated calling
@app.post("/api/campaign/start")
async def start_campaign():
    dialer.start(PUBLIC_URL)
    return {"ok": True, "status": dialer.status}

# Pause OBD automated calling
@app.post("/api/campaign/pause")
async def pause_campaign():
    dialer.pause()
    return {"ok": True, "status": dialer.status}

# Resume OBD automated calling
@app.post("/api/campaign/resume")
async def resume_campaign():
    dialer.resume(PUBLIC_URL)
    return {"ok": True, "status": dialer.status}

# Stop OBD automated calling
@app.post("/api/campaign/stop")
async def stop_campaign():
    dialer.stop()
    return {"ok": True, "status": dialer.status}

# Clear dialer queue
@app.post("/api/campaign/clear")
async def clear_campaign():
    dialer.clear()
    return {"ok": True, "status": dialer.status}

# Reset dialer queue and counters
@app.post("/api/campaign/reset")
async def reset_campaign():
    dialer.reset()
    return {"ok": True, "status": dialer.status}

# Retrieve campaign batch list
@app.get("/api/campaign/batches")
async def list_campaign_batches():
    return {"ok": True, "batches": db.get_batches()}

# Retrieve specific batch detail
@app.get("/api/campaign/batches/{batch_id}")
async def get_batch_detail(batch_id: str):
    detail = db.get_batch_detail(batch_id)
    return {"ok": True, **detail}

# Delete a campaign batch
@app.delete("/api/campaign/batches/{batch_id}")
async def delete_campaign_batch(batch_id: str):
    success = db.delete_batch(batch_id)
    if dialer.current_batch_id == batch_id:
        dialer.reset()
    return {"ok": success}

# Proxy authenticated audio recording from Vobiz
@app.get("/api/recording/{call_uuid}")
async def get_recording(call_uuid: str):
    doc = db.get_call(call_uuid)
    rec_url = doc.get("recording_url") if doc else None

    # Fallback: query Vobiz Recording API directly if not yet saved in database
    if not rec_url:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(
                    f"{vobiz_api.API_BASE}/Account/{vobiz_api.AUTH_ID}/Recording/?call_uuid={call_uuid}",
                    headers=vobiz_api.get_headers(),
                )
                if r.status_code == 200:
                    objs = r.json().get("objects", [])
                    if objs:
                        rec_url = objs[0].get("recording_url")
                        db.update_call(call_uuid, {"recording_url": rec_url})
        except Exception as exc:
            logger.warning(f"Error querying Vobiz recording API for {call_uuid}: {exc}")

    if not rec_url:
        return Response(content="No recording available for this call", status_code=404)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(rec_url, headers=vobiz_api.get_headers())
            return Response(
                content=resp.content,
                media_type=resp.headers.get("content-type", "audio/mpeg"),
                headers={"Accept-Ranges": "bytes"},
            )
    except Exception as exc:
        logger.error(f"Failed to fetch recording {rec_url}: {exc}")
        return Response(content="Failed to retrieve recording", status_code=502)

# Retrieve recent call history and transcripts
@app.get("/calls")
async def list_calls(limit: int = 50):
    return db.get_recent_calls(limit=limit)

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=False)
