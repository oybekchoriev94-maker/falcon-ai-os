"""Falcon Vision Edge — asosiy jarayon.

Ishga tushirish:
    python -m vision_edge.main

Uch qism parallel ishlaydi:
  1. Har bir yoqilgan kamera uchun RTSP o'qish thread'i (detector.CameraStream)
  2. Bitta aniqlash tsikli — navbat bilan har kamerani tekshiradi,
     odam topilsa (va cooldown o'tgan bo'lsa) Outbox'ga yozadi
  3. Yuboruvchi tsikli — Outbox'dagi hodisalarni kichik partiyalarda
     serverga jo'natadi, muvaffaqiyatli bo'lsa ChainState'ni siljitadi
"""
from __future__ import annotations

import logging
import sys
import threading
import time
from pathlib import Path

from .api_client import EdgeApiError, FalconEdgeClient
from .config import load_config
from .detector import CameraStream, PersonDetector
from .events import Detection
from .queue_store import Outbox
from .state import ChainState

DETECT_INTERVAL_SECONDS = 2
SEND_INTERVAL_SECONDS = 5
SEND_BATCH_SIZE = 20

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("vision_edge.main")


def run() -> None:
    cfg = load_config(Path(__file__).resolve().parent.parent)
    cameras = cfg.enabled_cameras()
    if not cameras:
        logger.error("Yoqilgan kamera yo'q — cameras.yaml'ni tekshiring")
        sys.exit(1)

    client = FalconEdgeClient(cfg)
    try:
        client.register(cameras)
    except EdgeApiError as e:
        logger.error("Ro'yxatdan o'tish muvaffaqiyatsiz: %s (kod: %s)", e, e.code)
        sys.exit(1)

    chain = ChainState(cfg.state_dir)
    outbox = Outbox(cfg.state_dir, chain)

    logger.info("Model yuklanmoqda: %s (%s)...", cfg.detector_model, cfg.detector_device)
    detector = PersonDetector(cfg.detector_model, cfg.detector_device, cfg.detector_conf_threshold)

    streams: dict[str, CameraStream] = {}
    for cam in cameras:
        url = cam.rtsp_url(cfg.nvr_host, cfg.nvr_port, cfg.nvr_user, cfg.nvr_password)
        stream = CameraStream(cam.camera_id, url)
        stream.start()
        streams[cam.camera_id] = stream
    logger.info("%d ta kamera ishga tushdi", len(streams))

    last_event_at: dict[str, float] = {}

    def detect_one(cam) -> None:
        frame = streams[cam.camera_id].latest_frame()
        if frame is None:
            return
        result = detector.detect(frame)
        if not result.found:
            return
        now = time.monotonic()
        cooldown_key = f"{cam.camera_id}|{cam.zone_id}"
        if now - last_event_at.get(cooldown_key, 0) < cfg.event_cooldown_seconds:
            return
        last_event_at[cooldown_key] = now
        detection = Detection(
            camera_id=cam.camera_id,
            zone_id=cam.zone_id,
            event_type="zone.person_detected",
            confidence=result.confidence,
            subject_ref=None,  # v1: shaxs aniqlanmaydi, faqat mavjudlik
            metadata={"bbox": [round(x, 1) for x in result.bbox]} if result.bbox else {},
        )
        outbox.enqueue(
            detection,
            tenant_id=cfg.tenant_id, clinic_id=cfg.clinic_id,
            node_id=cfg.node_id, model_version=detector.model_version,
        )
        logger.info("[%s] odam aniqlandi (conf=%.2f, zona=%s)",
                    cam.camera_id, result.confidence, cam.zone_id)

    def detect_loop() -> None:
        while True:
            for cam in cameras:
                try:
                    detect_one(cam)
                except Exception:  # noqa: BLE001 — bitta kamera xatosi butun tsiklni to'xtatmasin
                    logger.exception("[%s] aniqlashda xato", cam.camera_id)
            time.sleep(DETECT_INTERVAL_SECONDS)

    def send_loop() -> None:
        backoff_until = 0.0
        while True:
            time.sleep(SEND_INTERVAL_SECONDS)
            if time.monotonic() < backoff_until:
                continue
            batch = outbox.peek_batch(SEND_BATCH_SIZE)
            if not batch:
                continue
            seqs = [seq for seq, _ in batch]
            events = [payload for _, payload in batch]
            try:
                client.send_batch(events)
                outbox.confirm_sent(seqs, events[-1]["record_hash"])
                logger.info("%d ta hodisa yuborildi (%d navbatda qoldi)",
                            len(events), outbox.pending_count())
            except EdgeApiError as e:
                if e.code in ("EDGE_CHAIN_MISMATCH", "EDGE_DEDUP_CONFLICT"):
                    # Ikkalasi ham lokal holat serverdan uzilib qolgani belgisi —
                    # taxmin bilan "tuzatish" chain'ni yanada buzishi mumkin, shu
                    # sabab outbox'ga tegilmaydi, faqat operator e'tiboriga chiqadi.
                    logger.critical(
                        "ZANJIR/DEDUP NOMOSLIGI (%s) — state.json server bilan "
                        "sinxron emas. Qo'lda tekshiring (state.json'ni zaxiradan "
                        "tiklang yoki admin bilan bog'laning). 5 daqiqadan keyin "
                        "qayta urinadi, navbat saqlanadi.", e.code,
                    )
                    backoff_until = time.monotonic() + 300
                else:
                    logger.error("Yuborish xatosi: %s (kod: %s)", e, e.code)
                    backoff_until = time.monotonic() + 30
            except Exception:  # noqa: BLE001 — oqim hech qachon jim o'lib qolmasin
                logger.exception("Kutilmagan xato yuborish tsiklida")
                backoff_until = time.monotonic() + 30

    threading.Thread(target=detect_loop, daemon=True, name="detect").start()
    threading.Thread(target=send_loop, daemon=True, name="send").start()

    logger.info("Falcon Vision Edge ishga tushdi (node=%s)", cfg.node_id)
    while True:
        time.sleep(60)


if __name__ == "__main__":
    run()
