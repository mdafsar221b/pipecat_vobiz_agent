# Migration script to convert vobiz_ai_calls records to the telephony_calls structure
import os
import re
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
import pymongo
from pymongo import ReplaceOne

load_dotenv()
client = pymongo.MongoClient(os.getenv("MONGO_URI"))
db = client["rag-bot_test"]

ist_offset = timedelta(hours=5, minutes=30)
days_map = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

def parse_iso_or_epoch(val):
    if not val:
        return None
    if isinstance(val, (int, float)):
        return datetime.fromtimestamp(val, tz=timezone.utc)
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        except Exception:
            return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    return None

def get_duration_bucket(seconds):
    if seconds <= 0:
        return "0s"
    elif seconds < 15:
        return "<15s"
    elif seconds <= 60:
        return "15s-60s"
    elif seconds <= 180:
        return "1m-3m"
    else:
        return ">3m"

def transform_doc(doc):
    call_uuid = doc.get("call_uuid") or str(doc.get("_id"))
    batch_id = doc.get("batch_id")
    raw_phone = str(doc.get("phone_number") or "")
    digits = re.sub(r"\D", "", raw_phone)
    ten_digit = digits[-10:] if len(digits) >= 10 else digits
    raw_prefix = f"+91{ten_digit}" if len(ten_digit) == 10 else f"+{digits}"

    created_at_dt = parse_iso_or_epoch(doc.get("created_at") or doc.get("start_time"))
    if not created_at_dt:
        created_at_dt = doc["_id"].generation_time

    ist_dt = created_at_dt + ist_offset
    call_date = ist_dt.strftime("%Y-%m-%d")
    call_hour = ist_dt.hour
    day_of_week = days_map[ist_dt.weekday()]

    duration_sec = doc.get("duration_seconds")
    if duration_sec is None:
        duration_sec = doc.get("duration") or 0
    duration_sec = float(duration_sec)

    ended_at_dt = parse_iso_or_epoch(doc.get("ended_at") or doc.get("ended_at_epoch"))
    if not ended_at_dt:
        ended_at_dt = created_at_dt + timedelta(seconds=duration_sec)

    disposition_raw = (doc.get("disposition") or "").lower()
    disposition_title = disposition_raw.replace("_", " ").title() if disposition_raw else ""

    metadata = doc.get("metadata") or {}
    did_number = metadata.get("From") or "918071583794"
    did_clean = re.sub(r"\D", "", did_number)

    # Reconstruct transcripts
    transcripts = doc.get("transcripts")
    if not transcripts:
        turns = doc.get("turns") or []
        transcripts = []
        for t in turns:
            transcripts.append({
                "role": t.get("role"),
                "text": t.get("text"),
                "timestamp": created_at_dt.isoformat()
            })

    # Build callFlow array from events or default stages
    events = doc.get("events") or []
    call_flow = []
    if events:
        for ev in events:
            call_flow.append({
                "type": ev.get("event"),
                "time": ev.get("time_epoch") or 0,
                "details": ev.get("details")
            })
    else:
        call_flow.append({"type": "init", "value": call_uuid, "time": created_at_dt.timestamp()})
        if duration_sec > 0:
            call_flow.append({"type": "Customer", "dialst": "Answered", "time": created_at_dt.timestamp() + 3})
            call_flow.append({"type": "Agent", "name": "Ananya", "num": did_clean, "dialst": "Connected", "time": created_at_dt.timestamp() + 5})
        call_flow.append({"type": "Hangup", "time": ended_at_dt.timestamp()})

    rec_url = doc.get("recording_url") or ""
    rec_name = ""
    if rec_url:
        rec_name = rec_url.split("/")[-1].replace(".mp3", "")

    diag = doc.get("diagnostic") or {}
    hangup_cause = "NORMAL_CLEARING"
    hung_up_by = "unknown"
    if isinstance(diag, dict) and "hangup" in diag:
        hangup_cause = diag["hangup"].get("cause") or hangup_cause
        hung_up_by = (diag["hangup"].get("source") or hung_up_by).lower()

    customer_name = doc.get("customer_name") or doc.get("contact_name") or ""
    callback_time = doc.get("callback_time") or ""

    is_answered = duration_sec > 0 or disposition_raw in ("interested", "not_interested", "not_talking", "completed")
    call_status = "answered" if is_answered else ("busy" if disposition_raw == "busy" else "missed")
    is_productive = disposition_raw in ("interested", "not_interested")

    new_doc = {
        "_id": doc["_id"],
        "callId": call_uuid,
        "uuid": call_uuid,
        "direction": "outbound",
        "callStatus": call_status,
        "isProductive": is_productive,
        "isFirstCall": True,
        "isManual": False,
        "isTransferred": False,
        "abandonedInQueue": False,
        "answeredWithinSla": True,

        "agentName": "Ananya",
        "agentExtension": did_clean,
        "agentId": None,
        "teamLeaderName": "AI Operations",
        "teamLeaderId": None,

        "customerNumber": ten_digit,
        "customerNumberRaw": raw_prefix,
        "customerName": customer_name,
        "customerId": None,

        "didNumber": did_clean,
        "didNumberRaw": f"+{did_clean}",
        "sourceName": "Vobiz AI - Ananya",

        "campaignName": "AI Outbound Campaign",
        "campaignId": batch_id or "BATCH-VOBIZ-AI",
        "queueName": "",
        "queueWaitDuration": 0,

        "callDate": call_date,
        "callHour": call_hour,
        "dayOfWeek": day_of_week,
        "callTimestamp": created_at_dt,
        "answeredAt": (created_at_dt + timedelta(seconds=3)) if is_answered else None,
        "endedAt": ended_at_dt,

        "ringDuration": 3 if is_answered else min(int(duration_sec), 25),
        "talkDuration": int(duration_sec),
        "totalDuration": int(duration_sec) + (3 if is_answered else 0),
        "durationBucket": get_duration_bucket(duration_sec),

        "disposition": disposition_title,
        "rawDisposition": disposition_raw,
        "dispositionNotes": doc.get("reason") or "",
        "dispositionSavedAt": ended_at_dt,
        "missedType": None if is_answered else "customer_missed",

        "hangupCause": hangup_cause,
        "hungUpBy": hung_up_by,

        "carrier": "",
        "circle": "",

        "recordingName": rec_name,
        "recordingUrl": rec_url,
        "originalCollection": "vobiz_ai_calls",

        "callbackStatus": "not_applicable",
        "callbackAttempts": 0,
        "callbackCallId": None,
        "callbackTimestamp": None,

        "callFlow": call_flow,

        # Compatibility alias for legacy index/queries
        "call_uuid": call_uuid,
        "batch_id": batch_id,
        "phone_number": raw_phone,
        "created_at": created_at_dt.isoformat(),
        "isAiCall": True,
        "batchId": batch_id,
        "callbackSchedule": {
            "preferredTime": callback_time,
            "customerName": customer_name
        } if (callback_time or customer_name) else None,
        "transcripts": transcripts,
        "aiDiagnostic": {
            "classification": diag.get("classification") if isinstance(diag, dict) else None,
            "rootCauseSummary": diag.get("root_cause_summary") if isinstance(diag, dict) else None,
            "audioMetrics": doc.get("audio_metrics") or (diag.get("audio_metrics") if isinstance(diag, dict) else None)
        }
    }
    return new_doc

def run_migration():
    total_docs = db.vobiz_ai_calls.count_documents({})
    print(f"Starting migration for {total_docs} documents...")
    cursor = db.vobiz_ai_calls.find()
    batch = []
    updated = 0
    for doc in cursor:
        transformed = transform_doc(doc)
        batch.append(ReplaceOne({"_id": doc["_id"]}, transformed))
        if len(batch) >= 500:
            db.vobiz_ai_calls.bulk_write(batch, ordered=False)
            updated += len(batch)
            print(f"Migrated {updated}/{total_docs}...")
            batch = []
    if batch:
        db.vobiz_ai_calls.bulk_write(batch, ordered=False)
        updated += len(batch)
        print(f"Migrated {updated}/{total_docs} completed.")

if __name__ == "__main__":
    run_migration()
