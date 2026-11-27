import os
import re
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from dotenv import load_dotenv
from loguru import logger
from bson import ObjectId
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.collection import Collection
from pymongo.database import Database

import sys

BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

load_dotenv(BASE_DIR / ".env", override=True)

# Helper to extract database name from URI if not explicitly defined
def _extract_db_name(uri: str, explicit_db: Optional[str] = None) -> str:
    if explicit_db and explicit_db.strip():
        return explicit_db.strip()
    if uri and "/" in uri:
        try:
            from urllib.parse import urlparse
            p = urlparse(uri).path.lstrip("/")
            if p:
                return p.split("?")[0]
        except Exception:
            pass
    return ""

MONGO_URI = os.getenv("MONGO_URI", "")
MONGO_DB_NAME = _extract_db_name(MONGO_URI, os.getenv("MONGO_DB_NAME"))
MONGO_COLLECTION_NAME = os.getenv("MONGO_COLLECTION_NAME", "vobiz_ai_calls")
MONGO_BATCHES_COLLECTION_NAME = os.getenv("MONGO_BATCHES_COLLECTION_NAME", "campaign_batches")
MONGO_TEMPLATES_COLLECTION_NAME = os.getenv("MONGO_TEMPLATES_COLLECTION_NAME", "campaign_templates")
MONGO_SETTINGS_COLLECTION_NAME = os.getenv("MONGO_SETTINGS_COLLECTION_NAME", "app_settings")

_client: Optional[MongoClient] = None
_db: Optional[Database] = None
_collection: Optional[Collection] = None
_batches_col: Optional[Collection] = None
_templates_col: Optional[Collection] = None
_settings_col: Optional[Collection] = None
_transcript_enabled_cache: Optional[bool] = None

# Initialize MongoDB client and ensure collection indexes
def get_collection() -> Optional[Collection]:
    global _client, _db, _collection
    if _collection is not None:
        return _collection
    try:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        _db = _client[MONGO_DB_NAME]
        _collection = _db[MONGO_COLLECTION_NAME]
        _collection.create_index([("call_uuid", ASCENDING)], unique=True)
        _collection.create_index([("phone_number", ASCENDING)])
        _collection.create_index([("batch_id", ASCENDING)])
        _collection.create_index([("created_at", DESCENDING)])
        logger.info(f"MongoDB initialized with database: '{MONGO_DB_NAME}' (collection: '{MONGO_COLLECTION_NAME}')")
        return _collection
    except Exception as exc:
        logger.error(f"MongoDB connection failed: {exc}")
        return None

# Retrieve MongoDB database instance
def get_db() -> Optional[Database]:
    global _client, _db
    if _db is not None:
        return _db
    get_collection()
    return _db

# Initialize campaign batches collection
def get_batches_collection() -> Optional[Collection]:
    global _client, _db, _batches_col
    if _batches_col is not None:
        return _batches_col
    col = get_collection()
    if _db is not None:
        _batches_col = _db[MONGO_BATCHES_COLLECTION_NAME]
        _batches_col.create_index([("batch_id", ASCENDING)], unique=True)
        _batches_col.create_index([("created_at", DESCENDING)])
        return _batches_col
    return None

# Initialize campaign templates collection
def get_templates_collection() -> Optional[Collection]:
    global _client, _db, _templates_col
    if _templates_col is not None:
        return _templates_col
    col = get_collection()
    if _db is not None:
        _templates_col = _db[MONGO_TEMPLATES_COLLECTION_NAME]
        _templates_col.create_index([("template_id", ASCENDING)], unique=True)
        return _templates_col
    return None

# Initialize global app settings collection
def get_settings_collection() -> Optional[Collection]:
    global _db, _settings_col
    if _settings_col is not None:
        return _settings_col
    get_collection()
    if _db is not None:
        _settings_col = _db[MONGO_SETTINGS_COLLECTION_NAME]
        return _settings_col
    return None

# Check whether live & stored transcripts are globally enabled (defaults to False for low Gemini AI cost)
def is_transcript_enabled() -> bool:
    global _transcript_enabled_cache
    if _transcript_enabled_cache is not None:
        return _transcript_enabled_cache
    try:
        scol = get_settings_collection()
        if scol is not None:
            doc = scol.find_one({"_id": "global_settings"})
            if doc is not None and "transcript_enabled" in doc:
                _transcript_enabled_cache = bool(doc["transcript_enabled"])
                return _transcript_enabled_cache
    except Exception as exc:
        logger.warning(f"Failed to read transcript_enabled setting from DB: {exc}")
    env_default = os.getenv("ENABLE_TRANSCRIPT", "false").strip().lower() in ("1", "true", "yes", "on")
    _transcript_enabled_cache = env_default
    return _transcript_enabled_cache

# Persist global transcript enabled/disabled flag
def set_transcript_enabled(enabled: bool) -> bool:
    global _transcript_enabled_cache
    val = bool(enabled)
    _transcript_enabled_cache = val
    try:
        scol = get_settings_collection()
        if scol is not None:
            scol.update_one(
                {"_id": "global_settings"},
                {"$set": {"transcript_enabled": val, "updated_at": now_iso()}},
                upsert=True,
            )
    except Exception as exc:
        logger.error(f"Failed to persist transcript_enabled setting: {exc}")
    logger.info(f"Global transcript setting updated: {'ENABLED' if val else 'DISABLED (low-cost mode)'}")
    return val

