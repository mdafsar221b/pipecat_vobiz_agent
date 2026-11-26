import asyncio
import base64
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import time
from typing import Any, Callable, Dict, List, Optional
from dotenv import load_dotenv
from google.genai import Client, types
from loguru import logger
from starlette.websockets import WebSocket

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

from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import EndFrame, LLMContextFrame, LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.workers.runner import WorkerRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    AssistantTurnStoppedMessage,
    LLMContextAggregatorPair,
    UserTurnMessageAddedMessage,
)
from pipecat.services.google.gemini_live.llm import (
    Blob,
    EndSensitivity,
    GeminiLiveLLMService,
    GeminiVADParams,
    StartSensitivity,
)
from pipecat.services.llm_service import FunctionCallParams, FunctionCallResultProperties
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

import db
import diagnostics
import vobiz_api
from vobiz_serializer import VobizFrameSerializer

def mask_key(k: str) -> str:
    if not k or len(k) <= 8:
        return "****"
    return f"{k[:6]}...{k[-4:]}"

def load_gemini_api_keys() -> List[str]:
    keys: List[str] = []
    # 1. Primary paid key
    p = os.getenv("GEMINI_API_KEY", "").strip()
    if p and p not in keys:
        keys.append(p)
    # 2. Secondary fallback
    f = os.getenv("GEMINI_API_KEY_FALLBACK", "").strip()
    if f and f not in keys:
        keys.append(f)
    # 3. Numbered fallback keys (GEMINI_API_KEY_3, GEMINI_API_KEY_4, ...)
    for i in range(3, 10):
        k = os.getenv(f"GEMINI_API_KEY_{i}", "").strip()
        if k and k not in keys:
            keys.append(k)
    return keys

GEMINI_API_KEYS = load_gemini_api_keys()
_current_key_idx = 0
logger.info(f"Loaded {len(GEMINI_API_KEYS)} Gemini API key(s) into rotation pool: {[mask_key(k) for k in GEMINI_API_KEYS]}")

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-live-preview")
GEMINI_VOICE = os.getenv("GEMINI_VOICE", "Aoede")
AGENT_GREETING = os.getenv(
    "AGENT_GREETING",
    "నమస్తే అండి! నేను అనన్య స్వర్గసీమ నుంచి మాట్లాడుతున్నాను. మీరు మాకు మిస్డ్ కాల్ చేశారు. మీకు స్వర్గసీమ ప్రాజెక్ట్స్ లో ఇంట్రెస్ట్ ఉందా అండి?",
)
AGENT_SYSTEM_PROMPT = os.getenv("AGENT_SYSTEM_PROMPT", "")

GREETING_AUDIO_PATH = BASE_DIR / "assets" / "greeting_telugu_16k.pcm"
CACHED_GREETING_PCM: bytes = b""
if GREETING_AUDIO_PATH.exists():
    CACHED_GREETING_PCM = GREETING_AUDIO_PATH.read_bytes()
    logger.info(f"Loaded cached greeting audio: {len(CACHED_GREETING_PCM)} bytes ({len(CACHED_GREETING_PCM)/32000:.2f}s)")

# Detect active language from spoken script
def detect_spoken_language(text: str, default_lang: str = "telugu") -> str:
    lower = text.lower()
    if "telugu" in lower or any("\u0C00" <= ch <= "\u0C7F" for ch in text):
        return "telugu"
    for ch in text:
        if "\u0900" <= ch <= "\u097F":
            return "hindi"
    if any(w in lower for w in ["kya", "aap", "hum", "hai", "nahi", "nahin", "shukriya", "baat", "namaste", "dhanyawad", "bolo", "batao", "kahan", "kaun"]):
        return "hindi"
    if any(w in lower for w in ["speak in english", "english please", "in english"]):
        return "english"
    return default_lang

# Build system instruction with dynamic real-time date context
def build_system_instruction(custom_prompt: Optional[str] = None) -> str:
    ist = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(ist)
    current_date_str = now.strftime("%A, %d %B %Y")
    current_time_str = now.strftime("%I:%M %p")
    base_prompt = (custom_prompt if (custom_prompt and custom_prompt.strip()) else os.getenv("AGENT_SYSTEM_PROMPT", ""))
    temporal_context = (
        f"\n\n### REAL-TIME TEMPORAL CONTEXT\n"
        f"- Today's exact date is: {current_date_str}.\n"
        f"- Current time is: {current_time_str} IST.\n"
        f"- PAST DATE CORRECTION: You know today's exact date is {current_date_str}. If the customer proposes any date that is in the past (before {current_date_str}), you must immediately correct them politely and ask for an upcoming date (e.g. today, tomorrow, or later this week). Do not accept or agree to any past date."
    )
    return base_prompt + temporal_context

# Retrieve active Gemini API key from rotation pool
def get_gemini_api_key() -> str:
    global _current_key_idx
    if not GEMINI_API_KEYS:
        raise ValueError("No Gemini API keys configured in environment.")
    return GEMINI_API_KEYS[_current_key_idx % len(GEMINI_API_KEYS)]

