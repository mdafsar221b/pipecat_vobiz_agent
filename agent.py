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

# Detect active language from spoken script
def detect_spoken_language(text: str, default_lang: str = "telugu") -> str:
    for ch in text:
        if "\u0C00" <= ch <= "\u0C7F":
            return "telugu"
        if "\u0900" <= ch <= "\u097F":
            return "hindi"
    if any(ch.isalpha() for ch in text):
        lower = text.lower()
        if any(w in lower for w in ["kya", "aap", "hum", "hai", "nahi", "shukriya", "baat", "namaste", "dhanyawad"]):
            return "hindi"
        return "english"
    return default_lang

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
    asyncio.create_task(asyncio.to_thread(db.record_call_start, call_uuid, phone_number=phone_number, batch_id=batch_id))
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
    serializer.is_greeting_playing = True

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            audio_in_sample_rate=16000,
            audio_out_sample_rate=16000,
            audio_out_10ms_chunks=2,
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
    vad_buffer: bytearray = bytearray()
    vad_analyzer = SileroVADAnalyzer(sample_rate=16000)
    vad_analyzer.set_sample_rate(16000)

    # Passive Silero VAD monitor for real-time customer voice detection
    def handle_inbound_pcm(chunk: bytes):
        vad_buffer.extend(chunk)
        while len(vad_buffer) >= 1024:
            window = bytes(vad_buffer[:1024])
            del vad_buffer[:1024]
            conf = vad_analyzer.voice_confidence(window)
            if conf >= 0.45:
                last_customer_speech_time[0] = time.time()
                is_customer_speaking[0] = True
            elif time.time() - last_customer_speech_time[0] > 0.6:
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
            instruction = (
                "[System instruction: The caller has been silent. "
                "Politely ask if they can hear you in 1 short sentence, speaking naturally in the exact language of the current conversation.]"
            )
            try:
                if llm._session:
                    await llm._session.send_realtime_input(text=instruction)
            except Exception as exc:
                logger.warning(f"Failed to dispatch proactive prompt to Gemini: {exc}")
        elif stage == 2:
            tracer.record_event("second_silence_timeout", {"stage": 2, "silence_duration": timeout_sec, "language": current_language})
            silence_state = "CLOSING_PENDING"
            closing_instruction = (
                "[System instruction: The caller is still silent. "
                "Politely state that you are unable to hear them, say a courteous goodbye in 1 short sentence, "
                "speaking naturally in the exact language of the current conversation, and finish.]"
            )
            try:
                if llm._session:
                    await llm._session.send_realtime_input(text=closing_instruction)
            except Exception as exc:
                logger.warning(f"Failed to dispatch closing message to Gemini: {exc}")

    # Disconnect line after dead-air silence following farewell
    async def inactivity_hangup(delay: float = 8.0):
        await asyncio.sleep(delay)
        logger.info(f"Silence timeout ({delay}s) reached after farewell for {call_uuid}, terminating call")
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
        silence_state = "IDLE"

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
            silence_hangup_task[0] = asyncio.create_task(inactivity_hangup(delay=10.0))

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
                end_sensitivity=EndSensitivity.END_SENSITIVITY_HIGH,
                prefix_padding_ms=int(os.getenv("VAD_PREFIX_PADDING_MS", "350")),
                silence_duration_ms=int(os.getenv("VAD_SILENCE_MS", "300")),
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

    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)

    # Save caller turns into database and handle silence cancellation
    @user_aggregator.event_handler("on_user_turn_message_added")
    async def on_user_spoken(aggregator, message: UserTurnMessageAddedMessage):
        nonlocal farewell_concluded, current_language, silence_state
        if silence_hangup_task[0] and not silence_hangup_task[0].done():
            silence_hangup_task[0].cancel()
            logger.info(f"Caller spoke after farewell, cancelled silence hangup timer for {call_uuid}")
        farewell_concluded = False

        if silence_timer_task[0] and not silence_timer_task[0].done():
            silence_timer_task[0].cancel()

        if silence_state in ("STAGE_2_WAITING", "CLOSING_PENDING"):
            tracer.record_event(
                "disconnect_cancelled_customer_spoke",
                {"previous_state": silence_state, "text": (message.content or "")[:60]},
            )
        silence_state = "IDLE"

        if message and message.content:
            text = message.content.strip()
            logger.info(f"[Caller] {text}")
            tracer.turns_count += 1
            current_language = detect_spoken_language(text, current_language)
            tracer.record_event("customer_turn_completed", {"text": text[:60]})
            tracer.record_event("meaningful_speech_detected", {"text": text[:60], "language": current_language})
            db.append_transcript(call_uuid, "caller", text)

    # Pause silence timer while agent is speaking
    @assistant_aggregator.event_handler("on_assistant_turn_started")
    async def on_agent_turn_started(aggregator):
        nonlocal is_agent_speaking
        is_agent_speaking = True
        if silence_timer_task[0] and not silence_timer_task[0].done():
            silence_timer_task[0].cancel()

    # Save agent turns and advance silence recovery lifecycle
    @assistant_aggregator.event_handler("on_assistant_turn_stopped")
    async def on_agent_spoken(aggregator, message: AssistantTurnStoppedMessage):
        nonlocal is_agent_speaking, silence_state, current_language
        is_agent_speaking = False
        if message and message.content:
            text = message.content.strip()
            logger.info(f"[Agent] {text}")
            tracer.turns_count += 1
            tracer.record_event("agent_turn_completed", {"text": text[:60]})
            db.append_transcript(call_uuid, "agent", text)
            current_language = detect_spoken_language(text, current_language)

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
                silence_hangup_task[0] = asyncio.create_task(inactivity_hangup(delay=8.0))
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

        if not CACHED_GREETING_PCM:
            serializer.is_greeting_playing = False
            llm.set_audio_input_paused(False)
            return

        t_greet_start = time.time()
        logger.info(f"[TIMING] [{call_uuid[:8]}] 4. Greeting playback start at {t_greet_start:.3f} (+{t_greet_start - t_ans:.3f}s from answer)")
        tracer.record_event("greeting_playback_start", {"elapsed_from_answer": round(t_greet_start - t_ans, 3)})

        asyncio.create_task(asyncio.to_thread(db.append_transcript, call_uuid, "agent", AGENT_GREETING))
        tracer.turns_count += 1
        tracer.record_event("agent_turn_completed", {"text": AGENT_GREETING[:60]})

        chunk = 640
        frame_sec = 0.02
        lead_buffer_s = 0.4
        start_time = time.perf_counter()
        stream_id = serializer._stream_id
        first_chunk_sent = False

        for i in range(0, len(CACHED_GREETING_PCM), chunk):
            if websocket.client_state.name != "CONNECTED":
                break

            chunk_data = CACHED_GREETING_PCM[i : i + chunk]
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
        context.add_message({
            "role": "developer",
            "content": (
                f"Call connected. You have already spoken the opening Telugu greeting: '{AGENT_GREETING}'. "
                f"Do not repeat the opening greeting. Listen attentively. "
                f"LANGUAGE RETENTION RULES: "
                f"- The conversation starts in Telugu. "
                f"- If the caller says neutral greetings like 'Hello', 'Hi', or 'Haan', DO NOT change language. Remain in Telugu and reply politely in Telugu: 'నమస్తే అండి, నేను అనన్య స్వర్గసీమ నుంచి. మీకు మా ప్రాజెక్ట్స్ గురించి వివరాలు కావాలా అండి?' "
                f"- ONLY switch language if the caller actually speaks in Hindi (e.g. 'Hindi mein bolo', 'Kaun bol raha hai') or English. "
                f"- Once the caller switches to Hindi or English, continue in that language for the rest of the conversation. "
                f"STRICT: Speak only 1 single sentence per turn. Never repeat any sentence or utterance. "
                f"SILENCE RECOVERY: If you receive a system instruction that the caller is silent, ask if they can hear you in 1 short sentence in the active language of this conversation. If you receive a system instruction that the caller is still silent to close, speak 1 short closing sentence in the active language and stop. "
                f"CALLBACK TIME HANDLING: If the caller specifies any time (e.g. '1:00 p.m.', 'kal subah', 'tomorrow 10 AM', 'repu'), that is an agreed callback time. Acknowledge the time, ask for their name, and invoke end_call with disposition='interested'. "
                f"DISPOSITION RULES: NEVER invoke end_call for silence. Silence timeouts are handled automatically by the system. Only invoke end_call for interested, not_interested, or wrong_number. "
                f"When saying goodbye or concluding, speak the single farewell sentence once and stop."
            ),
        })
        context.add_message({
            "role": "assistant",
            "content": AGENT_GREETING,
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
    finally:
        db.finalize_call(call_uuid)
        logger.info(f"Finished pipeline session for call {call_uuid}")
