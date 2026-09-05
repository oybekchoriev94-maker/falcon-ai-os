"""Lokal holat — oxirgi qabul qilingan record_hash zanjiri.

MUHIM: bu fayl serverdagi edge_nodes.last_event_hash bilan sinxron
turishi kerak. Fayl yo'qolsa yoki eskirsa, keyingi yuborishlar
EDGE_CHAIN_MISMATCH (409) bilan rad etiladi — shu sabab state.json'ni
muntazam zaxiralang (masalan boshqa diskka rsync).
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

GENESIS_HASH = "0" * 64


class ChainState:
    def __init__(self, state_dir: Path):
        self._path = state_dir / "state.json"
        self._lock = threading.Lock()
        self._last_hash = GENESIS_HASH
        self._load()

    def _load(self) -> None:
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
                h = str(data.get("last_record_hash", GENESIS_HASH))
                if len(h) == 64:
                    self._last_hash = h
            except (json.JSONDecodeError, OSError):
                pass  # birinchi ishga tushish yoki fayl buzilgan — genesis'dan boshlaydi

    @property
    def last_hash(self) -> str:
        with self._lock:
            return self._last_hash

    def advance(self, new_hash: str) -> None:
        """Server muvaffaqiyatli qabul qilgandan KEYIN chaqiriladi."""
        with self._lock:
            self._last_hash = new_hash
            self._save()

    def _save(self) -> None:
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"last_record_hash": self._last_hash}), encoding="utf-8")
        os.replace(tmp, self._path)  # atomik — yarim yozilgan fayl qolmaydi
