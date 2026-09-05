"""Konfiguratsiya — .env va cameras.yaml ni o'qiydi, backend qabul
qiladigan formatga mos ekanini darhol tekshiradi (aniq xato bilan
ishga tushmasin, tunda birov keyin sabab qidirib yurmasin).
"""
from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from dotenv import load_dotenv

SCOPE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,63}$")


@dataclass
class Camera:
    camera_id: str
    channel: int
    zone_id: str
    display_name: str
    enabled: bool = True

    def rtsp_url(self, nvr_host: str, nvr_port: int, user: str, password: str) -> str:
        # Hikvision NVR standart RTSP yo'li: kanal + "01" (asosiy oqim, HD)
        return (
            f"rtsp://{user}:{password}@{nvr_host}:{nvr_port}"
            f"/Streaming/Channels/{self.channel}01"
        )


@dataclass
class Config:
    api_base: str
    tenant_id: str
    clinic_id: str
    node_id: str
    key_id: str
    signing_key: str

    nvr_host: str
    nvr_port: int
    nvr_user: str
    nvr_password: str

    detector_model: str
    detector_device: str
    detector_conf_threshold: float
    event_cooldown_seconds: int

    state_dir: Path
    cameras: list = field(default_factory=list)

    def enabled_cameras(self) -> list:
        return [c for c in self.cameras if c.enabled]


def _fail(message: str) -> "None":
    print(f"[CONFIG XATO] {message}", file=sys.stderr)
    sys.exit(1)


def _require_scope(name: str, value: str) -> str:
    if not value or not SCOPE_RE.match(value):
        _fail(
            f"{name}='{value}' yaroqsiz — kichik harf/raqam, 3-64 belgi, "
            "faqat '-' va '_' bilan bo'lishi shart (backend talabi)"
        )
    return value


def load_config(base_dir: Path | None = None) -> Config:
    base_dir = base_dir or Path(__file__).resolve().parent.parent
    load_dotenv(base_dir / ".env")

    api_base = os.environ.get("FALCON_API_BASE", "").rstrip("/")
    if not api_base.startswith("https://") and not api_base.startswith("http://"):
        _fail("FALCON_API_BASE to'liq URL bo'lishi shart (masalan https://falconmedai.uz)")

    tenant_id = _require_scope("FALCON_TENANT_ID", os.environ.get("FALCON_TENANT_ID", ""))
    clinic_id = _require_scope("FALCON_CLINIC_ID", os.environ.get("FALCON_CLINIC_ID", ""))
    node_id = _require_scope("FALCON_NODE_ID", os.environ.get("FALCON_NODE_ID", ""))

    key_id = os.environ.get("FALCON_KEY_ID", "").strip()
    signing_key = os.environ.get("FALCON_SIGNING_KEY", "").strip()
    if not key_id or not signing_key:
        _fail(
            "FALCON_KEY_ID / FALCON_SIGNING_KEY bo'sh — avval admin panelda "
            "node yarating (POST /api/v1/edge/nodes) va javobdagi qiymatlarni kiriting"
        )
    if not re.match(r"^[a-f0-9]{64}$", signing_key, re.IGNORECASE):
        _fail("FALCON_SIGNING_KEY 64 ta hex belgidan iborat bo'lishi shart")

    cameras_path = base_dir / "cameras.yaml"
    if not cameras_path.exists():
        _fail(f"{cameras_path} topilmadi — cameras.example.yaml'dan nusxa oling")
    raw = yaml.safe_load(cameras_path.read_text(encoding="utf-8")) or {}
    cameras = []
    seen_ids = set()
    for item in raw.get("cameras", []):
        cam_id = _require_scope("camera_id", str(item.get("camera_id", "")))
        zone_id = _require_scope("zone_id", str(item.get("zone_id", "")))
        if cam_id in seen_ids:
            _fail(f"camera_id takrorlangan: {cam_id}")
        seen_ids.add(cam_id)
        cameras.append(Camera(
            camera_id=cam_id,
            channel=int(item["channel"]),
            zone_id=zone_id,
            display_name=str(item.get("display_name", cam_id))[:120],
            enabled=bool(item.get("enabled", True)),
        ))
    if not cameras:
        _fail("cameras.yaml bo'sh — kamida bitta kamera kerak")

    state_dir = Path(os.environ.get("STATE_DIR", "./state")).resolve()
    state_dir.mkdir(parents=True, exist_ok=True)

    return Config(
        api_base=api_base,
        tenant_id=tenant_id,
        clinic_id=clinic_id,
        node_id=node_id,
        key_id=key_id,
        signing_key=signing_key,
        nvr_host=os.environ.get("NVR_HOST", ""),
        nvr_port=int(os.environ.get("NVR_PORT", "554")),
        nvr_user=os.environ.get("NVR_USER", ""),
        nvr_password=os.environ.get("NVR_PASSWORD", ""),
        detector_model=os.environ.get("DETECTOR_MODEL", "yolov8n.pt"),
        detector_device=os.environ.get("DETECTOR_DEVICE", "cuda:0"),
        detector_conf_threshold=float(os.environ.get("DETECTOR_CONF_THRESHOLD", "0.5")),
        event_cooldown_seconds=int(os.environ.get("EVENT_COOLDOWN_SECONDS", "60")),
        state_dir=state_dir,
        cameras=cameras,
    )
