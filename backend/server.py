import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from html import escape
import json
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qsl

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
import httpx
import uvicorn
import logging

# Filter out high-frequency polling endpoints from Uvicorn access logs to prevent console spam
class PollingEndpointFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            return "/api/campaign/status" not in record.getMessage()
        except Exception:
            return True

import sys

BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

load_dotenv(BASE_DIR / ".env", override=True)

# Device Guard / AppLocker safeguard: stub unsigned loudness.pyd & sentencex to prevent DLL load blocks on Windows
import sys
from types import ModuleType
if "loudness" not in sys.modules:
    try:
        import loudness
    except (ImportError, OSError):
        fake_loudness = ModuleType("loudness")
        fake_loudness.integrated_loudness = lambda audio, rate: -50.0
        sys.modules["loudness"] = fake_loudness

if "sentencex" not in sys.modules:
    try:
        import sentencex
    except (ImportError, OSError):
        import re
        fake_sentencex = ModuleType("sentencex")
        fake_sentencex.segment = lambda lang, text: [s.strip() for s in re.split(r'(?<=[.!?\n])\s+', text) if s.strip()]
        sys.modules["sentencex"] = fake_sentencex

import db
import diagnostics
import vobiz_api
from agent import run_vobiz_agent, transcribe_audio_bytes_with_gemini, translate_turns_to_english_with_gemini
from dialer import dialer, manager as dialer_manager

# Resolve dialer instance for the requesting operator
def resolve_dialer(request: Optional[Request] = None, operator: Optional[str] = None, call_uuid: Optional[str] = None):
    if operator and operator.strip():
        return dialer_manager.get_dialer(operator.strip())
    if request:
        op = (
            request.headers.get("X-Operator")
            or request.headers.get("x-operator")
            or request.query_params.get("operator")
        )
        if op and op.strip():
            return dialer_manager.get_dialer(op.strip())
    if call_uuid:
        d = dialer_manager.find_dialer_by_call_uuid(call_uuid)
        if d:
            return d
    return dialer

PORT = int(os.getenv("PORT", os.getenv("HTTP_PORT", "8000")))
STREAM_CONTENT_TYPE = os.getenv("STREAM_CONTENT_TYPE", "audio/x-l16;rate=16000")

# Resolve active public URL dynamically from environment or .env file
def get_public_url() -> str:
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("PUBLIC_URL="):
                        val = line.split("=", 1)[1].strip().strip('"').strip("'").rstrip("/")
                        if val:
                            return val
        except Exception:
            pass
    return os.getenv("PUBLIC_URL", "").rstrip("/")

# XML escape text for valid Vobiz response XML
def xml_escape(value: str) -> str:
    return escape(str(value), quote=True)

# Generate WebSocket URL pointing to this server
def get_ws_url(path_with_query: str) -> str:
    pub = get_public_url()
    base = pub.replace("https://", "wss://").replace("http://", "ws://")
    full_url = f"{base}{path_with_query}"
    return xml_escape(full_url)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.getLogger("uvicorn.access").addFilter(PollingEndpointFilter())
    logger.info("Initializing database and agent components...")
    db.get_collection()
    t_enabled = db.is_transcript_enabled()
    logger.info(f"Global transcript mode: {'ENABLED' if t_enabled else 'DISABLED (low-cost Gemini mode)'}")
    logger.info(f"Pipecat Vobiz Server active at {get_public_url() or f'http://127.0.0.1:{PORT}'}")
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

FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
FRONTEND_INDEX = FRONTEND_DIST / "index.html"

# Mount frontend assets if compiled React bundle exists
if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="frontend_assets")

