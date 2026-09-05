"""vision_events yozuvini backend/routes/edge.js'dagi eventSchema'ga
AYNAN mos qilib quradi (zod .strict() — ortiqcha yoki yetishmagan
maydon bo'lsa server butun batchni rad etadi).
"""
from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def compute_record_hash(*, previous_hash: str, event_id: str, camera_id: str,
                         zone_id: str, event_type: str, subject_ref: str | None,
                         occurred_at: str) -> str:
    canonical = "|".join([
        previous_hash, event_id, camera_id, zone_id, event_type,
        subject_ref or "", occurred_at,
    ])
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass
class Detection:
    camera_id: str
    zone_id: str
    event_type: str  # masalan 'zone.person_detected'
    confidence: float
    subject_ref: str | None = None
    metadata: dict | None = None


def build_event(
    *,
    detection: Detection,
    tenant_id: str,
    clinic_id: str,
    node_id: str,
    model_version: str,
    previous_hash: str,
) -> dict:
    """Bitta detection'ni to'liq vision_event ga aylantiradi va
    hash zanjirini davom ettiradi (previous_hash -> record_hash).
    """
    event_id = str(uuid.uuid4())
    occurred_at = now_iso()
    received_at = now_iso()
    metadata = dict(detection.metadata or {})

    record_hash = compute_record_hash(
        previous_hash=previous_hash,
        event_id=event_id,
        camera_id=detection.camera_id,
        zone_id=detection.zone_id,
        event_type=detection.event_type,
        subject_ref=detection.subject_ref,
        occurred_at=occurred_at,
    )

    # Bitta jismoniy hodisa ikki marta yuborilsa (masalan detektor xatosi)
    # server buni bir xil dedup_key orqali rad etadi — soniya aniqligida.
    epoch_ms = int(datetime.fromisoformat(occurred_at).timestamp() * 1000)
    dedup_key = f"{detection.camera_id}|{detection.zone_id}|{detection.event_type}|{epoch_ms}"

    return {
        "id": event_id,
        "tenant_id": tenant_id,
        "clinic_id": clinic_id,
        "node_id": node_id,
        "camera_id": detection.camera_id,
        "zone_id": detection.zone_id,
        "event_type": detection.event_type,
        "subject_ref": detection.subject_ref,
        "confidence": round(float(detection.confidence), 5),
        "occurred_at": occurred_at,
        "received_at": received_at,
        "model_version": model_version,
        "evidence_sha256": None,
        "dedup_key": dedup_key,
        "metadata": metadata,
        "previous_hash": previous_hash,
        "record_hash": record_hash,
    }


def canonical_json(payload: dict) -> bytes:
    """Sorted-key, bo'shliqsiz JSON — hujjatdagi talab. Body hash shu
    baytlar ustida hisoblanadi va aynan shu baytlar yuboriladi.
    """
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
