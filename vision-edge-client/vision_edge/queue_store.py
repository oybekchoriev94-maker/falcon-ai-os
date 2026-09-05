"""Durable outbox — internet uzilsa ham hodisalar yo'qolmasin.

Hash zanjiri GLOBAL (bitta node uchun bitta ketma-ketlik, kamera
bo'yicha emas), shuning uchun yozish bitta lock ostida ketma-ket
bo'ladi: har yangi hodisaga previous_hash = shu paytgacha
TAYINLANGAN (hali serverga tasdiqlanmagan bo'lishi mumkin) oxirgi
hash beriladi. Server tasdiqlagandan keyingina ChainState'ga
"confirmed" deb yoziladi (backend/routes/edge.js bilan bir xil
davomiylik talabi).
"""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

from .events import Detection, build_event
from .state import ChainState


class Outbox:
    def __init__(self, state_dir: Path, chain_state: ChainState):
        self._lock = threading.Lock()
        self._chain = chain_state
        self._db_path = state_dir / "outbox.sqlite3"
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS outbox (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL,
                record_hash TEXT NOT NULL,
                payload TEXT NOT NULL
            )"""
        )
        self._conn.commit()
        self._pending_head = self._resume_head()

    def _resume_head(self) -> str:
        row = self._conn.execute(
            "SELECT record_hash FROM outbox ORDER BY seq DESC LIMIT 1"
        ).fetchone()
        return row[0] if row else self._chain.last_hash

    def enqueue(self, detection: Detection, *, tenant_id: str, clinic_id: str,
                node_id: str, model_version: str) -> None:
        with self._lock:
            event = build_event(
                detection=detection,
                tenant_id=tenant_id,
                clinic_id=clinic_id,
                node_id=node_id,
                model_version=model_version,
                previous_hash=self._pending_head,
            )
            self._conn.execute(
                "INSERT INTO outbox (event_id, record_hash, payload) VALUES (?, ?, ?)",
                (event["id"], event["record_hash"], json.dumps(event)),
            )
            self._conn.commit()
            self._pending_head = event["record_hash"]

    def peek_batch(self, limit: int = 200) -> list[tuple[int, dict]]:
        rows = self._conn.execute(
            "SELECT seq, payload FROM outbox ORDER BY seq ASC LIMIT ?", (limit,)
        ).fetchall()
        return [(seq, json.loads(payload)) for seq, payload in rows]

    def confirm_sent(self, seqs: list[int], last_record_hash: str) -> None:
        """Server 200 qaytargandan KEYIN chaqiriladi — shu batch outbox'dan
        o'chadi va rasmiy zanjir holati (ChainState) shu yerga siljiydi.
        """
        with self._lock:
            self._conn.executemany(
                "DELETE FROM outbox WHERE seq = ?", [(s,) for s in seqs]
            )
            self._conn.commit()
            self._chain.advance(last_record_hash)

    def pending_count(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]