# Serve the Swargaseema AI Telephony Console UI
@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    if FRONTEND_INDEX.exists():
        return HTMLResponse(content=FRONTEND_INDEX.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>Frontend build not found. Run 'npm run build' in frontend directory.</h1>", status_code=404)

# Parse configured operators from APP_USERS env
def get_auth_users() -> Dict[str, Dict[str, str]]:
    raw = os.getenv("APP_USERS", "")
    users = {}
    for entry in raw.split(","):
        parts = entry.strip().split(":")
        if len(parts) >= 2:
            uname = parts[0].strip().lower()
            pwd = parts[1].strip()
            dname = parts[2].strip() if len(parts) >= 3 else uname.title()
            users[uname] = {"password": pwd, "displayName": dname}
    return users

# Authenticate user credentials
@app.post("/api/auth/login")
async def login(request: Request):
    payload = await parse_params(request)
    logger.info(f"Login request payload: {payload}")
    username = str(payload.get("username", "")).strip().lower()
    password = str(payload.get("password", "")).strip()

    users = get_auth_users()
    logger.info(f"Available auth users: {list(users.keys())}")
    if not users:
        # Fallback default if not configured
        if username == "admin" and password == "admin":
            return {"ok": True, "token": "session_admin", "user": {"username": "admin", "displayName": "Admin"}}
        return JSONResponse(status_code=401, content={"ok": False, "error": "Invalid credentials"})

    user = users.get(username)
    if not user or user["password"] != password:
        return JSONResponse(status_code=401, content={"ok": False, "error": "Invalid username or password"})

    token = f"sess_{username}_{int(time.time())}"
    return {
        "ok": True,
        "token": token,
        "user": {
            "username": username,
            "displayName": user["displayName"],
        },
    }

# Health status endpoint
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "pipecat-vobiz-gemini-live",
        "public_url": get_public_url(),
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

    t_answer = time.time()
    call_short = call_uuid[:8] if call_uuid else "unknown"
    logger.info(f"[TIMING] [{call_short}] 1. Call answered at {t_answer:.3f} ({datetime.now().strftime('%H:%M:%S.%f')[:-3]})")
    logger.info(f"Vobiz Answer Callback: call_uuid={call_uuid}, to={to_number}, from={from_number}")
    op = params.get("operator")
    d = resolve_dialer(request, operator=op, call_uuid=call_uuid)
    active_call_meta = d.active_call if (d.active_call and (not call_uuid or d.active_call.get("call_uuid") == call_uuid)) else {}
    batch_id = params.get("batch_id") or active_call_meta.get("batch_id")
    template_id = params.get("template_id") or active_call_meta.get("template_id") or d.selected_template_id
    asyncio.create_task(asyncio.to_thread(db.record_call_start, call_uuid, phone_number=to_number, batch_id=batch_id, metadata=params))
    d.set_call_status(call_uuid, "in_call")
    tracer = diagnostics.get_tracer(call_uuid, phone_number=to_number, batch_id=batch_id)
    tracer.t_answer = t_answer
    tracer.record_event("call_answered", {"timestamp": t_answer, "to": to_number, "from": from_number, "call_id": call_uuid})

    public_url = get_public_url()
    status_callback = xml_escape(f"{public_url}/stream-status")
    rec_callback = xml_escape(f"{public_url}/recording-callback?batch_id={batch_id or ''}&to={to_number}")
    ws_stream_url = get_ws_url(f"/ws?call_uuid={call_uuid}&to={to_number}&batch_id={batch_id or ''}&template_id={template_id or ''}&operator={d.operator}")

    xml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Record recordSession="true" playBeep="false" maxLength="3600" redirect="false" callbackUrl="{rec_callback}" callbackMethod="POST"/>
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
    op = params.get("operator")
    d = resolve_dialer(request, operator=op, call_uuid=call_uuid)
    batch_id = params.get("batch_id") or (d.active_call.get("batch_id") if d.active_call else None) or d.current_batch_id
    to_number = params.get("To") or params.get("to") or ""
    hangup_cause = params.get("HangupCause") or params.get("hangup_cause") or "NORMAL_CLEARING"
    hangup_source = params.get("HangupSource") or params.get("hangup_source") or ""
    duration = params.get("Duration") or params.get("duration")
    logger.info(f"Vobiz Hangup callback for {call_uuid} (operator: {d.operator}): cause={hangup_cause}, source={hangup_source}, batch={batch_id}")
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
        d.on_call_ended(call_uuid)
    return {"status": "ok"}

# Real-time WebSocket endpoint bridged to Pipecat agent
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    query_params = dict(websocket.query_params)
    call_uuid = query_params.get("call_uuid", "unknown_call")
    to_number = query_params.get("to", "")
    op = query_params.get("operator")
    d = resolve_dialer(operator=op, call_uuid=call_uuid)
    batch_id = query_params.get("batch_id") or (d.active_call.get("batch_id") if d.active_call else None) or d.current_batch_id
    template_id = query_params.get("template_id") or (d.active_call.get("template_id") if d.active_call else None) or d.selected_template_id
    d.set_call_status(call_uuid, "in_call")
    tracer = diagnostics.get_tracer(call_uuid, phone_number=to_number, batch_id=batch_id)

    try:
        await run_vobiz_agent(
            websocket=websocket,
            call_uuid=call_uuid,
            phone_number=to_number,
            batch_id=batch_id,
            template_id=template_id,
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
        d.on_call_ended(call_uuid)

dial_lock = asyncio.Lock()

# Trigger single test dial (compatible with UI dial button)
@app.post("/api/dial")
@app.post("/outbound")
async def trigger_dial(request: Request):
    payload = await parse_params(request)
    to_number = payload.get("to") or payload.get("phone_number")
    if not to_number:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Missing phone number"})

    op = payload.get("operator") or payload.get("created_by") or request.headers.get("X-Operator")
    d = resolve_dialer(request, operator=op)

    async with dial_lock:
        if d.active_call:
            active_num = d.active_call.get("phone_number", "another recipient")
            return JSONResponse(
                status_code=409,
                content={"ok": False, "error": f"Line busy: A call is currently active with {active_num}. Please wait for it to finish."}
            )

        public_url = get_public_url()
        from_number = payload.get("from")
        template_id = payload.get("template_id") or d.selected_template_id
        answer_url = f"{public_url}/answer?to={to_number}&template_id={template_id}&operator={d.operator}"
        hangup_url = f"{public_url}/hangup?operator={d.operator}"

        try:
            result = await vobiz_api.place_call(
                to_number=to_number,
                answer_url=answer_url,
                hangup_url=hangup_url,
                from_number=from_number,
            )
            call_uuid = result.get("request_uuid") or result.get("call_uuid") or ""
            d.set_active_call(
                call_uuid=call_uuid,
                phone_number=to_number,
                customer_name=payload.get("customer_name", ""),
                status="dialing",
                template_id=template_id,
            )
            db.record_call_start(
                call_uuid=call_uuid,
                phone_number=to_number,
                metadata={"customer_name": payload.get("customer_name", ""), "status": "dialing", "operator": d.operator, "created_by": d.operator},
            )
            return {"ok": True, "status": "call_initiated", "call_uuid": call_uuid, "vobiz_response": result}
        except Exception as exc:
            return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})

