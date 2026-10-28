import json
from typing import Optional
from loguru import logger
import diagnostics

from pipecat.frames.frames import AudioRawFrame, Frame, InputAudioRawFrame
from pipecat.serializers.vobiz import (
    VobizFrameSerializer as BaseVobizFrameSerializer,
    parse_vobiz_start,
)

# Serializer extending official pipecat-vobiz with diagnostic milestone tracing
class VobizFrameSerializer(BaseVobizFrameSerializer):
    def __init__(
        self,
        stream_id: str = "",
        call_id: Optional[str] = None,
        auth_id: Optional[str] = None,
        auth_token: Optional[str] = None,
        params: Optional[BaseVobizFrameSerializer.InputParams] = None,
    ):
        super().__init__(
            stream_id=stream_id,
            call_id=call_id,
            auth_id=auth_id,
            auth_token=auth_token,
            params=params,
        )

    # Set call identifiers dynamically
    def set_call_identifiers(self, call_uuid: str, stream_id: Optional[str] = None) -> None:
        self._call_id = call_uuid
        if stream_id:
            self._stream_id = stream_id

    # Serialize frames to Vobiz JSON with outbound audio diagnostic tracking
    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, AudioRawFrame):
            data = frame.audio
            if data and self._call_id:
                diagnostics.get_tracer(self._call_id).record_audio_out(
                    len(data), sample_rate=self._vobiz_sample_rate
                )
        return await super().serialize(frame)

    # Deserialize Vobiz JSON into Pipecat frames with inbound audio diagnostic tracking
    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, str) and ("start" in data):
            try:
                msg = json.loads(data)
                if msg.get("event") == "start":
                    start_data = msg.get("start") or {}
                    st_id = msg.get("streamId") or start_data.get("streamId")
                    if st_id:
                        self._stream_id = st_id
                    if self._call_id:
                        diagnostics.get_tracer(self._call_id).record_event(
                            "vobiz_stream_connected",
                            {
                                "stream_id": self._stream_id,
                                "encoding": self._encoding,
                                "sample_rate": self._vobiz_sample_rate,
                            },
                        )
            except Exception:
                pass

        frame = await super().deserialize(data)
        if isinstance(frame, InputAudioRawFrame):
            if frame.audio and self._call_id:
                diagnostics.get_tracer(self._call_id).record_audio_in(len(frame.audio))
        return frame
