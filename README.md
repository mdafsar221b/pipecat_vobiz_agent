# Pipecat Vobiz Gemini Live Voice Agent

Production-grade real-time conversational voice agent powered by the **Pipecat AI framework**, connecting **Vobiz Telephony** to **Google Gemini Multimodal Live API** with bidirectional audio streaming, native Voice Activity Detection (VAD), barge-in handling, and MongoDB session tracking.

---

## Architecture Overview

```
Caller (PSTN / Mobile)
          │
          ▼
    Vobiz Carrier
          │
          ▼ WebSocket (JSON: start, media, dtmf, stop)
[FastAPIWebsocketTransport]
          │
          ▼ Deserialization
[VobizFrameSerializer] ──▶ InputAudioRawFrame (16kHz PCM)
                                    │
                                    ▼
                     [GeminiLiveLLMService]
                                    │
                                    ▼
[VobizFrameSerializer] ◀── OutputAudioRawFrame (24kHz PCM)
          │                or InterruptionFrame (clearAudio)
          ▼ Serialization
[FastAPIWebsocketTransport]
          │
          ▼ WebSocket (JSON: playAudio, clearAudio)
    Vobiz Carrier
          │
          ▼
Caller (Speaker)
```

---

## Key Features

- **Native Pipecat Architecture**: Uses `FastAPIWebsocketTransport` and `GeminiLiveLLMService` for asynchronous frame processing.
- **Vobiz Telephony Integration**: Custom `VobizFrameSerializer` translates Vobiz WebSocket messages (`start`, `media`, `dtmf`, `stop`) into Pipecat frames and serializes speech output to `playAudio`.
- **Zero-Resampling Audio Flow**: Inbound 16 kHz PCM directly matches Gemini Live speech input; outbound 24 kHz PCM from Gemini directly streams to Vobiz 24 kHz playback.
- **Low-Latency Interruption (Barge-in)**: Emits `clearAudio` the moment the caller speaks over the agent, flushing buffered audio on the telephony leg.
- **Automated Tool Calling**: Native `end_call` function handles interest evaluation, customer name capture, callback scheduling, and automatic hangup via the Vobiz REST API.
- **MongoDB Persistence**: Stores call state, transcripts (caller vs agent), durations, and outcome dispositions (`interested`, `not_interested`, `wrong_number`, `not_talking`).

---

## Directory Structure

```
pipecat_vobiz_agent/
├── .env                  # Environment variables and API keys
├── requirements.txt      # Python package dependencies
├── server.py             # FastAPI entrypoint, XML webhook and WebSocket router
├── agent.py              # Pipecat pipeline, Gemini Live service, and turn-taking
├── vobiz_serializer.py   # FrameSerializer translating between Vobiz and Pipecat
├── vobiz_api.py          # Vobiz REST client (dialing and hangup)
├── db.py                 # MongoDB client for calls, dispositions, and transcripts
├── call.py               # CLI utility to place outbound test calls
└── README.md             # Project documentation
```

---

## Quickstart

### 1. Environment Setup

Create and activate a virtual environment:

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux / macOS
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

### 2. Configure Environment (`.env`)

Configure your credentials and server endpoints in `.env`:

```env
# Gemini Live API Keys
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.1-flash-live-preview
GEMINI_VOICE=Aoede

# Vobiz Telephony
VOBIZ_AUTH_ID=your_vobiz_auth_id
VOBIZ_AUTH_TOKEN=your_vobiz_auth_token
FROM_NUMBER=+918071583794

# Server & Tunnel
PORT=8000
PUBLIC_URL=https://your-public-tunnel-domain.com

# MongoDB
MONGO_URI=mongodb://username:password@host:27017/dbname?authSource=dbname
MONGO_DB_NAME=rag-bot_test
MONGO_COLLECTION_NAME=vobiz_ai_calls
```

### 3. Run the Server

```bash
python server.py
```

The application exposes:
- `GET /health`: Health and public URL check.
- `POST /answer`: Vobiz Answer URL returning `<Stream>` XML.
- `WS /ws`: Bidirectional media stream endpoint.
- `POST /outbound`: JSON endpoint to trigger an outbound call.
- `GET /calls`: Recent call history and transcripts.

---

## Triggering an Outbound Call

### Using the CLI Utility:

```bash
python call.py --to +919876543210
```

### Using HTTP API:

```bash
curl -X POST http://localhost:8000/outbound \
  -H "Content-Type: application/json" \
  -d '{"to": "+919876543210"}'
```
