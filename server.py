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

logging.getLogger("uvicorn.access").addFilter(PollingEndpointFilter())

load_dotenv(override=True)

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
from agent import run_vobiz_agent
from dialer import dialer

BASE_DIR = Path(__file__).parent
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
LEGACY_INDEX = BASE_DIR / "templates" / "index.html"

# Mount frontend assets if compiled React bundle exists
if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="frontend_assets")

# Serve the Swargaseema AI Telephony Console UI
@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    if FRONTEND_INDEX.exists():
        return HTMLResponse(content=FRONTEND_INDEX.read_text(encoding="utf-8"))
    if LEGACY_INDEX.exists():
        return HTMLResponse(content=LEGACY_INDEX.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>UI Template Not Found</h1>", status_code=404)

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
    batch_id = params.get("batch_id") or (dialer.active_call.get("batch_id") if dialer.active_call else None) or dialer.current_batch_id
    asyncio.create_task(asyncio.to_thread(db.record_call_start, call_uuid, phone_number=to_number, batch_id=batch_id, metadata=params))
    dialer.set_call_status(call_uuid, "in_call")
    tracer = diagnostics.get_tracer(call_uuid, phone_number=to_number, batch_id=batch_id)
    tracer.t_answer = t_answer
    tracer.record_event("call_answered", {"timestamp": t_answer, "to": to_number, "from": from_number, "call_id": call_uuid})

    public_url = get_public_url()
    status_callback = xml_escape(f"{public_url}/stream-status")
    rec_callback = xml_escape(f"{public_url}/recording-callback?batch_id={batch_id or ''}&to={to_number}")
    ws_stream_url = get_ws_url(f"/ws?call_uuid={call_uuid}&to={to_number}&batch_id={batch_id or ''}")

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

dial_lock = asyncio.Lock()

# Trigger single test dial (compatible with UI dial button)
@app.post("/api/dial")
@app.post("/outbound")
async def trigger_dial(request: Request):
    payload = await parse_params(request)
    to_number = payload.get("to") or payload.get("phone_number")
    if not to_number:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Missing phone number"})

    async with dial_lock:
        if dialer.active_call:
            active_num = dialer.active_call.get("phone_number", "another recipient")
            return JSONResponse(
                status_code=409,
                content={"ok": False, "error": f"Line busy: A call is currently active with {active_num}. Please wait for it to finish."}
            )

        public_url = get_public_url()
        answer_url = f"{public_url}/answer"
        hangup_url = f"{public_url}/hangup"
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
            db.record_call_start(
                call_uuid=call_uuid,
                phone_number=to_number,
                metadata={"customer_name": payload.get("customer_name", ""), "status": "dialing"},
            )
            return {"ok": True, "status": "call_initiated", "call_uuid": call_uuid, "vobiz_response": result}
        except Exception as exc:
            return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})

# Retrieve dialer and campaign status for UI HUD
@app.get("/api/campaign/status")
async def get_campaign_status():
    return dialer.get_status_payload()

# Fetch CRM pending missed calls
@app.get("/api/crm/pending-calls")
async def get_crm_pending_calls(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = "all",
):
    calls = dialer.fetch_crm_pending(start_date, end_date, status)
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
    dialer.start(get_public_url())
    return {"ok": True, "status": dialer.status}

# Pause OBD automated calling
@app.post("/api/campaign/pause")
async def pause_campaign():
    dialer.pause()
    return {"ok": True, "status": dialer.status}

# Resume OBD automated calling
@app.post("/api/campaign/resume")
async def resume_campaign():
    dialer.resume(get_public_url())
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
async def get_recording(call_uuid: str, download: Optional[int] = 0):
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

            headers = {"Accept-Ranges": "bytes"}
            if download:
                phone = (doc.get("phone_number") or "").replace("+", "")
                filename = f"recording_{phone}_{call_uuid[:8]}.mp3" if phone else f"recording_{call_uuid[:8]}.mp3"
                headers["Content-Disposition"] = f'attachment; filename="{filename}"'

            return Response(
                content=resp.content,
                media_type=resp.headers.get("content-type", "audio/mpeg"),
                headers=headers,
            )
    except Exception as exc:
        logger.error(f"Failed to fetch recording {rec_url}: {exc}")
        return Response(content="Failed to retrieve recording", status_code=502)

