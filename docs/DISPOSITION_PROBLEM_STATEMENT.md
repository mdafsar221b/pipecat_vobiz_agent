# Problem Statement: Telephony Disposition Resolution & In-Flight State Corruption

---

## 1. Executive Summary

In the current telephony voice AI pipeline, **call outcomes (dispositions) are frequently misclassified, prematurely committed, or corrupted mid-flight**. This directly impacts CRM lead attribution and sales follow-up:
- **Valid, qualified leads who scheduled appointments are being marked as `not_interested`**.
- **High-intent customers asking about project locations are dumped into a generic `dropped` category** without priority tagging.
- **Runaway calls with ambient noise trigger multiple conflicting dispositions**, overwriting earlier qualification decisions.

The root cause is a dual architectural flaw:
1. **Premature In-Flight Writes**: Writing official dispositions to MongoDB inside the real-time LLM tool handler while the audio stream is still live.
2. **Fragile Rule-Based Post-Processing**: Using crude keyword substring matching in `db.py` that evaluates negative words (e.g. `"नहीं"`, `"na"`) before verifying whether a confirmed appointment was captured.

---

## 2. Documented Case Studies & Empirical Proof

---

### Case Study 1: Confirmed Booking Falsely Overwritten to `not_interested`

- **Customer Phone Number**: `+918096051418`
- **Call UUID**: `76a18d14-9cd0-4117-bfa4-a1cf7ae88d40`
- **Batch ID**: `BATCH-20261030-124907`
- **Call Duration**: 69.7 seconds
- **Recording URL**: [Audio Recording](https://media.vobiz.ai/v1/Account/MA_D49H017R/Recording/acc354a2-eae1-43a7-a44d-b263e88ea728.mp3)
- **AI Tool Event Output**:
  ```json
  {
    "event": "tool_end_call_executed",
    "details": {
      "disposition": "interested",
      "customer_name": "Karunakar",
      "callback": "Tomorrow 01:15 PM",
      "reason": "Callback scheduled for tomorrow."
    }
  }
  ```
- **Final Disposition Stored in Database**: **`not_interested`**

#### Complete Transcript
| Speaker | Timestamp (UTC) | Utterance |
| :--- | :--- | :--- |
| **Agent** | 07:45:01 | నమస్తే అండి! నేను అనన్య స్వర్గసీమ నుంచి మాట్లాడుతున్నాను. మీరు మాకు మిస్డ్ కాల్ చేశారు. మీకు స్వర్గసీమ ప్రాజెక్ట్స్ లో ఇంట్రెస్ట్ ఉందా అండి? |
| **Caller** | 07:45:13 | आज ही जाएंगे। |
| **Agent** | 07:45:15 | ధన్యవాదాలు, దయచేసి మీ వివరాలు తెలియజేయండి, మా ప్రతినిధి మీకు తిరిగి కాల్ చేస్తారు. మీ పేరు తెలుసుకోవచ్చా అండి? |
| **Caller** | 07:45:22 | ferry anoche a las 9 *(Caller says their name: Karunakar)* |
| **Agent** | 07:45:25 | ధన్యవాదాలు కరుణాకర్ గారు, మా ప్రతినిధి మీకు ఏ రోజు, ఏ సమయానికి కాల్ చేయాలి? |
| **Caller** | 07:45:34 | यह पूरे इतना दिन फ्री में होता है क्या नहीं? |
| **Agent** | 07:45:37 | సరేనండి, రేపు ఎన్ని గంటలకు కాల్ చేయాలి - ఉదయం ఆ, సాయంత్రం ఆ? |
| **Caller** | 07:45:48 | 10:00 కి చేసినా, ఈ టైం కి చేసినా ఏం కాదు. |
| **Agent** | 07:45:51 | చాలా ధన్యవాదాలు కరుణాకర్ గారు, రేపు ఇదే సమయానికి మా ప్రతినిధి మీకు కాల్ చేస్తారు. Have a great day, goodbye! |
| **Caller** | 07:46:00 | Saram |

#### Code-Level Root Cause
In `db.py: resolve_end_of_call_disposition`:
```python
decline_caller_keywords = [
    "not interested", "nahi chahiye", "vaddu", "no interest", "don't want",
    "nahi", "nahin", "na", "नहीं", "नहीं चाहिए", ...
]
if (
    tracer.disposition == "not_interested"
    or any(k in full_caller for k in decline_caller_keywords)
):
    return {"disposition": "not_interested", ...}
```
1. In turn 6, the customer asked: *"यह पूरे इतना दिन फ्री में होता है क्या **नहीं**?"*
2. Because `"नहीं"` exists as an isolated substring inside `decline_caller_keywords`, `any(k in full_caller ...)` evaluated to `True`.
3. Because the rejection check runs **before** checking if `tracer.disposition == "interested"`, the algorithm overrode the valid appointment (`Karunakar`, `Tomorrow 01:15 PM`) to **`not_interested`**.

---

### Case Study 2: High-Intent Location Inquiry Misclassified as `dropped`

- **Customer Phone Number**: `+919440512881`
- **Call UUID**: `eaac84a9-b1ef-4b3c-a319-4b3192374753`
- **Batch ID**: `BATCH-20261030-124907`
- **Call Duration**: 57.9 seconds
- **Hangup Source**: `Callee` (Customer hung up)
- **Final Disposition Stored in Database**: **`dropped`** (`"Conversation disconnected before qualification outcome reached"`)

#### Complete Transcript
| Speaker | Utterance |
| :--- | :--- |
| **Agent** | నమస్తే అండి! నేను అనన్య స్వర్గసీమ నుంచి మాట్లాడుతున్నాను. మీరు మాకు మిస్డ్ కాల్ చేశారు. మీకు స్వర్గసీమ ప్రాజెక్ట్స్ లో ఇంట్రెస్ట్ ఉందా అండి? |
| **Caller** | **ఎక్కడ ఉంది ఇది?** *(Where is this located?)* |
| **Agent** | తప్పకుండా అండి! దయచేసి మీ వివరాలు తెలియజేయండి, మా ప్రతినిధి మీకు తిరిగి కాల్ చేస్తారు. మీ పేరు తెలుసుకోవచ్చా అండి? |
| **Caller** | **ఇది ఎక్కడ ఉంది చెప్పండి ఫస్ట్? స్వర్గసీమ ఎక్కడ ఉంది? ఆ దాన్ని బట్టి నేను డిసైడ్ చేస్తా.** *(First tell me where it is located! Where is Swargaseema? Based on that I will decide!)* |
| **Agent** | ప్రాజెక్ట్ వివరాలన్ని మా ప్రతినిధి మీకు తెలియజేస్తారండి, మీరు పేరు చెప్తే నేను కాల్ షెడ్యూల్ చేస్తాను. మీ పేరు తెలుసుకోవచ్చా? |
| **Caller** | *(Hangs up in frustration)* |

#### Code-Level Root Cause
1. In `db.py`, `interest_caller_keywords` only looks for explicit affirmative tokens:
   `["interested", "haan", "yes", "ha", "plot", "plots", "ఇంట్రెస్ట్", "అవును"]`.
2. The caller did not say the word *"interested"*; they expressed intent by asking for the location (*"ఎక్కడ ఉంది ఇది?"*).
3. Because the AI had no location knowledge, it repeatedly evaded the question. When the customer hung up, the function reached the final fallback:
   ```python
   return {"disposition": "dropped", "reason": "Conversation disconnected before qualification outcome reached"}
   ```
4. A high-value prospective buyer was lost into the generic `dropped` pool rather than being flagged as an **`inquiry_drop`** for immediate sales callback.

---

### Case Study 3: Premature In-Flight Writes & Runaway Call (10 Conflicting Dispositions)

- **Customer Phone Number**: `+918292451265`
- **Call UUID**: `8ae7062b-619f-4825-b5b6-0d370b545acb`
- **Batch ID**: `BATCH-20261030-124907`
- **Call Duration**: **417.2 seconds (~7 minutes)**
- **Tool Invocations during Single Call**: **10 separate times**

#### Chronology of Tool Invocations within One Call
| Time (Epoch) | Tool Triggered Disposition | Reason Extracted by Gemini |
| :--- | :--- | :--- |
| 1793345865 | `not_talking` | Caller is talking to someone else. |
| 1793345889 | `not_interested` | User wants to cancel the call. |
| 1793345892 | `not_talking` | User said Stop unexpectedly. |
| 1793345914 | `not_talking` | Inappropriate personal request. |
| 1793345946 | **`interested`** | User confirmed callback time. |
| 1793345952 | **`interested`** | Customer requested callback. |
| 1793345980 | **`interested`** | Customer requested callback. |
| 1793346001 | `not_talking` | Caller asked to play a song. |
| 1793346009 | `not_talking` | User said irrelevant word. |
| 1793346048 | **`interested`** | Callback scheduled. |

#### Code-Level Root Cause
In `agent.py`:
1. Every time Gemini Live emits an `end_call` tool call, `agent.py` updates MongoDB immediately.
2. Instead of terminating the call, the system scheduled an inactivity timer (`silence_hangup_task`).
3. Whenever background noise or ambient TV audio triggered `on_user_turn_message_added`, the system cancelled the hangup timer:
   ```python
   if silence_hangup_task[0] and not silence_hangup_task[0].done():
       silence_hangup_task[0].cancel()
   ```
4. The call stayed alive for 7 minutes, continually flipping between `not_talking`, `not_interested`, and `interested`.

---

### Case Study 4: Initial Rejection Overwritten by Ambient Background Talk

- **Customer Phone Number**: `+919705459422`
- **Call UUID**: `2fb4cfdd-f292-41f9-b32a-91b0b31e7a1b`
- **Batch ID**: `BATCH-20261030-114732`
- **Call Duration**: **498.0 seconds (~8.3 minutes)**
- **Initial Intent**: `not_interested` (at 06:23:18 UTC: *"Caller stated 'Nahi ji' expressing lack of interest"*)
- **Final Disposition Stored in Database**: **`wrong_number`**

#### Chronology
1. At **06:23:18**, caller explicitly declined: *"नहीं जी। हेलो।"*
2. Gemini executed `end_call` (`not_interested`).
3. Due to the timer cancellation bug, the line remained open for **3 minutes and 43 seconds of dead air**.
4. At **06:27:19**, the caller was overheard speaking to someone nearby in the room: *"What's the name of your bank? What's the gift?"*
5. Gemini Live re-engaged, assumed the caller was talking to a third party, and executed `end_call` again with `wrong_number`.
6. The legitimate rejection was permanently overwritten by ambient room noise.

---

## 3. Structural Flaws in the Current System

```
Current Flawed Flow:
   [Call Active] ──▶ [Gemini emits end_call] ──▶ [IMMEDIATE DB WRITE: doc.disposition] 
                          │                                 │
                          ▼                                 ▼
               [Inactivity Timer Set]              (Overwritten multiple times
                          │                         if call lingers)
                          ▼
            [Ambient Noise Triggers Turn]
                          │
                          ▼
               [Timer Cancelled, Call Lives]
                          │
                          ▼
   [Callee Hangs Up] ──▶ [resolve_end_of_call_disposition in db.py]
                                  │
                                  ▼
                         [Crude Substring Regex]
                                  │
                                  ▼
                         (Matches "नहीं" in question ──▶ Overwrites to "not_interested")
```

1. **Premature State Mutation**: Telephony dispositions represent the *terminal verdict* of an interaction. Mutating `doc.disposition` during an active call violates state idempotency.
2. **Inverted Evaluation Precedence**: In `db.py`, negative keyword matching is evaluated *before* checking if structured appointment fields (`customer_name`, `callback_time`, `tracer.disposition == 'interested'`) are present.
3. **No Recognition of Inquiries**: If a caller asks questions before saying yes/no (*"Where is the location?"*, *"Price ఎంత?"*), the system does not recognize this as positive interest and defaults to `dropped`.

---

## 4. Proposed Production-Grade Architecture

```
Proposed Production Flow:
   [Call Active] ──▶ [Gemini emits end_call]
                          │
                          ▼
              [Record in_flight_slots only]
              (e.g., candidate_name, candidate_callback)
                          │
                          ▼
              [Mandatory 1.5s Audio Drain Buffer]
                          │
                          ▼
              [Unconditional vobiz_api.hangup_call()]
                          │
                          ▼
   [Call Fully Terminated (server.py /hangup)]
                          │
                          ▼
   [Post-Call Evaluation Engine]
     Analyzes:
       1. Complete Dual-Channel Transcript
       2. Carrier Disconnect Signaling (Callee vs Carrier timeout)
       3. Audio Byte Flow & Silence Ratio
       4. Candidate Slots from Tool Calls
                          │
                          ▼
   [Persist Final Immutable Disposition]
       • "interested": Confirmed booking (Name + Slot)
       • "inquiry_drop": Expressed interest/inquiry, hung up before booking (High Priority Sales Callback)
       • "not_interested": Explicit refusal
       • "wrong_number": Identified wrong recipient
       • "not_talking": Handset answered, but pure silence
       • "busy" / "no_answer": Carrier signaled network failure
```

### Specific Engineering Fixes
1. **Decouple In-Call State from Terminal State**:
   `handle_end_call` in `agent.py` should write only to `doc.candidate_slots`. It must not touch `doc.disposition`.
2. **Unconditional Hangup**:
   Once `end_call` is triggered, the server must execute `await vobiz_api.hangup_call(call_uuid)` after a fixed 1.5-second buffer. Background noise must never cancel the hangup.
3. **Fix Rule Precedence in `db.py`**:
   If `tracer.customer_name` and `tracer.callback_time` exist, or if `tracer.disposition == "interested"`, the call must be locked as **`interested`**. Keyword matching must not override structured slot captures.
4. **Introduce `inquiry_drop` Category**:
   Incorporate regex patterns for real-estate inquiries (location, price, sq yards, approval) so that callers who ask questions but disconnect before booking are highlighted for human agents.