# Rotate to the next available API key in case of quota, rate limit, or expiry issues
def rotate_gemini_api_key(reason: str = "quota/error") -> str:
    global _current_key_idx
    if not GEMINI_API_KEYS:
        raise ValueError("No Gemini API keys configured in environment.")
    old_idx = _current_key_idx % len(GEMINI_API_KEYS)
    _current_key_idx = (_current_key_idx + 1) % len(GEMINI_API_KEYS)
    new_idx = _current_key_idx % len(GEMINI_API_KEYS)
    old_masked = mask_key(GEMINI_API_KEYS[old_idx])
    new_masked = mask_key(GEMINI_API_KEYS[new_idx])
    logger.warning(
        f"🔄 [GEMINI KEY ROTATED] Reason: {reason} | [{old_idx}] {old_masked} -> [{new_idx}] {new_masked} (Available keys: {len(GEMINI_API_KEYS)})"
    )
    return GEMINI_API_KEYS[new_idx]

# Detect clean audio MIME type from file magic bytes or HTTP Content-Type
def detect_audio_mime_type(audio_bytes: bytes, content_type: str = "") -> str:
    if audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE":
        return "audio/wav"
    if audio_bytes[:3] == b"ID3" or (len(audio_bytes) >= 2 and audio_bytes[0] == 0xFF and (audio_bytes[1] & 0xE0) == 0xE0):
        return "audio/mpeg"
    if audio_bytes[:4] == b"OggS":
        return "audio/ogg"
    if audio_bytes[:4] == b"fLaC":
        return "audio/flac"
    clean_ct = (content_type or "").split(";")[0].strip().lower()
    if clean_ct.startswith("audio/"):
        if clean_ct in ("audio/x-wav", "audio/wave"):
            return "audio/wav"
        if clean_ct == "audio/mp3":
            return "audio/mpeg"
        return clean_ct
    return "audio/mpeg"

# Shared Gemini JSON generation helper with model fallback, 503 retry, and API key rotation
async def _call_gemini_json_with_fallback(contents: List[Any], op_label: str = "transcription") -> Any:
    if not GEMINI_API_KEYS:
        raise ValueError("No Gemini API keys configured in environment.")

    primary_model = os.getenv("GEMINI_TRANSCRIBE_MODEL", "gemini-3.8-flash").strip() or "gemini-3.8-flash"
    candidate_models = [primary_model]
    for fallback_model in (
        "gemini-3.8-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
    ):
        if fallback_model not in candidate_models:
            candidate_models.append(fallback_model)

    last_error: Optional[Exception] = None
    for idx, model_name in enumerate(candidate_models):
        is_last_model = idx == len(candidate_models) - 1
        max_attempts = max(1, len(GEMINI_API_KEYS))
        transient_retries = 0
        attempt = 0
        while attempt < max_attempts:
            api_key = get_gemini_api_key()
            try:
                def _run_sync() -> str:
                    client = Client(api_key=api_key)
                    resp = client.models.generate_content(
                        model=model_name,
                        contents=contents,
                        config=types.GenerateContentConfig(
                            temperature=0.1,
                            response_mime_type="application/json",
                        ),
                    )
                    return resp.text or "[]"

                raw_text = await asyncio.to_thread(_run_sync)
                cleaned = raw_text.strip()
                if cleaned.startswith("```"):
                    cleaned = cleaned.strip("`")
                    if cleaned.lower().startswith("json"):
                        cleaned = cleaned[4:].strip()
                return json.loads(cleaned)
            except Exception as exc:
                last_error = exc
                err_str = str(exc).lower()
                is_quota_or_auth = any(m in err_str for m in [
                    "429", "resource_exhausted", "quota", "403", "permission_denied", "unauthenticated"
                ])
                if is_quota_or_auth and attempt < max_attempts - 1:
                    rotate_gemini_api_key(f"On-demand {op_label} quota/auth error: {exc}")
                    attempt += 1
                    continue
                is_transient = any(m in err_str for m in [
                    "503", "unavailable", "high demand", "overloaded", "500", "internal", "timeout", "try again"
                ])
                if is_transient:
                    if is_last_model and transient_retries < 1:
                        transient_retries += 1
                        logger.warning(f"Gemini {op_label} model {model_name} temporarily unavailable ({exc}); retrying in 1.5s")
                        await asyncio.sleep(1.5)
                        continue
                    logger.warning(f"Gemini {op_label} model {model_name} overloaded/unavailable ({exc}); trying fallback model")
                    break
                is_model_error = any(m in err_str for m in ["404", "not_found", "not found", "unsupported"])
                if is_model_error:
                    logger.warning(f"Gemini {op_label} model {model_name} unavailable ({exc}); trying fallback model")
                    break
                raise
    if last_error:
        raise last_error
    return []

def _normalize_transcript_turns(parsed: Any) -> List[Dict[str, Any]]:
    if isinstance(parsed, dict):
        parsed = parsed.get("turns") or parsed.get("transcripts") or []
    if not isinstance(parsed, list):
        return []
    turns: List[Dict[str, Any]] = []
    now_ts = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    for item in parsed:
        if not isinstance(item, dict):
            continue
        role_raw = str(item.get("role", "")).strip().lower()
        role = "agent" if role_raw in ("agent", "ai", "assistant", "bot", "ananya") else "caller"
        txt = str(item.get("text") or item.get("content") or "").strip()
        if txt:
            turns.append({"role": role, "text": txt, "timestamp": item.get("timestamp") or now_ts})
    return turns