def clean_translation_turns(turns: List[Dict[str, Any]], lang_code: str) -> List[Dict[str, Any]]:
    import re
    cleaned = []
    has_telugu = lambda s: any("\u0C00" <= ch <= "\u0C7F" for ch in s)
    has_devanagari = lambda s: any("\u0900" <= ch <= "\u097F" for ch in s)

    for t in turns:
        text = str(t.get("text", "")).strip()
        role = t.get("role", "customer")

        if lang_code == "en":
            if has_telugu(text):
                # If text is e.g. "నమస్తే... (Hello...)" extract text inside parentheses
                parenthetical_match = re.search(r"\(([^)]+)\)", text)
                if parenthetical_match:
                    candidate = parenthetical_match.group(1).strip()
                    if not has_telugu(candidate) and any(c.isalpha() for c in candidate):
                        text = candidate
                if has_telugu(text):
                    # Strip out all Telugu unicode blocks
                    no_telugu = re.sub(r"[\u0C00-\u0C7F]+", "", text).strip()
                    no_telugu = re.sub(r"^[()\-:\s\.\,]+|[()\-:\s\.\,]+$", "", no_telugu).strip()
                    if no_telugu and any(c.isalpha() for c in no_telugu):
                        text = no_telugu
        elif lang_code == "hi":
            if has_telugu(text) and has_devanagari(text):
                parenthetical_match = re.search(r"\(([^)]+)\)", text)
                if parenthetical_match:
                    candidate = parenthetical_match.group(1).strip()
                    if has_devanagari(candidate) and not has_telugu(candidate):
                        text = candidate
                if has_telugu(text):
                    no_telugu = re.sub(r"[\u0C00-\u0C7F]+", "", text).strip()
                    no_telugu = re.sub(r"^[()\-:\s\.\,]+|[()\-:\s\.\,]+$", "", no_telugu).strip()
                    if no_telugu and has_devanagari(no_telugu):
                        text = no_telugu

        cleaned.append({"role": role, "text": text.strip()})
    return cleaned

