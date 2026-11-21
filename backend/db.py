import os
import re
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from dotenv import load_dotenv
from loguru import logger
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
REAL_MONGO_URI = os.getenv("REAL_MONGO_URI", "")
REAL_MONGO_DB_NAME = os.getenv("REAL_MONGO_DB_NAME", "")

_client: Optional[MongoClient] = None
_db: Optional[Database] = None
_collection: Optional[Collection] = None
_batches_col: Optional[Collection] = None
_templates_col: Optional[Collection] = None
_crm_client: Optional[MongoClient] = None
_crm_db: Optional[Database] = None

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

# Create or upsert a call record
def record_call_start(
    call_uuid: str,
    phone_number: str = "",
    batch_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    col = get_collection()
    initial_doc = {
        "call_uuid": call_uuid,
        "phone_number": phone_number,
        "status": "in_progress",
        "created_at": now_iso(),
        "start_time": time.time(),
        "disposition": "not_talking",
        "customer_name": None,
        "callback_time": None,
        "reason": None,
        "transcripts": [],
        "metadata": metadata or {},
    }
    if col is not None:
        try:
            update_op: Dict[str, Any] = {"$setOnInsert": initial_doc}
            if batch_id:
                update_op["$set"] = {"batch_id": batch_id}
            else:
                initial_doc["batch_id"] = None
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

# Append a spoken turn to the call transcript
def append_transcript(call_uuid: str, role: str, text: str) -> None:
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

    # 2. No caller audio received (agent spoke greeting, then line dropped or remained completely silent)
    if len(caller_turns) == 0:
        if audio_out > 0 and (duration is None or duration < 35):
            return {"disposition": "dropped", "reason": "Connection dropped after greeting before customer could speak (retryable)"}
        return {"disposition": "not_talking", "reason": "Customer remained silent throughout call"}

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

    name = tracer.customer_name or (doc.get("customer_name") if doc else None) or (doc.get("metadata", {}).get("customer_name") if doc else None)
    cb = tracer.callback_time or (doc.get("callback_time") if doc else None)

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
            update_fields: Dict[str, Any] = {
                "status": status,
                "disposition": final_disp,
                "ended_at": now_iso(),
                "ended_at_epoch": time.time(),
                "duration_seconds": duration,
                "events": summary.get("events", []),
                "diagnostic": summary.get("diagnostic", {}),
                "audio_metrics": summary.get("diagnostic", {}).get("audio_metrics", {}),
            }
            safe_name, safe_time = sanitize_to_english_metadata(resolved.get("customer_name"), resolved.get("callback_time"))
            if safe_name:
                update_fields["customer_name"] = safe_name
            if safe_time:
                update_fields["callback_time"] = safe_time
            final_reason = reason or resolved.get("reason")
            if final_reason:
                update_fields["reason"] = final_reason
            if b_id:
                update_fields["batch_id"] = b_id

            col.update_one({"call_uuid": call_uuid}, {"$set": update_fields}, upsert=True)
        except Exception as exc:
            logger.error(f"Failed to finalize call {call_uuid}: {exc}")

# Retrieve a single call record by uuid
def get_call(call_uuid: str) -> Optional[Dict[str, Any]]:
    col = get_collection()
    if col is not None:
        try:
            doc = col.find_one({"call_uuid": call_uuid}, {"_id": 0})
            if doc:
                doc["turns"] = doc.get("transcripts", [])
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

# Retrieve recent call records with optional date range
def get_recent_calls(
    limit: int = 500,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> List[Dict[str, Any]]:
    col = get_collection()
    if col is not None:
        try:
            query: Dict[str, Any] = {}
            if start_date and end_date:
                query["created_at"] = {
                    "$gte": f"{start_date}T00:00:00",
                    "$lte": f"{end_date}T23:59:59.999999",
                }
            elif start_date:
                query["created_at"] = {"$gte": f"{start_date}T00:00:00"}
            elif end_date:
                query["created_at"] = {"$lte": f"{end_date}T23:59:59.999999"}

            cursor = col.find(query, {"_id": 0}).sort("created_at", DESCENDING).limit(limit)
            calls = list(cursor)
            for c in calls:
                c["turns"] = c.get("transcripts", [])
                c["duration"] = c.get("duration_seconds", 0) or 0
                c["started"] = c.get("created_at", "")
                c["ended"] = c.get("ended_at", "")
                c["diagnostic"] = c.get("diagnostic") or {}
                c["events"] = c.get("events") or []
                c["audio_metrics"] = c.get("audio_metrics") or {}
            return calls
        except Exception as exc:
            logger.error(f"Failed to query recent calls: {exc}")
    return []

# Save or update a campaign batch document
def save_batch(batch_doc: Dict[str, Any]) -> None:
    col = get_batches_collection()
    if col is not None:
        try:
            batch_doc["updated_at"] = now_iso()
            col.update_one({"batch_id": batch_doc["batch_id"]}, {"$set": batch_doc}, upsert=True)
        except Exception as exc:
            logger.error(f"Failed to save batch {batch_doc.get('batch_id')}: {exc}")

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
        "whatsup": 0,
        "jad": 0,
    }
    if col is not None and batch_id:
        try:
            calls = list(col.find({"batch_id": batch_id}, {"disposition": 1, "_id": 0}))
            metrics["dialed"] = len(calls)
            for c in calls:
                disp = str(c.get("disposition") or "").lower()
                if disp == "interested":
                    metrics["interested"] += 1
                elif disp in ("not_interested", "declined", "ni"):
                    metrics["not_interested"] += 1
                elif disp in ("whatsup", "whatsapp"):
                    metrics["whatsup"] += 1
                elif disp in ("jad",):
                    metrics["jad"] += 1
                elif disp == "wrong_number":
                    metrics["wrong_number"] += 1
                elif disp in ("dropped", "system_error", "inquiry_drop"):
                    metrics["dropped"] += 1
                elif disp == "not_talking":
                    metrics["not_talking"] += 1
                elif disp in ("no_answer", "busy", "failed", "na"):
                    metrics["no_answer"] += 1
        except Exception as exc:
            logger.error(f"Failed to calculate metrics for batch {batch_id}: {exc}")
    return metrics

# Retrieve all campaign batches with live metrics
def get_batches() -> List[Dict[str, Any]]:
    col = get_batches_collection()
    batches: List[Dict[str, Any]] = []
    if col is not None:
        try:
            cursor = col.find({}, {"_id": 0}).sort("created_at", DESCENDING)
            for b in cursor:
                bid = b.get("batch_id", "")
                m = get_batch_metrics(bid)
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
    if c_col is not None:
        try:
            cursor = c_col.find({"batch_id": batch_id}, {"_id": 0}).sort("created_at", DESCENDING)
            for c in cursor:
                c["turns"] = c.get("transcripts", [])
                c["duration"] = c.get("duration_seconds", 0) or 0
                c["started"] = c.get("created_at", "")
                c["ended"] = c.get("ended_at", "")
                calls.append(c)
        except Exception as exc:
            logger.error(f"Failed to query calls for batch {batch_id}: {exc}")

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

# Initialize CRM database connection for live missed calls
def get_crm_db() -> Optional[Database]:
    global _crm_client, _crm_db
    if _crm_db is not None:
        return _crm_db
    uri = REAL_MONGO_URI or MONGO_URI
    db_name = REAL_MONGO_DB_NAME or MONGO_DB_NAME or _extract_db_name(uri)
    if not uri or not db_name:
        return get_db()

    # If CRM DB matches the primary DB, reuse existing connection
    main_db = get_db()
    if main_db is not None and main_db.name == db_name:
        _crm_db = main_db
        return _crm_db

    try:
        _crm_client = MongoClient(uri, serverSelectionTimeoutMS=8000)
        _crm_db = _crm_client[db_name]
        logger.info(f"Connected to CRM database: {db_name}")
        return _crm_db
    except Exception as exc:
        logger.error(f"CRM DB connection failed: {exc}")
        return get_db()


# Query CRM calls from unified telephony_calls collection
def fetch_crm_from_telephony_calls(
    db_inst: Database,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status_filter: Optional[str] = "all",
) -> List[Dict[str, Any]]:
    tel_col = db_inst["telephony_calls"]
    ist_offset = timedelta(hours=5, minutes=30)
    now_ist = datetime.now(timezone.utc) + ist_offset

    if not start_date:
        start_date = now_ist.strftime("%Y-%m-%d")
        end_date = start_date
    elif not end_date:
        end_date = start_date

    match_query: Dict[str, Any] = {}
    if start_date == end_date:
        match_query["callDate"] = start_date
    else:
        match_query["callDate"] = {"$gte": start_date, "$lte": end_date}

    if status_filter == "all_records":
        pass
    else:
        match_query["direction"] = "inbound"
        match_query["callStatus"] = "missed"
        if status_filter == "pending":
            match_query["callbackStatus"] = "pending"
        elif status_filter in ("resolved", "completed", "called"):
            match_query["callbackStatus"] = "completed"
        elif status_filter == "attempted":
            match_query["callbackStatus"] = "attempted"

    cursor = tel_col.find(match_query).sort("callTimestamp", -1)
    calls = list(cursor)

    cb_ids = [m.get("callbackCallId") for m in calls if m.get("callbackCallId")]
    cb_map: Dict[str, Dict[str, Any]] = {}
    if cb_ids:
        projection = {
            "callId": 1,
            "disposition": 1,
            "rawDisposition": 1,
            "dispositionNotes": 1,
            "agentName": 1,
            "callTimestamp": 1,
        }
        for c in tel_col.find({"callId": {"$in": cb_ids}}, projection):
            cb_map[c["callId"]] = c

    unresolved_nums = [
        m.get("customerNumber")
        for m in calls
        if m.get("customerNumber") and (not m.get("callbackCallId") or m.get("callbackCallId") not in cb_map)
    ]
    outbound_by_num: Dict[str, Dict[str, Any]] = {}
    if unresolved_nums:
        ob_projection = {
            "customerNumber": 1,
            "disposition": 1,
            "rawDisposition": 1,
            "dispositionNotes": 1,
            "agentName": 1,
            "callTimestamp": 1,
        }
        ob_query: Dict[str, Any] = {
            "direction": "outbound",
            "customerNumber": {"$in": unresolved_nums},
        }
        if start_date == end_date:
            ob_query["callDate"] = start_date
        else:
            ob_query["callDate"] = {"$gte": start_date, "$lte": end_date}

        for ob in tel_col.find(ob_query, ob_projection).sort("callTimestamp", -1):
            if ob["customerNumber"] not in outbound_by_num:
                outbound_by_num[ob["customerNumber"]] = ob

    results = []
    for m in calls:
        cb = cb_map.get(m.get("callbackCallId")) or outbound_by_num.get(m.get("customerNumber"))
        cb_status = m.get("callbackStatus")
        if cb_status in ("completed", "resolved"):
            st = "resolved"
        elif cb_status == "attempted":
            st = "attempted"
        elif cb_status == "pending":
            st = "pending"
        else:
            st = m.get("callStatus") or "pending"

        num = m.get("customerNumberRaw") or m.get("customerNumber") or ""
        if len(str(num)) == 10 and not str(num).startswith("+"):
            num = f"+91{num}"

        crm_disp = (cb.get("disposition") if cb else None) or m.get("disposition") or ""
        crm_raw_disp = (cb.get("rawDisposition") if cb else None) or m.get("rawDisposition") or ""
        crm_notes = (cb.get("dispositionNotes") if cb else None) or m.get("dispositionNotes") or ""
        crm_agent = (cb.get("agentName") if cb else None) or m.get("agentName") or ""

        results.append({
            "id": str(m.get("_id", "")),
            "callId": m.get("callId", ""),
            "phone_number": str(num),
            "customer_name": m.get("customerName") or "",
            "source": m.get("sourceName") or "",
            "dialedDid": m.get("didNumberRaw") or m.get("didNumber") or "",
            "campaign": m.get("campaignName") or "",
            "missedAgents": [m.get("agentName")] if m.get("agentName") else ["Queue"],
            "duration": m.get("ringDuration") or m.get("totalDuration") or 0,
            "circle": m.get("circle") or "",
            "operator": m.get("carrier") or "",
            "createdAt": m.get("callTimestamp").isoformat() if hasattr(m.get("callTimestamp"), "isoformat") else str(m.get("callTimestamp") or ""),
            "startStamp": str(m.get("callTimestamp") or ""),
            "status": st,
            "direction": m.get("direction", "inbound"),
            "call_status": m.get("callStatus", "missed"),
            "crm_disposition": crm_disp,
            "crm_raw_disposition": crm_raw_disp,
            "crm_disposition_notes": crm_notes,
            "crm_callback_agent": crm_agent,
        })

    return results

# Query inbound missed calls from telephony_calls with legacy webhook fallback
def fetch_crm_missed_calls(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status_filter: Optional[str] = "all",
) -> List[Dict[str, Any]]:
    db_inst = get_crm_db()
    if db_inst is None:
        return []
    try:
        col_names = db_inst.list_collection_names()
        if "telephony_calls" in col_names:
            return fetch_crm_from_telephony_calls(db_inst, start_date, end_date, status_filter)

        if "hook_v2_inbound_hangup_missed" not in col_names:
            logger.info(f"Neither telephony_calls nor hook_v2_inbound_hangup_missed found in database '{db_inst.name}'. Returning empty list.")
            return []

        ist_offset = timedelta(hours=5, minutes=30)
        now_utc = datetime.now(timezone.utc)
        now_ist = now_utc + ist_offset

        if not start_date:
            start_utc = now_ist.replace(hour=0, minute=0, second=0, microsecond=0) - ist_offset
            end_utc = now_ist.replace(hour=23, minute=59, second=59, microsecond=999999) - ist_offset
        else:
            sp = [int(p) for p in start_date.split("-")]
            start_utc = datetime(sp[0], sp[1], sp[2], 0, 0, 0) - ist_offset
            if end_date:
                ep = [int(p) for p in end_date.split("-")]
                end_utc = datetime(ep[0], ep[1], ep[2], 23, 59, 59, 999999) - ist_offset
            else:
                end_utc = datetime(sp[0], sp[1], sp[2], 23, 59, 59, 999999) - ist_offset

        match_stage = {"createdAt": {"$gte": start_utc, "$lte": end_utc}}

        pipeline = [
            {"$match": match_stage},
            {"$sort": {"createdAt": -1}},
            {
                "$group": {
                    "_id": "$call_id",
                    "doc": {"$first": "$$ROOT"}
                }
            },
            {"$replaceRoot": {"newRoot": "$doc"}},
            {"$sort": {"createdAt": -1}}
        ]

        missed_col = db_inst["hook_v2_inbound_hangup_missed"]
        missed_calls = list(missed_col.aggregate(pipeline))

        # Collect 10-digit customer phone numbers
        all_numbers_10 = set()
        for c in missed_calls:
            num = c.get("caller_id_number") or ""
            digits = re.sub(r"\D", "", str(num))[-10:]
            if len(digits) == 10:
                all_numbers_10.add(digits)

        number_variants = list(all_numbers_10)
        for n in list(all_numbers_10):
            number_variants.extend([f"+91{n}", f"91{n}", f"0{n}"])

        outbound_map: Dict[str, List[Dict[str, Any]]] = {}

        if number_variants:
            outbound_filter = {
                "createdAt": {"$gte": start_utc},
                "$or": [
                    {"call_to_number": {"$in": number_variants}},
                    {"broadcast_lead_fields.Phone_Number": {"$in": number_variants}},
                    {"customer_no_with_prefix": {"$in": number_variants}},
                    {"customer_no_with_prefix ": {"$in": number_variants}},
                ]
            }

            inbound_filter = {
                "createdAt": {"$gte": start_utc},
                "$or": [
                    {"caller_id_number": {"$in": number_variants}},
                    {"call_from_number": {"$in": number_variants}},
                    {"broadcast_lead_fields.Phone_Number": {"$in": number_variants}},
                    {"customer_no_with_prefix": {"$in": number_variants}},
                ]
            }

            fields = {
                "call_to_number": 1,
                "caller_id_number": 1,
                "call_from_number": 1,
                "broadcast_lead_fields.Phone_Number": 1,
                "customer_no_with_prefix": 1,
                "customer_no_with_prefix ": 1,
                "isAnswered": 1,
                "call_status": 1,
                "call_connected": 1,
                "createdAt": 1,
                "start_stamp": 1,
            }

            answered_docs = list(db_inst["hook_v2_outbound_hangup_answered"].find(outbound_filter, fields))
            missed_docs = list(db_inst["hook_v2_outbound_hangup_missed"].find(outbound_filter, fields))
            in_answered_docs = list(db_inst["hook_v2_inbound_hangup_answered"].find(inbound_filter, fields))

            all_outbounds = []
            for d in answered_docs:
                ext = d.get("call_to_number") or (d.get("broadcast_lead_fields") or {}).get("Phone_Number") or d.get("customer_no_with_prefix") or d.get("customer_no_with_prefix ")
                all_outbounds.append({"ext": ext, "is_ans": True, "doc": d})
            for d in missed_docs:
                ext = d.get("call_to_number") or (d.get("broadcast_lead_fields") or {}).get("Phone_Number") or d.get("customer_no_with_prefix") or d.get("customer_no_with_prefix ")
                all_outbounds.append({"ext": ext, "is_ans": False, "doc": d})
            for d in in_answered_docs:
                ext = d.get("caller_id_number") or d.get("call_from_number") or d.get("customer_no_with_prefix")
                all_outbounds.append({"ext": ext, "is_ans": True, "doc": d})

            for item in all_outbounds:
                raw = item["ext"] or ""
                clean_num = re.sub(r"\D", "", str(raw))[-10:]
                if clean_num:
                    outbound_map.setdefault(clean_num, []).append(item)

        results = []
        for c in missed_calls:
            num = c.get("caller_id_number") or ""
            d10 = re.sub(r"\D", "", str(num))[-10:]
            cust_outbounds = outbound_map.get(d10, [])
            missed_time = c.get("createdAt")

            # Match callbacks made on or after the missed call (-5s tolerance) exactly like Corely CRM
            post_callbacks = []
            if missed_time:
                for o in cust_outbounds:
                    o_time = o["doc"].get("createdAt")
                    if o_time and o_time >= (missed_time - timedelta(seconds=5)):
                        post_callbacks.append(o)
            else:
                post_callbacks = cust_outbounds

            ans_cb = next(
                (o for o in post_callbacks if o["is_ans"] or o["doc"].get("call_status") == "answered" or str(o["doc"].get("call_connected")) == "1"),
                None
            )
            cb_doc = ans_cb or (post_callbacks[-1] if post_callbacks else None)

            status = "pending"
            if cb_doc:
                is_conn = cb_doc["is_ans"] or cb_doc["doc"].get("call_status") == "answered" or str(cb_doc["doc"].get("call_connected")) == "1"
                status = "called" if is_conn else "attempted"

            if status_filter == "pending" and status != "pending":
                continue
            if status_filter == "called" and status != "called":
                continue
            if status_filter == "attempted" and status != "attempted":
                continue

            # Resolve agents
            agents = []
            ma = c.get("missed_agent")
            if isinstance(ma, list):
                for a in ma:
                    if isinstance(a, dict) and a.get("name"):
                        agents.append(a["name"])
            elif isinstance(ma, str) and ma:
                agents.append(ma)
            if not agents and c.get("answered_agent_name"):
                agents.append(c["answered_agent_name"])

            # Resolve customer name and source
            bfields = c.get("broadcast_lead_fields") or {}
            cust_name = bfields.get("Full_Name") or bfields.get("Customer_Name") or ""
            if cust_name in ("nt", "Unknown"):
                cust_name = ""

            source = c.get("source_name") or bfields.get("Source") or ""
            circle_info = c.get("billing_circle") or ""
            circle_str = circle_info.get("circle", "") if isinstance(circle_info, dict) else str(circle_info)
            operator_str = circle_info.get("operator", "") if isinstance(circle_info, dict) else ""

            duration_val = c.get("duration") or 0
            try:
                duration_int = int(float(duration_val))
            except (ValueError, TypeError):
                duration_int = 0

            created_iso = c.get("createdAt").isoformat() if hasattr(c.get("createdAt"), "isoformat") else str(c.get("createdAt") or "")

            results.append({
                "id": str(c.get("_id", "")),
                "callId": c.get("call_id", ""),
                "phone_number": num,
                "customer_name": cust_name,
                "source": source,
                "dialedDid": c.get("call_to_number") or "",
                "campaign": c.get("campaign_name") or "",
                "missedAgents": agents,
                "duration": duration_int,
                "circle": circle_str,
                "operator": operator_str,
                "createdAt": created_iso,
                "startStamp": c.get("start_stamp") or "",
                "status": status,
            })

        return results
    except Exception as exc:
        logger.error(f"Failed to fetch CRM missed calls natively: {exc}")
        return []
