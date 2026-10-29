# Swargaseema AI Telephony - Pipecat Voice Agent

Production-grade real-time conversational voice agent powered by the **Pipecat AI framework**, connecting **Vobiz Telephony** to **Google Gemini Multimodal Live API** with bidirectional audio streaming, native Voice Activity Detection (VAD), barge-in handling, automated OBD campaign management, and MongoDB session tracking.

---

## Prerequisites

- **Python**: 3.11 or 3.12
- **Node.js**: 18+ and npm
- **MongoDB**: Local instance (`localhost:27017`) or MongoDB Atlas
- **Vobiz Telephony Account**: With SIP trunk/DID and API credentials
- **Google AI Studio**: Gemini API key with access to Multimodal Live API

---

## How to Run After Cloning

### Step 1: Clone and Enter the Directory

```bash
git clone <repository_url>
cd pipecat_vobiz_agent
```

---

### Step 2: Install Dependencies

#### 1. Python Environment:
```bash
# Create virtual environment
python -m venv .venv

# Activate environment
# On Windows:
.venv\Scripts\activate
# On Linux / macOS:
source .venv/bin/activate

# Install Python requirements
pip install -r requirements.txt
```

#### 2. Node.js & Frontend Dependencies:
```bash
# Installs root supervisor and React frontend dependencies
npm run install:all
```

---

### Step 3: Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Open `.env` and fill in your credentials:

```env
# Gemini Live API Key
GEMINI_API_KEY=your_gemini_api_key

# Vobiz Telephony Credentials
VOBIZ_AUTH_ID=your_vobiz_auth_id
VOBIZ_AUTH_TOKEN=your_vobiz_auth_token
FROM_NUMBER=+918071583794

# Public HTTPS URL (Cloudflare tunnel or your domain)
PUBLIC_URL=https://your-domain.com

# MongoDB
MONGO_URI=mongodb://localhost:27017
MONGO_DB_NAME=vobiz_agent_db
```

---

### Step 4: Run the Application

#### Option A: Local Development (Single Command)
Starts the backend server (port 8000), React frontend (port 3000), and auto-detects `cloudflared.exe` if present:
```bash
npm run dev
```
Open **`http://localhost:3000`** in your browser.

#### Option B: Production Mode (Recommended for Server Deployment)
Build the React UI once, then run FastAPI (FastAPI serves both the API and the compiled React UI directly on port 8000):
```bash
# 1. Build React dashboard
npm run build

# 2. Start production server
npm start
# OR: python -m uvicorn server:app --host 0.0.0.0 --port 8000
```
Open **`http://localhost:8000`** in your browser.

#### Option C: Docker (One Command)
If you have Docker and Docker Compose installed:
```bash
# 1. Make sure .env exists with your API keys
cp .env.example .env

# 2. Build and launch container stack (Voice Agent + MongoDB)
docker compose up -d --build
```
Open **`http://localhost:8000`** in your browser.

---

## Important Telephony Notice for Carrier Webhooks

Vobiz requires an accessible **HTTPS** endpoint to reach your `/answer` and `/hangup` webhooks:

1. **Local Testing**:
   Place `cloudflared.exe` (or `cloudflared` on Linux) in the project root directory. `npm run dev` will automatically launch the tunnel and synchronize `PUBLIC_URL` into `.env`.

2. **Production Deployment**:
   Assign a permanent domain (e.g., `https://voice.yourdomain.com`) with an SSL certificate pointing to port 8000, and set `PUBLIC_URL=https://voice.yourdomain.com` in `.env`.

---

## Verification & Health Check

Verify your deployment with:

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "pipecat-vobiz-gemini-live",
  "public_url": "https://your-public-url.com"
}
```