# Transcribe a single call's recorded audio bytes on demand using Gemini multimodal generate_content
async def transcribe_audio_bytes_with_gemini(
    audio_bytes: bytes,
    content_type: str = "",
    target_language: str = "original",
) -> List[Dict[str, Any]]:
    if not audio_bytes:
        return []

    mime_type = detect_audio_mime_type(audio_bytes, content_type)
    if str(target_language).strip().lower() == "english":
        lang_instruction = (
            "Transcribe the complete conversation chronologically and translate every spoken turn into clear, natural English. "
            "All output text must be in English."
        )
    else:
        lang_instruction = (
            "Transcribe the complete conversation chronologically in the exact spoken language(s) "
            "(Telugu, Hindi, English, or mixed as spoken)."
        )

    prompt = (
        "Listen carefully to this phone call recording between an AI voice agent ('Ananya' from Swargaseema) "
        "and a customer/caller.\n"
        f"{lang_instruction}\n"
        "Label each turn's role as 'agent' (the female AI voice agent speaking for Swargaseema) or 'caller' (the customer).\n"
        "Return ONLY a valid JSON array of objects with keys 'role' ('agent' or 'caller') and 'text' (spoken words). "
        "If there is no intelligible speech (only silence or ringing), return []."
    )
    parsed = await _call_gemini_json_with_fallback(
        [types.Part.from_bytes(data=audio_bytes, mime_type=mime_type), prompt],
        op_label="transcription",
    )
    return _normalize_transcript_turns(parsed)

