import asyncio
import base64
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import time
from typing import Any, Callable, Dict, List, Optional
from dotenv import load_dotenv
from loguru import logger
from starlette.websockets import WebSocket

BASE_DIR = Path(__file__).parent
load_dotenv(BASE_DIR / ".env", override=True)

from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.frames.frames import EndFrame, LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.workers.runner import WorkerRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    AssistantTurnStoppedMessage,
    LLMContextAggregatorPair,
    UserTurnMessageAddedMessage,
)
from pipecat.audio.filters.rnnoise_filter import RNNoiseFilter
from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService, GeminiVADParams
from pipecat.services.llm_service import FunctionCallParams, FunctionCallResultProperties
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

import db
import diagnostics
import vobiz_api
from vobiz_serializer import VobizFrameSerializer

GEMINI_API_KEYS = [
    k.strip()
    for k in [
        os.getenv("GEMINI_API_KEY", ""),
        os.getenv("GEMINI_API_KEY_FALLBACK", ""),
        os.getenv("GEMINI_API_KEY_3", ""),
    ]
    if k.strip()
]
_current_key_idx = 0

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

# Build system instruction with dynamic real-time date context
def build_system_instruction() -> str:
    ist = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(ist)
    current_date_str = now.strftime("%A, %d %B %Y")
    current_time_str = now.strftime("%I:%M %p")
    base_prompt = os.getenv("AGENT_SYSTEM_PROMPT", "")
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

# Rotate to the next available API key in case of quota or rate limit issues
def rotate_gemini_api_key() -> str:
    global _current_key_idx
    _current_key_idx = (_current_key_idx + 1) % len(GEMINI_API_KEYS)
    logger.warning(f"Rotated Gemini API key to index {_current_key_idx}")
    return get_gemini_api_key()