# Convert / translate call transcript or recording to English or Hindi using Gemini AI
@app.api_route("/api/calls/{call_uuid}/translate", methods=["GET", "POST"])
async def translate_call_transcript(call_uuid: str, request: Request):
    lang = "en"
    force_audio = False
    if request.method == "POST":
        try:
            body = await request.json()
            lang = body.get("language") or body.get("lang") or "en"
            force_audio = bool(body.get("force_audio") or body.get("force") or False)
        except Exception:
            params = dict(request.query_params)
            lang = params.get("language") or params.get("lang") or "en"
            force_audio = params.get("force_audio") in ("1", "true", "True")
    else:
        params = dict(request.query_params)
        lang = params.get("language") or params.get("lang") or "en"
        force_audio = params.get("force_audio") in ("1", "true", "True")

    raw_lang = str(lang).lower().strip()
    if raw_lang in ("orig", "original", "telugu"):
        lang_code = "orig"
        lang_name = "Original Spoken Language"
    elif raw_lang in ("hi", "hindi"):
        lang_code = "hi"
        lang_name = "Hindi"
    else:
        lang_code = "en"
        lang_name = "English"

    doc = db.get_call(call_uuid)
    if not doc:
        return JSONResponse(status_code=404, content={"ok": False, "error": "Call record not found"})

    cache_field = "transcripts" if lang_code == "orig" else f"transcripts_{lang_code}"
    # If not forcing audio re-transcription, check cache first
    if not force_audio and doc.get(cache_field) and len(doc[cache_field]) > 0:
        cleaned_cached = clean_translation_turns(doc[cache_field], lang_code)
        return {
            "ok": True,
            "call_uuid": call_uuid,
            "language": lang_code,
            "language_name": lang_name,
            "turns": cleaned_cached,
            "cached": True,
            "source": "cache",
        }

    turns = doc.get("turns") or doc.get("transcripts") or []

    # If force_audio requested OR no text turns exist, fetch audio recording
    audio_bytes = None
    if force_audio or not turns:
        rec_url = doc.get("recording_url")
        if not rec_url:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    api_url = f"{vobiz_api.API_BASE}/Account/{vobiz_api.AUTH_ID}/Recording/?call_uuid={call_uuid}"
                    r = await client.get(api_url, headers=vobiz_api.get_headers())
                    if r.status_code == 200:
                        objs = r.json().get("objects", [])
                        if objs:
                            rec_url = objs[0].get("recording_url") or objs[0].get("url")
                            if rec_url:
                                db.update_call(call_uuid, {"recording_url": rec_url})
            except Exception as e:
                logger.warning(f"Failed to lookup recording for translation: {e}")

        if rec_url:
            try:
                async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                    resp = await client.get(rec_url, headers=vobiz_api.get_headers())
                    if resp.status_code == 200:
                        audio_bytes = resp.content
            except Exception as e:
                logger.warning(f"Failed to download audio for translation: {e}")

    # If force_audio was explicitly requested but audio recording is not available
    if force_audio and not audio_bytes:
        return JSONResponse(
            status_code=404,
            content={"ok": False, "error": "No call audio recording is available from the carrier to re-transcribe."},
        )

    if not turns and not audio_bytes:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "No conversation turns or audio recording found for this call to convert."},
        )

    # Call Gemini to translate turns or audio recording
    from google.genai import Client, types
    import agent
    import re

    translated_turns = []
    last_err = ""
    attempts = len(agent.GEMINI_API_KEYS) or 1
    used_source = "audio" if (force_audio or (audio_bytes and not turns)) else "transcript"

    for attempt in range(attempts):
        api_key = agent.get_gemini_api_key()
        try:
            client = Client(api_key=api_key)
            if used_source == "audio":
                # Audio-based transcription directly from call audio
                if lang_code == "en":
                    prompt = (
                        "You are an expert audio transcriber and translator for real estate customer phone calls.\n"
                        "Listen carefully to this entire phone call audio recording from start to finish.\n"
                        "STRICT MANDATORY RULES:\n"
                        "1. TRANSLATE COMPLETELY INTO 100% PURE ENGLISH ONLY.\n"
                        "2. NEVER output any Telugu script characters (న, మ, etc.). No bilingual parentheses like 'Telugu (English)'. Replace all Telugu text entirely with natural English.\n"
                        "3. CAPTURE EVERY SINGLE SPOKEN UTTERANCE: Listen closely to everything spoken by both Ananya and the Customer, including questions, complaints, arguments, hesitation, or greetings.\n"
                        "4. SPEAKER LABELS: Identify each speaker as either 'agent' (Ananya) or 'customer'.\n"
                        "5. OUTPUT FORMAT: Return ONLY a valid JSON array of objects with keys 'role' and 'text'.\n"
                        "Format example:\n"
                        "[\n"
                        '  {"role": "agent", "text": "Hello, I am Ananya speaking from Swargaseema. You gave us a missed call. Are you interested in Swargaseema projects?"},\n'
                        '  {"role": "customer", "text": "Tell me. Yes, I am interested. Hello? Hello?"}\n'
                        "]\n"
                        "No markdown formatting, no explanations."
                    )
                elif lang_code == "hi":
                    prompt = (
                        "You are an expert audio transcriber and translator for real estate customer phone calls.\n"
                        "Listen carefully to this entire phone call audio recording from start to finish.\n"
                        "STRICT MANDATORY RULES:\n"
                        "1. TRANSLATE COMPLETELY INTO 100% PURE HINDI (in Devanagari script) ONLY.\n"
                        "2. NEVER output any Telugu script characters (న, మ, etc.). No bilingual parentheses. Replace all dialogue completely with natural Hindi.\n"
                        "3. CAPTURE EVERY SINGLE SPOKEN UTTERANCE: Listen closely to everything spoken by both Ananya and the Customer.\n"
                        "4. SPEAKER LABELS: Identify each speaker as either 'agent' (Ananya) or 'customer'.\n"
                        "5. OUTPUT FORMAT: Return ONLY a valid JSON array of objects with keys 'role' and 'text'.\n"
                        "Format example:\n"
                        "[\n"
                        '  {"role": "agent", "text": "नमस्ते, मैं स्वर्गसीमा से अनन्या बात कर रही हूँ। आपने हमें मिस्ड कॉल किया था। क्या आप स्वर्गसीमा प्रोजेक्ट्स में रुचि रखते हैं?"},\n'
                        '  {"role": "customer", "text": "बताइए। हाँ, मुझे दिलचस्पी है।"}\n'
                        "]\n"
                        "No markdown formatting, no explanations."
                    )
                else:
                    prompt = (
                        "Listen carefully to this entire phone call recording between Swargaseema Voice AI Ananya and a customer.\n"
                        "Transcribe every turn of the conversation in the exact language spoken (primarily Telugu/Hindi/English).\n"
                        "Do not skip any words spoken by the customer or the agent, even if faint, brief, or interrupted.\n"
                        "Identify and label each speaker as either 'agent' (Ananya) or 'customer'.\n"
                        "Return ONLY a valid JSON array of objects with keys 'role' and 'text'. No markdown code fences, no extra commentary.\n"
                        "Format example:\n"
                        '[{"role": "agent", "text": "నమస్తే అండి..."}, {"role": "customer", "text": "హలో..."}]'
                    )

                res = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[
                        types.Part.from_bytes(data=audio_bytes, mime_type="audio/mp3"),
                        prompt,
                    ],
                )
                raw = res.text.strip()
                match = re.search(r"\[\s*\{.*\}\s*\]", raw, re.DOTALL)
                if match:
                    translated_turns = json.loads(match.group(0))
                else:
                    translated_turns = json.loads(raw)
                break
            else:
                if lang_code == "en":
                    prompt = (
                        "You are an expert real estate dialogue translator.\n"
                        "Translate the following phone call conversation turns between Ananya (Voice AI) and a Customer into 100% PURE ENGLISH ONLY.\n"
                        "STRICT RULES:\n"
                        "1. Output must be 100% PURE ENGLISH ONLY. DO NOT include any Telugu words, Telugu script (న, మ, etc.), or bilingual parentheses like 'Telugu (English)'.\n"
                        "2. Replace the text completely with natural, fluent English.\n"
                        "3. Preserve exact speaker roles ('agent' and 'customer').\n"
                        "4. Return ONLY a valid JSON array of objects with keys 'role' and 'text'.\n"
                        "Format example:\n"
                        '[{"role": "agent", "text": "Hello, I am Ananya speaking from Swargaseema..."}, {"role": "customer", "text": "Yes, I am interested."}]\n\n'
                        f"Original dialogue to translate:\n"
                        f"{json.dumps(turns, ensure_ascii=False)}"
                    )
                elif lang_code == "hi":
                    prompt = (
                        "You are an expert real estate dialogue translator.\n"
                        "Translate the following phone call conversation turns between Ananya (Voice AI) and a Customer into 100% PURE HINDI (Devanagari script) ONLY.\n"
                        "STRICT RULES:\n"
                        "1. Output must be 100% PURE HINDI ONLY. DO NOT include any Telugu words, Telugu script (న, మ, etc.), or bilingual mixture.\n"
                        "2. Replace the text completely with natural, fluent Hindi.\n"
                        "3. Preserve exact speaker roles ('agent' and 'customer').\n"
                        "4. Return ONLY a valid JSON array of objects with keys 'role' and 'text'.\n"
                        "Format example:\n"
                        '[{"role": "agent", "text": "नमस्ते, मैं अनन्या..."}, {"role": "customer", "text": "हाँ, मैं इच्छुक हूँ।"}]\n\n'
                        f"Original dialogue to translate:\n"
                        f"{json.dumps(turns, ensure_ascii=False)}"
                    )
                else:
                    prompt = (
                        f"You are an expert real estate multilingual translation assistant.\n"
                        f"Format the following phone call turns into a valid JSON array:\n"
                        f"{json.dumps(turns, ensure_ascii=False)}"
                    )

                res = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt,
                )
                raw = res.text.strip()
                match = re.search(r"\[\s*\{.*\}\s*\]", raw, re.DOTALL)
                if match:
                    translated_turns = json.loads(match.group(0))
                else:
                    translated_turns = json.loads(raw)
                break
        except Exception as exc:
            last_err = str(exc)
            logger.warning(f"Translation attempt {attempt+1} failed: {exc}")
            agent.rotate_gemini_api_key(f"Translation failure: {exc}")

    if not translated_turns:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": f"Failed to translate conversation: {last_err}"},
        )

    # Clean translated turns to ensure 100% pure target language without leftover Telugu text
    translated_turns = clean_translation_turns(translated_turns, lang_code)

    # Cache translated turns in MongoDB under their dedicated language field (never overwrite original live transcript with translations)
    if lang_code == "orig":
        if used_source == "audio" or not turns:
            db.update_call(call_uuid, {"transcripts": translated_turns})
    else:
        db.update_call(call_uuid, {cache_field: translated_turns})

    return {
        "ok": True,
        "call_uuid": call_uuid,
        "language": lang_code,
        "language_name": lang_name,
        "turns": translated_turns,
        "source": used_source,
        "cached": False,
    }

# Retrieve recent call history and transcripts with optional date range
@app.get("/calls")
async def list_calls(
    limit: int = 500,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    return db.get_recent_calls(limit=limit, start_date=start_date, end_date=end_date)

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=True)
