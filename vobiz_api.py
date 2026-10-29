import os
from typing import Any, Dict, Optional
import httpx
from loguru import logger

API_BASE = "https://api.vobiz.ai/api/v1"
AUTH_ID = os.getenv("VOBIZ_AUTH_ID", "")
AUTH_TOKEN = os.getenv("VOBIZ_AUTH_TOKEN", "")
FROM_NUMBER = os.getenv("FROM_NUMBER", "") or os.getenv("VOBIZ_PHONE_NUMBER", "")

# Build request headers with Vobiz authentication
def get_headers() -> Dict[str, str]:
    return {
        "Content-Type": "application/json",
        "X-Auth-ID": AUTH_ID,
        "X-Auth-Token": AUTH_TOKEN,
    }

# Place an outbound call via Vobiz REST API
async def place_call(
    to_number: str,
    answer_url: str,
    hangup_url: str,
    from_number: Optional[str] = None,
) -> Dict[str, Any]:
    caller = from_number or FROM_NUMBER
    payload = {
        "from": caller,
        "to": to_number,
        "answer_url": answer_url,
        "answer_method": "POST",
        "hangup_url": hangup_url,
        "hangup_method": "POST",
    }
    url = f"{API_BASE}/Account/{AUTH_ID}/Call/"
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(url, json=payload, headers=get_headers())
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            err_msg = str(exc)
            try:
                err_data = exc.response.json()
                if isinstance(err_data, dict) and "error" in err_data:
                    err_msg = f"{err_data['error']} (HTTP {exc.response.status_code})"
                elif exc.response.text:
                    err_msg = f"{exc.response.text.strip()} (HTTP {exc.response.status_code})"
            except Exception:
                pass
            logger.error(f"Failed to place Vobiz call to {to_number}: {err_msg}")
            raise RuntimeError(err_msg) from exc
        except httpx.HTTPError as exc:
            logger.error(f"Failed to place Vobiz call to {to_number}: {exc}")
            raise

# Terminate an active call via Vobiz REST API
async def hangup_call(call_uuid: str) -> bool:
    if not call_uuid:
        return False
    url = f"{API_BASE}/Account/{AUTH_ID}/Call/{call_uuid}/"
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.delete(url, headers=get_headers())
            return resp.status_code in (200, 204)
        except Exception as exc:
            logger.warning(f"Failed to execute Vobiz hangup for {call_uuid}: {exc}")
            return False
