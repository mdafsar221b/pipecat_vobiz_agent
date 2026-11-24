import os
import re
import time
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()
client = MongoClient(os.getenv("MONGO_URI"))
rag_db = client["rag-bot_test"]
rea_db = client["realestate_db"]

DAYS_MAP = {0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri", 5: "Sat", 6: "Sun"}

def get_duration_bucket(seconds):
    if seconds <= 0: return "0s"
    if seconds < 30: return "<30s"
    if seconds < 60: return "30s-1m"
    if seconds < 180: return "1m-3m"
    return "3m+"

# 1. Migrate missing campaign batches
missing_batch_ids = ["BATCH-20261124-093722", "BATCH-20261124-092958"]
batches_migrated = 0
for b_id in missing_batch_ids:
    if not rea_db.campaign_batches.find_one({"batch_id": b_id}):
        b_doc = rag_db.campaign_batches.find_one({"batch_id": b_id})
        if b_doc:
            b_doc.pop("_id", None)
            rea_db.campaign_batches.insert_one(b_doc)
            batches_migrated += 1
print(f"Migrated {batches_migrated} campaign batches.")

# 2. Find missing calls
rea_uuids = set(rea_db.vobiz_ai_calls.distinct("call_uuid"))
rag_calls = list(rag_db.vobiz_ai_calls.find({}))
missing_calls = [c for c in rag_calls if c.get("call_uuid") not in rea_uuids]
print(f"Found {len(missing_calls)} calls to migrate.")

batch_cache = {}
for b in rea_db.campaign_batches.find({}, {"batch_id": 1, "created_by": 1}):
    batch_cache[b.get("batch_id")] = b.get("created_by")

migrated_calls = 0
synced_telephony = 0

for old in missing_calls:
    call_uuid = old.get("call_uuid")
    if not call_uuid:
        continue

    raw_phone = str(old.get("phone_number") or "")
    digits = re.sub(r"\D", "", raw_phone)
    ten_digit = digits[-10:] if len(digits) >= 10 else digits
    raw_num = f"+91{ten_digit}" if ten_digit else raw_phone

    dur = float(old.get("duration_seconds") or 0.0)
    raw_disp = str(old.get("disposition") or "not_talking").lower()
    title_disp = raw_disp.replace("_", " ").title()
    is_ans = dur > 0 or raw_disp in ("interested", "not_interested", "not_talking", "completed")
    call_st = "answered" if is_ans else ("busy" if raw_disp == "busy" else "missed")
    is_prod = raw_disp in ("interested", "not_interested")

    b_id = old.get("batch_id")
    operator = batch_cache.get(b_id) or old.get("metadata", {}).get("created_by") or "Prakash"
    cust_name = old.get("customer_name") or old.get("metadata", {}).get("customer_name") or ""
    cb_time = old.get("callback_time")

    dt_str = old.get("created_at")
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")) if dt_str else datetime.now(timezone.utc)
    except Exception:
        dt = datetime.now(timezone.utc)
    ist_dt = dt.astimezone(timezone(timedelta(hours=5, minutes=30)))

    diag = old.get("diagnostic") or {}
    hangup_cause = "NORMAL_CLEARING"
    hung_up_by = "unknown"
    if isinstance(diag, dict) and "hangup" in diag:
        hangup_cause = diag["hangup"].get("cause") or hangup_cause
        hung_up_by = (diag["hangup"].get("source") or hung_up_by).lower()

    events = old.get("events") or []
    call_flow = [{"type": ev.get("event"), "time": ev.get("time_epoch") or 0, "details": ev.get("details")} for ev in events]

    unified_doc = {
        "callId": call_uuid,
        "uuid": call_uuid,
        "call_uuid": call_uuid,
        "customerNumber": ten_digit,
        "customerNumberRaw": raw_num,
        "customerName": cust_name,
        "customer_name": cust_name,
        "customerId": None,
        "direction": "outbound",
        "callStatus": call_st,
        "isProductive": is_prod,
        "isFirstCall": True,
        "isManual": False,
        "isTransferred": False,
        "abandonedInQueue": False,
        "answeredWithinSla": True,
        "agentName": "Ananya",
        "agentExtension": "918071583794",
        "agentId": None,
        "teamLeaderName": "AI Operations",
        "teamLeaderId": None,
        "didNumber": "918071583794",
        "didNumberRaw": "+918071583794",
        "sourceName": "Vobiz AI - Ananya",
        "campaignName": "AI Outbound Campaign",
        "campaignId": b_id or "BATCH-VOBIZ-AI",
        "batchId": b_id,
        "batch_id": b_id,
        "initiatedBy": operator,
        "createdBy": operator,
        "queueName": "",
        "queueWaitDuration": 0,
        "callDate": ist_dt.strftime("%Y-%m-%d"),
        "callHour": ist_dt.hour,
        "dayOfWeek": DAYS_MAP[ist_dt.weekday()],
        "callTimestamp": dt,
        "answeredAt": (dt + timedelta(seconds=12)) if is_ans else None,
        "endedAt": dt + timedelta(seconds=int(dur)),
        "ringDuration": 0,
        "talkDuration": int(dur),
        "totalDuration": int(dur) + (3 if is_ans else 0),
        "durationBucket": get_duration_bucket(dur),
        "disposition": title_disp,
        "rawDisposition": raw_disp,
        "dispositionNotes": old.get("reason") or "",
        "dispositionSavedAt": dt + timedelta(seconds=int(dur)),
        "missedType": None if is_ans else "customer_missed",
        "hangupCause": hangup_cause,
        "hungUpBy": hung_up_by,
        "carrier": "",
        "circle": "",
        "recordingName": "",
        "recordingUrl": old.get("recording_url") or "",
        "originalCollection": "vobiz_ai_calls",
        "callbackStatus": "completed" if is_ans else "attempted",
        "callbackAttempts": 1,
        "callbackCallId": None,
        "callbackTimestamp": None,
        "callFlow": call_flow,
        "isAiCall": True,
        "callbackSchedule": {"preferredTime": cb_time or "", "customerName": cust_name or ""} if (cb_time or cust_name) else None,
        "callback_time": cb_time,
        "transcripts": old.get("transcripts") or [],
        "events": events,
        "diagnostic": diag,
        "audio_metrics": old.get("audio_metrics") or {},
        "aiDiagnostic": {
            "classification": diag.get("classification"),
            "rootCauseSummary": diag.get("root_cause_summary"),
            "audioMetrics": diag.get("audio_metrics", {}),
        },
        "status": old.get("status") or "completed",
        "created_at": old.get("created_at"),
        "start_time": old.get("start_time"),
        "duration_seconds": dur,
        "metadata": old.get("metadata") or {},
        "phone_number": raw_num,
    }

    rea_db.vobiz_ai_calls.insert_one(unified_doc)
    migrated_calls += 1

    if ten_digit:
        res = rea_db.telephony_calls.update_many(
            {
                "customerNumber": ten_digit,
                "direction": "inbound",
                "missedType": {"$ne": None},
                "callbackStatus": {"$in": ["pending", None]},
            },
            {
                "$set": {
                    "callbackStatus": "completed" if is_ans else "attempted",
                    "callbackCallId": call_uuid,
                    "callbackTimestamp": dt,
                    "isAiResolved": True,
                    "callbackAgentName": "Ananya",
                    "aiDisposition": title_disp,
                },
                "$inc": {"callbackAttempts": 1}
            }
        )
        synced_telephony += res.modified_count

print(f"Success! Migrated {migrated_calls} call records to realestate_db.")
print(f"Synced {synced_telephony} pending missed calls in telephony_calls.")