# Build and execute the real-time Pipecat agent for an incoming Vobiz stream
async def run_vobiz_agent(
    websocket: WebSocket,
    call_uuid: str,
    phone_number: str = "",
    batch_id: Optional[str] = None,
    vobiz_auth_id: Optional[str] = None,
    vobiz_auth_token: Optional[str] = None,
) -> None:
    tracer = diagnostics.get_tracer(call_uuid, phone_number, batch_id=batch_id)
    db.record_call_start(call_uuid, phone_number=phone_number, batch_id=batch_id)
    logger.info(f"Starting Pipecat voice agent for call {call_uuid} ({phone_number}, batch={batch_id})")

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

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            audio_in_sample_rate=16000,
            audio_out_sample_rate=16000,
            audio_out_10ms_chunks=2,
            audio_in_filter=RNNoiseFilter(),
            serializer=serializer,
        ),
    )

    task_ref: List[Optional[PipelineTask]] = [None]
    hangup_timer: List[Optional[asyncio.Task]] = [None]
    call_ended = False

    # Handler for end_call tool invoked by Gemini
    async def handle_end_call(params: FunctionCallParams) -> None:
        nonlocal call_ended
        if call_ended:
            return
        call_ended = True

        args = params.arguments or {}
        disposition = args.get("disposition", "not_talking")
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
            {"status": "call_concluded"},
            properties=FunctionCallResultProperties(run_llm=False),
        )

        # Allow final goodbye speech to reach caller before stopping pipeline
        async def delayed_terminate():
            await asyncio.sleep(1.2)
            try:
                await vobiz_api.hangup_call(call_uuid)
            except Exception as e:
                logger.warning(f"Immediate hangup failed for {call_uuid}: {e}")
            if task_ref[0] and not task_ref[0].has_finished():
                logger.info(f"Executing graceful termination for call {call_uuid}")
                await task_ref[0].queue_frame(EndFrame())

        if hangup_timer[0] is None or hangup_timer[0].done():
            hangup_timer[0] = asyncio.create_task(delayed_terminate())

    end_call_function = FunctionSchema(
        name="end_call",
        description=(
            "Hang up the phone call. Call this whenever the conversation concludes, "
            "when the caller declines (NO), requests callback, says wrong number, or is silent. "
            "Always include the disposition parameter."
        ),
        properties={
            "disposition": {
                "type": "string",
                "enum": ["interested", "not_interested", "wrong_number", "not_talking"],
                "description": "Call outcome disposition.",
            },
            "customer_name": {
                "type": "string",
                "description": "Full or first name of caller if provided.",
            },
            "callback_time": {
                "type": "string",
                "description": "Agreed callback date and time (e.g. 'Tomorrow 5:00 PM').",
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
            system_instruction=build_system_instruction(),
            voice=GEMINI_VOICE,
            model=GEMINI_MODEL,
            vad=GeminiVADParams(
                prefix_padding_ms=int(os.getenv("VAD_PREFIX_PADDING_MS", "150")),
                silence_duration_ms=int(os.getenv("VAD_SILENCE_MS", "300")),
            ),
        ),
        tools=tools,
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

    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)

    # Save caller turns into database
    @user_aggregator.event_handler("on_user_turn_message_added")
    async def on_user_spoken(aggregator, message: UserTurnMessageAddedMessage):
        if message and message.content:
            text = message.content.strip()
            logger.info(f"[Caller] {text}")
            tracer.turns_count += 1
            tracer.record_event("customer_turn_completed", {"text": text[:60]})
            db.append_transcript(call_uuid, "caller", text)

    # Save agent turns into database
    @assistant_aggregator.event_handler("on_assistant_turn_stopped")
    async def on_agent_spoken(aggregator, message: AssistantTurnStoppedMessage):
        if message and message.content:
            text = message.content.strip()
            logger.info(f"[Agent] {text}")
            tracer.turns_count += 1
            tracer.record_event("agent_turn_completed", {"text": text[:60]})
            db.append_transcript(call_uuid, "agent", text)

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

    # Stream pre-cached opening greeting immediately when media stream connects
    async def play_opening_greeting():
        t_ans = tracer.t_answer or time.time()
        await serializer.stream_ready_event.wait()
        t_media = time.time()
        logger.info(f"[TIMING] [{call_uuid[:8]}] 2. Media-stream ready at {t_media:.3f} (+{t_media - t_ans:.3f}s from answer)")
        tracer.record_event("media_stream_ready", {"elapsed_from_answer": round(t_media - t_ans, 3), "stream_id": serializer._stream_id})

        if not CACHED_GREETING_PCM:
            logger.warning(f"No cached greeting audio available for {call_uuid}")
            return

        serializer.is_greeting_playing = True
        await llm.pause_processing_frames()

        t_greet_start = time.time()
        logger.info(f"[TIMING] [{call_uuid[:8]}] 4. Greeting playback start at {t_greet_start:.3f} (+{t_greet_start - t_ans:.3f}s from answer)")
        tracer.record_event("greeting_playback_start", {"elapsed_from_answer": round(t_greet_start - t_ans, 3)})

        # Seed conversation context with opening greeting so Gemini does not duplicate it
        context.add_message({
            "role": "assistant",
            "content": AGENT_GREETING,
        })
        db.append_transcript(call_uuid, "agent", AGENT_GREETING)
        tracer.turns_count += 1
        tracer.record_event("agent_turn_completed", {"text": AGENT_GREETING[:60]})

        chunk_size = 1600
        first_chunk_sent = False
        stream_id = serializer._stream_id

        for i in range(0, len(CACHED_GREETING_PCM), chunk_size):
            if call_ended or websocket.client_state.name != "CONNECTED":
                break

            chunk = CACHED_GREETING_PCM[i : i + chunk_size]
            payload = base64.b64encode(chunk).decode("utf-8")
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
                tracer.record_audio_out(len(chunk), sample_rate=16000)
            except Exception as exc:
                logger.warning(f"Greeting streaming interrupted for {call_uuid}: {exc}")
                break

            if not first_chunk_sent:
                first_chunk_sent = True
                t_first = time.time()
                logger.info(f"[TIMING] [{call_uuid[:8]}] 5. First audio chunk sent at {t_first:.3f} (+{t_first - t_ans:.3f}s from answer)")
                tracer.record_event("first_audio_chunk_sent", {"elapsed_from_answer": round(t_first - t_ans, 3)})

            await asyncio.sleep(0.05)

        serializer.is_greeting_playing = False
        t_greet_end = time.time()
        logger.info(f"[TIMING] [{call_uuid[:8]}] 6. Greeting completed at {t_greet_end:.3f} (+{t_greet_end - t_ans:.3f}s from answer)")
        tracer.record_event("greeting_completed", {"elapsed_from_answer": round(t_greet_end - t_ans, 3)})

        # Resume Gemini processing for caller speech captured during or after greeting
        await llm.resume_processing_frames()

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport_instance, client):
        logger.info(f"Vobiz WebSocket connected for call {call_uuid}")
        nonlocal greeting_task
        greeting_task = asyncio.create_task(play_opening_greeting())

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport_instance, client):
        logger.info(f"Vobiz WebSocket disconnected for call {call_uuid}")
        if greeting_task and not greeting_task.done():
            greeting_task.cancel()
        if hangup_timer[0] and not hangup_timer[0].done():
            hangup_timer[0].cancel()
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
    finally:
        db.finalize_call(call_uuid)
        logger.info(f"Finished pipeline session for call {call_uuid}")