# Retrieve global transcript setting
@app.get("/api/settings/transcript")
async def get_transcript_setting():
    return {"ok": True, "transcript_enabled": db.is_transcript_enabled()}

# Toggle global transcript setting (also controls Gemini Live audio transcription cost)
@app.post("/api/settings/transcript")
async def set_transcript_setting(request: Request):
    payload = await parse_params(request)
    raw_val = payload.get("enabled") if "enabled" in payload else payload.get("transcript_enabled")
    if isinstance(raw_val, str):
        enabled = raw_val.strip().lower() in ("1", "true", "yes", "on")
    elif raw_val is None:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Missing 'enabled' boolean"})
    else:
        enabled = bool(raw_val)
    val = db.set_transcript_enabled(enabled)
    return {"ok": True, "transcript_enabled": val}

# Retrieve dialer and campaign status for UI HUD
@app.get("/api/campaign/status")
async def get_campaign_status(request: Request):
    d = resolve_dialer(request)
    return d.get_status_payload()

# Fetch CRM pending missed calls
@app.get("/api/crm/pending-calls")
async def get_crm_pending_calls(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = "all",
):
    d = resolve_dialer(request)
    calls = d.fetch_crm_pending(start_date, end_date, status)
    return {"ok": True, "calls": calls, "total": len(calls)}

# Queue selected leads into outbound campaign
@app.post("/api/campaign/leads")
async def queue_campaign_leads(request: Request):
    payload = await request.json()
    leads = payload.get("leads", [])
    batch_name = payload.get("batch_name")
    source_filter = payload.get("source_filter")
    template_id = payload.get("template_id")
    append = payload.get("append", False)
    created_by = payload.get("created_by") or payload.get("operator")
    d = resolve_dialer(request, operator=created_by)
    batch_id = d.queue_leads(
        leads,
        batch_name=batch_name,
        source_filter=source_filter,
        template_id=template_id,
        append=append,
        created_by=created_by,
    )
    return {"ok": True, "batch_id": batch_id, "queued": len(leads), "appended": bool(append)}

