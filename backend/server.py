import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from html import escape
import json
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qsl

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect, Depends, HTTPException, status
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
import auth
import email_service
from auth import get_current_user, require_admin, get_optional_user
from agent import run_vobiz_agent
from dialer import dialer

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

# Resolve frontend URL for email verification & reset links
def get_frontend_url() -> str:
    front = os.getenv("FRONTEND_URL", "").rstrip("/")
    if front:
        return front
    pub = get_public_url()
    if pub:
        return pub
    return f"http://localhost:3000"

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
    auth.init_admin_user()
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
    active_call_meta = (
        dialer.link_call_uuid(call_uuid, to_number=to_number, req_uuid=params.get("req_uuid"))
        or dialer.active_calls.get(call_uuid)
        or (dialer.active_call if (dialer.active_call and (not call_uuid or dialer.active_call.get("call_uuid") == call_uuid)) else {})
    )
    batch_id = params.get("batch_id") or active_call_meta.get("batch_id")
    template_id = params.get("template_id") or active_call_meta.get("template_id") or dialer.selected_template_id
    creator_id = active_call_meta.get("created_by_id")
    creator_name = active_call_meta.get("created_by_name")
    asyncio.create_task(
        asyncio.to_thread(
            db.record_call_start,
            call_uuid,
            phone_number=to_number,
            batch_id=batch_id,
            metadata=params,
            created_by_id=creator_id,
            created_by_name=creator_name,
        )
    )
    dialer.set_call_status(call_uuid, "in_call")
    tracer = diagnostics.get_tracer(call_uuid, phone_number=to_number, batch_id=batch_id)
    tracer.t_answer = t_answer
    tracer.record_event("call_answered", {"timestamp": t_answer, "to": to_number, "from": from_number, "call_id": call_uuid})

    public_url = get_public_url()
    status_callback = xml_escape(f"{public_url}/stream-status")
    rec_callback = xml_escape(f"{public_url}/recording-callback?batch_id={batch_id or ''}&to={to_number}")
    ws_stream_url = get_ws_url(f"/ws?call_uuid={call_uuid}&to={to_number}&batch_id={batch_id or ''}&template_id={template_id or ''}")

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
        dialer.on_call_ended(call_uuid, phone_number=to_number)
    return {"status": "ok"}

# Real-time WebSocket endpoint bridged to Pipecat agent
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    query_params = dict(websocket.query_params)
    call_uuid = query_params.get("call_uuid", "unknown_call")
    to_number = query_params.get("to", "")
    batch_id = query_params.get("batch_id") or (dialer.active_call.get("batch_id") if dialer.active_call else None) or dialer.current_batch_id
    template_id = query_params.get("template_id") or (dialer.active_call.get("template_id") if dialer.active_call else None) or dialer.selected_template_id
    dialer.set_call_status(call_uuid, "in_call")
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
        dialer.on_call_ended(call_uuid, phone_number=to_number)

dial_lock = asyncio.Lock()

# Trigger single test dial (compatible with multi-channel concurrent execution)
@app.post("/api/dial")
@app.post("/outbound")
async def trigger_dial(request: Request, current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)):
    payload = await parse_params(request)
    to_number = payload.get("to") or payload.get("phone_number")
    if not to_number:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Missing phone number"})

    async with dial_lock:
        if len(dialer.active_calls) >= dialer.max_concurrency:
            return JSONResponse(
                status_code=429,
                content={"ok": False, "error": f"All {dialer.max_concurrency} concurrent channels are currently active. Please wait for an active call to finish."}
            )

        public_url = get_public_url()
        from_number = payload.get("from")
        template_id = payload.get("template_id") or dialer.selected_template_id
        answer_url = f"{public_url}/answer?to={to_number}&template_id={template_id}"
        hangup_url = f"{public_url}/hangup"

        creator_id = current_user.get("id") if current_user else None
        creator_name = current_user.get("name") if current_user else "Manual Dial"

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
                template_id=template_id,
                created_by_id=creator_id,
                created_by_name=creator_name,
            )
            db.record_call_start(
                call_uuid=call_uuid,
                phone_number=to_number,
                metadata={"customer_name": payload.get("customer_name", ""), "status": "dialing"},
                created_by_id=creator_id,
                created_by_name=creator_name,
            )
            return {"ok": True, "status": "call_initiated", "call_uuid": call_uuid, "vobiz_response": result}
        except Exception as exc:
            return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})