# Translate existing conversation transcript turns into clear English using Gemini text-only call
async def translate_turns_to_english_with_gemini(turns: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not turns:
        return []
    compact_turns = [
        {
            "role": "agent" if str(t.get("role", "")).lower() == "agent" else "caller",
            "text": str(t.get("text") or t.get("content") or "").strip(),
        }
        for t in turns
        if str(t.get("text") or t.get("content") or "").strip()
    ]
    if not compact_turns:
        return []

    prompt = (
        "Translate this phone call transcript between an AI voice agent ('agent') and a customer ('caller') "
        "into clear, natural English.\n"
        "Preserve the exact turn order and 'role' values ('agent' or 'caller').\n"
        "Return ONLY a valid JSON array of objects with keys 'role' and 'text' (in English).\n\n"
        f"Input transcript JSON:\n{json.dumps(compact_turns, ensure_ascii=False)}"
    )
    parsed = await _call_gemini_json_with_fallback([prompt], op_label="translation")
    translated = _normalize_transcript_turns(parsed)
    for idx, item in enumerate(translated):
        if idx < len(turns) and turns[idx].get("timestamp"):
            item["timestamp"] = turns[idx]["timestamp"]
    return translated

# Build and execute the real-time Pipecat agent for an incoming Vobiz stream
async def run_vobiz_agent(
    websocket: WebSocket,
    call_uuid: str,
    phone_number: str = "",
    batch_id: Optional[str] = None,
    template_id: Optional[str] = None,
    vobiz_auth_id: Optional[str] = None,
    vobiz_auth_token: Optional[str] = None,
) -> None:
    tracer = diagnostics.get_tracer(call_uuid, phone_number, batch_id=batch_id)
    transcript_enabled = db.is_transcript_enabled()
    asyncio.create_task(asyncio.to_thread(db.record_call_start, call_uuid, phone_number=phone_number, batch_id=batch_id))
    logger.info(
        f"Starting Pipecat voice agent for call {call_uuid} ({phone_number}, batch={batch_id}, template={template_id}, "
        f"transcript={'ENABLED' if transcript_enabled else 'DISABLED - low-cost Gemini mode'})"
    )

    # Resolve dynamic campaign template and greeting for this batch or call
    batch_doc = db.get_batch(batch_id) if batch_id else None

    # Priority: explicitly passed template_id > batch_doc template_id > dialer fallback
    active_template_id = template_id or (batch_doc.get("template_id") if batch_doc else None) or "missed_calls"
    tpl = db.get_template(active_template_id)

    # Resolve greeting text and system prompt from template first, then batch_doc
    active_greeting = (tpl.get("greeting_telugu") if tpl else None) or (batch_doc.get("greeting_text") if batch_doc else None) or AGENT_GREETING
    active_system_prompt = (tpl.get("system_prompt") if tpl else None) or (batch_doc.get("system_prompt") if batch_doc else None) or AGENT_SYSTEM_PROMPT

    # Candidate pre-recorded greeting PCM files: strictly match active_template_id
    greeting_pcm = b""
    candidates = []
    if tpl and tpl.get("greeting_audio_path"):
        candidates.append(BASE_DIR / tpl["greeting_audio_path"])
    candidates.append(BASE_DIR / "assets" / f"greeting_{active_template_id}_16k.pcm")
    if active_template_id == "missed_calls" and GREETING_AUDIO_PATH.exists():
        candidates.append(GREETING_AUDIO_PATH)

    for cand in candidates:
        if cand.exists():
            try:
                greeting_pcm = cand.read_bytes()
                logger.info(f"Using pre-recorded greeting audio: {cand.name} ({len(greeting_pcm)} bytes, {len(greeting_pcm)/32000:.2f}s)")
                break
            except Exception as e:
                logger.warning(f"Failed reading greeting file {cand}: {e}")

    auth_id = vobiz_auth_id or os.getenv("VOBIZ_AUTH_ID", "")
    auth_token = vobiz_auth_token or os.getenv("VOBIZ_AUTH_TOKEN", "")

    serializer_params = VobizFrameSerializer.InputParams(
        encoding="audio/x-l16",
        vobiz_sample_rate=16000,
        l16_byte_order="le",
        auto_hang_up=True,
        hangup_method="both",
    )

    serializer = VobizFrameSerializer(
        stream_id="",
        call_id=call_uuid,
        auth_id=auth_id,
        auth_token=auth_token,
        params=serializer_params,
    )
    serializer.is_greeting_playing = True

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            audio_in_sample_rate=16000,
            audio_out_sample_rate=16000,
            audio_out_10ms_chunks=int(os.getenv("AUDIO_OUT_10MS_CHUNKS", "4")),
            serializer=serializer,
        ),
    )

    task_ref: List[Optional[PipelineTask]] = [None]
    silence_hangup_task: List[Optional[asyncio.Task]] = [None]
    silence_timer_task: List[Optional[asyncio.Task]] = [None]
    farewell_concluded: bool = False
    current_language: str = "telugu"
    silence_state: str = "IDLE"
    is_agent_speaking: bool = False
    last_customer_speech_time: List[float] = [0.0]
    is_customer_speaking: List[bool] = [False]
    speech_frames_streak: List[int] = [0]
    vad_buffer: bytearray = bytearray()
    vad_analyzer = SileroVADAnalyzer(sample_rate=16000)
    vad_analyzer.set_sample_rate(16000)

    # Passive Silero VAD monitor for real-time customer voice detection
    def handle_inbound_pcm(chunk: bytes):
        nonlocal silence_state
        vad_buffer.extend(chunk)
        while len(vad_buffer) >= 1024:
            window = bytes(vad_buffer[:1024])
            del vad_buffer[:1024]
            conf = vad_analyzer.voice_confidence(window)
            if conf >= 0.45:
                last_customer_speech_time[0] = time.time()
                is_customer_speaking[0] = True
                if conf >= 0.55 and not is_agent_speaking:
                    speech_frames_streak[0] += 1
                    if speech_frames_streak[0] >= 6:
                        tracer.caller_speech_detected = True
                        if not transcript_enabled and not farewell_concluded and silence_state != "TERMINATED":
                            if silence_hangup_task[0] and not silence_hangup_task[0].done():
                                silence_hangup_task[0].cancel()
                            if silence_state in ("STAGE_1_WAITING", "STAGE_2_WAITING", "PROACTIVE_PROMPT_PENDING", "CLOSING_PENDING"):
                                start_silence_timer(stage=1, timeout_sec=15.0)
                else:
                    speech_frames_streak[0] = 0
            else:
                speech_frames_streak[0] = 0
                if time.time() - last_customer_speech_time[0] > 0.6:
                    is_customer_speaking[0] = False

    serializer.on_inbound_audio = handle_inbound_pcm

    # Start or restart customer silence timeout monitoring
    def start_silence_timer(stage: int, timeout_sec: float):
        nonlocal silence_state
        if silence_timer_task[0] and not silence_timer_task[0].done():
            silence_timer_task[0].cancel()
        silence_state = f"STAGE_{stage}_WAITING"
        silence_timer_task[0] = asyncio.create_task(run_silence_timer(stage, timeout_sec))

    # Worker task for silence countdown with speech-onset hold
    async def run_silence_timer(stage: int, timeout_sec: float):
        nonlocal silence_state
        tracer.record_event("silence_timer_started", {"stage": stage, "timeout_seconds": timeout_sec, "language": current_language})
        try:
            await asyncio.sleep(timeout_sec)
        except asyncio.CancelledError:
            return

        # Provisional hold if agent or customer is speaking near timeout
        if is_agent_speaking or is_customer_speaking[0] or (time.time() - last_customer_speech_time[0] < 1.8):
            logger.info(f"Speech activity detected near silence timeout ({stage}), holding for 2.5s")
            try:
                await asyncio.sleep(2.5)
            except asyncio.CancelledError:
                return
            if silence_state != f"STAGE_{stage}_WAITING":
                return
            if is_agent_speaking or is_customer_speaking[0] or (time.time() - last_customer_speech_time[0] < 1.0):
                tracer.record_event("background_noise_ignored", {"reason": "unconfirmed_vad_burst"})

        if stage == 1:
            tracer.record_event("silence_timeout_triggered", {"stage": 1, "silence_duration": timeout_sec, "language": current_language})
            tracer.record_event("proactive_prompt_started", {"language": current_language})
            silence_state = "PROACTIVE_PROMPT_PENDING"
            lang_prompt = "Telugu" if current_language == "telugu" else ("Hindi" if current_language == "hindi" else "English")
            instruction = f"[System instruction: The caller has been silent. In {lang_prompt}, politely ask if they can hear you in 1 short sentence.]"
            try:
                if llm._session:
                    await llm._session.send_realtime_input(text=instruction)
                    if hasattr(llm, "_complete_turn"):
                        await llm._complete_turn()
            except Exception as exc:
                logger.warning(f"Failed to dispatch proactive prompt to Gemini: {exc}")

            # Watchdog: ensure we do not remain stuck in PROACTIVE_PROMPT_PENDING if model turn does not fire
            async def watchdog_stage2():
                await asyncio.sleep(6.0)
                if silence_state == "PROACTIVE_PROMPT_PENDING":
                    logger.info(f"Proactive prompt timed out for {call_uuid}, advancing to stage 2")
                    start_silence_timer(stage=2, timeout_sec=10.0)

            asyncio.create_task(watchdog_stage2())

        elif stage == 2:
            tracer.record_event("second_silence_timeout", {"stage": 2, "silence_duration": timeout_sec, "language": current_language})
            silence_state = "CLOSING_PENDING"
            lang_prompt = "Telugu" if current_language == "telugu" else ("Hindi" if current_language == "hindi" else "English")
            closing_instruction = f"[System instruction: The caller is still silent. In {lang_prompt}, say a polite 1-sentence goodbye and conclude.]"
            try:
                if llm._session:
                    await llm._session.send_realtime_input(text=closing_instruction)
                    if hasattr(llm, "_complete_turn"):
                        await llm._complete_turn()
            except Exception as exc:
                logger.warning(f"Failed to dispatch closing message to Gemini: {exc}")

            # Watchdog: disconnect cleanly if model closing turn is delayed
            async def watchdog_closing():
                nonlocal silence_state
                await asyncio.sleep(6.0)
                if silence_state == "CLOSING_PENDING":
                    logger.info(f"Closing turn timed out for {call_uuid}, terminating line")
                    silence_state = "TERMINATING"
                    final_disp = "not_talking" if tracer.turns_count <= 2 else "dropped"
                    db.record_disposition(call_uuid=call_uuid, disposition=final_disp, reason="Customer silence timeout")
                    try:
                        await vobiz_api.hangup_call(call_uuid)
                    except Exception:
                        pass
                    if task_ref[0] and not task_ref[0].has_finished():
                        await task_ref[0].queue_frame(EndFrame())

            asyncio.create_task(watchdog_closing())

    # Disconnect line cleanly after farewell audio plays out
    async def inactivity_hangup(delay: float = 2.0):
        await asyncio.sleep(delay)
        logger.info(f"Farewell completion hangup for {call_uuid}, terminating call")
        try:
            llm.set_audio_input_paused(True)
        except Exception:
            pass
        try:
            await vobiz_api.hangup_call(call_uuid)
        except Exception as e:
            logger.warning(f"Inactivity hangup failed for {call_uuid}: {e}")
        if task_ref[0] and not task_ref[0].has_finished():
            logger.info(f"Executing graceful termination for call {call_uuid}")
            await task_ref[0].queue_frame(EndFrame())

    # Handler for end_call tool invoked by Gemini
    async def handle_end_call(params: FunctionCallParams) -> None:
        nonlocal farewell_concluded, silence_state
        farewell_concluded = True
        if silence_timer_task[0] and not silence_timer_task[0].done():
            silence_timer_task[0].cancel()
        silence_state = "TERMINATED"

        args = params.arguments or {}
        disposition = args.get("disposition") or "dropped"
        customer_name = args.get("customer_name")
        callback_time = args.get("callback_time")
        reason = args.get("reason", "Call finished")

        logger.info(
            f"Tool end_call executed for {call_uuid}: disposition={disposition}, "
            f"customer_name={customer_name}, callback_time={callback_time}, reason={reason}"
        )
        tracer.disposition = disposition
        tracer.customer_name = customer_name
        tracer.callback_time = callback_time
        tracer.reason = reason
        tracer.record_event("tool_end_call_executed", {"disposition": disposition, "reason": reason, "name": customer_name, "callback": callback_time})
        db.record_disposition(
            call_uuid=call_uuid,
            disposition=disposition,
            customer_name=customer_name,
            callback_time=callback_time,
            reason=reason,
        )

        await params.result_callback(
            {"status": "recorded"},
            properties=FunctionCallResultProperties(run_llm=False),
        )

        if silence_hangup_task[0] is None or silence_hangup_task[0].done():
            silence_hangup_task[0] = asyncio.create_task(inactivity_hangup(delay=2.0))

    end_call_function = FunctionSchema(
        name="end_call",
        description=(
            "Hang up the phone call ONLY when the conversation naturally concludes after scheduling a callback (interested), "
            "when the caller explicitly declines (not_interested), or indicates wrong number (wrong_number). "
            "NEVER call this tool for silence; silence timeouts are automatically managed by the system."
        ),
        properties={
            "disposition": {
                "type": "string",
                "enum": ["interested", "not_interested", "wrong_number"],
                "description": "Call outcome disposition.",
            },
            "customer_name": {
                "type": "string",
                "description": "Full or first name of caller in English Latin letters only (e.g. 'Shiva', 'Ramesh', 'Priya'). Never output in Telugu or Hindi script.",
            },
            "callback_time": {
                "type": "string",
                "description": "Agreed callback date and time in English only (e.g. 'Today by 5:00 PM', 'Tomorrow 11:00 AM'). Never output in Telugu or Hindi script.",
            },
            "reason": {
                "type": "string",
                "description": "Brief explanation for ending the call.",
            },
        },
        required=["disposition"],
        handler=handle_end_call,
    )

    tools = ToolsSchema(standard_tools=[end_call_function])

    llm = GeminiLiveLLMService(
        api_key=get_gemini_api_key(),
        settings=GeminiLiveLLMService.Settings(
            system_instruction=build_system_instruction(active_system_prompt),
            voice=GEMINI_VOICE,
            model=GEMINI_MODEL,
            vad=GeminiVADParams(
                start_sensitivity=StartSensitivity.START_SENSITIVITY_LOW,
                end_sensitivity=EndSensitivity.END_SENSITIVITY_LOW,
                prefix_padding_ms=int(os.getenv("VAD_PREFIX_PADDING_MS", "300")),
                silence_duration_ms=int(os.getenv("VAD_SILENCE_MS", "500")),
            ),
        ),
        tools=tools,
        start_audio_paused=True,
        inference_on_context_initialization=False,
    )

    # Wrap session ready to record exact Gemini handshake timing
    orig_handle_session_ready = llm._handle_session_ready
    async def wrapped_session_ready(session):
        t_gemini = time.time()
        t_ans = tracer.t_answer or t_gemini
        logger.info(f"[TIMING] [{call_uuid[:8]}] 3. Gemini session ready at {t_gemini:.3f} (+{t_gemini - t_ans:.3f}s from answer)")
        tracer.record_event("gemini_session_ready", {"elapsed_from_answer": round(t_gemini - t_ans, 3)})
        return await orig_handle_session_ready(session)
    llm._handle_session_ready = wrapped_session_ready

    # Automatic fallback rotation: if initial connection fails due to quota or auth, retry with fallback keys
    orig_conn_task_handler = llm._connection_task_handler
    async def resilient_connection_task_handler(config):
        if not transcript_enabled:
            # Omit input/output audio transcription from Gemini Live setup to eliminate transcription token cost
            config.input_audio_transcription = None
            config.output_audio_transcription = None
        max_attempts = len(GEMINI_API_KEYS)
        for attempt in range(max_attempts):
            try:
                return await orig_conn_task_handler(config)
            except Exception as exc:
                err_str = str(exc).lower()
                is_quota_or_auth = any(m in err_str for m in [
                    "429", "resource_exhausted", "quota", "403", "permission_denied",
                    "unauthenticated", "invalid", "1008"
                ])
                if is_quota_or_auth and attempt < max_attempts - 1:
                    new_key = rotate_gemini_api_key(f"Initial connect failure: {exc}")
                    llm._client = Client(api_key=new_key, http_options=getattr(llm, "_http_options", None))
                    tracer.record_event("gemini_key_rotated", {"attempt": attempt + 1, "reason": str(exc)[:80]})
                    await asyncio.sleep(0.5)
                    continue
                else:
                    logger.error(f"Gemini connection failed on attempt {attempt+1}/{max_attempts}: {exc}")
                    raise
    llm._connection_task_handler = resilient_connection_task_handler

    # Automatic fallback rotation: if quota runs out mid-call, rotate key and reconnect
    orig_handle_conn_error = llm._handle_connection_error
    async def resilient_handle_conn_error(error: Exception) -> bool:
        err_str = str(error).lower()
        if any(marker in err_str for marker in ["429", "resource_exhausted", "quota", "403", "permission_denied", "unauthenticated", "1008"]):
            new_key = rotate_gemini_api_key(f"Mid-call quota exhausted: {error}")
            llm._client = Client(api_key=new_key, http_options=getattr(llm, "_http_options", None))
            llm._consecutive_failures = 0
            tracer.record_event("gemini_midcall_key_rotated", {"reason": str(error)[:80]})
            return True
        return await orig_handle_conn_error(error)
    llm._handle_connection_error = resilient_handle_conn_error

    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)

    # Save caller turns into database and handle silence cancellation
    @user_aggregator.event_handler("on_user_turn_message_added")
    async def on_user_spoken(aggregator, message: UserTurnMessageAddedMessage):
        nonlocal farewell_concluded, current_language, silence_state
        if farewell_concluded or silence_state == "TERMINATED":
            logger.info(f"Ignoring post-farewell audio turn for {call_uuid}")
            return

        if silence_hangup_task[0] and not silence_hangup_task[0].done():
            silence_hangup_task[0].cancel()
            logger.info(f"Caller spoke after farewell, cancelled silence hangup timer for {call_uuid}")
        farewell_concluded = False

        if silence_timer_task[0] and not silence_timer_task[0].done():
            silence_timer_task[0].cancel()

        if silence_state in ("STAGE_2_WAITING", "CLOSING_PENDING"):
            tracer.record_event(
                "disconnect_cancelled_customer_spoke",
                {"previous_state": silence_state, "text": ((message.content or "")[:60] if transcript_enabled else "")},
            )
        silence_state = "IDLE"

        if message and message.content:
            text = message.content.strip()
            tracer.turns_count += 1
            tracer.caller_speech_detected = True
            current_language = detect_spoken_language(text, current_language)
            if transcript_enabled and db.is_transcript_enabled():
                logger.info(f"[Caller] {text}")
                tracer.record_event("customer_turn_completed", {"text": text[:60]})
                tracer.record_event("meaningful_speech_detected", {"text": text[:60], "language": current_language})
                db.append_transcript(call_uuid, "caller", text)
            else:
                tracer.record_event("customer_turn_completed", {})

    # Pause silence timer while agent is speaking
    @assistant_aggregator.event_handler("on_assistant_turn_started")
    async def on_agent_turn_started(aggregator):
        nonlocal is_agent_speaking
        is_agent_speaking = True
        serializer.agent_speaking_started_at = time.time()
        if silence_timer_task[0] and not silence_timer_task[0].done():
            silence_timer_task[0].cancel()

    # Save agent turns and advance silence recovery lifecycle
    @assistant_aggregator.event_handler("on_assistant_turn_stopped")
    async def on_agent_spoken(aggregator, message: AssistantTurnStoppedMessage):
        nonlocal is_agent_speaking, silence_state, current_language
        is_agent_speaking = False
        serializer.agent_speaking_started_at = 0.0
        has_text = bool(message and message.content and message.content.strip())
        if has_text or not transcript_enabled:
            tracer.turns_count += 1
            if has_text:
                text = message.content.strip()
                current_language = detect_spoken_language(text, current_language)
                if transcript_enabled and db.is_transcript_enabled():
                    logger.info(f"[Agent] {text}")
                    tracer.record_event("agent_turn_completed", {"text": text[:60]})
                    db.append_transcript(call_uuid, "agent", text)
                else:
                    tracer.record_event("agent_turn_completed", {})
            else:
                tracer.record_event("agent_turn_completed", {})

            if farewell_concluded or silence_state == "TERMINATED":
                if silence_hangup_task[0] and not silence_hangup_task[0].done():
                    silence_hangup_task[0].cancel()
                silence_hangup_task[0] = asyncio.create_task(inactivity_hangup(delay=1.5))
                return

            if silence_state == "PROACTIVE_PROMPT_PENDING":
                tracer.record_event("proactive_prompt_completed", {"language": current_language})
                start_silence_timer(stage=2, timeout_sec=10.0)
            elif silence_state == "CLOSING_PENDING":
                tracer.record_event("closing_message_completed", {"language": current_language})
                silence_state = "TERMINATING"
                final_disp = "not_talking" if tracer.turns_count <= 2 else "dropped"
                tracer.record_event("silence_disconnect_executed", {"call_uuid": call_uuid, "disposition": final_disp})
                db.record_disposition(
                    call_uuid=call_uuid,
                    disposition=final_disp,
                    reason="Customer silence timeout (15s + 10s)",
                )
                try:
                    await vobiz_api.hangup_call(call_uuid)
                except Exception as exc:
                    logger.warning(f"Failed to execute carrier hangup for {call_uuid}: {exc}")
                if task_ref[0] and not task_ref[0].has_finished():
                    await task_ref[0].queue_frame(EndFrame())
            elif farewell_concluded:
                if silence_hangup_task[0] and not silence_hangup_task[0].done():
                    silence_hangup_task[0].cancel()
                silence_hangup_task[0] = asyncio.create_task(inactivity_hangup(delay=1.5))
            else:
                start_silence_timer(stage=1, timeout_sec=15.0)

    pipeline = Pipeline([
        transport.input(),
        user_aggregator,
        llm,
        transport.output(),
        assistant_aggregator,
    ])

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=16000,
            audio_out_sample_rate=16000,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )
    task_ref[0] = task
    greeting_task: Optional[asyncio.Task] = None

    # Stream pre-cached greeting smoothly without interruption
    async def play_cached_greeting():
        t_ans = tracer.t_answer or time.time()
        await serializer.stream_ready_event.wait()
        t_media = time.time()
        logger.info(f"[TIMING] [{call_uuid[:8]}] 2. Media-stream ready at {t_media:.3f} (+{t_media - t_ans:.3f}s from answer)")
        tracer.record_event("media_stream_ready", {"elapsed_from_answer": round(t_media - t_ans, 3), "stream_id": serializer._stream_id})

        if not greeting_pcm:
            serializer.is_greeting_playing = False
            llm.set_audio_input_paused(False)
            logger.info("No pre-recorded greeting audio file found; live model will greet")
            return

        t_greet_start = time.time()
        logger.info(f"[TIMING] [{call_uuid[:8]}] 4. Greeting playback start at {t_greet_start:.3f} (+{t_greet_start - t_ans:.3f}s from answer)")
        tracer.record_event("greeting_playback_start", {"elapsed_from_answer": round(t_greet_start - t_ans, 3)})

        if transcript_enabled and db.is_transcript_enabled():
            asyncio.create_task(asyncio.to_thread(db.append_transcript, call_uuid, "agent", active_greeting))
            tracer.record_event("agent_turn_completed", {"text": active_greeting[:60]})
        else:
            tracer.record_event("agent_turn_completed", {})
        tracer.turns_count += 1

        chunk = 1280
        frame_sec = 0.04
        lead_buffer_s = 0.4
        start_time = time.perf_counter()
        stream_id = serializer._stream_id
        first_chunk_sent = False

        for i in range(0, len(greeting_pcm), chunk):
            if websocket.client_state.name != "CONNECTED":
                break

            chunk_data = greeting_pcm[i : i + chunk]
            frame_time = (i / chunk) * frame_sec
            payload = base64.b64encode(chunk_data).decode("utf-8")
            msg = json.dumps({
                "event": "playAudio",
                "media": {
                    "contentType": "audio/x-l16",
                    "sampleRate": 16000,
                    "payload": payload,
                },
                "streamId": stream_id,
            })

            try:
                await websocket.send_text(msg)
                tracer.record_audio_out(len(chunk_data), sample_rate=16000)
            except Exception as exc:
                logger.warning(f"Greeting streaming interrupted: {exc}")
                break

            if not first_chunk_sent:
                first_chunk_sent = True
                t_first = time.time()
                logger.info(f"[TIMING] [{call_uuid[:8]}] 5. First audio chunk sent at {t_first:.3f} (+{t_first - t_ans:.3f}s from answer)")
                tracer.record_event("first_audio_chunk_sent", {"elapsed_from_answer": round(t_first - t_ans, 3)})

            elapsed = time.perf_counter() - start_time
            ahead = frame_time - elapsed
            if ahead > lead_buffer_s:
                await asyncio.sleep(ahead - lead_buffer_s)

        # Allow carrier audio path to finish playing final frames
        await asyncio.sleep(0.4)
        serializer.is_greeting_playing = False
        llm.set_audio_input_paused(False)

        # Forward any caller audio spoken near greeting end directly to Gemini
        if serializer.greeting_inbound_buffer and llm._session:
            buffered_audio = bytes(serializer.greeting_inbound_buffer)
            serializer.greeting_inbound_buffer.clear()
            try:
                await llm._session.send_realtime_input(
                    audio=Blob(data=buffered_audio, mime_type="audio/pcm;rate=16000")
                )
                logger.info(f"Forwarded {len(buffered_audio)} bytes of caller audio from greeting window")
            except Exception as exc:
                logger.warning(f"Failed to forward greeting caller audio: {exc}")

        t_greet_end = time.time()
        logger.info(f"[TIMING] [{call_uuid[:8]}] 6. Greeting completed at {t_greet_end:.3f} (+{t_greet_end - t_ans:.3f}s from answer)")
        tracer.record_event("greeting_completed", {"elapsed_from_answer": round(t_greet_end - t_ans, 3)})

        # Start initial Stage 1 silence monitoring after greeting completes
        start_silence_timer(stage=1, timeout_sec=15.0)

    greeting_task = asyncio.create_task(play_cached_greeting())

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport_instance, client):
        logger.info(f"Vobiz WebSocket connected for call {call_uuid}")
        tracer.record_event("vobiz_stream_connected", {"stream_id": serializer._stream_id})
        tracer.record_event("gemini_session_ready", {"model": GEMINI_MODEL, "voice": GEMINI_VOICE})
        # Seed conversation context so model knows greeting was delivered and waits for customer
        dev_instruction = (
            f"Call connected. You have already spoken the opening greeting: '{active_greeting}'. "
            f"Do not repeat the opening greeting. Listen attentively. "
            f"Follow the conversation stages and objection handling rules defined in your system prompt. "
            f"LANGUAGE MIRRORING RULES (STRICT): "
            f"- You must always speak in the exact language the caller is speaking. "
            f"- The conversation starts with the opening greeting. "
            f"- THE MOMENT the caller speaks in Hindi (e.g. 'Haan', 'Bolo', 'Kaun', 'Kya', 'Nahi', 'Kahan se', or Hindi speech), immediately switch to Hindi and continue all turns in Hindi. "
            f"- If the caller speaks English, converse in English. "
            f"- STRICT: Speak only 1 single sentence per turn. Never repeat any sentence or utterance. "
            f"- SILENCE RECOVERY: If you receive a system instruction that caller is silent, ask if they can hear you in 1 short sentence in the active language. If still silent, say polite farewell and stop. "
            f"- CALLBACK TIME HANDLING: Accept any natural timeframe the caller provides (e.g. '4 PM', 'kal', 'shaam ko', 'Sunday'). Do NOT over-interrogate. Acknowledge timeframe, confirm name, and invoke end_call with disposition='interested'. ALWAYS provide customer_name and callback_time in Latin/English script. "
            f"- DISPOSITION RULES: Only invoke end_call for interested, not_interested, or wrong_number. Silence timeouts are automated. "
            f"- When saying goodbye or concluding, speak the single farewell sentence once and stop."
        ) if greeting_pcm else (
            f"Call connected. Greet the customer now by speaking this exact opening greeting in a warm, natural tone: '{active_greeting}'. "
            f"Do not add any other words. Speak only the greeting and wait for customer response."
        )

        context.add_message({
            "role": "developer",
            "content": dev_instruction,
        })
        if greeting_pcm:
            context.add_message({
                "role": "assistant",
                "content": active_greeting,
            })
        # Seed initial context so Gemini Live sets _ready_for_realtime_input immediately
        await task.queue_frames([LLMContextFrame(context)])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport_instance, client):
        logger.info(f"Vobiz WebSocket disconnected for call {call_uuid}")
        if greeting_task and not greeting_task.done():
            greeting_task.cancel()
        if silence_hangup_task[0] and not silence_hangup_task[0].done():
            silence_hangup_task[0].cancel()
        if silence_timer_task[0] and not silence_timer_task[0].done():
            silence_timer_task[0].cancel()
        serializer.on_inbound_audio = None
        vad_buffer.clear()
        await task.cancel()

    runner = WorkerRunner(handle_sigint=False)
    try:
        await runner.add_workers(task)
        await runner.run()
    except asyncio.CancelledError:
        logger.info(f"Call task cancelled for {call_uuid}")
    except Exception as exc:
        logger.error(f"Pipeline error on call {call_uuid}: {exc}")
        tracer.record_error("pipeline_error", str(exc))
        err_str = str(exc).lower()
        if any(m in err_str for m in ["429", "resource_exhausted", "quota", "403", "permission_denied", "unauthenticated", "1008"]):
            rotate_gemini_api_key(f"Pipeline quota error on call {call_uuid}: {exc}")
    finally:
        db.finalize_call(call_uuid)
        logger.info(f"Finished pipeline session for call {call_uuid}")