# List all campaign templates
@app.get("/api/campaign/templates")
async def list_campaign_templates(request: Request):
    d = resolve_dialer(request)
    return {
        "ok": True,
        "templates": db.get_templates(),
        "selected_template_id": d.selected_template_id,
    }

# Retrieve specific campaign template
@app.get("/api/campaign/templates/{template_id}")
async def get_campaign_template(template_id: str):
    tpl = db.get_template(template_id)
    if not tpl:
        return JSONResponse(status_code=404, content={"ok": False, "error": f"Template {template_id} not found"})
    return {"ok": True, "template": tpl}

# Update a campaign template
@app.put("/api/campaign/templates/{template_id}")
async def update_campaign_template(template_id: str, request: Request):
    body = await request.json()
    body["template_id"] = template_id
    res = db.save_template(body)
    return res

# Create a new campaign template
@app.post("/api/campaign/templates")
async def create_campaign_template(request: Request):
    body = await request.json()
    res = db.save_template(body)
    return res

# Delete a campaign template
@app.delete("/api/campaign/templates/{template_id}")
async def delete_campaign_template(template_id: str, request: Request):
    if template_id == "missed_calls":
        return JSONResponse(status_code=400, content={"ok": False, "error": "Cannot delete core default template"})
    success = db.delete_template(template_id)
    d = resolve_dialer(request)
    if success and d.selected_template_id == template_id:
        d.set_selected_template("missed_calls")
    return {"ok": success}

# Select active campaign template for ad-hoc dials and upcoming batches
@app.post("/api/campaign/select-template")
async def select_campaign_template(request: Request):
    body = await request.json()
    tpl_id = body.get("template_id")
    if not tpl_id:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Missing template_id"})
    d = resolve_dialer(request, operator=body.get("operator"))
    d.set_selected_template(tpl_id)
    return {"ok": True, "selected_template_id": d.selected_template_id}

# Start OBD automated calling
@app.post("/api/campaign/start")
async def start_campaign(request: Request):
    d = resolve_dialer(request)
    d.start(get_public_url())
    return {"ok": True, "status": d.status}

# Pause OBD automated calling
@app.post("/api/campaign/pause")
async def pause_campaign(request: Request):
    d = resolve_dialer(request)
    d.pause()
    return {"ok": True, "status": d.status}

# Resume OBD automated calling
@app.post("/api/campaign/resume")
async def resume_campaign(request: Request):
    d = resolve_dialer(request)
    d.resume(get_public_url())
    return {"ok": True, "status": d.status}

# Stop OBD automated calling
@app.post("/api/campaign/stop")
async def stop_campaign(request: Request):
    d = resolve_dialer(request)
    d.stop()
    return {"ok": True, "status": d.status}

# Clear dialer queue
@app.post("/api/campaign/clear")
async def clear_campaign(request: Request):
    d = resolve_dialer(request)
    d.clear()
    return {"ok": True, "status": d.status}

# Reset dialer queue and counters
@app.post("/api/campaign/reset")
async def reset_campaign(request: Request):
    d = resolve_dialer(request)
    d.reset()
    return {"ok": True, "status": d.status}

# Retrieve all previously called numbers for Excel import exclusion
@app.get("/api/campaign/dialed-numbers")
async def get_dialed_numbers():
    return db.get_existing_called_numbers()

# Retrieve campaign batch list
@app.get("/api/campaign/batches")
async def list_campaign_batches():
    return {"ok": True, "batches": db.get_batches()}

# Retrieve specific batch detail
@app.get("/api/campaign/batches/{batch_id}")
async def get_batch_detail(batch_id: str):
    detail = db.get_batch_detail(batch_id)
    return {"ok": True, **detail}

# Resume an existing batch in-place by queueing only pending leads without creating a new batch
@app.post("/api/campaign/batches/{batch_id}/resume")
async def resume_campaign_batch(batch_id: str, request: Request):
    d = resolve_dialer(request)
    result = d.resume_batch(batch_id)
    if result.get("ok"):
        d.start(get_public_url())
    return result