# Retrieve dialer and campaign status for UI HUD (strictly scoped to current user's queue & active calls)
@app.get("/api/campaign/status")
async def get_campaign_status(
    request: Request,
    user_id: Optional[str] = None,
    user_name: Optional[str] = None,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    import urllib.parse
    eff_id = (current_user.get("id") if current_user else None) or user_id or request.headers.get("x-user-id")
    eff_name = (current_user.get("name") if current_user else None) or user_name or request.headers.get("x-user-name")
    eff_email = (current_user.get("email") if current_user else None) or request.headers.get("x-user-email")
    if eff_name and "%" in eff_name:
        try:
            eff_name = urllib.parse.unquote(eff_name)
        except Exception:
            pass

    return dialer.get_status_payload(user_id=eff_id, user_name=eff_name, user_email=eff_email)

# Fetch CRM pending missed calls
@app.get("/api/crm/pending-calls")
async def get_crm_pending_calls(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = "all",
):
    calls = dialer.fetch_crm_pending(start_date, end_date, status)
    return {"ok": True, "calls": calls, "total": len(calls)}

# Queue selected leads into outbound campaign with creator attribution
@app.post("/api/campaign/leads")
async def queue_campaign_leads(request: Request, current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)):
    import urllib.parse
    payload = await request.json()
    leads = payload.get("leads", [])
    batch_name = payload.get("batch_name")
    source_filter = payload.get("source_filter")
    template_id = payload.get("template_id")
    creator_id = (
        (current_user.get("id") if current_user else None)
        or payload.get("created_by_id")
        or request.headers.get("x-user-id")
    )
    creator_name = (
        (current_user.get("name") if current_user else None)
        or payload.get("created_by_name")
        or request.headers.get("x-user-name")
    )
    creator_email = (
        (current_user.get("email") if current_user else None)
        or payload.get("created_by_email")
        or request.headers.get("x-user-email")
    )
    if creator_name and "%" in creator_name:
        try:
            creator_name = urllib.parse.unquote(creator_name)
        except Exception:
            pass
    if not creator_name:
        creator_name = "Super Admin" if creator_id == "admin_root" else "Employee"

    batch_id = dialer.queue_leads(
        leads,
        batch_name=batch_name,
        source_filter=source_filter,
        template_id=template_id,
        created_by_id=creator_id,
        created_by_name=creator_name,
        created_by_email=creator_email,
    )
    return {"ok": True, "batch_id": batch_id, "queued": len(leads)}

# List all campaign templates
@app.get("/api/campaign/templates")
async def list_campaign_templates():
    return {
        "ok": True,
        "templates": db.get_templates(),
        "selected_template_id": dialer.selected_template_id,
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
async def delete_campaign_template(template_id: str):
    if template_id == "missed_calls":
        return JSONResponse(status_code=400, content={"ok": False, "error": "Cannot delete core default template"})
    success = db.delete_template(template_id)
    if success and dialer.selected_template_id == template_id:
        dialer.set_selected_template("missed_calls")
    return {"ok": success}

# Select active campaign template for ad-hoc dials and upcoming batches
@app.post("/api/campaign/select-template")
async def select_campaign_template(request: Request):
    body = await request.json()
    tpl_id = body.get("template_id")
    if not tpl_id:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Missing template_id"})
    dialer.set_selected_template(tpl_id)
    return {"ok": True, "selected_template_id": dialer.selected_template_id}

# Start OBD automated calling for user's queue
@app.post("/api/campaign/start")
async def start_campaign(request: Request, current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)):
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    user_id = (
        (current_user.get("id") if current_user else None)
        or body.get("user_id")
        or request.headers.get("x-user-id")
        or "default"
    )
    user_name = (
        (current_user.get("name") if current_user else None)
        or body.get("user_name")
        or request.headers.get("x-user-name")
    )
    if user_name and "%" in user_name:
        import urllib.parse
        try:
            user_name = urllib.parse.unquote(user_name)
        except Exception:
            pass
    dialer.start_user(user_id, get_public_url(), user_name=user_name)
    return {"ok": True, "status": dialer.get_user_status(user_id, user_name)}