# Seed default campaign templates if collection is empty
def init_default_templates() -> None:
    col = get_templates_collection()
    if col is None:
        return

    default_templates = [
        {
            "template_id": "missed_calls",
            "name": "Pending Missed Calls",
            "description": "Callback acknowledgment for recent inbound missed calls to Swargaseema",
            "target_disposition": "Missed Calls",
            "greeting_telugu": "నమస్తే అండి! నేను అనన్య స్వర్గసీమ నుంచి మాట్లాడుతున్నాను. మీరు మాకు మిస్డ్ కాల్ చేశారు. మీకు స్వర్గసీమ ప్రాజెక్ట్స్ లో ఇంట్రెస్ట్ ఉందా అండి?",
            "greeting_hindi": "Namaste ji! Main Ananya Swargaseema se baat kar rahi hoon. Aapka missed call mila tha, kya aapko projects ki details chahiye thi?",
            "greeting_audio_path": "assets/greeting_telugu_16k.pcm",
            "system_prompt": (
                "You are Ananya (అనన్య), an outbound AI voice calling agent for Swargaseema, a real-estate plots company. You are calling customers because records show they made a missed call to Swargaseema.\n\n"
                "### SCOPE & OPERATING RULES (STRICT)\n"
                "1. NATURAL SPOKEN VOICE ONLY: Speak ONLY natural conversational sentences that a human caller would hear.\n"
                "2. ZERO CODE OR FUNCTION LEAKAGE: NEVER speak function names, parameter names, or code syntax aloud. All function tools must be executed silently.\n"
                "3. CONCISENESS & SINGLE UTTERANCE: Speak strictly 1 single concise sentence per turn. Never repeat yourself.\n"
                "4. STRICT ASSISTANT BOUNDARIES: You are an initial qualification assistant, NOT a full sales representative. Do NOT get into in-depth explanations. Answer basic queries in 1 short sentence, then state a senior executive will call back.\n\n"
                "### BASIC PROJECT KNOWLEDGE\n"
                "- Company: Swargaseema Sandalwood & Open Plots.\n"
                "- Locations: Near Hyderabad along prime highway corridors, especially Shadnagar and Bangalore Highway (DTCP and RERA approved open plots).\n"
                "- Rule: If caller asks what this is about, answer in 1 sentence that Swargaseema provides DTCP approved open plots near Shadnagar and highway corridors, and senior executive will explain details.\n\n"
                "### CONVERSATION FLOW\n"
                "1. Opening Telugu Greeting & Strict Language Mirroring: You already spoken the opening Telugu greeting. If caller speaks Hindi, immediately switch 100% to Hindi: 'Namaste! Main Ananya, Swargaseema se call back kar rahi hoon. Aapne open plots ke liye call kiya tha, kya aapko details chahiye thi?'\n"
                "2. If caller says YES or expresses interest: Step 1 - Ask Name ('మీ పేరు తెలుసుకోవచ్చా అండి?') -> Step 2 - Ask Callback Timing ('మా ఎగ్జిక్యూటివ్ మీకు ఏ రోజు లేదా ఏ సమయానికి కాల్ చేయాలి?') -> Step 3 - Confirm, say goodbye once, and invoke end_call with disposition='interested'.\n"
                "3. If caller says NO / not interested: say polite goodbye once and invoke end_call with disposition='not_interested'.\n"
                "4. If caller says wrong number: apologize in 1 sentence, say goodbye, and invoke end_call with disposition='wrong_number'.\n"
                "5. SILENCE RECOVERY: If caller is silent, ask if they hear you. If still silent, say polite goodbye and stop."
            ),
            "is_active": True,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        },
        {
            "template_id": "production_callback_conversion",
            "name": "Production Callback Conversion (Shadnagar Open Plots)",
            "description": "Recommended production script: 10s permission check, executive value bridge, and appointment scheduling",
            "target_disposition": "Callback Conversion",
            "greeting_telugu": "నమస్తే అండి! నేను అనన్య, స్వర్గసీమ నుంచి మాట్లాడుతున్నానండి. షాద్నగర్, బెంగళూరు హైవే వైపు మా ఓపెన్ ప్లాట్స్ గురించి మీకు కొన్ని వివరాలు చెప్పడానికి కాల్ చేశానండి. ఇప్పుడు ఒక నిమిషం మాట్లాడటం వీలవుతుందా అండి?",
            "greeting_hindi": "Namaste ji! Main Ananya, Swargaseema se baat kar rahi hoon. Shadnagar aur Bangalore Highway side mein hamare open plots ke baare mein aapko kuch details batane ke liye call kiya tha. Kya abhi ek minute baat karna convenient rahega?",
            "greeting_audio_path": "assets/greeting_callback_conversion_16k.pcm",
            "system_prompt": (
                "You are Ananya (అనన్య), a telecalling AI assistant for Swargaseema.\n"
                "Golden rule: Train around this single sentence: 'మా సీనియర్ ఎగ్జిక్యూటివ్ మీకు పూర్తి వివరాలు వివరిస్తారు. మీకు ఎప్పుడు కాల్ చేయడం సౌకర్యంగా ఉంటుంది అండి?'\n"
                "Your objective is to secure a callback appointment with our senior property executive.\n\n"
                "### CORE OPERATING RULES\n"
                "1. Natural, warm, and respectful tone. Speak clearly and slowly. Strictly 1 single sentence per turn. Keep call under 45-60 seconds.\n"
                "2. ZERO code/function leakage: never speak tool names or code aloud. All tools are executed silently.\n"
                "3. DO NOT explain complete project details or discuss prices and discounts. Always bridge to senior executive callback.\n\n"
                "### CONVERSATION FLOW\n"
                "1. Opening: You already delivered the opening greeting mentioning Shadnagar and Bangalore Highway open plots and asked for 1 minute.\n"
                "- If caller speaks Hindi, immediately switch 100% to Hindi for all subsequent turns.\n"
                "2. Customer agrees / says yes (e.g. 'హలో చెప్పండి', 'Haan boliye'):\n"
                "- In Telugu: 'తప్పకుండా అండి! మనకి షాద్నగర్, బెంగళూరు హైవే వైపు ఓపెన్ ప్లాట్స్ అందుబాటులో ఉన్నాయండి. లొకేషన్, ప్లాట్ సైజులు, ప్రస్తుత ధరలు, ప్రాజెక్ట్ వివరాలన్నీ మా సీనియర్ ప్రాపర్టీ ఎగ్జిక్యూటివ్ మీకు క్లియర్గా వివరిస్తారండి. మీకు ఎప్పుడు కాల్ చేయడం సౌకర్యంగా ఉంటుంది అండి?'\n"
                "- In Hindi: 'Bilkul ji! Hamare Shadnagar aur Bangalore Highway side mein open plots available hain. Location, plot sizes, current pricing aur project ki complete details hamare senior property executive aapko achhe se samjha denge. Aapko kis time call karna convenient rahega ji?'\n"
                "3. Secure the appointment (Most important step):\n"
                "- Ask preferred slot: 'తప్పకుండా అండి. మీకు ఈరోజు సాయంత్రం కాల్ చేయడం సౌకర్యంగా ఉంటుందా, లేక రేపు ఉదయం బాగుంటుందా?' (Hindi: 'Zaroor ji. Aapke liye aaj shaam call karna convenient rahega ya kal subah?')\n"
                "- Ask Name: 'సరేనండి. మీ పేరు తెలుసుకోవచ్చా?' (Hindi: 'Zaroor ji. Aapka naam jaan sakti hoon?')\n"
                "- Confirm details & WhatsApp permission: 'థాంక్యూ [Name] గారు. [Confirmed Time]కి మా సీనియర్ ఎగ్జిక్యూటివ్ మీకు కాల్ చేస్తారండి. మీకు వాట్సాప్ లో ప్రాజెక్ట్ వివరాలు కూడా పంపించవచ్చా?' (Hindi: 'Thank you, [Name] ji. [Time] baje hamare senior executive aapko call karenge. Kya main aapko WhatsApp par project details bhi share kar doon?')\n"
                "- Once confirmed, say a single polite goodbye and invoke end_call with disposition='interested', customer_name, callback_time.\n\n"
                "### OBJECTION HANDLING (STRICT 1-SENTENCE REPLIES)\n"
                "- I'm busy: 'పర్లేదండి, మీకు ఎప్పుడు కాల్ చేస్తే సౌకర్యంగా ఉంటుంది?' (Hindi: 'Koi baat nahi ji, aapko kis time call karna convenient rahega?')\n"
                "- Send on WhatsApp: 'తప్పకుండా అండి. వివరాలు పంపిస్తాను. వాటిని వివరించడానికి ఎప్పుడు కాల్ చేయమంటారు?' (Hindi: 'Zaroor ji, details bhej deti hoon. Unhe explain karne ke liye executive kis time call karein?')\n"
                "- What's the price?: 'ప్లాట్ సైజ్, లొకేషన్ను బట్టి ధర మారుతుందండి. ప్రస్తుత ప్రైస్ లిస్ట్తో ఎగ్జిక్యూటివ్ మీకు వివరిస్తారండి. ఎప్పుడు కాల్ చేయమంటారు?' (Hindi: 'Plot size aur location par price depend karta hai ji. Current price list ke saath executive aapko call karenge. Kis time call karein?')\n"
                "- Call me later: 'తప్పకుండా అండి. ఈరోజు సాయంత్రమా, లేక రేపు ఉదయమా? మీకు ఏ సమయం అనుకూలంగా ఉంటుంది?'\n"
                "- I didn't enquire: 'పర్లేదండి. బహుశా పొరపాటున కాల్ కనెక్ట్ అయి ఉండవచ్చు. మీకు ప్లాట్స్ వివరాలు తెలుసుకోవాలనే ఆసక్తి లేకపోతే ఇబ్బంది పెట్టము.' If they decline, invoke end_call with disposition='not_interested'.\n"
                "- Not interested: 'పర్లేదండి, మీ సమయానికి ధన్యవాదాలు. Have a nice day!' and invoke end_call with disposition='not_interested'."
            ),
            "is_active": True,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        },
        {
            "template_id": "urgency_price_revision",
            "name": "Urgency / Price Revision Update",
            "description": "Curiosity hook: 8-12s opening on imminent price revisions in Shadnagar/Bangalore Highway to secure callback",
            "target_disposition": "Price Revision Callback",
            "greeting_telugu": "నమస్తే అండి! నేను అనన్య, స్వర్గసీమ నుంచి మాట్లాడుతున్నానండి. షాద్నగర్, బెంగళూరు హైవే ప్లాట్స్ గురించి ఒక ముఖ్యమైన అప్డేట్ ఉందండి. త్వరలో ధరలు మారబోతున్నాయండి. ఇప్పుడు ఒక నిమిషం మాట్లాడవచ్చా అండి?",
            "greeting_hindi": "Namaste ji! Main Ananya, Swargaseema se baat kar rahi hoon. Shadnagar aur Bangalore Highway plots ko lekar ek important update tha ji. Hamare yahan jald hi prices revise hone wale hain. Kya abhi ek minute baat ho sakti hai?",
            "greeting_audio_path": "assets/greeting_price_revision_16k.pcm",
            "system_prompt": (
                "You are Ananya (అనన్య), an outbound telecalling AI assistant for Swargaseema.\n"
                "Goal: Create genuine urgency around the upcoming price revision for Shadnagar and Bangalore Highway open plots and secure a callback appointment before prices increase.\n\n"
                "### OPERATING RULES\n"
                "1. Natural, respectful tone. Strictly 1 single sentence per turn. Keep call under 45-60 seconds.\n"
                "2. Do not reveal everything at once. Keep opening to 8-12 seconds. Create curiosity, establish value, then secure callback.\n"
                "3. ZERO code/function leakage: never speak tool names or syntax aloud.\n\n"
                "### CONVERSATION FLOW\n"
                "1. Opening: You already delivered the opening greeting notifying them about the important price revision update for Shadnagar/Bangalore Highway plots, and asked for 1 minute.\n"
                "- If caller speaks Hindi, immediately switch 100% to Hindi for all subsequent turns.\n"
                "2. When caller agrees / says yes (e.g. 'Haan ji boliye', 'చెప్పండి'):\n"
                "- In Telugu: 'అవునండి, ప్రస్తుతం ఉన్న ధరలు త్వరలో మారబోతున్నాయి. అందుకే పాత ధరలు మరియు ప్రాజెక్ట్ వివరాలు మీకు ముందే తెలియజేయాలని కాల్ చేశాము. మీకు మా సీనియర్ ప్రాపర్టీ ఎగ్జిక్యూటివ్ ఈరోజు సాయంత్రం కాల్ చేయడం సౌకర్యంగా ఉంటుందా లేక రేపు ఉదయమా?'\n"
                "- In Hindi: 'Ji, abhi jo current pricing hai, usmein jald revision hone wala hai. Isliye hum chahte hain ki aapko existing prices aur project details pehle hi explain kar dein. Aapke liye hamare senior property executive ka call aaj shaam convenient rahega ya kal subah?'\n"
                "3. Secure the appointment:\n"
                "- Clarify preferred slot (today evening or tomorrow morning).\n"
                "- Ask Name: 'సరేనండి. మీ పేరు తెలుసుకోవచ్చా?' (Hindi: 'Zaroor ji. Aapka naam jaan sakti hoon?')\n"
                "- Confirm time and WhatsApp permission: 'ధన్యవాదాలు [Name] గారు. [Time]కి మా సీనియర్ ఎగ్జిక్యూటివ్ మీకు కాల్ చేస్తారు. మీకు వాట్సాప్ లో కూడా వివరాలు షేర్ చేయమంటారా?'\n"
                "- Say goodbye once and invoke end_call with disposition='interested', customer_name, callback_time.\n\n"
                "### OBJECTION HANDLING\n"
                "- Busy / Call later: 'పర్లేదండి, ధరలు పెరగకముందే వివరాలు చెప్పడానికి ఈరోజు సాయంత్రమా లేక రేపు ఉదయమా ఎప్పుడు కాల్ చేయమంటారు?'\n"
                "- What is the price/hike?: 'ప్లాట్ సైజు మరియు లొకేషన్ ను బట్టి కొత్త ధరలు ఉంటాయి. పాత ధరల లిస్ట్ తో మా ఎగ్జిక్యూటివ్ మీకు వివరిస్తారు. ఎప్పుడు కాల్ చేయమంటారు?'\n"
                "- Send on WhatsApp: 'తప్పకుండా అండి. రేట్ల వివరాలు వాట్సాప్ లో పంపిస్తాను. వాటిని వివరించడానికి ఎగ్జిక్యూటివ్ ఎప్పుడు కాల్ చేయమంటారు?'\n"
                "- Not interested: 'పర్లేదండి, మీ సమయానికి ధన్యవాదాలు. Have a nice day!' and invoke end_call with disposition='not_interested'."
            ),
            "is_active": True,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        },
    ]

    for tpl in default_templates:
        col.update_one({"template_id": tpl["template_id"]}, {"$setOnInsert": tpl}, upsert=True)

