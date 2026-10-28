import asyncio
import os
from pathlib import Path
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
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

import db
import diagnostics
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

    # Handler for end_call tool invoked by Gemini
    async def handle_end_call(params: FunctionCallParams) -> None:
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

        await params.result_callback({"status": "success"})

        # Allow final goodbye speech to reach caller before stopping pipeline
        async def delayed_terminate():
            await asyncio.sleep(2.5)
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
            system_instruction=AGENT_SYSTEM_PROMPT,
            voice=GEMINI_VOICE,
            model=GEMINI_MODEL,
            vad=GeminiVADParams(
                prefix_padding_ms=int(os.getenv("VAD_PREFIX_PADDING_MS", "150")),
                silence_duration_ms=int(os.getenv("VAD_SILENCE_MS", "300")),
            ),
        ),
        tools=tools,
    )

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

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport_instance, client):
        logger.info(f"Vobiz WebSocket connected for call {call_uuid}")
        tracer.record_event("gemini_session_ready", {"model": GEMINI_MODEL, "voice": GEMINI_VOICE})
        # Prompt model to begin conversation with configured opening greeting
        context.add_message({
            "role": "developer",
            "content": (
                f"Begin the call now. Speak the exact opening Telugu greeting: '{AGENT_GREETING}'"
            ),
        })
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport_instance, client):
        logger.info(f"Vobiz WebSocket disconnected for call {call_uuid}")
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
