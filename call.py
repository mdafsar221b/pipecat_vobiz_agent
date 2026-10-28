import argparse
import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import httpx

BASE_DIR = Path(__file__).parent
load_dotenv(BASE_DIR / ".env", override=True)

API_BASE = "https://api.vobiz.ai/api/v1"
AUTH_ID = os.getenv("VOBIZ_AUTH_ID", "")
AUTH_TOKEN = os.getenv("VOBIZ_AUTH_TOKEN", "")
FROM_NUMBER = os.getenv("FROM_NUMBER", "") or os.getenv("VOBIZ_PHONE_NUMBER", "")
TO_NUMBER = os.getenv("TO_NUMBER", "")
PORT = os.getenv("PORT", os.getenv("HTTP_PORT", "8000"))

# Determine active server base URL from health endpoint or config
def resolve_server_url() -> str:
    try:
        resp = httpx.get(f"http://127.0.0.1:{PORT}/health", timeout=3.0)
        if resp.status_code == 200:
            public = resp.json().get("public_url", "")
            if public:
                return public.rstrip("/")
    except Exception:
        pass
    env_url = os.getenv("PUBLIC_URL", "").rstrip("/")
    if env_url:
        return env_url
    sys.exit("Server public URL not found. Ensure server is running or set PUBLIC_URL in .env.")

# Place outbound call via command line
def main():
    parser = argparse.ArgumentParser(description="Place an outbound call via Pipecat Vobiz Agent")
    parser.add_argument("--to", default=TO_NUMBER, help="Destination phone number (E.164)")
    parser.add_argument("--from", dest="from_", default=FROM_NUMBER, help="Caller ID phone number")
    parser.add_argument("--url", default="", help="Override public base URL")
    args = parser.parse_args()

    if not AUTH_ID or not AUTH_TOKEN:
        sys.exit("VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN must be configured.")
    if not args.to:
        sys.exit("Specify destination number via --to or TO_NUMBER in .env.")

    base_url = (args.url or resolve_server_url()).rstrip("/")
    payload = {
        "from": args.from_,
        "to": args.to,
        "answer_url": f"{base_url}/answer",
        "answer_method": "POST",
        "hangup_url": f"{base_url}/hangup",
        "hangup_method": "POST",
    }

    headers = {
        "Content-Type": "application/json",
        "X-Auth-ID": AUTH_ID,
        "X-Auth-Token": AUTH_TOKEN,
    }
    url = f"{API_BASE}/Account/{AUTH_ID}/Call/"

    print("Initiating outbound call with payload:")
    print(json.dumps(payload, indent=2))

    resp = httpx.post(url, json=payload, headers=headers, timeout=20.0)
    print(f"\nResponse HTTP {resp.status_code}:")
    try:
        print(json.dumps(resp.json(), indent=2))
    except Exception:
        print(resp.text)

if __name__ == "__main__":
    main()
