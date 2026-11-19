import asyncio
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from loguru import logger

import sys

BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import db
import diagnostics
import vobiz_api

class OutboundDialer:
    """Manages the outbound call queue, multi-channel concurrent OBD campaign execution (up to 20+ parallel calls),
    and live multi-agent tracking across different employees and batches."""

    def __init__(self):
        self.status = "idle"
        self.queue: List[Dict[str, Any]] = []
        # Multi-channel active calls: map of call_uuid -> call metadata dict
        self.active_calls: Dict[str, Dict[str, Any]] = {}
        self.last_call: Optional[Dict[str, Any]] = None
        self.dialer_task: Optional[asyncio.Task] = None
        self.cooldown_seconds = float(os.getenv("OUTBOUND_COOLDOWN_SEC", "0.5"))
        self.max_concurrency = int(os.getenv("MAX_CONCURRENT_CALLS", "20"))
        self.batches: List[Dict[str, Any]] = []
        self.current_batch_id: Optional[str] = None
        self.total_batch_leads: int = 0
        self.selected_template_id: str = "production_callback_conversion"
        # Per-user isolated queue execution status: user_id / user_name -> "idle" | "running" | "paused"
        self.user_statuses: Dict[str, str] = {}
        # Per-user active batch tracker: user_id / user_name -> batch_id
        self.user_current_batch: Dict[str, str] = {}
        # Per-user last completed call: user_id / user_name -> call dict
        self.user_last_call: Dict[str, Dict[str, Any]] = {}

    def _matches_user(
        self,
        item: Optional[Dict[str, Any]],
        user_id: Optional[str],
        user_name: Optional[str] = None,
        user_email: Optional[str] = None,
    ) -> bool:
        """Centralized helper to check whether a lead or call belongs to a specific user."""
        if not item or not isinstance(item, dict):
            return False
        c_id = item.get("created_by_id")
        c_email = item.get("created_by_email")
        c_name = item.get("created_by_name")

        if user_id and c_id and str(c_id).strip() == str(user_id).strip():
            return True
        if user_id and c_email and str(c_email).strip().lower() == str(user_id).strip().lower():
            return True
        if user_email and c_email and str(c_email).strip().lower() == str(user_email).strip().lower():
            return True
        if user_name and c_name and str(c_name).strip().lower() == str(user_name).strip().lower():
            return True
        return False

    @property
    def active_call(self) -> Optional[Dict[str, Any]]:
        """Backwards compatibility property: returns the most recent active call."""
        if self.active_calls:
            return list(self.active_calls.values())[-1]
        return None

    # Enrich each CRM lead with latest AI voice agent disposition
    def _enrich_with_ai_disposition(self, calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        try:
            import re
            ai_map = db.get_latest_ai_call_by_phone()
            for c in calls:
                num = c.get("phone_number") or ""
                digits = re.sub(r"\D", "", str(num))[-10:]
                if digits and digits in ai_map:
                    ai_info = ai_map[digits]
                    c["ai_disposition"] = ai_info.get("disposition")
                    c["ai_call_uuid"] = ai_info.get("call_uuid")
                    c["ai_call_time"] = ai_info.get("created_at")
                    c["ai_duration"] = ai_info.get("duration", 0)
                else:
                    c["ai_disposition"] = None
                    c["ai_call_uuid"] = None
                    c["ai_call_time"] = None
                    c["ai_duration"] = 0
        except Exception as enrich_err:
            logger.warning(f"Failed to enrich CRM leads with AI disposition: {enrich_err}")
        return calls

    # Fetch pending calls from CRM (direct MongoDB primary, node service fallback)
    def fetch_crm_pending(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        status: Optional[str] = "all",
    ) -> List[Dict[str, Any]]:
        # 1. Primary: Direct native MongoDB query (works standalone on Linux VPS, Docker, Windows)
        try:
            native_calls = db.fetch_crm_missed_calls(start_date, end_date, status)
            if native_calls:
                return self._enrich_with_ai_disposition(native_calls)
        except Exception as exc:
            logger.warning(f"Native MongoDB CRM fetch failed: {exc}")

        # 2. Fallback: Node crm_service.cjs (if local realestate workflow exists)
        script_path = BACKEND_DIR / "crm_service.cjs"
        cmd = ["node", str(script_path), start_date or "", end_date or "", status or "all"]
        try:
            res = subprocess.run(cmd, cwd=str(BACKEND_DIR), capture_output=True, text=True, timeout=25)
            if res.returncode == 0 and res.stdout.strip():
                data = json.loads(res.stdout.strip())
                calls = data.get("calls", []) if isinstance(data, dict) else data
                return self._enrich_with_ai_disposition(calls)
            logger.warning(f"CRM fetch non-zero exit ({res.returncode}): {res.stderr}")
        except Exception as exc:
            logger.error(f"CRM pending fetch failed: {exc}")
        return []

    # Queue a list of leads for outbound calling, tagged with creator metadata
    def queue_leads(
        self,
        leads: List[Dict[str, Any]],
        batch_name: Optional[str] = None,
        source_filter: Optional[str] = None,
        template_id: Optional[str] = None,
        created_by_id: Optional[str] = None,
        created_by_name: Optional[str] = None,
        created_by_email: Optional[str] = None,
    ) -> str:
        batch_id = f"BATCH-{datetime_now_str()}"
        self.current_batch_id = batch_id
        if created_by_id:
            self.user_current_batch[created_by_id] = batch_id
        if created_by_name:
            self.user_current_batch[created_by_name] = batch_id
        if created_by_email:
            self.user_current_batch[created_by_email] = batch_id

        # Clean up this user's PREVIOUS completed/finalized leads from active queue so they don't accumulate into new batches
        self.queue = [
            item for item in self.queue
            if not (
                self._matches_user(item, created_by_id, created_by_name, created_by_email)
                and item.get("status") in ("completed", "failed")
            )
        ]

        effective_template_id = template_id or self.selected_template_id
        tpl = db.get_template(effective_template_id)

        new_entries = []
        for lead in leads:
            entry = {
                "id": lead.get("id") or str(time.time()),
                "phone_number": lead.get("phone_number") or lead.get("customerNumber"),
                "customer_name": lead.get("customer_name") or lead.get("customerName", ""),
                "source": lead.get("source") or lead.get("marketing_source", ""),
                "batch_id": batch_id,
                "template_id": effective_template_id,
                "created_by_id": created_by_id,
                "created_by_name": created_by_name or "System",
                "created_by_email": created_by_email,
                "status": "pending",
                "queued_at": time.time(),
            }
            if entry["phone_number"]:
                new_entries.append(entry)
                self.queue.append(entry)

        batch_doc = {
            "batch_id": batch_id,
            "name": batch_name or f"Batch {time.strftime('%Y-%m-%d %H:%M')}",
            "source_filter": source_filter or "CRM Missed Calls",
            "template_id": effective_template_id,
            "template_name": (tpl.get("name") if tpl else effective_template_id) or "Standard",
            "greeting_text": tpl.get("greeting_telugu") if tpl else None,
            "system_prompt": tpl.get("system_prompt") if tpl else None,
            "greeting_audio_path": tpl.get("greeting_audio_path") if tpl else None,
            "total_leads": len(new_entries),
            "leads": [dict(l) for l in leads],
            "created_by_id": created_by_id,
            "created_by_name": created_by_name or "Admin",
            "created_by_email": created_by_email,
            "status": "active",
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "started_at": time.time(),
        }
        db.save_batch(batch_doc)
        self.total_batch_leads += len(new_entries)
        logger.info(
            f"Queued {len(new_entries)} leads into batch {batch_id} by {created_by_name or 'Admin'} "
            f"(Template: {effective_template_id}, Total in Queue: {len(self.queue)})"
        )
        return batch_id

    # Re-run a previous batch by re-queueing its leads
    def rerun_batch(
        self,
        batch_id: str,
        mode: str = "all",
        created_by_id: Optional[str] = None,
        created_by_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        b_col = db.get_batches_collection()
        c_col = db.get_collection()
        batch_doc = b_col.find_one({"batch_id": batch_id}) if b_col is not None else None

        leads_to_queue = []

        if batch_doc and batch_doc.get("leads"):
            saved = batch_doc["leads"]
            if mode == "unreached" and c_col is not None:
                reached_nums = set()
                for c in c_col.find({"batch_id": batch_id, "disposition": {"$in": ["interested", "inquiry_drop"]}}):
                    if c.get("phone_number"):
                        reached_nums.add(c["phone_number"][-10:])
                leads_to_queue = [l for l in saved if str(l.get("phone_number", ""))[-10:] not in reached_nums]
            else:
                leads_to_queue = list(saved)

        if not leads_to_queue and c_col is not None:
            for c in c_col.find({"batch_id": batch_id}).sort("created_at", 1):
                disp = c.get("disposition")
                if mode == "unreached" and disp in ("interested", "inquiry_drop"):
                    continue
                num = c.get("phone_number")
                if num:
                    leads_to_queue.append({
                        "id": str(time.time()),
                        "phone_number": num,
                        "customer_name": c.get("customer_name") or "",
                        "source": f"Re-run of {batch_id}",
                    })

        if not leads_to_queue:
            return {"ok": False, "error": f"No leads found to re-run for batch {batch_id}"}

        orig_name = (batch_doc.get("name") if batch_doc else batch_id) or "Batch"
        clean_name = orig_name.replace("Re-run (", "").rstrip(")")
        new_name = f"Re-run ({clean_name})"
        orig_template_id = batch_doc.get("template_id") if batch_doc else None
        new_batch_id = self.queue_leads(
            leads=leads_to_queue,
            batch_name=new_name,
            source_filter=f"Re-run of {batch_id}",
            template_id=orig_template_id,
            created_by_id=created_by_id or (batch_doc.get("created_by_id") if batch_doc else None),
            created_by_name=created_by_name or (batch_doc.get("created_by_name") if batch_doc else None),
        )
        return {"ok": True, "batch_id": new_batch_id, "queued": len(leads_to_queue), "name": new_name}

    # Check and clear stuck orphan calls exceeding carrier thresholds across all active channels
    def _check_watchdog(self):
        if not self.active_calls:
            return
        import re
        now = time.time()
        for uuid, call in list(self.active_calls.items()):
            phone_raw = call.get("phone_number") or ""
            target_digits = re.sub(r"\D", "", str(phone_raw))[-10:] if phone_raw else None

            # 1. Immediate sync: if MongoDB already marked call as finished, pop it immediately!
            doc = db.get_call(uuid) if uuid else None
            if not doc and target_digits:
                col = db.get_collection()
                if col is not None:
                    try:
                        doc = col.find_one(
                            {"phone_number": {"$regex": f"{target_digits}$"}},
                            {"_id": 0},
                            sort=[("created_at", -1)],
                        )
                    except Exception:
                        pass

            if doc and (doc.get("ended_at") or doc.get("status") in ("hung_up", "completed", "failed") or doc.get("disposition")):
                logger.info(f"Watchdog auto-clearing DB-finished call {uuid[:8]} (phone: {phone_raw}, disposition: {doc.get('disposition')})")
                self.on_call_ended(uuid, phone_number=phone_raw)
                continue

            elapsed = now - call.get("started_at", now)
            status = call.get("status", "dialing")
            turns_count = len(doc.get("turns", [])) if doc else 0

            # 2. Strict Timeout Checks:
            # - Ringing timeout: 35s max if not picked up
            # - Stream failed / handset dropped immediately: If in_call but after 12s no turns exist, clear immediately!
            # - Hard safety limit: 600s (10 min)
            is_stuck_dialing = (status == "dialing" and elapsed > 35.0)
            is_stuck_incall = (status == "in_call" and elapsed > 12.0 and turns_count == 0)
            is_overdue = (elapsed > 600.0)

            if is_stuck_dialing or is_stuck_incall or is_overdue:
                disp = "no_answer" if is_stuck_dialing else ("not_talking" if is_stuck_incall else "completed")
                reason = "Ringing timeout (35s)" if is_stuck_dialing else (
                    "Carrier media stream failure - no speech or WebSocket handshake within 12s" if is_stuck_incall else "Max call duration exceeded"
                )
                logger.warning(f"Watchdog terminating stuck call {uuid[:8]} ({status}) after {elapsed:.1f}s ({reason})")
                try:
                    db.finalize_call(
                        call_uuid=uuid,
                        status="hung_up",
                        fallback_disposition=disp,
                        disposition=disp,
                        reason=reason,
                    )
                except Exception as exc:
                    logger.error(f"Error finalizing stuck call {uuid} in watchdog: {exc}")
                finally:
                    self.on_call_ended(uuid, phone_number=phone_raw)

    # Link incoming telephony call_uuid with active call slot
    def link_call_uuid(
        self,
        call_uuid: str,
        to_number: Optional[str] = None,
        req_uuid: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        if not call_uuid:
            return None

        # Already properly keyed
        if call_uuid in self.active_calls:
            return self.active_calls[call_uuid]

        import re
        target_digits = re.sub(r"\D", "", to_number or "")[-10:] if to_number else None

        # Search by req_uuid or matching phone number
        match_key = None
        for k, c in list(self.active_calls.items()):
            if req_uuid and (k == req_uuid or c.get("call_uuid") == req_uuid or c.get("request_uuid") == req_uuid):
                match_key = k
                break
            if target_digits:
                c_digits = re.sub(r"\D", "", c.get("phone_number", ""))[-10:]
                if c_digits and c_digits == target_digits:
                    match_key = k
                    break

        if match_key:
            info = self.active_calls.pop(match_key)
            info["call_uuid"] = call_uuid
            info["request_uuid"] = match_key
            self.active_calls[call_uuid] = info
            logger.info(f"🔗 Re-keyed active call from {match_key[:8]} to Vobiz CallUUID {call_uuid[:8]} ({info.get('phone_number')})")
            return info

        return None

    # Calculate live counters for dialer UI
    def get_kpi_counts(self, batch_id: Optional[str] = None) -> Dict[str, int]:
        self._check_watchdog()
        is_dialing = sum(1 for c in self.active_calls.values() if c.get("status") == "dialing")
        is_incall = sum(1 for c in self.active_calls.values() if c.get("status") == "in_call")
        active_count = len(self.active_calls)

        target_batch = batch_id or self.current_batch_id

        # If specific batch requested, get batch metrics from MongoDB
        batch_metrics = db.get_batch_metrics(target_batch) if target_batch else {}
        pending_in_queue = sum(1 for item in self.queue if item["status"] == "pending")
        total_leads = len(self.queue) if len(self.queue) > 0 else (getattr(self, "total_batch_leads", 0) or batch_metrics.get("dialed", 0))

        return {
            "total": total_leads,
            "pending": pending_in_queue,
            "dialing": is_dialing,
            "in_call": is_incall,
            "active": active_count,
            "channels_active": active_count,
            "max_concurrency": self.max_concurrency,
            "interested": batch_metrics.get("interested", 0),
            "not_interested": batch_metrics.get("not_interested", 0),
            "wrong_number": batch_metrics.get("wrong_number", 0),
            "not_talking": batch_metrics.get("not_talking", 0),
            "no_answer": batch_metrics.get("no_answer", 0),
            "dropped": batch_metrics.get("dropped", 0),
            "retry_scheduled": 0,
        }

    # Set active call reference in multi-channel dictionary
    def set_active_call(
        self,
        call_uuid: str,
        phone_number: str,
        customer_name: str = "",
        status: str = "dialing",
        batch_id: Optional[str] = None,
        template_id: Optional[str] = None,
        created_by_id: Optional[str] = None,
        created_by_name: Optional[str] = None,
        created_by_email: Optional[str] = None,
    ):
        if not call_uuid:
            return
        self.active_calls[call_uuid] = {
            "call_uuid": call_uuid,
            "phone_number": phone_number,
            "customer_name": customer_name,
            "batch_id": batch_id or self.current_batch_id,
            "template_id": template_id or self.selected_template_id,
            "created_by_id": created_by_id,
            "created_by_name": created_by_name or "System",
            "created_by_email": created_by_email,
            "status": status,
            "started_at": time.time(),
        }

    # Update active call phase status
    def set_call_status(self, call_uuid: str, status: str = "in_call"):
        if call_uuid and call_uuid in self.active_calls:
            self.active_calls[call_uuid]["status"] = status
        elif self.active_calls and not call_uuid:
            latest = list(self.active_calls.values())[-1]
            latest["status"] = status

    # Per-user status controls for user-isolated queues
    def start_user(self, user_id: str, public_url: str, user_name: Optional[str] = None):
        if user_id:
            self.user_statuses[user_id] = "running"
        if user_name:
            self.user_statuses[user_name] = "running"
        self.start(public_url)

    def pause_user(self, user_id: str, user_name: Optional[str] = None):
        if user_id:
            self.user_statuses[user_id] = "paused"
        if user_name:
            self.user_statuses[user_name] = "paused"

    def resume_user(self, user_id: str, public_url: str, user_name: Optional[str] = None):
        self.start_user(user_id, public_url, user_name=user_name)

    def stop_user(self, user_id: str, user_name: Optional[str] = None):
        if user_id:
            self.user_statuses[user_id] = "idle"
        if user_name:
            self.user_statuses[user_name] = "idle"
        if not any(st == "running" for st in self.user_statuses.values()):
            self.status = "idle"

    def reset_user(self, user_id: str, user_name: Optional[str] = None, user_email: Optional[str] = None):
        if user_id:
            self.user_statuses[user_id] = "idle"
        if user_name:
            self.user_statuses[user_name] = "idle"
        if user_email:
            self.user_statuses[user_email] = "idle"

        # Remove only this user's leads from queue
        self.queue = [
            i for i in self.queue
            if not self._matches_user(i, user_id, user_name, user_email)
        ]
        # Auto-pop active calls belonging to this user
        for k, c in list(self.active_calls.items()):
            if self._matches_user(c, user_id, user_name, user_email):
                self.on_call_ended(k, phone_number=c.get("phone_number"))

        if not any(st == "running" for st in self.user_statuses.values()):
            self.status = "idle"

    def get_user_status(self, user_id: Optional[str] = None, user_name: Optional[str] = None) -> str:
        if user_id and user_id in self.user_statuses:
            return self.user_statuses[user_id]
        if user_name and user_name in self.user_statuses:
            return self.user_statuses[user_name]
        return "idle"

    # Start automated dialer loop
    def start(self, public_url: str):
        if self.status == "running":
            return
        self.status = "running"
        logger.info(f"Outbound dialer started with max concurrency = {self.max_concurrency} parallel calls")
        if not self.dialer_task or self.dialer_task.done():
            self.dialer_task = asyncio.create_task(self._dial_loop(public_url))

    # Pause dialer loop
    def pause(self):
        self.status = "paused"
        logger.info("Outbound dialer paused")

    # Resume dialer loop
    def resume(self, public_url: str):
        self.start(public_url)

    # Stop dialer and cancel active background loop
    def stop(self):
        self.status = "idle"
        for uid in list(self.user_statuses.keys()):
            self.user_statuses[uid] = "idle"
        if self.dialer_task and not self.dialer_task.done():
            self.dialer_task.cancel()
        logger.info("Outbound dialer stopped")

    # Clear pending queue and reset batch
    def clear(self):
        self.reset()

    # Reset dialer state, queue, and active batch counters
    def reset(self):
        self.stop()
        self.queue.clear()
        self.active_calls.clear()
        self.last_call = None
        self.total_batch_leads = 0
        if self.current_batch_id:
            db.finalize_batch(self.current_batch_id, status="completed")
            self.current_batch_id = None
        logger.info("Dialer queue and batch counters reset")

    # Remove a specific batch from queue without wiping other users' batches
    def remove_batch_from_queue(self, batch_id: str):
        self.queue = [item for item in self.queue if item.get("batch_id") != batch_id]
        if self.current_batch_id == batch_id:
            pending = next((item for item in self.queue if item.get("status") == "pending"), None)
            self.current_batch_id = pending.get("batch_id") if pending else None
            if not self.queue and not self.active_calls:
                self.status = "idle"
        logger.info(f"Removed batch {batch_id} leads from queue. Remaining in queue: {len(self.queue)}")

    # Asynchronous dispatch of a single call slot
    async def _dispatch_single_call(self, pending_item: Dict[str, Any], public_url: str):
        target_phone = pending_item["phone_number"]
        pending_item["status"] = "dialing"
        batch_id = pending_item.get("batch_id") or self.current_batch_id
        lead_id = pending_item.get("id", "")
        lead_name = pending_item.get("customer_name", "")
        tpl_id = pending_item.get("template_id") or self.selected_template_id
        creator_id = pending_item.get("created_by_id")
        creator_name = pending_item.get("created_by_name")
        creator_email = pending_item.get("created_by_email")

        # Immediately claim active call slot synchronously so sequential guard sees it
        temp_uuid = pending_item.get("id") or str(time.time())
        pending_item["call_uuid"] = temp_uuid
        self.set_active_call(
            call_uuid=temp_uuid,
            phone_number=target_phone,
            customer_name=lead_name,
            status="dialing",
            batch_id=batch_id,
            template_id=tpl_id,
            created_by_id=creator_id,
            created_by_name=creator_name,
            created_by_email=creator_email,
        )

        logger.info(
            f"🚀 [Sequential Slot] Dialer placing call to {target_phone} by {creator_name or 'System'} "
            f"(batch: {batch_id}, active calls: {len(self.active_calls)})"
        )

        call_answer_url = f"{public_url}/answer?batch_id={batch_id or ''}&lead_id={lead_id}&to={target_phone}&template_id={tpl_id}"
        call_hangup_url = f"{public_url}/hangup?batch_id={batch_id or ''}&lead_id={lead_id}&to={target_phone}"

        try:
            res = await vobiz_api.place_call(
                to_number=target_phone,
                answer_url=call_answer_url,
                hangup_url=call_hangup_url,
            )
            call_uuid = res.get("request_uuid") or res.get("call_uuid") or temp_uuid
            pending_item["call_uuid"] = call_uuid
            if call_uuid != temp_uuid:
                self.active_calls.pop(temp_uuid, None)
                self.set_active_call(
                    call_uuid=call_uuid,
                    phone_number=target_phone,
                    customer_name=lead_name,
                    status="dialing",
                    batch_id=batch_id,
                    template_id=tpl_id,
                    created_by_id=creator_id,
                    created_by_name=creator_name,
                    created_by_email=creator_email,
                )
            tracer = diagnostics.get_tracer(call_uuid, phone_number=target_phone, batch_id=batch_id)
            tracer.record_event("call_initiated", {
                "to": target_phone,
                "customer_name": lead_name,
                "batch_id": batch_id,
                "lead_id": lead_id,
                "created_by": creator_name,
            })
            tracer.record_event("carrier_dispatched", {
                "request_uuid": call_uuid,
                "message": res.get("message", "call placed"),
                "api_id": res.get("api_id", ""),
            })
            db.record_call_start(
                call_uuid=call_uuid,
                phone_number=target_phone,
                batch_id=batch_id,
                metadata={"customer_name": lead_name, "lead_id": lead_id, "status": "dialing", "request_uuid": call_uuid},
                created_by_id=creator_id,
                created_by_name=creator_name,
            )
        except Exception as exc:
            logger.error(f"Dialer failed to place call to {target_phone}: {exc}")
            pending_item["status"] = "failed"
            self.active_calls.pop(temp_uuid, None)
            tracer = diagnostics.get_tracer(pending_item.get("id", str(time.time())), phone_number=target_phone, batch_id=batch_id)
            tracer.record_error("api_call_failed", str(exc))

    # Continuous background worker placing calls sequentially (strictly 1-by-1 per user)
    async def _dial_loop(self, public_url: str):
        while any(st == "running" for st in self.user_statuses.values()) or self.status == "running":
            # 0. Continuously clear any finished or stuck calls across all user channels
            self._check_watchdog()

            # 1. Global concurrency gate
            if len(self.active_calls) >= self.max_concurrency:
                await asyncio.sleep(0.5)
                continue

            # 2. Find next pending lead for any user currently in 'running' status
            # STRICT SEQUENTIAL CALLING (1-BY-1):
            # A user's next call is ONLY dispatched after their previous call has fully ended!
            pending_item = None
            for item in self.queue:
                if item.get("status") == "pending":
                    c_id = item.get("created_by_id")
                    c_email = item.get("created_by_email")
                    c_name = item.get("created_by_name")

                    user_st = (
                        (self.user_statuses.get(c_id) if c_id else None)
                        or (self.user_statuses.get(c_email) if c_email else None)
                        or (self.user_statuses.get(c_name) if c_name else None)
                    )
                    is_user_running = (
                        user_st == "running"
                        or (user_st is None and self.status == "running" and len(self.user_statuses) <= 1)
                    )
                    if not is_user_running:
                        continue

                    # Sequential Guard: Does this user already have an active or in-flight call?
                    user_has_active_call = any(
                        self._matches_user(c, c_id, c_name, c_email)
                        for c in self.active_calls.values()
                    ) or any(
                        i.get("status") == "dialing" and self._matches_user(i, c_id, c_name, c_email)
                        for i in self.queue
                    )
                    if user_has_active_call:
                        # User is already on a call! Wait for it to finish before starting next lead.
                        continue

                    pending_item = item
                    break

            if not pending_item:
                # If leads are done or calls are in flight/live, keep waiting patiently!
                has_in_flight = any(i.get("status") == "dialing" for i in self.queue) or len(self.active_calls) > 0
                if has_in_flight:
                    await asyncio.sleep(0.8)
                    continue

                # Auto-idle users who have completed their queues
                for uid in list(self.user_statuses.keys()):
                    if self.user_statuses.get(uid) == "running":
                        u_has_pending = any(
                            i.get("status") in ("pending", "dialing") and self._matches_user(i, uid, uid, uid)
                            for i in self.queue
                        )
                        u_has_active = any(
                            self._matches_user(c, uid, uid, uid)
                            for c in self.active_calls.values()
                        )
                        if not u_has_pending and not u_has_active:
                            self.user_statuses[uid] = "idle"
                            logger.info(f"User {uid} completed their call queue. Status set to idle.")

                if not any(st == "running" for st in self.user_statuses.values()):
                    logger.info("All pending calls processed across active users. Dialer idle.")
                    self.status = "idle"
                    break
                await asyncio.sleep(0.5)
                continue

            # 3. Fire sequential call for this user
            asyncio.create_task(self._dispatch_single_call(pending_item, public_url))

            # 4. Pacing interval between initiating calls
            await asyncio.sleep(self.cooldown_seconds)

    # Callback when call terminates to update dialer state
    def on_call_ended(self, call_uuid: str, phone_number: Optional[str] = None):
        if not call_uuid and not phone_number:
            return

        import re
        target_digits = re.sub(r"\D", "", phone_number or "")[-10:] if phone_number else None

        ended_call_info = None

        # 1. Exact match by call_uuid
        if call_uuid and call_uuid in self.active_calls:
            ended_call_info = self.active_calls.pop(call_uuid)

        # 2. Match by call_uuid inside dict or prefix match
        if not ended_call_info and call_uuid:
            clean_uuid = str(call_uuid).strip().lower()
            for k, c in list(self.active_calls.items()):
                k_clean = str(k).strip().lower()
                c_uuid = str(c.get("call_uuid", "")).strip().lower()
                c_req = str(c.get("request_uuid", "")).strip().lower()
                if (
                    k_clean == clean_uuid
                    or c_uuid == clean_uuid
                    or c_req == clean_uuid
                    or (len(clean_uuid) >= 8 and (k_clean.startswith(clean_uuid[:8]) or clean_uuid.startswith(k_clean[:8])))
                ):
                    ended_call_info = self.active_calls.pop(k)
                    break

        # 3. Match by 10-digit phone number
        if not ended_call_info and target_digits:
            for k, c in list(self.active_calls.items()):
                c_digits = re.sub(r"\D", "", c.get("phone_number", ""))[-10:]
                if c_digits and c_digits == target_digits:
                    ended_call_info = self.active_calls.pop(k)
                    break

        if ended_call_info:
            eff_uuid = ended_call_info.get("call_uuid") or call_uuid
            duration = round(time.time() - ended_call_info.get("started_at", time.time()), 1)
            doc = db.get_call(eff_uuid) if eff_uuid else None
            call_summary = {
                **ended_call_info,
                "duration": doc.get("duration", duration) if doc else duration,
                "disposition": doc.get("disposition", "completed") if doc else "completed",
                "ended_at": time.time(),
                "turns": doc.get("turns", []) if doc else [],
                "diagnostic": doc.get("diagnostic", {}) if doc else {},
            }
            self.last_call = call_summary
            c_uid = ended_call_info.get("created_by_id")
            c_uname = ended_call_info.get("created_by_name")
            c_email = ended_call_info.get("created_by_email")
            if c_uid:
                self.user_last_call[c_uid] = call_summary
            if c_uname:
                self.user_last_call[c_uname] = call_summary
            if c_email:
                self.user_last_call[c_email] = call_summary
            logger.info(
                f"📴 Call {str(eff_uuid)[:8]} ended. Active channels: {len(self.active_calls)}/{self.max_concurrency}"
            )

        # Mark in queue as completed
        for item in self.queue:
            q_uuid = item.get("call_uuid")
            q_phone = re.sub(r"\D", "", item.get("phone_number", ""))[-10:] if target_digits else None
            if (call_uuid and q_uuid == call_uuid) or (target_digits and q_phone == target_digits):
                item["status"] = "completed"

        # Check if batch finished
        if ended_call_info:
            b_id = ended_call_info.get("batch_id")
            if b_id:
                has_pending = any(i.get("batch_id") == b_id and i.get("status") in ("pending", "dialing") for i in self.queue)
                if not has_pending:
                    db.finalize_batch(b_id, status="completed")

    # Format live dialer status payload for UI polling with user-isolated queue and active calls
    def get_status_payload(
        self,
        user_id: Optional[str] = None,
        user_name: Optional[str] = None,
        user_email: Optional[str] = None,
    ) -> Dict[str, Any]:
        self._check_watchdog()

        # Auto-clean any calls in self.active_calls that DB already reports as ended
        for uuid, c in list(self.active_calls.items()):
            doc = db.get_call(uuid) if uuid else None
            if not doc and c.get("phone_number"):
                col = db.get_collection()
                if col is not None:
                    try:
                        doc = col.find_one({"phone_number": c["phone_number"]}, {"_id": 0}, sort=[("created_at", -1)])
                    except Exception:
                        pass
            if doc and (doc.get("ended_at") or doc.get("status") in ("hung_up", "completed", "failed") or doc.get("disposition")):
                self.on_call_ended(uuid, phone_number=c.get("phone_number"))

        # Strict user isolation: never leak one user's queue or active calls into another user's session
        if user_id or user_name or user_email:
            user_queue = [
                i for i in self.queue
                if self._matches_user(i, user_id, user_name, user_email)
            ]
            user_active_calls = {
                k: v for k, v in self.active_calls.items()
                if self._matches_user(v, user_id, user_name, user_email)
            }
            user_status = self.get_user_status(user_id, user_name)
            # If user has no pending items and no active calls, force status to idle
            has_pending = any(i.get("status") == "pending" for i in user_queue)
            if not has_pending and not user_active_calls:
                user_status = "idle"
                if user_id:
                    self.user_statuses[user_id] = "idle"
                if user_name:
                    self.user_statuses[user_name] = "idle"
        else:
            user_queue = []
            user_active_calls = {}
            user_status = "idle"

        # Format user's active call list
        active_list: List[Dict[str, Any]] = []
        for uuid, c_info in list(user_active_calls.items()):
            doc = db.get_call(uuid) if uuid else None
            turns = doc.get("turns", []) if doc else []
            elapsed = int(time.time() - c_info.get("started_at", time.time()))

            active_list.append({
                "call_uuid": uuid,
                "phone_number": c_info.get("phone_number", ""),
                "customer_name": c_info.get("customer_name", ""),
                "status": c_info.get("status", "in_call"),
                "batch_id": c_info.get("batch_id", ""),
                "created_by": c_info.get("created_by_name", "System"),
                "elapsed_sec": max(0, elapsed),
                "started_at": c_info.get("started_at"),
                "turns": turns,
                "transcripts": turns,
            })

        is_dialing = sum(1 for c in user_active_calls.values() if c.get("status") == "dialing")
        is_incall = sum(1 for c in user_active_calls.values() if c.get("status") == "in_call")
        pending_count = sum(1 for i in user_queue if i.get("status") == "pending")
        total_leads = len(user_queue)

        # Batch-wise metrics for user's active batch
        user_batch_id = (
            (self.user_current_batch.get(user_id) if user_id else None)
            or (self.user_current_batch.get(user_name) if user_name else None)
            or (self.user_current_batch.get(user_email) if user_email else None)
            or (user_queue[0].get("batch_id") if user_queue else None)
            or (list(user_active_calls.values())[0].get("batch_id") if user_active_calls else None)
        )
        batch_metrics = db.get_batch_metrics(user_batch_id) if user_batch_id else {}

        kpi = {
            "total": total_leads,
            "pending": pending_count,
            "dialing": is_dialing,
            "in_call": is_incall,
            "active": len(active_list),
            "channels_active": len(active_list),
            "max_concurrency": self.max_concurrency,
            "interested": batch_metrics.get("interested", 0),
            "not_interested": batch_metrics.get("not_interested", 0),
            "wrong_number": batch_metrics.get("wrong_number", 0),
            "not_talking": batch_metrics.get("not_talking", 0),
            "no_answer": batch_metrics.get("no_answer", 0),
            "dropped": batch_metrics.get("dropped", 0),
            "retry_scheduled": 0,
        }

        next_lead = next((i for i in user_queue if i["status"] == "pending"), None)

        # User-scoped last completed call
        last_completed = (
            (self.user_last_call.get(user_id) if user_id else None)
            or (self.user_last_call.get(user_name) if user_name else None)
            or (self.user_last_call.get(user_email) if user_email else None)
        )
        if not last_completed and (user_id or user_name):
            recent = db.get_recent_calls(1, user_id=user_id, is_admin=False)
            if recent:
                last_rec = recent[0]
                last_completed = {
                    "call_uuid": last_rec.get("call_uuid", ""),
                    "phone_number": last_rec.get("phone_number", ""),
                    "customer_name": last_rec.get("customer_name") or "",
                    "disposition": last_rec.get("disposition", "completed"),
                    "duration": last_rec.get("duration", 0),
                    "ended_at": last_rec.get("ended_at_epoch") or time.time(),
                    "turns": last_rec.get("turns", []),
                    "diagnostic": last_rec.get("diagnostic", {}),
                }

        return {
            "status": user_status,
            "is_running": user_status == "running",
            "is_paused": user_status == "paused",
            "running": user_status == "running",
            "paused": user_status == "paused",
            "stats": kpi,
            "kpis": kpi,
            "counts": kpi,
            "channels_active": len(active_list),
            "max_concurrency": self.max_concurrency,
            "total_queued": len(user_queue),
            "pending_count": pending_count,
            "active_calls": active_list,
            "active_call": active_list[0] if active_list else None,
            "last_completed_call": last_completed,
            "last_call": last_completed,
            "next_call": next_lead,
            "next_in_queue": next_lead,
            "did": os.getenv("FROM_NUMBER", ""),
            "selected_template_id": self.selected_template_id,
        }

    # Set active campaign template for ad-hoc dials and upcoming batches
    def set_selected_template(self, template_id: str) -> None:
        self.selected_template_id = template_id
        logger.info(f"Active campaign template set to: {template_id}")
        tpl = db.get_template(template_id)
        if self.current_batch_id and tpl:
            db.update_batch_template(
                batch_id=self.current_batch_id,
                template_id=template_id,
                template_name=tpl.get("name", template_id),
                greeting_text=tpl.get("greeting_telugu", ""),
                system_prompt=tpl.get("system_prompt", ""),
                greeting_audio_path=tpl.get("greeting_audio_path") or f"assets/greeting_{template_id}_16k.pcm",
            )

# Generate compact ISO-like timestamp string
def datetime_now_str() -> str:
    return time.strftime("%Y%m%d-%H%M%S")

dialer = OutboundDialer()