# Re-run a campaign batch
@app.post("/api/campaign/batches/{batch_id}/rerun")
async def rerun_campaign_batch(batch_id: str, request: Request):
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    mode = body.get("mode", "all")
    d = resolve_dialer(request, operator=body.get("operator"))
    result = d.rerun_batch(batch_id, mode=mode)
    return result

# Delete a campaign batch
@app.delete("/api/campaign/batches/{batch_id}")
async def delete_campaign_batch(batch_id: str, request: Request):
    success = db.delete_batch(batch_id)
    d = resolve_dialer(request)
    if d.current_batch_id == batch_id:
        d.reset()
    return {"ok": success}

# Fetch authenticated call recording bytes from Vobiz
async def fetch_call_recording_bytes(call_uuid: str) -> Tuple[Optional[bytes], Optional[str], Optional[str], int]:
    doc = db.get_call(call_uuid)
    rec_url = (doc.get("recording_url") or doc.get("recordingUrl")) if doc else None

    # Fallback: query Vobiz Recording API if not saved in database
    if not rec_url:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                api_url = f"{vobiz_api.API_BASE}/Account/{vobiz_api.AUTH_ID}/Recording/?call_uuid={call_uuid}"
                r = await client.get(api_url, headers=vobiz_api.get_headers())
                logger.info(f"Vobiz Recording API response for {call_uuid}: status={r.status_code}, body={r.text[:500]}")
                if r.status_code == 200:
                    data = r.json()
                    objs = data.get("objects", [])
                    if objs:
                        rec_url = objs[0].get("recording_url") or objs[0].get("url")
                        if rec_url:
                            db.update_call(call_uuid, {"recording_url": rec_url})
        except Exception as exc:
            logger.warning(f"Error querying Vobiz recording API for {call_uuid}: {exc}")

    if not rec_url:
        return None, None, "No recording available for this call", 404

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(rec_url, headers=vobiz_api.get_headers())
            if resp.status_code != 200:
                logger.warning(f"Recording fetch returned {resp.status_code} for {rec_url}")
                return None, None, "Recording not available from provider", 502
            return resp.content, resp.headers.get("content-type", "audio/mpeg"), None, 200
    except Exception as exc:
        logger.error(f"Failed to fetch recording {rec_url}: {exc}")
        return None, None, "Failed to retrieve recording", 502

# Proxy authenticated audio recording from Vobiz
@app.get("/api/recording/{call_uuid}")
async def get_recording(call_uuid: str):
    content, media_type, err_msg, status_code = await fetch_call_recording_bytes(call_uuid)
    if content is None:
        return Response(content=err_msg or "No recording available", status_code=status_code)
    return Response(
        content=content,
        media_type=media_type or "audio/mpeg",
        headers={"Accept-Ranges": "bytes"},
    )