# Pause OBD automated calling for user's queue
@app.post("/api/campaign/pause")
async def pause_campaign(request: Request, current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)):
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    user_id = (
        (current_user.get("id") if current_user else None)
        or body.get("user_id")
        or request.headers.get("x-user-id")
        or "default"
    )
    user_name = (
        (current_user.get("name") if current_user else None)
        or body.get("user_name")
        or request.headers.get("x-user-name")
    )
    dialer.pause_user(user_id, user_name=user_name)
    return {"ok": True, "status": dialer.get_user_status(user_id, user_name)}

# Resume OBD automated calling for user's queue
@app.post("/api/campaign/resume")
async def resume_campaign(request: Request, current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)):
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    user_id = (
        (current_user.get("id") if current_user else None)
        or body.get("user_id")
        or request.headers.get("x-user-id")
        or "default"
    )
    user_name = (
        (current_user.get("name") if current_user else None)
        or body.get("user_name")
        or request.headers.get("x-user-name")
    )
    dialer.resume_user(user_id, get_public_url(), user_name=user_name)
    return {"ok": True, "status": dialer.get_user_status(user_id, user_name)}

# Stop OBD automated calling for user's queue
@app.post("/api/campaign/stop")
async def stop_campaign(request: Request, current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)):
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    user_id = (
        (current_user.get("id") if current_user else None)
        or body.get("user_id")
        or request.headers.get("x-user-id")
        or "default"
    )
    user_name = (
        (current_user.get("name") if current_user else None)
        or body.get("user_name")
        or request.headers.get("x-user-name")
    )
    dialer.stop_user(user_id, user_name=user_name)
    return {"ok": True, "status": dialer.get_user_status(user_id, user_name)}

# Clear user's pending queue
@app.post("/api/campaign/clear")
@app.post("/api/campaign/reset")
async def reset_campaign(request: Request, current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)):
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    user_id = (
        (current_user.get("id") if current_user else None)
        or body.get("user_id")
        or request.headers.get("x-user-id")
        or "default"
    )
    user_name = (
        (current_user.get("name") if current_user else None)
        or body.get("user_name")
        or request.headers.get("x-user-name")
    )
    user_email = (
        (current_user.get("email") if current_user else None)
        or request.headers.get("x-user-email")
    )
    dialer.reset_user(user_id, user_name, user_email)
    return {"ok": True, "status": "idle"}

# Retrieve campaign batch list with creator attribution
@app.get("/api/campaign/batches")
async def list_campaign_batches(current_user: Optional[Dict[str, Any]] = Depends(get_optional_user)):
    # All active team members can view all batches and see who ran each one
    return {"ok": True, "batches": db.get_batches(user_id=None, is_admin=True)}

# Retrieve specific batch detail
@app.get("/api/campaign/batches/{batch_id}")
async def get_batch_detail(batch_id: str):
    detail = db.get_batch_detail(batch_id)
    return {"ok": True, **detail}

# Re-run a campaign batch
@app.post("/api/campaign/batches/{batch_id}/rerun")
async def rerun_campaign_batch(
    batch_id: str,
    request: Request,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    mode = body.get("mode", "all")
    creator_id = (current_user.get("id") if current_user else None) or body.get("created_by_id")
    creator_name = (current_user.get("name") if current_user else None) or body.get("created_by_name") or "Super Admin"
    result = dialer.rerun_batch(
        batch_id,
        mode=mode,
        created_by_id=creator_id,
        created_by_name=creator_name,
    )
    return result

# Delete a campaign batch
@app.delete("/api/campaign/batches/{batch_id}")
async def delete_campaign_batch(batch_id: str):
    success = db.delete_batch(batch_id)
    dialer.remove_batch_from_queue(batch_id)
    return {"ok": success}

# =========================================================================
# Multi-User Authentication & Email Verification API
# =========================================================================

import uuid

# User Login endpoint (Strictly authenticated against .env users - Zero DB Touches)
@app.post("/api/auth/login")
async def login_user(request: Request):
    data = await request.json()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Email and password are required"})

    user = auth.authenticate_user(email, password)
    if not user:
        return JSONResponse(status_code=401, content={"ok": False, "error": "Invalid email or password"})

    if not user.get("is_active", True):
        return JSONResponse(status_code=403, content={"ok": False, "error": "Account is disabled"})

    token = auth.create_access_token({
        "user_id": user.get("id"),
        "email": user.get("email"),
        "name": user.get("name"),
        "role": user.get("role", "employee"),
    })

    return {
        "ok": True,
        "token": token,
        "user": {
            "id": user.get("id"),
            "name": user.get("name"),
            "email": user.get("email"),
            "role": user.get("role", "employee"),
            "phone": user.get("phone", ""),
        },
    }

# Get current logged-in user profile
@app.get("/api/auth/me")
async def get_my_profile(current_user: Dict[str, Any] = Depends(get_current_user)):
    return {
        "ok": True,
        "user": {
            "id": current_user.get("id"),
            "name": current_user.get("name"),
            "email": current_user.get("email"),
            "role": current_user.get("role", "employee"),
            "phone": current_user.get("phone", ""),
            "is_active": current_user.get("is_active", True),
        },
    }

# List all configured users / slots (admin only) - ZERO database queries
@app.get("/api/auth/users")
async def list_all_users(current_user: Dict[str, Any] = Depends(require_admin)):
    slots = auth.get_all_user_slots()
    return JSONResponse(content={"ok": True, "users": slots})

# Add employee information (Instructions for .env)
@app.post("/api/auth/users")
async def create_employee_user(request: Request, current_user: Dict[str, Any] = Depends(require_admin)):
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "message": "User accounts are configured directly in .env (Zero DB touches). Open .env and fill USER_X_EMAIL and USER_X_PASSWORD to enable additional employees.",
        },
    )

