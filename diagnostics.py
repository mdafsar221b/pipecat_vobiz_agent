import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from loguru import logger

BASE_DIR = Path(__file__).parent
LOGS_DIR = BASE_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
DIAGNOSTICS_LOG_FILE = LOGS_DIR / "call_diagnostics.jsonl"

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")

class CallTracer:
    """Tracks and classifies lifecycle events, audio transfers, and failures for a single phone call."""

    def __init__(self, call_uuid: str, phone_number: str = "", batch_id: Optional[str] = None):
        self.call_uuid = call_uuid
        self.phone_number = phone_number
        self.batch_id = batch_id
        self.created_at = now_iso()
        self.events: List[Dict[str, Any]] = []
        self.inbound_audio_chunks = 0
        self.inbound_audio_bytes = 0
        self.outbound_audio_chunks = 0
        self.outbound_audio_bytes = 0
        self.first_audio_in_time: Optional[float] = None
        self.first_audio_out_time: Optional[float] = None
        self.ws_close_code: Optional[int] = None
        self.ws_close_reason: Optional[str] = None
        self.hangup_cause: Optional[str] = None
        self.hangup_source: Optional[str] = None
        self.gemini_session_ready_time: Optional[float] = None
        self.errors: List[Dict[str, Any]] = []
        self.disposition: Optional[str] = None
        self.customer_name: Optional[str] = None
        self.callback_time: Optional[str] = None
        self.reason: Optional[str] = None
        self.turns_count = 0

    # Record a milestone lifecycle event with timestamp
    def record_event(self, event_name: str, details: Optional[Dict[str, Any]] = None) -> None:
        safe_details = {}
        if details:
            for k, v in details.items():
                if "key" in k.lower() or "token" in k.lower() or "secret" in k.lower():
                    continue
                safe_details[k] = v

        entry = {
            "event": event_name,
            "timestamp": now_iso(),
            "time_epoch": time.time(),
            "details": safe_details,
        }
        self.events.append(entry)
        logger.info(f"[{self.call_uuid[:8]}] Event: {event_name} | {safe_details}")

    # Track caller inbound audio packet
    def record_audio_in(self, num_bytes: int) -> None:
        if self.inbound_audio_chunks == 0:
            self.first_audio_in_time = time.time()
            self.record_event("customer_audio_received", {"initial_chunk_bytes": num_bytes})
            self.record_event("audio_forwarded_to_gemini", {"initial_chunk_bytes": num_bytes})
        self.inbound_audio_chunks += 1
        self.inbound_audio_bytes += num_bytes

    # Track agent outbound audio packet
    def record_audio_out(self, num_bytes: int, sample_rate: int = 24000) -> None:
        if self.outbound_audio_chunks == 0:
            self.first_audio_out_time = time.time()
            self.record_event("gemini_audio_received", {"initial_chunk_bytes": num_bytes, "sample_rate": sample_rate})
            self.record_event("audio_forwarded_to_vobiz", {"initial_chunk_bytes": num_bytes, "sample_rate": sample_rate})
        self.outbound_audio_chunks += 1
        self.outbound_audio_bytes += num_bytes

    # Track WebSocket termination code and reason
    def record_ws_close(self, code: int, reason: Optional[str] = None) -> None:
        self.ws_close_code = code
        self.ws_close_reason = reason or "Normal"
        self.record_event("websocket_closed", {"code": code, "reason": self.ws_close_reason})

    # Track Vobiz hangup callback parameters
    def record_hangup(self, cause: str, source: str = "", duration: Any = None) -> None:
        self.hangup_cause = cause
        self.hangup_source = source
        self.record_event("call_ended", {"cause": cause, "source": source, "duration": duration})

    # Record error or exception during call
    def record_error(self, error_type: str, message: str) -> None:
        err = {"error_type": error_type, "message": str(message), "timestamp": now_iso()}
        self.errors.append(err)
        logger.error(f"[{self.call_uuid[:8]}] Error {error_type}: {message}")

    # Classify the call into one of the 4 diagnostic buckets
    def classify(self) -> Dict[str, Any]:
        has_in = self.inbound_audio_bytes > 0
        has_out = self.outbound_audio_bytes > 0
        normal_hangup = self.hangup_cause in ("NORMAL_CLEARING", None) and (self.ws_close_code in (1000, None))

        classification = "success"
        root_cause = "Bidirectional audio completed cleanly."

        # Case 1: Early abort before audio exchange
        if not has_in and not has_out:
            classification = "everything_stopped_together"
            if self.hangup_cause in ("CALL_REJECTED", "21"):
                root_cause = "Call was rejected by customer handset before answer."
            elif self.hangup_cause in ("NO_ANSWER", "19", "NO_USER_RESPONDING"):
                root_cause = "Handset rang out without answering."
            elif self.hangup_cause in ("USER_BUSY", "17"):
                root_cause = "Customer line was busy."
            elif self.ws_close_code and self.ws_close_code != 1000:
                root_cause = f"WebSocket disconnected early with code {self.ws_close_code} ({self.ws_close_reason})."
            else:
                root_cause = "Call terminated immediately after pickup before media transmission."

        # Case 2: Inbound audio missing
        elif not has_in and has_out:
            classification = "no_incoming_audio"
            root_cause = "Agent spoke, but zero incoming audio bytes received from caller handset. Check Vobiz stream audioTrack/contentType or handset microphone."

        # Case 3: Inbound audio exists, but Gemini produced no audio
        elif has_in and not has_out:
            classification = "incoming_audio_exists_gemini_missing"
            if self.errors:
                root_cause = f"Gemini error or quota failure: {self.errors[0].get('message')}"
            else:
                root_cause = "Caller spoke, but Gemini returned no audio frames. Inspect session state, API key quota, or VAD parameters."

        # Case 4: Gemini produced audio, but caller heard silence or dropped early
        elif has_in and has_out and not normal_hangup:
            if self.outbound_audio_chunks < 5:
                classification = "gemini_audio_produced_caller_silence"
                root_cause = "Gemini generated audio, but stream closed before playback completed at handset."
            elif self.ws_close_code == 1006:
                classification = "everything_stopped_together"
                root_cause = "Abnormal WebSocket closure (1006). Tunnel or transport connection dropped abruptly."
            else:
                classification = "success"
                root_cause = f"Call completed with disposition: {self.disposition or self.hangup_cause}."
        else:
            classification = "success"
            root_cause = f"Normal conversational call ({self.turns_count} turns, {self.outbound_audio_bytes} bytes sent)."

        return {
            "classification": classification,
            "root_cause_summary": root_cause,
            "audio_metrics": {
                "inbound_chunks": self.inbound_audio_chunks,
                "inbound_bytes": self.inbound_audio_bytes,
                "outbound_chunks": self.outbound_audio_chunks,
                "outbound_bytes": self.outbound_audio_bytes,
            },
            "websocket": {
                "close_code": self.ws_close_code,
                "close_reason": self.ws_close_reason,
            },
            "hangup": {
                "cause": self.hangup_cause,
                "source": self.hangup_source,
            },
            "errors": self.errors,
            "total_events": len(self.events),
        }

    # Finalize tracer and persist structured summary to disk and database
    def finalize(self) -> Dict[str, Any]:
        result = self.classify()
        payload = {
            "call_uuid": self.call_uuid,
            "phone_number": self.phone_number,
            "batch_id": self.batch_id,
            "created_at": self.created_at,
            "ended_at": now_iso(),
            "diagnostic": result,
            "events": self.events,
        }

        # Write to JSONL diagnostics log
        try:
            with open(DIAGNOSTICS_LOG_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(payload) + "\n")
        except Exception as exc:
            logger.error(f"Failed to append to diagnostics log file: {exc}")

        return payload

_tracers: Dict[str, CallTracer] = {}

# Retrieve or create active tracer for a call
def get_tracer(call_uuid: str, phone_number: str = "", batch_id: Optional[str] = None) -> CallTracer:
    if not call_uuid:
        call_uuid = f"CALL-{time.strftime('%Y%m%d%H%M%S')}"
    if call_uuid not in _tracers:
        _tracers[call_uuid] = CallTracer(call_uuid, phone_number, batch_id)
    tracer = _tracers[call_uuid]
    if phone_number and not tracer.phone_number:
        tracer.phone_number = phone_number
    if batch_id and not tracer.batch_id:
        tracer.batch_id = batch_id
    return tracer

# Remove tracer from active memory cache
def pop_tracer(call_uuid: str) -> Optional[CallTracer]:
    return _tracers.pop(call_uuid, None)
