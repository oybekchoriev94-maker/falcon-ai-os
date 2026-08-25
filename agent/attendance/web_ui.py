# -*- coding: utf-8 -*-
"""
Klinika ekrani uchun mahalliy veb-server — "Face ID" dizayni shu orqali
ko'rsatiladi. Kamera va tanish agent.py'da (asosiy oqim) ishlaydi; bu
modul faqat HOLATNI (SharedState) HTTP orqali ko'rsatadi:

    GET /            -> ui/face-id.html (klinika nomi joylashtirilgan)
    GET /state.json  -> joriy holat (scanning/success/failed) + real
                         o'lchovlar (ishonch, javob vaqti, yorug'lik...)
    GET /frame.jpg    -> so'nggi aniqlangan yuz atrofidagi kesim (JPEG)

Faqat mahalliy tarmoqda (localhost) ishlashi mo'ljallangan — autentifikatsiya
yo'q, chunki bu klinika kompyuterining o'zida ochiladigan ekran, tashqi
tarmoqqa chiqarilmaydi.
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

UI_DIR = Path(__file__).parent / "ui"
INDEX_PATH = UI_DIR / "face-id.html"

SUCCESS_SHOW_SEC = 6.0
FAILED_THRESHOLD_SEC = 2.0     # shuncha vaqt uzluksiz tanilmasa -> "failed"
FAILED_RESET_GAP_SEC = 4.0     # shuncha vaqt hech qanday yuz ko'rinmasa -> tozalanadi


class SharedState:
    """agent.py asosiy siklidan yoziladi, HTTP handlerdan o'qiladi."""

    def __init__(self, clinic_name):
        self.lock = threading.Lock()
        self.clinic_name = clinic_name

        self.fid_state = "scanning"     # scanning | success | failed
        self.name = None
        self.score = 0.0
        self.visit_kind = None          # "Birinchi" | "Takroriy"
        self.event_time = None          # "HH:MM"
        self.success_until = 0.0

        self.unmatched_since = None     # time.monotonic() yoki None
        self.best_unmatched_score = 0.0

        self.light_label = "—"
        self.face_px = 0
        self.resp_ms = 0

        self.jpg = b""

    def mark_arrival(self, name, score, visit_kind, event_time):
        with self.lock:
            self.fid_state = "success"
            self.name = name
            self.score = score
            self.visit_kind = visit_kind
            self.event_time = event_time
            self.success_until = time.monotonic() + SUCCESS_SHOW_SEC
            self.unmatched_since = None
            self.best_unmatched_score = 0.0

    def update_frame_metrics(self, light_label, face_px, resp_ms,
                              matched_this_frame, unmatched_this_frame,
                              best_unmatched_score):
        now_m = time.monotonic()
        with self.lock:
            self.light_label = light_label
            self.face_px = face_px
            self.resp_ms = resp_ms

            if matched_this_frame:
                self.unmatched_since = None
                self.best_unmatched_score = 0.0
            elif unmatched_this_frame:
                if self.unmatched_since is None:
                    self.unmatched_since = now_m
                self.best_unmatched_score = max(self.best_unmatched_score, best_unmatched_score)
            elif self.unmatched_since and (now_m - self.unmatched_since) > FAILED_RESET_GAP_SEC:
                self.unmatched_since = None
                self.best_unmatched_score = 0.0

            if self.fid_state == "success" and now_m < self.success_until:
                pass
            elif self.unmatched_since and (now_m - self.unmatched_since) >= FAILED_THRESHOLD_SEC:
                self.fid_state = "failed"
            else:
                self.fid_state = "scanning"

    def set_jpg(self, data):
        if data is None:
            return
        with self.lock:
            self.jpg = data

    def to_json(self):
        with self.lock:
            unmatched_sec = 0
            if self.fid_state == "failed" and self.unmatched_since:
                unmatched_sec = int(time.monotonic() - self.unmatched_since)
            return json.dumps({
                "clinic_name": self.clinic_name,
                "fid_state": self.fid_state,
                "name": self.name,
                "score_pct": round(self.score * 100, 1),
                "visit_kind": self.visit_kind,
                "event_time": self.event_time,
                "light_label": self.light_label,
                "face_px": self.face_px,
                "resp_ms": self.resp_ms,
                "unmatched_sec": unmatched_sec,
                "best_unmatched_pct": round(self.best_unmatched_score * 100, 1),
            })

    def jpg_bytes(self):
        with self.lock:
            return self.jpg


def _make_handler(state):
    template = INDEX_PATH.read_text(encoding="utf-8")
    page = template.replace("{{CLINIC_NAME}}", state.clinic_name).encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass   # konsolni ifloslantirmaslik uchun jim

        def _send(self, code, body, content_type):
            self.send_response(code)
            if body:
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path in ("/", "/index.html"):
                self._send(200, page, "text/html; charset=utf-8")
            elif path == "/state.json":
                self._send(200, state.to_json().encode("utf-8"), "application/json")
            elif path == "/frame.jpg":
                body = state.jpg_bytes()
                self._send(200 if body else 204, body, "image/jpeg")
            else:
                self._send(404, b"not found", "text/plain")

    return Handler


def start_server(state, port=8787, log=print):
    server = ThreadingHTTPServer(("0.0.0.0", port), _make_handler(state))
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    log(f"Veb ekran: http://127.0.0.1:{port}  (klinika kompyuterida brauzerda oching)")
    return server