@app.post("/api/auth/users/{user_id}/resend-activation")
async def resend_user_activation(user_id: str, current_user: Dict[str, Any] = Depends(require_admin)):
    return JSONResponse(content={"ok": True, "message": "Users log in directly using credentials in .env. No email activation required."})

@app.patch("/api/auth/users/{user_id}")
async def update_user_details(user_id: str, request: Request, current_user: Dict[str, Any] = Depends(require_admin)):
    return JSONResponse(content={"ok": True, "message": "Users are managed directly in .env."})

@app.delete("/api/auth/users/{user_id}")
async def delete_user_account(user_id: str, current_user: Dict[str, Any] = Depends(require_admin)):
    return JSONResponse(content={"ok": True, "message": "To remove a user, clear their email & password in .env."})

# Public token verification endpoint
@app.get("/api/auth/verify-token")
async def verify_auth_token(token: str, type: str = "activation"):
    return JSONResponse(content={"ok": True, "message": "Direct login enabled via .env"})

@app.post("/api/auth/activate")
async def activate_employee_account(request: Request):
    return JSONResponse(content={"ok": True, "message": "Users log in directly using credentials in .env."})

@app.post("/api/auth/forgot-password")
async def request_forgot_password(request: Request):
    data = await request.json()
    email = (data.get("email") or "").strip().lower()
    user = auth.get_user_by_email(email)
    if user:
        return {
            "ok": True,
            "message": f"Your account is configured in .env under {user.get('slot', 'env')}. Please check .env or ask your administrator for the password.",
        }
    return {
        "ok": True,
        "message": "If this email is configured in .env, please consult your administrator for the password.",
    }

@app.post("/api/auth/reset-password")
async def execute_reset_password(request: Request):
    return JSONResponse(content={"ok": True, "message": "Passwords are managed in .env."})


# Proxy authenticated audio recording from Vobiz
@app.get("/api/recording/{call_uuid}")
async def get_recording(call_uuid: str):
    doc = db.get_call(call_uuid)
    rec_url = doc.get("recording_url") if doc else None

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
        return Response(content="No recording available for this call", status_code=404)

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(rec_url, headers=vobiz_api.get_headers())
            if resp.status_code != 200:
                logger.warning(f"Recording fetch returned {resp.status_code} for {rec_url}")
                return Response(content="Recording not available from provider", status_code=502)
            return Response(
                content=resp.content,
                media_type=resp.headers.get("content-type", "audio/mpeg"),
                headers={"Accept-Ranges": "bytes"},
            )
    except Exception as exc:
        logger.error(f"Failed to fetch recording {rec_url}: {exc}")
        return Response(content="Failed to retrieve recording", status_code=502)

# Retrieve recent call history and transcripts with optional date range
@app.get("/calls")
async def list_calls(
    limit: int = 500,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    user_id = current_user.get("id") if current_user else None
    is_admin = current_user.get("role") == "admin" if current_user else True
    return db.get_recent_calls(limit=limit, start_date=start_date, end_date=end_date, user_id=user_id, is_admin=is_admin)

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