# Retrieve all campaign templates
def get_templates() -> List[Dict[str, Any]]:
    col = get_templates_collection()
    if col is None:
        return []
    try:
        init_default_templates()
        return list(col.find({}, {"_id": 0}).sort("created_at", ASCENDING))
    except Exception as exc:
        logger.error(f"Failed to fetch campaign templates: {exc}")
        return []

# Retrieve a single campaign template
def get_template(template_id: str) -> Optional[Dict[str, Any]]:
    col = get_templates_collection()
    if col is None:
        return None
    try:
        init_default_templates()
        return col.find_one({"template_id": template_id}, {"_id": 0})
    except Exception as exc:
        logger.error(f"Failed to fetch campaign template {template_id}: {exc}")
        return None

# Create or update a campaign template
def save_template(template_data: Dict[str, Any]) -> Dict[str, Any]:
    col = get_templates_collection()
    if col is None:
        return {"ok": False, "error": "Database unavailable"}
    try:
        tpl_id = template_data.get("template_id")
        if not tpl_id:
            return {"ok": False, "error": "Missing template_id"}
        template_data["updated_at"] = now_iso()
        if "created_at" not in template_data:
            template_data["created_at"] = now_iso()
        col.update_one({"template_id": tpl_id}, {"$set": template_data}, upsert=True)
        return {"ok": True, "template": get_template(tpl_id)}
    except Exception as exc:
        logger.error(f"Failed to save campaign template: {exc}")
        return {"ok": False, "error": str(exc)}

# Update an existing batch's template configuration in real-time
def update_batch_template(
    batch_id: str,
    template_id: str,
    template_name: str,
    greeting_text: str,
    system_prompt: str,
    greeting_audio_path: Optional[str] = None,
) -> bool:
    col = get_batches_collection()
    if col is not None:
        try:
            update_fields: Dict[str, Any] = {
                "template_id": template_id,
                "template_name": template_name,
                "greeting_text": greeting_text,
                "system_prompt": system_prompt,
                "updated_at": now_iso(),
            }
            if greeting_audio_path:
                update_fields["greeting_audio_path"] = greeting_audio_path
            col.update_one({"batch_id": batch_id}, {"$set": update_fields})
            return True
        except Exception as exc:
            logger.error(f"Failed to update batch template: {exc}")
    return False

# Delete a campaign template by template_id
def delete_template(template_id: str) -> bool:
    col = get_templates_collection()
    if col is not None:
        try:
            res = col.delete_one({"template_id": template_id})
            return res.deleted_count > 0
        except Exception as exc:
            logger.error(f"Failed to delete template {template_id}: {exc}")
    return False

# Retrieve raw batch document by batch_id
def get_batch(batch_id: str) -> Optional[Dict[str, Any]]:
    col = get_batches_collection()
    if col is not None:
        try:
            return col.find_one({"batch_id": batch_id}, {"_id": 0})
        except Exception as exc:
            logger.error(f"Failed to get batch {batch_id}: {exc}")
    return None

# Current UTC timestamp in ISO 8601 format
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")

# Days of week mapping for telephony schema
DAYS_MAP = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
IST_OFFSET = timedelta(hours=5, minutes=30)

# Helper to compute duration bucket matching telephony_calls
def get_duration_bucket(seconds: float) -> str:
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

