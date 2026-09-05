"""Falcon Edge sync API klienti — /api/edge/v1/nodes/register va
/api/edge/v1/events/batch (docs/edge-vision-integration.md).
"""
from __future__ import annotations

import logging
import time

import requests

from .config import Config
from .events import canonical_json, now_iso
from .signing import sign_request

logger = logging.getLogger("vision_edge.api")

REGISTER_PATH = "/api/edge/v1/nodes/register"
BATCH_PATH = "/api/edge/v1/events/batch"
MAX_RETRIES = 5
RETRY_BASE_SECONDS = 2


class EdgeApiError(Exception):
    def __init__(self, message: str, status: int | None = None, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


class FalconEdgeClient:
    def __init__(self, config: Config):
        self._cfg = config
        self._session = requests.Session()

    def _post(self, path: str, payload: dict, timeout: float = 15.0) -> dict:
        body = canonical_json(payload)
        signed = sign_request(
            signing_key=self._cfg.signing_key,
            method="POST",
            path=path,
            body=body,
            tenant_id=self._cfg.tenant_id,
            clinic_id=self._cfg.clinic_id,
            node_id=self._cfg.node_id,
            key_id=self._cfg.key_id,
        )
        url = f"{self._cfg.api_base}{path}"
        resp = self._session.post(url, data=body, headers=signed.headers, timeout=timeout)
        if resp.status_code >= 400:
            try:
                detail = resp.json()
            except ValueError:
                detail = {"error": resp.text[:300]}
            raise EdgeApiError(
                detail.get("error", f"HTTP {resp.status_code}"),
                status=resp.status_code,
                code=detail.get("code"),
            )
        return resp.json()

    def _post_with_retry(self, path: str, payload: dict) -> dict:
        last_error: Exception | None = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                return self._post(path, payload)
            except EdgeApiError as e:
                # 4xx (401/403/409 chain mismatch va h.k.) qayta urinishdan
                # foyda bermaydi — operator e'tiboriga darhol chiqarish kerak.
                if e.status and 400 <= e.status < 500:
                    raise
                last_error = e
            except requests.RequestException as e:
                last_error = e
            wait = RETRY_BASE_SECONDS * (2 ** (attempt - 1))
            logger.warning("So'rov muvaffaqiyatsiz (%s/%s), %ss kutish: %s",
                            attempt, MAX_RETRIES, wait, last_error)
            time.sleep(wait)
        # Chaqiruvchilar faqat EdgeApiError'ni tutadi — tarmoq xatosi ham
        # shu turga o'raladi, aks holda yuboruvchi tsikl butunlay to'xtab qoladi.
        if isinstance(last_error, EdgeApiError):
            raise last_error
        raise EdgeApiError(f"Tarmoq xatosi: {last_error}") from last_error

    def register(self, cameras: list) -> None:
        ts = now_iso()
        payload = {
            "tenant_id": self._cfg.tenant_id,
            "clinic_id": self._cfg.clinic_id,
            "node_id": self._cfg.node_id,
            "software_version": "1.0.0",
            "capabilities": ["person_detection", "zone_presence"],
            "cameras": [
                {
                    "camera_id": c.camera_id,
                    "channel": c.channel,
                    "zone_id": c.zone_id,
                    "display_name": c.display_name,
                    "enabled": c.enabled,
                    "vendor": "hikvision",
                    "created_at": ts,
                    "updated_at": ts,
                }
                for c in cameras
            ],
        }
        self._post_with_retry(REGISTER_PATH, payload)
        logger.info("Node ro'yxatdan o'tdi: %s (%d kamera)", self._cfg.node_id, len(cameras))

    def send_batch(self, events: list) -> None:
        self._post_with_retry(BATCH_PATH, {"events": events})