# Transcribe a specific call's recorded audio (or translate to English) on-demand using Gemini
@app.post("/api/calls/{call_uuid}/transcribe")
async def transcribe_call_audio(call_uuid: str, request: Request):
    force = False
    language = "original"
    try:
        payload = await parse_params(request)
        raw_force = payload.get("force")
        if isinstance(raw_force, str):
            force = raw_force.strip().lower() in ("1", "true", "yes")
        else:
            force = bool(raw_force)
        raw_lang = str(payload.get("language") or "original").strip().lower()
        if raw_lang in ("en", "english"):
            language = "english"
    except Exception:
        pass

    existing_doc = db.find_call_doc(
        call_uuid,
        {"_id": 0, "manual_transcripts": 1, "manual_transcripts_en": 1, "transcripts": 1},
    )
    cached_orig = (existing_doc or {}).get("manual_transcripts") or []
    cached_en = (existing_doc or {}).get("manual_transcripts_en") or []
    live_turns = (existing_doc or {}).get("transcripts") or []

    if language == "english":
        if cached_en and not force:
            return {
                "ok": True,
                "call_uuid": call_uuid,
                "language": "english",
                "turns": cached_en,
                "cached": True,
                "has_english_transcript": True,
            }

        source_turns = cached_orig or (live_turns if db.is_transcript_enabled() else [])
        if source_turns and not force:
            try:
                en_turns = await translate_turns_to_english_with_gemini(source_turns)
                db.save_manual_transcript(call_uuid, en_turns, language="english")
                return {
                    "ok": True,
                    "call_uuid": call_uuid,
                    "language": "english",
                    "turns": en_turns,
                    "cached": False,
                    "has_english_transcript": True,
                }
            except Exception as exc:
                logger.error(f"On-demand English translation failed for {call_uuid}: {exc}")
                return JSONResponse(status_code=500, content={"ok": False, "error": f"English translation failed: {exc}"})

        audio_bytes, media_type, err_msg, status_code = await fetch_call_recording_bytes(call_uuid)
        if audio_bytes is None:
            return JSONResponse(status_code=status_code, content={"ok": False, "error": err_msg or "No recording available for this call"})
        try:
            en_turns = await transcribe_audio_bytes_with_gemini(audio_bytes, media_type or "audio/mpeg", target_language="english")
            db.save_manual_transcript(call_uuid, en_turns, language="english")
            return {
                "ok": True,
                "call_uuid": call_uuid,
                "language": "english",
                "turns": en_turns,
                "cached": False,
                "has_english_transcript": True,
            }
        except Exception as exc:
            logger.error(f"On-demand English transcription failed for {call_uuid}: {exc}")
            return JSONResponse(status_code=500, content={"ok": False, "error": f"Transcription failed: {exc}"})

    if cached_orig and not force:
        return {
            "ok": True,
            "call_uuid": call_uuid,
            "language": "original",
            "turns": cached_orig,
            "cached": True,
            "has_manual_transcript": True,
        }

    audio_bytes, media_type, err_msg, status_code = await fetch_call_recording_bytes(call_uuid)
    if audio_bytes is None:
        return JSONResponse(status_code=status_code, content={"ok": False, "error": err_msg or "No recording available for this call"})

    try:
        turns = await transcribe_audio_bytes_with_gemini(audio_bytes, media_type or "audio/mpeg", target_language="original")
        db.save_manual_transcript(call_uuid, turns, language="original", clear_english=force)
        return {
            "ok": True,
            "call_uuid": call_uuid,
            "language": "original",
            "turns": turns,
            "cached": False,
            "has_manual_transcript": True,
        }
    except Exception as exc:
        logger.error(f"On-demand audio transcription failed for {call_uuid}: {exc}")
        return JSONResponse(status_code=500, content={"ok": False, "error": f"Transcription failed: {exc}"})

# Retrieve global disposition and status metrics for all calls
@app.get("/api/calls/stats")
async def get_calls_stats(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    return db.get_call_stats(start_date=start_date, end_date=end_date)

# Retrieve paginated call history and transcripts with server-side filters
@app.get("/calls")
async def list_calls(
    page: int = 1,
    limit: int = 50,
    search: Optional[str] = None,
    disposition: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    has_recording: Optional[bool] = None,
    has_callback: Optional[bool] = None,
):
    return db.get_paginated_calls(
        page=page,
        limit=limit,
        search=search,
        disposition=disposition,
        start_date=start_date,
        end_date=end_date,
        has_recording=has_recording,
        has_callback=has_callback,
    )

# Retrieve single call record with full transcripts, carrier logs, and events
@app.get("/api/calls/{call_uuid}")
async def get_call_detail(call_uuid: str):
    doc = db.get_call(call_uuid)
    if not doc:
        return JSONResponse(status_code=404, content={"ok": False, "error": "Call not found"})
    return {"ok": True, "call": doc}

# Update call record fields like disposition and callback time
@app.api_route("/api/call/{call_uuid}", methods=["PATCH", "POST"])
async def update_call_record(call_uuid: str, request: Request):
    payload = await parse_params(request)
    updates: Dict[str, Any] = {}
    if "disposition" in payload and payload["disposition"] is not None:
        updates["disposition"] = str(payload["disposition"]).strip().lower()
    if "callback_time" in payload and payload["callback_time"] is not None:
        updates["callback_time"] = str(payload["callback_time"]).strip()
    if "customer_name" in payload and payload["customer_name"] is not None:
        updates["customer_name"] = str(payload["customer_name"]).strip()
    if not updates:
        return JSONResponse(status_code=400, content={"ok": False, "error": "No update fields provided"})
    db.update_call(call_uuid, updates)
    return {"ok": True, "call_uuid": call_uuid, "updates": updates}

if __name__ == "__main__":
    reload_enabled = os.getenv("UVICORN_RELOAD", "false").lower() == "true"
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=reload_enabled)