# Create or upsert a call record
def record_call_start(
    call_uuid: str,
    phone_number: str = "",
    batch_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    col = get_collection()
    now_utc = datetime.now(timezone.utc)
    ist_dt = now_utc + IST_OFFSET
    meta = metadata or {}
    operator_name = meta.get("created_by") or meta.get("operator") or meta.get("initiated_by") or ""
    did_num = re.sub(r"\D", "", meta.get("From") or "918071583794")
    digits = re.sub(r"\D", "", str(phone_number))
    ten_digit = digits[-10:] if len(digits) >= 10 else digits
    raw_prefix = f"+91{ten_digit}" if len(ten_digit) == 10 else f"+{digits}"

    initial_doc = {
        "callId": call_uuid,
        "uuid": call_uuid,
        "call_uuid": call_uuid,
        "phone_number": phone_number,
        "customerNumber": ten_digit,
        "customerNumberRaw": raw_prefix,
        "customerName": "",
        "customerId": None,
        "direction": "outbound",
        "callStatus": "in_progress",
        "isProductive": False,
        "isFirstCall": True,
        "isManual": False,
        "isTransferred": False,
        "abandonedInQueue": False,
        "answeredWithinSla": True,
        "agentName": "Ananya",
        "agentExtension": did_num,
        "agentId": None,
        "teamLeaderName": "AI Operations",
        "teamLeaderId": None,
        "didNumber": did_num,
        "didNumberRaw": f"+{did_num}",
        "sourceName": "Vobiz AI - Ananya",
        "campaignName": "AI Outbound Campaign",
        "campaignId": batch_id or "BATCH-VOBIZ-AI",
        "batchId": batch_id,
        "batch_id": batch_id,
        "initiatedBy": operator_name,
        "createdBy": operator_name,
        "queueName": "",
        "queueWaitDuration": 0,
        "callDate": ist_dt.strftime("%Y-%m-%d"),
        "callHour": ist_dt.hour,
        "dayOfWeek": DAYS_MAP[ist_dt.weekday()],
        "callTimestamp": now_utc,
        "answeredAt": None,
        "endedAt": None,
        "ringDuration": 0,
        "talkDuration": 0,
        "totalDuration": 0,
        "durationBucket": "0s",
        "disposition": "Not Talking",
        "rawDisposition": "not_talking",
        "dispositionNotes": "",
        "dispositionSavedAt": None,
        "missedType": None,
        "hangupCause": "",
        "hungUpBy": "unknown",
        "carrier": "",
        "circle": "",
        "recordingName": "",
        "recordingUrl": "",
        "originalCollection": "vobiz_ai_calls",
        "callbackStatus": "not_applicable",
        "callbackAttempts": 0,
        "callbackCallId": None,
        "callbackTimestamp": None,
        "callFlow": [{"type": "init", "value": call_uuid, "time": time.time()}],
        "isAiCall": True,
        "callbackSchedule": None,
        "transcripts": [],
        "aiDiagnostic": None,
        "status": "in_progress",
        "created_at": now_iso(),
        "start_time": time.time(),
        "customer_name": None,
        "callback_time": None,
        "reason": None,
        "metadata": meta,
    }
    if col is not None:
        try:
            update_op: Dict[str, Any] = {"$setOnInsert": initial_doc}
            if batch_id:
                initial_doc["batch_id"] = batch_id
                initial_doc["batchId"] = batch_id
                initial_doc["campaignId"] = batch_id
            col.update_one({"call_uuid": call_uuid}, update_op, upsert=True)
        except Exception as exc:
            logger.error(f"Failed to record call start for {call_uuid}: {exc}")
    return initial_doc

# Update call record fields
def update_call(call_uuid: str, updates: Dict[str, Any]) -> None:
    col = get_collection()
    if col is not None:
        try:
            updates["updated_at"] = now_iso()
            col.update_one({"call_uuid": call_uuid}, {"$set": updates}, upsert=True)
        except Exception as exc:
            logger.error(f"Failed to update call {call_uuid}: {exc}")

# Append a spoken turn to the call transcript (no-op when transcripts are disabled)
def append_transcript(call_uuid: str, role: str, text: str) -> None:
    if not is_transcript_enabled():
        return
    col = get_collection()
    if not text or not text.strip():
        return
    turn = {
        "role": role,
        "text": text.strip(),
        "timestamp": now_iso(),
    }
    if col is not None:
        try:
            col.update_one({"call_uuid": call_uuid}, {"$push": {"transcripts": turn}, "$set": {"updated_at": now_iso()}})
        except Exception as exc:
            logger.error(f"Failed to append transcript for {call_uuid}: {exc}")

# Match a call document regardless of which identifier field was stored
def _call_uuid_filter(call_uuid: str) -> Dict[str, Any]:
    return {"$or": [{"call_uuid": call_uuid}, {"callId": call_uuid}, {"uuid": call_uuid}]}

# Fetch raw call document fields by any call identifier
def find_call_doc(call_uuid: str, projection: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    col = get_collection()
    if col is None:
        return None
    try:
        doc = col.find_one({"call_uuid": call_uuid}, projection)
        if doc is None:
            doc = col.find_one(_call_uuid_filter(call_uuid), projection)
        return doc
    except Exception as exc:
        logger.error(f"Failed to find call doc {call_uuid}: {exc}")
        return None

# Persist on-demand audio-to-transcript turns for a specific call
def save_manual_transcript(call_uuid: str, turns: List[Dict[str, Any]], language: str = "original", clear_english: bool = False) -> None:
    col = get_collection()
    if col is not None:
        try:
            existing = find_call_doc(call_uuid, {"_id": 1})
            match_query = {"_id": existing["_id"]} if existing and "_id" in existing else {"call_uuid": call_uuid}
            is_en = str(language).strip().lower() == "english"
            if is_en:
                set_fields: Dict[str, Any] = {
                    "manual_transcripts_en": turns,
                    "has_english_transcript": True,
                    "manual_transcribed_en_at": now_iso(),
                    "updated_at": now_iso(),
                }
                col.update_one(match_query, {"$set": set_fields}, upsert=True)
            else:
                set_fields = {
                    "manual_transcripts": turns,
                    "has_manual_transcript": True,
                    "manual_transcribed_at": now_iso(),
                    "updated_at": now_iso(),
                }
                update_op: Dict[str, Any] = {"$set": set_fields}
                if clear_english:
                    update_op["$unset"] = {"manual_transcripts_en": "", "has_english_transcript": ""}
                col.update_one(match_query, update_op, upsert=True)
        except Exception as exc:
            logger.error(f"Failed to save manual transcript for {call_uuid}: {exc}")

# Convert non-English callback terms or names to clean English
def sanitize_to_english_metadata(name: Optional[str], cb_time: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    out_name = name
    out_time = cb_time
    if out_time:
        t_replacements = [
            ("ఈరోజు", "Today"),
            ("ఈ రోజు", "Today"),
            ("రేపు", "Tomorrow"),
            ("సాయంత్రం", "Evening"),
            ("సాయంకాలం", "Evening"),
            ("ఉదయం", "Morning"),
            ("మధ్యాహ్నం", "Afternoon"),
            ("గంటలకు", "o'clock"),
            ("గంటలకి", "o'clock"),
            ("లోపు", "by"),
            ("కాల్ చేయండి", ""),
            ("చేయండి", ""),
            ("kal", "Tomorrow"),
            ("shaam", "Evening"),
            ("subah", "Morning"),
            ("dopahar", "Afternoon"),
            ("baje", "o'clock"),
        ]
        res_time = out_time
        for k, v in t_replacements:
            res_time = re.sub(re.escape(k), v, res_time, flags=re.IGNORECASE)
        out_time = re.sub(r"\s+", " ", res_time).strip()

    if out_name:
        n_replacements = {
            "శివ": "Shiva",
            "రమేష్": "Ramesh",
            "సురేష్": "Suresh",
            "వెంకట్": "Venkat",
            "శివా": "Shiva",
            "కుమార్": "Kumar",
            "రాజు": "Raju",
            "శివ గారు": "Shiva",
            "శివగారు": "Shiva",
        }
        stripped_n = out_name.strip()
        if stripped_n in n_replacements:
            out_name = n_replacements[stripped_n]
        else:
            out_name = re.sub(r"\s*(?:గారు|జీ|ji|garu)\b", "", out_name, flags=re.IGNORECASE).strip()

    return out_name, out_time

# Record final disposition and parameters from tool call or fallback
def record_disposition(
    call_uuid: str,
    disposition: str,
    customer_name: Optional[str] = None,
    callback_time: Optional[str] = None,
    reason: Optional[str] = None,
) -> None:
    safe_name, safe_time = sanitize_to_english_metadata(customer_name, callback_time)
    updates: Dict[str, Any] = {"disposition": disposition}
    if safe_name:
        updates["customer_name"] = safe_name
    if safe_time:
        updates["callback_time"] = safe_time
    if reason:
        updates["reason"] = reason
    update_call(call_uuid, updates)

import diagnostics

# Evaluate complete call evidence at call conclusion to determine final truthful disposition
def resolve_end_of_call_disposition(
    doc: Optional[Dict[str, Any]],
    tracer: Any,
    summary: Dict[str, Any],
    fallback_disposition: Optional[str] = None,
) -> Dict[str, Any]:
    audio_out = summary.get("diagnostic", {}).get("audio_metrics", {}).get("outbound_bytes", 0)
    audio_in = summary.get("diagnostic", {}).get("audio_metrics", {}).get("inbound_bytes", 0)
    hangup_cause = str(summary.get("diagnostic", {}).get("hangup", {}).get("cause") or "").upper()
    duration = doc.get("duration_seconds", 0) if doc else 0
    transcripts = doc.get("transcripts", []) if doc else []
    caller_turns = [t for t in transcripts if t.get("role") == "caller"]

    # 1. Unanswered, busy, or rejected calls
    if hangup_cause == "USER_BUSY":
        return {"disposition": "busy", "reason": "Customer line busy"}
    if hangup_cause in ("NO_ANSWER", "TIMEOUT", "CALL_REJECTED", "ORIGINATOR_CANCEL", "REJECTED") or (audio_out == 0 and audio_in == 0 and len(transcripts) == 0):
        return {"disposition": "no_answer", "reason": "Customer did not answer / carrier network issue"}

    name = tracer.customer_name or (doc.get("customer_name") if doc else None) or (doc.get("metadata", {}).get("customer_name") if doc else None)
    cb = tracer.callback_time or (doc.get("callback_time") if doc else None)

    # 2. No caller transcript turns (either silent caller, or transcript collection was disabled)
    if len(caller_turns) == 0:
        if tracer.disposition in ("interested", "not_interested", "wrong_number"):
            return {
                "disposition": tracer.disposition,
                "customer_name": name,
                "callback_time": cb,
                "reason": tracer.reason or f"Call concluded with disposition: {tracer.disposition}",
            }
        caller_spoke = bool(getattr(tracer, "caller_speech_detected", False) or getattr(tracer, "turns_count", 0) > 1)
        if not caller_spoke:
            if audio_out > 0 and (duration is None or duration < 35):
                return {"disposition": "dropped", "reason": "Connection dropped after greeting before customer could speak (retryable)"}
            return {"disposition": "not_talking", "reason": "Customer remained silent throughout call"}
        return {
            "disposition": tracer.disposition or fallback_disposition or "dropped",
            "customer_name": name,
            "callback_time": cb,
            "reason": tracer.reason or "Conversation disconnected before qualification outcome reached",
        }

    # 3. Caller spoke - evaluate conversational evidence
    full_caller = " ".join(t.get("text", "") for t in caller_turns).lower()
    agent_turns = [t for t in transcripts if t.get("role") == "agent"]
    full_agent = " ".join(t.get("text", "") for t in agent_turns).lower()

    wrong_num_patterns = [
        r"\bwrong\s*number\b", r"\bgalat\s*number\b", r"\btappu\s*number\b",
        r"गलत\s*नंबर", r"తప్పు\s*నంబర్"
    ]
    if tracer.disposition == "wrong_number" or any(re.search(p, full_caller) for p in wrong_num_patterns):
        return {"disposition": "wrong_number", "reason": tracer.reason or "Caller indicated wrong number"}

    # 4. Explicit Rejection by Caller (Word Boundary Checked)
    decline_regexes = [
        r"\bnot\s+interested\b",
        r"\bno\s+interest\b",
        r"\bdon'?t\s+want\b",
        r"\bnot\s+required\b",
        r"\bnahi\s+chahiye\b",
        r"\bnahi\s+lena\b",
        r"\bdetail\s+nahi\b",
        r"\bbaat\s+nahi\s+karni\b",
        r"\binterest\s+ledu\b",
        r"\bvaddu\b",
        r"\boddhu\b",
        r"వద్దు",
        r"ఇంట్రెస్ట్\s*లేదు",
        r"ఆసక్తి\s*లేదు",
        r"नहीं\s*चाहिए",
        r"रुचि\s*नहीं",
        r"इंटरेस्टेड\s*नहीं",
        r"बात\s*नहीं\s*करनी",
    ]
    is_explicit_decline = any(re.search(p, full_caller) for p in decline_regexes)

    if not is_explicit_decline:
        for t in caller_turns:
            txt = t.get("text", "").lower().strip()
            if re.fullmatch(r"(nahi|nahin|nahi ji|no|no thanks|vaddu|oddhu|వద్దు|नहीं|नहीं जी)[\.\?!]*", txt):
                is_explicit_decline = True
                break
            if re.match(r"^(nahi|nahin|nahi ji|no|vaddu|oddhu|వద్దు|नहीं)\b", txt) and not any(w in txt for w in ["kya", "batao", "free", "kyun", "details", "plot", "cheppandi", "hours", "call", "tarvata", "manchi", "poorti"]):
                is_explicit_decline = True
                break

    # 5. Confirmed Qualified Lead / Appointment Booking (Precedence #1)
    if (cb and tracer.disposition == "interested") or (tracer.disposition == "interested" and not is_explicit_decline) or (name and cb):
        return {
            "disposition": "interested",
            "customer_name": name,
            "callback_time": cb,
            "reason": tracer.reason or "Caller confirmed interest and callback details",
        }

    # 6. Caller or agent proposed callback slot (e.g. "evening 5:00", "5:00 pm", "సాయంత్రం 5", "kal subah")
    time_regex = (
        r"((?:evening|morning|afternoon|night|shaam|subah|dopahar|సాయంత్రం|ఉదయం|మధ్యాహ్నం)\s*(?:at\s*)?\d{1,2}(?::\d{2})?"
        r"|\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.|a\.m|p\.m|o'?clock)\b"
        r"|\b\d{1,2}\s*(?:baje|గంటలకు|గంటలకి|gantalu|gantalaku)\b"
        r"|\bkal(?:\s+subah|\s+shaam|\s+dopahar)?\b"
        r"|\brepu(?:\s+podunna|\s+sayantram)?\b"
        r"|\btomorrow(?:\s+morning|\s+evening|\s+afternoon)?\b)"
    )
    time_match = re.search(time_regex, full_caller)
    agent_time_match = re.search(r"(?:call\s*(?:you\s*)?back\s*(?:around|at)?\s*)(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))", full_agent)
    if (time_match or agent_time_match) and not is_explicit_decline:
        proposed_time = cb or (time_match.group(0).strip() if time_match else agent_time_match.group(1).strip())
        return {
            "disposition": "interested",
            "customer_name": name,
            "callback_time": proposed_time,
            "reason": tracer.reason if (tracer.disposition == "interested" and tracer.reason) else "Caller agreed on callback time before call ended",
        }

    if tracer.disposition == "not_interested" or is_explicit_decline:
        return {"disposition": "not_interested", "reason": tracer.reason or "Caller declined / not interested"}

    # Refusal and irritation check to avoid treating complaints as inquiries
    anger_refusal_patterns = [
        r"(?:\b|(?<=\s))(పెట్టేయ్|ఫోన్\s*పెట్టు|డిస్టర్బెన్స్|వద్దు|డిస్టర్బ్|రద్దు|ఫోన్\s*కట్\s*చేయ్|cut\s*the\s*call|don'?t\s*call|stop\s*calling)(?:\b|(?=\s)|$|[.,!?])"
    ]
    if any(re.search(p, full_caller) for p in anger_refusal_patterns):
        return {"disposition": "not_interested", "reason": tracer.reason or "Caller refused / demanded disconnect"}

    # 6. High-Intent Real Estate Inquiries (Location / Pricing / Venture inquiries)
    inquiry_patterns = [
        r"(?:\b|(?<=\s))ఎక్కడ(?:\s*ఉంది|\s*ఉన్నాయి|\s*అండి|\s*చెప్పండి)?(?:\b|(?=\s)|$|[.,!?])",
        r"ధర\s*ఎంత", r"(?:\b|(?<=\s))ధర(?:\b|(?=\s)|$)", r"(?:\b|(?<=\s))రేటు(?:\b|(?=\s)|$)",
        r"ఎన్ని\s*గజాలు", r"(?:\b|(?<=\s))ప్లాట్(?:\b|(?=\s)|$)", r"(?:\b|(?<=\s))లొకేషన్(?:\b|(?=\s)|$)",
        r"(?:\b|(?<=\s))ప్రాజెక్ట్(?:\b|(?=\s)|$)", r"(?:\b|(?<=\s))వెంచర్(?:\b|(?=\s)|$)",
        r"\bkahan\s+hai\b", r"\bkidhar\s+hai\b", r"\blocation\b", r"\brate\s+kya\b",
        r"\bprice\s+kya\b", r"\bkitne\s+ka\b", r"\bcost\b", r"\bwhere\s+is\b",
        r"\bplot\b", r"\bplots\b", r"\bsq\s*yards?\b", r"\bsquare\s*yards?\b",
    ]
    if any(re.search(p, full_caller) for p in inquiry_patterns):
        return {
            "disposition": "inquiry_drop",
            "customer_name": name,
            "callback_time": cb,
            "reason": "Caller inquired about location/project details before disconnect (high-priority sales callback)",
        }

    # 7. Partial Interest without confirmed booking
    interest_caller_keywords = [
        r"\binterested\b", r"\bhaan\b", r"\byes\b", r"\bha\b", r"\bcall\s*back\b",
        r"\bdetails\b", r"हाँ", r"हां", r"हाँजी", r"हांजी", r"ఇంట్రెస్ట్", r"అవును",
        r"ఉంది", r"ఉందమ్మా", r"\bundamma\b", r"\bundhi\b", r"\bundi\b",
    ]
    if any(re.search(p, full_caller) for p in interest_caller_keywords):
        return {
            "disposition": "dropped",
            "customer_name": name,
            "callback_time": cb,
            "reason": "Caller expressed interest but call dropped before collecting details (high-priority retry)",
        }

    if tracer.disposition and tracer.disposition != "not_talking":
        return {"disposition": tracer.disposition, "reason": tracer.reason}
    if fallback_disposition and fallback_disposition != "not_talking":
        return {"disposition": fallback_disposition, "reason": None}

    return {"disposition": "dropped", "reason": "Conversation disconnected before qualification outcome reached"}

# Sync AI call resolution back to missed records in telephony_calls
def sync_ai_resolution_to_telephony_calls(
    phone_number: str,
    ai_call_id: str,
    is_answered: bool,
    disposition: str,
) -> None:
    db_inst = get_db()
    if db_inst is None:
        return
    try:
        digits = re.sub(r"\D", "", str(phone_number))
        ten_digit = digits[-10:] if len(digits) >= 10 else digits
        if not ten_digit:
            return

        telephony_col = db_inst["telephony_calls"]
        now_utc = datetime.now(timezone.utc)
        status_val = "completed" if is_answered else "attempted"

        # Update matched pending missed call in telephony_calls
        telephony_col.update_many(
            {
                "customerNumber": ten_digit,
                "direction": "inbound",
                "missedType": {"$ne": None},
                "callbackStatus": {"$in": ["pending", None]},
            },
            {
                "$set": {
                    "callbackStatus": status_val,
                    "callbackCallId": ai_call_id,
                    "callbackTimestamp": now_utc,
                    "isAiResolved": True,
                    "callbackAgentName": "Ananya",
                    "aiDisposition": disposition,
                },
                "$inc": {"callbackAttempts": 1},
            },
        )
    except Exception as exc:
        logger.error(f"Failed to sync AI resolution to telephony_calls for {phone_number}: {exc}")

# Finalize call duration, disposition, and diagnostic health
def finalize_call(
    call_uuid: str,
    status: str = "completed",
    batch_id: Optional[str] = None,
    fallback_disposition: Optional[str] = None,
    disposition: Optional[str] = None,
    reason: Optional[str] = None,
    **kwargs: Any,
) -> None:
    col = get_collection()
    tracer = diagnostics.get_tracer(call_uuid)
    summary = tracer.finalize()
    b_id = batch_id or tracer.batch_id

    if col is not None:
        try:
            doc = col.find_one({"call_uuid": call_uuid})
            if not b_id and doc:
                b_id = doc.get("batch_id")

            duration = None
            if doc and doc.get("start_time"):
                duration = round(time.time() - doc["start_time"], 2)

            resolved = resolve_end_of_call_disposition(doc, tracer, summary, disposition or fallback_disposition)

            final_disp = disposition or resolved.get("disposition") or ("dropped" if (doc and doc.get("transcripts")) else "not_talking")
            raw_disp = final_disp.lower()
            title_disp = raw_disp.replace("_", " ").title()
            safe_name, safe_time = sanitize_to_english_metadata(resolved.get("customer_name"), resolved.get("callback_time"))
            final_reason = reason or resolved.get("reason") or ""

            dur_sec = float(duration) if duration is not None else 0.0
            is_ans = dur_sec > 0 or raw_disp in ("interested", "not_interested", "not_talking", "completed")
            call_st = "answered" if is_ans else ("busy" if raw_disp == "busy" else "missed")
            is_prod = raw_disp in ("interested", "not_interested")

            # Extract diagnostic & hangup attributes
            diag = summary.get("diagnostic", {})
            hangup_cause = "NORMAL_CLEARING"
            hung_up_by = "unknown"
            if isinstance(diag, dict) and "hangup" in diag:
                hangup_cause = diag["hangup"].get("cause") or hangup_cause
                hung_up_by = (diag["hangup"].get("source") or hung_up_by).lower()

            # Construct callFlow from events
            events = summary.get("events", [])
            call_flow = []
            if events:
                for ev in events:
                    call_flow.append({
                        "type": ev.get("event"),
                        "time": ev.get("time_epoch") or 0,
                        "details": ev.get("details"),
                    })
            elif doc and doc.get("callFlow"):
                call_flow = doc["callFlow"]

            now_utc = datetime.now(timezone.utc)
            update_fields: Dict[str, Any] = {
                "status": status,
                "callStatus": call_st,
                "isProductive": is_prod,
                "disposition": title_disp,
                "rawDisposition": raw_disp,
                "dispositionNotes": final_reason,
                "dispositionSavedAt": now_utc,
                "missedType": None if is_ans else "customer_missed",
                "hangupCause": hangup_cause,
                "hungUpBy": hung_up_by,
                "talkDuration": int(dur_sec),
                "totalDuration": int(dur_sec) + (3 if is_ans else 0),
                "durationBucket": get_duration_bucket(dur_sec),
                "endedAt": now_utc,
                "ended_at": now_iso(),
                "ended_at_epoch": time.time(),
                "duration_seconds": duration,
                "events": events,
                "callFlow": call_flow,
                "diagnostic": diag,
                "audio_metrics": diag.get("audio_metrics", {}),
                "aiDiagnostic": {
                    "classification": diag.get("classification"),
                    "rootCauseSummary": diag.get("root_cause_summary"),
                    "audioMetrics": diag.get("audio_metrics", {}),
                },
            }
            if is_ans:
                update_fields["answeredAt"] = now_utc - timedelta(seconds=dur_sec)
            if safe_name:
                update_fields["customerName"] = safe_name
                update_fields["customer_name"] = safe_name
            if safe_time:
                update_fields["callback_time"] = safe_time
            if safe_name or safe_time:
                update_fields["callbackSchedule"] = {
                    "preferredTime": safe_time or "",
                    "customerName": safe_name or "",
                }
            if final_reason:
                update_fields["reason"] = final_reason
            if b_id:
                update_fields["batch_id"] = b_id
                update_fields["batchId"] = b_id
                update_fields["campaignId"] = b_id

            col.update_one({"call_uuid": call_uuid}, {"$set": update_fields}, upsert=True)

            # Sync callback outcome to telephony_calls missed call record
            phone_val = (doc.get("phone_number") if doc else None) or (doc.get("customerNumber") if doc else None) or ""
            if phone_val:
                sync_ai_resolution_to_telephony_calls(
                    phone_number=phone_val,
                    ai_call_id=call_uuid,
                    is_answered=is_ans,
                    disposition=title_disp,
                )
        except Exception as exc:
            logger.error(f"Failed to finalize call {call_uuid}: {exc}")

# Retrieve a single call record by uuid
def get_call(call_uuid: str) -> Optional[Dict[str, Any]]:
    col = get_collection()
    if col is not None:
        try:
            doc = find_call_doc(call_uuid, {"_id": 0})
            if doc:
                manual_turns = doc.get("manual_transcripts") or []
                english_turns = doc.get("manual_transcripts_en") or []
                doc["has_manual_transcript"] = bool(manual_turns) or bool(doc.get("has_manual_transcript"))
                doc["has_english_transcript"] = bool(english_turns) or bool(doc.get("has_english_transcript"))
                if is_transcript_enabled():
                    doc["turns"] = doc.get("transcripts") or manual_turns
                    doc["english_turns"] = english_turns
                elif manual_turns or english_turns:
                    doc["turns"] = manual_turns
                    doc["english_turns"] = english_turns
                    doc["transcripts"] = []
                else:
                    doc["transcripts"] = []
                    doc["turns"] = []
                    doc["english_turns"] = []
                doc["duration"] = doc.get("duration_seconds", 0) or 0
                doc["started"] = doc.get("created_at", "")
                doc["ended"] = doc.get("ended_at", "")
                doc["diagnostic"] = doc.get("diagnostic") or {}
                doc["events"] = doc.get("events") or []
                doc["audio_metrics"] = doc.get("audio_metrics") or {}
                return doc
        except Exception as exc:
            logger.error(f"Failed to query call {call_uuid}: {exc}")
    return None

# Query collection-level disposition and overall summary counts
def get_call_stats(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    col = get_collection()
    if col is None:
        return {"total": 0, "dispositions": {}}

    match_filter: Dict[str, Any] = {}
    if start_date and end_date:
        match_filter["callDate"] = start_date if start_date == end_date else {"$gte": start_date, "$lte": end_date}
    elif start_date:
        match_filter["callDate"] = {"$gte": start_date}
    elif end_date:
        match_filter["callDate"] = {"$lte": end_date}

    pipeline = []
    if match_filter:
        pipeline.append({"$match": match_filter})
    pipeline.append({
        "$group": {
            "_id": {"$toLower": "$rawDisposition"},
            "count": {"$sum": 1},
        }
    })

    try:
        raw_counts = {str(d["_id"]): d["count"] for d in col.aggregate(pipeline)}
        total = col.count_documents(match_filter)
        return {
            "total": total,
            "dispositions": raw_counts,
        }
    except Exception as exc:
        logger.error(f"Failed to calculate call stats: {exc}")
        return {"total": 0, "dispositions": {}}

# Compatibility helper for dialer status payload
def get_recent_calls(limit: int = 1) -> List[Dict[str, Any]]:
    res = get_paginated_calls(page=1, limit=limit)
    return res.get("calls", [])

def get_paginated_calls(
    page: int = 1,
    limit: int = 50,
    search: Optional[str] = None,
    disposition: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    has_recording: Optional[bool] = None,
    has_callback: Optional[bool] = None,
) -> Dict[str, Any]:
    col = get_collection()
    if col is None:
        return {"calls": [], "total": 0, "page": page, "limit": limit, "pages": 0}

    query: Dict[str, Any] = {}

    # Date range
    if start_date and end_date:
        query["callDate"] = start_date if start_date == end_date else {"$gte": start_date, "$lte": end_date}
    elif start_date:
        query["callDate"] = {"$gte": start_date}
    elif end_date:
        query["callDate"] = {"$lte": end_date}

    # Disposition filter
    if disposition and disposition != "all":
        disp_clean = disposition.lower()
        if disp_clean == "not_answering_busy":
            query["rawDisposition"] = {"$in": ["no_answer", "busy", "not_talking", "dropped"]}
        elif disp_clean == "no_answer":
            query["rawDisposition"] = {"$in": ["no_answer", "busy"]}
        else:
            query["rawDisposition"] = disp_clean

    # Recording filter
    if has_recording:
        query["recordingUrl"] = {"$exists": True, "$ne": ""}

    # Callback filter
    if has_callback:
        query["$or"] = [
            {"callback_time": {"$exists": True, "$ne": "", "$ne": None}},
            {"callbackSchedule.preferredTime": {"$exists": True, "$ne": "", "$ne": None}},
        ]

    # Server-side text search across phone number, name, disposition notes
    if search and search.strip():
        q_str = search.strip()
        digits = re.sub(r"\D", "", q_str)
        or_clauses = [
            {"customerName": {"$regex": re.escape(q_str), "$options": "i"}},
            {"dispositionNotes": {"$regex": re.escape(q_str), "$options": "i"}},
            {"callId": {"$regex": re.escape(q_str), "$options": "i"}},
        ]
        if digits:
            or_clauses.append({"customerNumber": {"$regex": re.escape(digits)}})
            or_clauses.append({"phone_number": {"$regex": re.escape(digits)}})
        query["$or"] = or_clauses

    try:
        total = col.count_documents(query)
        skip = max(0, (page - 1) * limit)

        # Exclude massive nested payloads from list view
        projection = {
            "_id": 0,
            "transcripts": 0,
            "manual_transcripts": 0,
            "manual_transcripts_en": 0,
            "callFlow": 0,
            "events": 0,
            "metadata": 0,
        }

        cursor = col.find(query, projection).sort("callTimestamp", DESCENDING).skip(skip).limit(limit)
        calls = list(cursor)

        for c in calls:
            c["duration"] = c.get("duration_seconds", 0) or c.get("talkDuration", 0) or 0
            c["started"] = c.get("created_at", "")
            c["ended"] = c.get("ended_at", "")
            c["diagnostic"] = c.get("diagnostic") or {}
            c["audio_metrics"] = c.get("audio_metrics") or {}
            # Fallback customer name from customerName or callbackSchedule
            if not c.get("customer_name"):
                c["customer_name"] = c.get("customerName") or (c.get("callbackSchedule") or {}).get("customerName") or ""
            # Fallback callback time from callbackSchedule.preferredTime
            if not c.get("callback_time"):
                c["callback_time"] = (c.get("callbackSchedule") or {}).get("preferredTime") or ""
            # Sanitize any ObjectId or non-serializable fields
            for k, v in list(c.items()):
                if isinstance(v, ObjectId):
                    c[k] = str(v)

        pages = max(1, (total + limit - 1) // limit) if total > 0 else 1
        return {
            "calls": calls,
            "total": total,
            "page": page,
            "limit": limit,
            "pages": pages,
        }
    except Exception as exc:
        logger.error(f"Failed to query paginated calls: {exc}")
        return {"calls": [], "total": 0, "page": page, "limit": limit, "pages": 0}

# Save or update a campaign batch document
def save_batch(batch_doc: Dict[str, Any]) -> None:
    col = get_batches_collection()
    if col is not None:
        try:
            batch_doc["updated_at"] = now_iso()
            col.update_one({"batch_id": batch_doc["batch_id"]}, {"$set": batch_doc}, upsert=True)
        except Exception as exc:
            logger.error(f"Failed to save batch {batch_doc.get('batch_id')}: {exc}")

# Append additional leads to an existing active batch document
def append_leads_to_batch(batch_id: str, new_leads: List[Dict[str, Any]]) -> None:
    col = get_batches_collection()
    if col is not None:
        try:
            col.update_one(
                {"batch_id": batch_id},
                {
                    "$push": {"leads": {"$each": new_leads}},
                    "$inc": {"total_leads": len(new_leads)},
                    "$set": {"updated_at": now_iso()},
                },
            )
        except Exception as exc:
            logger.error(f"Failed to append leads to batch {batch_id}: {exc}")

# Finalize a campaign batch
def finalize_batch(batch_id: str, status: str = "completed") -> None:
    col = get_batches_collection()
    if col is not None:
        try:
            col.update_one(
                {"batch_id": batch_id},
                {"$set": {"status": status, "ended_at": now_iso(), "updated_at": now_iso()}},
            )
        except Exception as exc:
            logger.error(f"Failed to finalize batch {batch_id}: {exc}")

# Calculate batch-wise metrics for a given batch_id
def get_batch_metrics(batch_id: str) -> Dict[str, int]:
    col = get_collection()
    metrics = {
        "dialed": 0,
        "interested": 0,
        "not_interested": 0,
        "wrong_number": 0,
        "not_talking": 0,
        "no_answer": 0,
        "dropped": 0,
    }
    if col is not None and batch_id:
        try:
            calls = list(col.find({"$or": [{"batch_id": batch_id}, {"campaignId": batch_id}]}, {"disposition": 1, "rawDisposition": 1, "_id": 0}))
            metrics["dialed"] = len(calls)
            for c in calls:
                disp = str(c.get("rawDisposition") or c.get("disposition") or "").strip().lower().replace(" ", "_")
                if disp == "interested":
                    metrics["interested"] += 1
                elif disp in ("not_interested", "declined"):
                    metrics["not_interested"] += 1
                elif disp == "wrong_number":
                    metrics["wrong_number"] += 1
                elif disp in ("dropped", "system_error", "inquiry_drop"):
                    metrics["dropped"] += 1
                elif disp == "not_talking":
                    metrics["not_talking"] += 1
                elif disp in ("no_answer", "busy", "failed"):
                    metrics["no_answer"] += 1
        except Exception as exc:
            logger.error(f"Failed to calculate metrics for batch {batch_id}: {exc}")
    return metrics

# Retrieve all campaign batches with live metrics via single aggregation
def get_batches() -> List[Dict[str, Any]]:
    b_col = get_batches_collection()
    c_col = get_collection()
    batches: List[Dict[str, Any]] = []
    if b_col is None:
        return batches

    # Pre-aggregate all batch metrics from calls in a single pipeline
    metrics_map: Dict[str, Dict[str, int]] = {}
    if c_col is not None:
        try:
            pipeline = [
                {
                    "$project": {
                        "batch_id": 1,
                        "disp": {
                            "$toLower": {
                                "$ifNull": ["$rawDisposition", "$disposition"]
                            }
                        }
                    }
                },
                {
                    "$group": {
                        "_id": "$batch_id",
                        "dialed": {"$sum": 1},
                        "interested": {"$sum": {"$cond": [{"$in": ["$disp", ["interested"]]}, 1, 0]}},
                        "not_interested": {"$sum": {"$cond": [{"$in": ["$disp", ["not_interested", "not interested", "declined"]]}, 1, 0]}},
                        "wrong_number": {"$sum": {"$cond": [{"$in": ["$disp", ["wrong_number", "wrong number"]]}, 1, 0]}},
                        "not_talking": {"$sum": {"$cond": [{"$in": ["$disp", ["not_talking", "not talking"]]}, 1, 0]}},
                        "no_answer": {"$sum": {"$cond": [{"$in": ["$disp", ["no_answer", "no answer", "busy", "failed"]]}, 1, 0]}},
                        "dropped": {"$sum": {"$cond": [{"$in": ["$disp", ["dropped", "system_error", "inquiry_drop", "inquiry drop"]]}, 1, 0]}},
                    }
                }
            ]
            for row in c_col.aggregate(pipeline):
                bid = row.get("_id")
                if bid:
                    metrics_map[str(bid)] = {
                        "dialed": row.get("dialed", 0),
                        "interested": row.get("interested", 0),
                        "not_interested": row.get("not_interested", 0),
                        "wrong_number": row.get("wrong_number", 0),
                        "not_talking": row.get("not_talking", 0),
                        "no_answer": row.get("no_answer", 0),
                        "dropped": row.get("dropped", 0),
                    }
        except Exception as exc:
            logger.error(f"Failed to pre-aggregate batch metrics: {exc}")

    try:
        cursor = b_col.find({}, {"_id": 0}).sort("created_at", DESCENDING)
        for b in cursor:
            bid = str(b.get("batch_id") or "")
            m = metrics_map.get(bid, {
                "dialed": 0, "interested": 0, "not_interested": 0,
                "wrong_number": 0, "not_talking": 0, "no_answer": 0, "dropped": 0
            }).copy()
            total = b.get("total_leads", 0)
            m["pending"] = max(0, total - m["dialed"])
            b["metrics"] = m
            batches.append(b)
    except Exception as exc:
        logger.error(f"Failed to query batches: {exc}")
    return batches

# Retrieve a batch document and all its associated calls
def get_batch_detail(batch_id: str) -> Dict[str, Any]:
    b_col = get_batches_collection()
    c_col = get_collection()
    batch_doc = None
    if b_col is not None:
        batch_doc = b_col.find_one({"batch_id": batch_id}, {"_id": 0})
    if batch_doc:
        m = get_batch_metrics(batch_id)
        m["pending"] = max(0, batch_doc.get("total_leads", 0) - m["dialed"])
        batch_doc["metrics"] = m

    calls: List[Dict[str, Any]] = []
    dialed_numbers = set()
    if c_col is not None:
        try:
            projection = {
                "_id": 0,
                "transcripts": 0,
                "manual_transcripts": 0,
                "manual_transcripts_en": 0,
                "callFlow": 0,
                "events": 0,
                "metadata": 0,
            }
            cursor = c_col.find({"$or": [{"batch_id": batch_id}, {"campaignId": batch_id}]}, projection).sort("callTimestamp", DESCENDING)
            for c in cursor:
                c["duration"] = c.get("duration_seconds", 0) or c.get("talkDuration", 0) or 0
                c["started"] = c.get("created_at", "")
                c["ended"] = c.get("ended_at", "")
                c["diagnostic"] = c.get("diagnostic") or {}
                c["audio_metrics"] = c.get("audio_metrics") or {}
                if not c.get("recording_url") and c.get("recordingUrl"):
                    c["recording_url"] = c["recordingUrl"]
                if not c.get("customer_name"):
                    c["customer_name"] = c.get("customerName") or (c.get("callbackSchedule") or {}).get("customerName") or ""
                if not c.get("callback_time"):
                    c["callback_time"] = (c.get("callbackSchedule") or {}).get("preferredTime") or ""
                
                num = c.get("customerNumber") or c.get("phone_number") or ""
                digits = re.sub(r"\D", "", str(num))[-10:]
                if digits:
                    dialed_numbers.add(digits)
                calls.append(c)
        except Exception as exc:
            logger.error(f"Failed to query calls for batch {batch_id}: {exc}")

    # Include undialed leads from batch_doc so Total reflects all imported batch records
    if batch_doc and "leads" in batch_doc and isinstance(batch_doc["leads"], list):
        for lead in batch_doc["leads"]:
            raw_phone = str(lead.get("phone_number") or "")
            digits = re.sub(r"\D", "", raw_phone)[-10:]
            if digits and digits not in dialed_numbers:
                calls.append({
                    "call_uuid": lead.get("id") or f"pending-{digits}",
                    "callId": lead.get("id") or f"pending-{digits}",
                    "customerNumber": digits,
                    "customerNumberRaw": raw_phone if raw_phone.startswith("+") else f"+91{digits}",
                    "phone_number": raw_phone,
                    "customer_name": lead.get("customer_name") or "",
                    "customerName": lead.get("customer_name") or "",
                    "disposition": "Pending",
                    "rawDisposition": "pending",
                    "callStatus": "pending",
                    "duration": 0,
                    "duration_seconds": 0,
                    "talkDuration": 0,
                    "started": batch_doc.get("created_at", ""),
                    "created_at": batch_doc.get("created_at", ""),
                    "status": "pending",
                })
                dialed_numbers.add(digits)

    return {"batch": batch_doc or {"batch_id": batch_id, "status": "unknown"}, "calls": calls}

# Delete a batch record
def delete_batch(batch_id: str) -> bool:
    col = get_batches_collection()
    if col is not None:
        try:
            col.delete_one({"batch_id": batch_id})
            return True
        except Exception as exc:
            logger.error(f"Failed to delete batch {batch_id}: {exc}")
    return False

# Map normalized 10-digit phone to latest AI voice agent call
def get_latest_ai_call_by_phone() -> Dict[str, Dict[str, Any]]:
    col = get_collection()
    if col is None:
        return {}
    try:
        import re
        cursor = col.find(
            {},
            {
                "_id": 0,
                "phone_number": 1,
                "disposition": 1,
                "call_uuid": 1,
                "created_at": 1,
                "duration_seconds": 1,
                "status": 1,
            }
        ).sort("created_at", DESCENDING)

        dispo_map: Dict[str, Dict[str, Any]] = {}
        for doc in cursor:
            raw = doc.get("phone_number")
            if not raw:
                continue
            digits = re.sub(r"\D", "", str(raw))[-10:]
            if digits and digits not in dispo_map:
                dispo_map[digits] = {
                    "disposition": doc.get("disposition") or "completed",
                    "call_uuid": doc.get("call_uuid"),
                    "created_at": doc.get("created_at"),
                    "duration": doc.get("duration_seconds", 0) or 0,
                    "status": doc.get("status"),
                }
        return dispo_map
    except Exception as exc:
        logger.error(f"Failed to query latest AI calls: {exc}")
        return {}

# Retrieve MongoDB database instance (Single Source of Truth)
def get_crm_db() -> Optional[Database]:
    return get_db()


# Query clean, unique pending missed calls from telephony_calls SSOT
def fetch_crm_from_telephony_calls(
    db_inst: Database,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status_filter: Optional[str] = "pending",
) -> List[Dict[str, Any]]:
    tel_col = db_inst["telephony_calls"]
    ist_offset = timedelta(hours=5, minutes=30)
    now_ist = datetime.now(timezone.utc) + ist_offset

    if not start_date:
        start_date = now_ist.strftime("%Y-%m-%d")
        end_date = start_date
    elif not end_date:
        end_date = start_date

    match_query: Dict[str, Any] = {
        "direction": "inbound",
        "callStatus": "missed",
    }
    if start_date == end_date:
        match_query["callDate"] = start_date
    else:
        match_query["callDate"] = {"$gte": start_date, "$lte": end_date}

    if status_filter != "all_records":
        match_query["callbackStatus"] = "pending"

    # Only project minimal fields needed
    projection = {
        "customerNumber": 1,
        "customerNumberRaw": 1,
        "customerName": 1,
        "callTimestamp": 1,
        "callDate": 1,
    }

    cursor = tel_col.find(match_query, projection).sort("callTimestamp", -1)

    seen_phones = set()
    results = []

    for m in cursor:
        raw_num = m.get("customerNumberRaw") or m.get("customerNumber") or ""
        digits = re.sub(r"\D", "", str(raw_num))
        ten_digit = digits[-10:] if len(digits) >= 10 else digits
        if not ten_digit:
            continue

        # Keep strictly unique by phone number (most recent call)
        if ten_digit in seen_phones:
            continue
        seen_phones.add(ten_digit)

        formatted_phone = f"+91{ten_digit}" if len(ten_digit) == 10 else f"+{digits}"
        cust_name = (m.get("customerName") or "").strip()
        ts = m.get("callTimestamp")
        date_str = ts.strftime("%Y-%m-%d %I:%M %p") if isinstance(ts, datetime) else str(m.get("callDate") or "")

        results.append({
            "id": str(m.get("_id", "")),
            "phone_number": formatted_phone,
            "customer_name": cust_name or "--",
            "date": date_str,
            "createdAt": ts.isoformat() if isinstance(ts, datetime) else date_str,
            "status": "pending",
        })

    return results

# Retrieve all unique 10-digit phone numbers already called or present in batches
def get_existing_called_numbers() -> Dict[str, Any]:
    called_numbers = set()
    col = get_collection()
    if col is not None:
        try:
            for p in col.distinct("customerNumber"):
                d = "".join(c for c in str(p or "") if c.isdigit())[-10:]
                if len(d) == 10:
                    called_numbers.add(d)
            for p in col.distinct("phone_number"):
                d = "".join(c for c in str(p or "") if c.isdigit())[-10:]
                if len(d) == 10:
                    called_numbers.add(d)
        except Exception as exc:
            logger.error(f"Failed to fetch called numbers from vobiz_ai_calls: {exc}")

    b_col = get_batches_collection()
    if b_col is not None:
        try:
            for b in b_col.find({}, {"leads.phone_number": 1, "leads.customerNumber": 1}):
                for lead in b.get("leads", []):
                    num = lead.get("phone_number") or lead.get("customerNumber")
                    d = "".join(c for c in str(num or "") if c.isdigit())[-10:]
                    if len(d) == 10:
                        called_numbers.add(d)
        except Exception as exc:
            logger.error(f"Failed to fetch batch leads for exclusion: {exc}")

    return {"numbers": list(called_numbers), "total": len(called_numbers)}

# Query inbound missed calls from telephony_calls SSOT
def fetch_crm_missed_calls(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status_filter: Optional[str] = "all",
) -> List[Dict[str, Any]]:
    db_inst = get_crm_db()
    if db_inst is None:
        return []
    try:
        return fetch_crm_from_telephony_calls(db_inst, start_date, end_date, status_filter)
    except Exception as exc:
        logger.error(f"Failed to fetch CRM missed calls from telephony_calls: {exc}")
        return []
