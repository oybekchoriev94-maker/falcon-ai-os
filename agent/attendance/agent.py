# -*- coding: utf-8 -*-
"""
Davomat agenti — Rapoo (yoki istalgan USB) web-kamera.
XODIMLAR va BEMORLAR: faces/ papkada oddiy ism — xodim,
"bemor_" prefiksi bilan — bemor (masalan faces/bemor_Alisher Karim/).

OQIM:
    kamera -> yuz aniqlash -> tanish -> multi-frame tasdiq +
    liveness -> keldi/ketdi -> navbat -> server

Face ID v2 (PR #10): hodisa bilan birga frame_count va liveness_score
ketadi; server ularni qayta tekshiradi. Bemor keldi -> bugungi bron
avtomatik check-in bo'ladi (server tomonida).

MUHIM QOIDA: yuz shablonlari (data/faces_db.json) SHU KOMPYUTERDA
qoladi. Serverga faqat {ism, yo'nalish, vaqt, metadata} yuboriladi.

Internet uzilsa agent ishlashda davom etadi va hodisalarni
data/queue.jsonl ga yozadi; aloqa tiklangach jo'natadi.

Ishga tushirish:
    python agent.py
    python agent.py --preview     # oynada ko'rsatadi (sozlash uchun)
"""
import argparse
import json
import os
import sys
import time
from collections import deque
from datetime import datetime, date

import cv2
import numpy as np

import faces as faces_mod
import liveness as liveness_mod
import web_ui

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
DATA_DIR = os.path.join(BASE_DIR, "data")
QUEUE_PATH = os.path.join(DATA_DIR, "queue.jsonl")
STATE_PATH = os.path.join(DATA_DIR, "state.json")
LOG_PATH = os.path.join(DATA_DIR, "agent.log")

os.makedirs(DATA_DIR, exist_ok=True)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def log(msg):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def load_config():
    if not os.path.exists(CONFIG_PATH):
        raise SystemExit(
            "config.json topilmadi.\n"
            "  cp config.example.json config.json\n"
            "  keyin server manzili va tokenni yozing."
        )
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# Face ID v2: papka nomi orqali subyekt turi. Bemorlar uchun papka
# "bemor_" prefiksi bilan ataladi: faces/bemor_Alisher Karim/...
PATIENT_PREFIXES = ("bemor_", "bemor:")


def parse_subject(name):
    """(subject_type, toza ism) qaytaradi."""
    for pref in PATIENT_PREFIXES:
        if name.lower().startswith(pref):
            rest = name[len(pref):].strip()
            return "patient", (rest or name)
    return "staff", name


# ── Kamera ────────────────────────────────────────────────────

class Camera:
    """USB web-kamera. Eskirgan kadrni bermasligi uchun bufer 1 va
    retrieve oldidan bir necha grab qilinadi.

    BACKEND TANLASH: ba'zi kameralar (masalan Rapoo'ning ba'zi modellari)
    DirectShow ostida ochiladi-yu, lekin qop-qora kadr qaytaradi — shu
    bilan birga Windows'ning o'z Camera ilovasi (Media Foundation
    ishlatadi) bemalol ko'rsatadi. Shuning uchun bir nechta backend
    ketma-ket sinaladi va birinchi QORA BO'LMAGAN kadr beradigani
    tanlanadi."""

    def __init__(self, device, width, height):
        if sys.platform.startswith("win"):
            candidates = [("DSHOW", cv2.CAP_DSHOW), ("MSMF", cv2.CAP_MSMF), ("AUTO", cv2.CAP_ANY)]
        else:
            candidates = [("V4L2", cv2.CAP_V4L2), ("AUTO", cv2.CAP_ANY)]

        self.cap = None
        tried = []
        for name, backend in candidates:
            cap = cv2.VideoCapture(device, backend)
            if not cap.isOpened():
                cap.release()
                tried.append(f"{name}(ochilmadi)")
                continue

            cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except Exception:
                pass
            for _ in range(5):
                cap.grab()                            # isitish

            ok, probe = cap.read()
            if ok and probe is not None and float(probe.mean()) >= 3.0:
                self.cap = cap
                log(f"Kamera {device}: {name} backend orqali ochildi")
                break

            tried.append(f"{name}(qora kadr)")
            cap.release()

        if self.cap is None:
            raise RuntimeError(
                f"Kamera {device} hech qanday backend bilan ishlamadi "
                f"(sinaldi: {', '.join(tried) or '-'}). "
                f"Kamera boshqa dastur tomonidan band qilinganini yoki "
                f"qopqog'i yopiqligini tekshiring."
            )

        w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        log(f"  {w}x{h}")
        if w < width:
            log(f"  ! So'ralgan {width}px berilmadi. Yuz kichik chiqishi mumkin.")

    def read(self):
        for _ in range(2):
            self.cap.grab()
        ok, frame = self.cap.retrieve()
        return frame if ok else None

    def release(self):
        try:
            self.cap.release()
        except Exception:
            pass


# ── Davomat ───────────────────────────────────────────────────

class Attendance:
    """
    Keldi/ketdi mantig'i.

    KELDI — odam tanildi va hozir "yo'q" holatida edi.
      Tasodifiy noto'g'ri tanishdan himoya: ism `confirm_frames` marta
      ketma-ket ko'rinishi kerak. Bitta xato kadr davomat yozmaydi.

      Face ID v2 (PR #10): tasdiqlash oynasidagi kadrlardan LIVENESS
      ham hisoblanadi — yuz markazining siljishi. Foto/qog'ozdagi yuz
      harakatsiz, jonli odamniki siljiydi. Ball hodisada serverga
      ketadi; server uni qayta tekshiradi (flag, o'chirish emas).

    KETDI — odam `absence_timeout` soniya ko'rinmadi.
      Vaqt sifatida OXIRGI KO'RINGAN payt yoziladi (hozirgi emas) —
      aks holda hamma "ketdi" vaqti bir xil chiqadi.
    """

    def __init__(self, cfg, on_event):
        a = cfg["attendance"]
        self.absence_timeout = a.get("absence_timeout_sec", 180)
        self.confirm_frames = a.get("confirm_frames", 3)
        self.confirm_window = a.get("confirm_window_sec", 10)
        self.liveness_threshold = a.get("liveness_threshold",
                                        liveness_mod.MOTION_THRESHOLD)
        self.on_event = on_event

        self.today = date.today().isoformat()
        self.people = {}                  # ism -> holat
        self.recent = {}                  # ism -> ko'rilgan vaqtlar (deque)
        # ism -> [(vaqt, cx, cy, w)] — liveness uchun yuz kuzatuvlari
        self.obs = {}

    def _st(self, name):
        return self.people.setdefault(
            name, {"present": False, "last_seen": 0.0, "first_in": None, "arrivals": 0})

    def roll_day(self):
        today = date.today().isoformat()
        if today == self.today:
            return
        # Kun almashdi — ichkarida qolganlarni yopamiz
        for name, st in self.people.items():
            if st["present"]:
                st["present"] = False
                self.on_event(name, "out", datetime.fromtimestamp(st["last_seen"]), None)
        log(f"Yangi kun: {today}")
        self.today = today
        for st in self.people.values():
            st.update({"present": False, "first_in": None, "arrivals": 0, "last_seen": 0.0})
        self.recent.clear()
        self.obs.clear()

    def seen(self, name, now, score, bbox=None, subject_type="staff"):
        """Yuz tanildi. Tasdiqlangandan keyingina 'keldi' yoziladi."""
        st = self._st(name)
        st["last_seen"] = now
        st["subject_type"] = subject_type

        # Liveness kuzatuvlari — tasdiqlash oynasiga mos saqlanadi
        if bbox is not None:
            x, y, w, h = [float(v) for v in bbox[:4]]
            dq_obs = self.obs.setdefault(name, deque(maxlen=self.confirm_frames * 3))
            dq_obs.append((now, x + w / 2, y + h / 2, w))

        if st["present"]:
            return

        dq = self.recent.setdefault(name, deque(maxlen=self.confirm_frames * 3))
        dq.append(now)
        # Oynadan tashqaridagilarni tashlaymiz
        while dq and (now - dq[0]) > self.confirm_window:
            dq.popleft()

        if len(dq) < self.confirm_frames:
            return

        st["present"] = True
        st["arrivals"] += 1
        when = datetime.now()
        if st["first_in"] is None:
            st["first_in"] = when.isoformat(timespec="seconds")
        dq.clear()

        # Multi-frame + liveness metadata (server qayta tekshiradi)
        frames = [o for o in self.obs.get(name, []) if (now - o[0]) <= self.confirm_window]
        liv = liveness_mod.compute_liveness(frames, threshold=self.liveness_threshold)
        meta = {
            "subject_type": subject_type,
            "frame_count": len(frames),
            "liveness_score": liv["score"],
            "liveness_ok": liv["ok"],
        }
        if self.obs.get(name) is not None:
            self.obs[name].clear()

        kind = "XODIM" if subject_type == "staff" else "BEMOR"
        live_mark = "jonli" if liv["ok"] else f"liveness past ({liv['score']:.3f})"
        log(f"KELDI [{kind}]: {name}  {when.strftime('%H:%M:%S')}  "
            f"({len(frames)} kadr, {live_mark}, o'xshashlik {score:.2f})")
        self.on_event(name, "in", when, score, meta)

    def tick(self, now):
        for name, st in self.people.items():
            if st["present"] and (now - st["last_seen"]) > self.absence_timeout:
                st["present"] = False
                when = datetime.fromtimestamp(st["last_seen"])
                log(f"KETDI: {name}  {when.strftime('%H:%M:%S')}")
                self.on_event(name, "out", when, None)

    def snapshot(self):
        return {
            "date": self.today,
            "updated": datetime.now().isoformat(timespec="seconds"),
            "present": sorted(n for n, s in self.people.items() if s["present"]),
            "arrived_today": sorted(n for n, s in self.people.items() if s["arrivals"] > 0),
        }


# ── Serverga yuborish ─────────────────────────────────────────

class Sender:
    """
    Hodisalarni navbatga yozadi va to'plam bo'lib jo'natadi.

    Navbat diskda (queue.jsonl) — agent qayta ishga tushsa ham
    yuborilmagan hodisalar yo'qolmaydi. Yuborilgach fayl qayta
    yoziladi (faqat qolganlari bilan).
    """

    # Token yo'q bo'lsa — SINOV rejimi: hodisalar navbatga yoziladi,
    # serverga urinilmaydi. Klinika kompyuteriga qo'yishdan oldin
    # tanishni tekshirib olish uchun.
    PLACEHOLDER = "BU_YERGA_TOKEN"

    def __init__(self, cfg):
        s = cfg["server"]
        self.url = s["url"].rstrip("/") + "/api/attendance/events"
        self.token = (s.get("device_token") or "").strip()
        self.offline = (not self.token) or self.token == self.PLACEHOLDER
        self.batch = s.get("batch_size", 50)
        self.interval = s.get("send_interval_sec", 20)
        self.timeout = s.get("timeout_sec", 15)
        self.last_send = 0.0
        self.queue = self._load()

        if self.offline:
            log("SINOV REJIMI — token yo'q, serverga yuborilmaydi.")
            log("  Hodisalar data/queue.jsonl ga yoziladi.")
        if self.queue:
            log(f"Navbatda {len(self.queue)} ta yuborilmagan hodisa")

    def _load(self):
        if not os.path.exists(QUEUE_PATH):
            return []
        out = []
        with open(QUEUE_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        return out

    def _persist(self):
        tmp = QUEUE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            for ev in self.queue:
                f.write(json.dumps(ev, ensure_ascii=False) + "\n")
        os.replace(tmp, QUEUE_PATH)

    def add(self, name, direction, when, score, meta=None):
        ev = {
            "person_name": name,
            "direction": direction,
            "occurred_at": when.astimezone().isoformat(timespec="seconds"),
        }
        if score is not None:
            ev["confidence"] = round(float(score), 3)
        if meta:
            # Face ID v2: server shu metadata'ni qayta tekshiradi
            ev["subject_type"] = meta.get("subject_type", "staff")
            if meta.get("frame_count"):
                ev["frame_count"] = int(meta["frame_count"])
            if meta.get("liveness_score") is not None:
                ev["liveness_score"] = float(meta["liveness_score"])
            if meta.get("liveness_ok") is not None:
                ev["liveness_ok"] = bool(meta["liveness_ok"])
        self.queue.append(ev)
        self._persist()

    def flush(self, force=False):
        # Sinov rejimida hodisalar faqat navbatda turadi
        if self.offline or not self.queue:
            return
        now = time.time()
        if not force and (now - self.last_send) < self.interval:
            return
        self.last_send = now

        import requests
        chunk = self.queue[: self.batch]
        try:
            r = requests.post(
                self.url,
                json={"events": chunk},
                headers={"X-Kiosk-Token": self.token},
                timeout=self.timeout,
            )
            if r.status_code == 200:
                data = r.json()
                self.queue = self.queue[len(chunk):]
                self._persist()
                log(f"Yuborildi: {data.get('accepted', 0)} ta "
                    f"(takror {data.get('duplicates', 0)}), navbatda {len(self.queue)}")
            elif r.status_code in (401, 403):
                # Token yaroqsiz — qayta urinish foydasiz, lekin hodisalarni
                # SAQLAB qolamiz: token tuzatilgach yuboriladi.
                log(f"Token rad etildi ({r.status_code}). Panelda tokenni tekshiring.")
            else:
                log(f"Server {r.status_code}: {r.text[:120]}")
        except Exception as e:
            log(f"Yuborilmadi ({type(e).__name__}) — navbatda {len(self.queue)} ta")


# ── Klinika ekrani (--preview) ───────────────────────────────
#
# Klinika kompyuterida doim ekranda turadigan oyna: chapda kamera,
# o'ngda ma'lumot paneli (klinika nomi, soat, so'nggi hodisa, hozir
# ichkaridagilar ro'yxati). cv2.putText faqat ASCII-ga yaqin belgilarni
# chizadi — shuning uchun panel matnlari oddiy lotin harflari bilan.

WINDOW_NAME = "Davomat"
FONT = cv2.FONT_HERSHEY_SIMPLEX
PANEL_W = 420
WELCOME_SHOW_SEC = 6.0
DISPLAY_CAM_W = 960


def _text(img, s, org, scale, color, thick=1):
    cv2.putText(img, s, org, FONT, scale, color, thick, cv2.LINE_AA)


def _light_label(frame):
    m = float(frame.mean())
    if m < 40:
        return "Past"
    if m < 120:
        return "O'rta"
    return "Yaxshi"


def _crop_face_jpg(frame, face_row, pad=0.7, size=360):
    """Yuz atrofidan kvadrat kesim oladi va JPEG baytlarga aylantiradi —
    veb ekrandagi doiraviy rasm shu bilan to'ldiriladi."""
    x, y, w, h = [int(v) for v in face_row[:4]]
    cx, cy = x + w / 2, y + h / 2
    half = int(max(w, h) * (1 + pad) / 2)
    fh, fw = frame.shape[:2]
    x0, y0 = max(0, int(cx - half)), max(0, int(cy - half))
    x1, y1 = min(fw, int(cx + half)), min(fh, int(cy + half))
    if x1 <= x0 or y1 <= y0:
        return None
    crop = frame[y0:y1, x0:x1]
    crop = cv2.resize(crop, (size, size))
    ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 78])
    return buf.tobytes() if ok else None


def compose_ui(cam_frame, att, sender, last_event, clinic_name):
    """Kamera kadri + o'ng panelni bitta canvasga birlashtiradi."""
    ch, cw = cam_frame.shape[:2]
    disp_h = int(DISPLAY_CAM_W * ch / cw) if cw else ch
    cam_disp = cv2.resize(cam_frame, (DISPLAY_CAM_W, disp_h))

    canvas_h = max(disp_h, 680)
    canvas = np.full((canvas_h, DISPLAY_CAM_W + PANEL_W, 3), (22, 22, 26), dtype=np.uint8)

    y_off = (canvas_h - disp_h) // 2
    canvas[y_off:y_off + disp_h, 0:DISPLAY_CAM_W] = cam_disp

    px = DISPLAY_CAM_W + 26
    pr = DISPLAY_CAM_W + PANEL_W - 20
    py = 46

    _text(canvas, clinic_name, (px, py), 0.75, (245, 245, 248), 2)
    py += 16
    cv2.line(canvas, (px, py), (pr, py), (58, 58, 64), 1)
    py += 46

    now_dt = datetime.now()
    _text(canvas, now_dt.strftime("%H:%M:%S"), (px, py), 1.1, (255, 255, 255), 2)
    py += 28
    _text(canvas, now_dt.strftime("%d.%m.%Y"), (px, py), 0.55, (165, 165, 172), 1)
    py += 46

    # So'nggi hodisa — bir necha soniya ko'rinib turadi
    if last_event["name"] and (time.time() - last_event["at"]) < WELCOME_SHOW_SEC:
        is_in = last_event["direction"] == "in"
        bg = (34, 46, 36) if is_in else (34, 38, 46)
        fg = (110, 225, 150) if is_in else (150, 180, 230)
        cv2.rectangle(canvas, (px - 14, py - 30), (pr, py + 42), bg, -1)
        _text(canvas, "Xush kelibsiz" if is_in else "Xayr", (px, py), 0.62, fg, 2)
        py += 32
        _text(canvas, last_event["name"], (px, py), 0.85, (255, 255, 255), 2)
        py += 40
        py += 16

    py += 8
    present = att.snapshot()["present"]
    _text(canvas, f"HOZIR ICHKARIDA ({len(present)})", (px, py), 0.5, (150, 150, 158), 1)
    py += 30
    if not present:
        _text(canvas, "- hech kim yo'q -", (px, py), 0.55, (110, 110, 118), 1)
        py += 26
    else:
        for name in present[:14]:
            cv2.circle(canvas, (px + 5, py - 5), 4, (110, 225, 150), -1)
            _text(canvas, name, (px + 20, py), 0.58, (222, 222, 228), 1)
            py += 30

    # Pastki holat qatori
    sy = canvas_h - 26
    if sender.offline:
        _text(canvas, "SINOV REJIMI", (px, sy), 0.5, (120, 170, 235), 1)
    else:
        _text(canvas, "ONLAYN", (px, sy), 0.5, (110, 225, 150), 1)
        if sender.queue:
            _text(canvas, f"navbatda: {len(sender.queue)}", (px + 130, sy), 0.48, (165, 165, 172), 1)

    return canvas


def write_state(att, online, faces_in_frame, enrolled, detected_raw=0, too_small=0):
    state = att.snapshot()
    state.update({
        "online": online,
        "enrolled": enrolled,
        # faces_in_frame — o'lchov filtridan o'tganlari (tanishga ketganlari)
        "faces_in_frame": faces_in_frame,
        # Diagnostika: "yuz yo'q" va "yuz kichik" ni ajratish uchun
        "detected_raw": detected_raw,
        "too_small": too_small,
    })
    tmp = STATE_PATH + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
        os.replace(tmp, STATE_PATH)
    except Exception:
        pass


# ── Asosiy sikl ───────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="OpenCV oynada ko'rsatish (sozlash uchun)")
    ap.add_argument("--fullscreen", action="store_true", help="--preview bilan: to'liq ekran")
    ap.add_argument("--web", action="store_true", help="klinika ekrani — brauzerda ochiladigan Face ID sahifasi")
    ap.add_argument("--web-port", type=int, default=8787, help="--web uchun port (standart 8787)")
    args = ap.parse_args()

    cfg = load_config()
    cam_cfg = cfg["camera"]
    fcfg = cfg["faces"]
    clinic_name = cfg.get("display", {}).get("clinic_name") or "Klinika"

    engine = faces_mod.FaceEngine(
        score_thresh=fcfg.get("det_score", 0.7),
        cosine_thresh=fcfg.get("cosine_threshold", faces_mod.COSINE_THRESHOLD),
        log=log,
    )
    db_mat, db_names, db_sig = faces_mod.load_db()
    if db_mat is None:
        log("Yuz bazasi bo'sh. Avval: python enroll.py")
    else:
        log(f"Bazada {len(set(db_names))} ta odam ({len(db_names)} surat)")

    sender = Sender(cfg)

    # Ekranda "Xush kelibsiz/Xayr" banneri uchun — Attendance hodisa
    # chiqarganda serverga yuborish BILAN BIRGA shu holatni yangilaymiz.
    last_event = {"name": None, "direction": None, "at": 0.0}

    web_state = web_ui.SharedState(clinic_name) if args.web else None

    def ui_event(name, direction, when, score, meta=None):
        sender.add(name, direction, when, score, meta)
        last_event["name"] = name
        last_event["direction"] = direction
        last_event["at"] = time.time()
        if web_state is not None and direction == "in":
            arrivals = att.people.get(name, {}).get("arrivals", 1)
            if (meta or {}).get("subject_type") == "patient":
                visit_kind = "Bemor"
            else:
                visit_kind = "Birinchi" if arrivals <= 1 else "Takroriy"
            web_state.mark_arrival(name, score, visit_kind, when.strftime("%H:%M"))

    att = Attendance(cfg, on_event=ui_event)

    if web_state is not None:
        web_ui.start_server(web_state, port=args.web_port, log=log)

    cam = Camera(cam_cfg["device"], cam_cfg.get("width", 1920), cam_cfg.get("height", 1080))
    process_width = cam_cfg.get("process_width", 960)
    min_face = fcfg.get("min_face_px", 80)
    poll = cfg.get("poll_interval_sec", 0.3)

    log(f"Boshlandi. Minimal yuz: {min_face}px, chegara: {engine.cosine_thresh}")
    log("To'xtatish: Ctrl+C")

    if args.preview:
        cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
        if args.fullscreen:
            cv2.setWindowProperty(WINDOW_NAME, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

    last_sig_check = 0.0
    last_hint = 0.0
    fail_streak = 0

    try:
        while True:
            loop_start = time.time()
            att.roll_day()

            frame = cam.read()
            if frame is None:
                fail_streak += 1
                if fail_streak in (1, 10, 60):
                    log(f"Kadr olinmadi (ketma-ket {fail_streak}) — kamerani tekshiring")
                write_state(att, False, 0, len(set(db_names)))
                time.sleep(min(2.0, poll * fail_streak))
                continue
            fail_streak = 0

            now = time.time()

            # faces/ o'zgargan bo'lsa bazani qayta quramiz
            if now - last_sig_check > 5.0:
                last_sig_check = now
                cur = faces_mod.folder_signature()
                if cur != db_sig:
                    log("Yangi surat sezildi — baza qayta qurilmoqda")
                    try:
                        faces_mod.build_db(engine, log=lambda *a: None)
                        db_mat, db_names, db_sig = faces_mod.load_db()
                        log(f"Baza yangilandi: {len(set(db_names))} ta xodim")
                    except Exception as e:
                        log(f"Baza xatosi: {e}")
                        db_sig = cur          # qayta-qayta urinmaslik uchun

            # Aniqlashni kichraytirilgan kadrda qilamiz (tez),
            # embeddingni TO'LIQ o'lchamda (aniq).
            oh, ow = frame.shape[:2]
            scale = process_width / ow if ow > process_width else 1.0
            small = cv2.resize(frame, (int(ow * scale), int(oh * scale))) if scale < 1.0 else frame

            try:
                detected = engine.detect(small)
            except Exception as e:
                log(f"Aniqlash xatosi: {e}")
                detected = []

            # Diagnostika uchun ikkalasini alohida sanaymiz: "yuz umuman
            # yo'q" va "yuz bor, lekin kichik" — butunlay boshqa muammolar.
            accepted = 0
            too_small = 0

            # Veb ekran (--web) uchun: shu kadrdagi eng katta yuz (kesim
            # olish uchun), tanildi/tanilmadi holati va javob vaqti.
            largest_full = None
            largest_px = 0
            matched_this_frame = False
            unmatched_this_frame = False
            best_unmatched_score = 0.0
            face_proc_start = time.perf_counter()

            for f in detected:
                fw_small = float(f[2])
                fw_full = fw_small / scale          # asl kadrdagi kenglik

                # Koordinatalarni asl o'lchamga qaytaramiz
                f_full = np.array(f, dtype=np.float32).copy()
                f_full[:14] = f_full[:14] / scale

                if fw_full > largest_px:
                    largest_px = fw_full
                    largest_full = f_full

                if fw_full < min_face:
                    too_small += 1
                    # Kichik yuzni ham CHIZAMIZ — aks holda ekranda hech
                    # narsa ko'rinmaydi va sabab noma'lum qoladi.
                    if args.preview:
                        x, y = int(f_full[0]), int(f_full[1])
                        w_, h_ = int(f_full[2]), int(f_full[3])
                        cv2.rectangle(frame, (x, y), (x + w_, y + h_), (150, 150, 150), 1)
                        cv2.putText(frame, f"{int(fw_full)}px (kichik, {min_face} kerak)",
                                    (x, max(16, y - 6)), cv2.FONT_HERSHEY_SIMPLEX,
                                    0.5, (150, 150, 150), 1, cv2.LINE_AA)
                    continue

                try:
                    feat = engine.embed(frame, f_full)
                    name, score = engine.match(feat, db_mat, db_names)
                except Exception:
                    continue

                accepted += 1
                if name:
                    # Papka nomi orqali subyekt turi: bemor_ prefiksi -> bemor.
                    # Serverga TOZA ism + subject_type ketadi.
                    subject_type, clean_name = parse_subject(name)
                    att.seen(clean_name, now, score, bbox=f_full, subject_type=subject_type)
                    matched_this_frame = True
                else:
                    unmatched_this_frame = True
                    best_unmatched_score = max(best_unmatched_score, score)

                if args.preview:
                    x, y = int(f_full[0]), int(f_full[1])
                    w_, h_ = int(f_full[2]), int(f_full[3])
                    ok = name is not None
                    color = (80, 220, 100) if ok else (80, 80, 220)
                    label = f"{name} {score:.2f}" if ok else f"? {score:.2f} ({int(fw_full)}px)"
                    cv2.rectangle(frame, (x, y), (x + w_, y + h_), color, 2)
                    cv2.putText(frame, label, (x, max(16, y - 6)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2, cv2.LINE_AA)

            if web_state is not None:
                resp_ms = int((time.perf_counter() - face_proc_start) * 1000)
                web_state.update_frame_metrics(
                    light_label=_light_label(frame),
                    face_px=int(largest_px),
                    resp_ms=resp_ms,
                    matched_this_frame=matched_this_frame,
                    unmatched_this_frame=unmatched_this_frame,
                    best_unmatched_score=best_unmatched_score,
                )
                if largest_full is not None:
                    web_state.set_jpg(_crop_face_jpg(frame, largest_full))

            att.tick(now)
            sender.flush()
            write_state(att, True, accepted, len(set(db_names)),
                        detected_raw=len(detected), too_small=too_small)

            # Yuz ko'rinyapti, lekin hammasi kichik — sabab aniq, aytamiz.
            # Har 30 soniyada bir marta, log to'lib ketmasin.
            if too_small and not accepted and (now - last_hint) > 30:
                last_hint = now
                log(f"Yuz topildi, lekin {min_face}px dan kichik "
                    f"({too_small} ta). Kameraga yaqinroq keling yoki "
                    f"config.json da min_face_px ni pasaytiring.")

            if args.preview:
                canvas = compose_ui(frame, att, sender, last_event, clinic_name)
                cv2.imshow(WINDOW_NAME, canvas)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            elapsed = time.time() - loop_start
            if elapsed < poll:
                time.sleep(poll - elapsed)

    except KeyboardInterrupt:
        log("To'xtatilmoqda...")
    finally:
        # Ichkarida qolganlarni yopmaymiz — agent qayta ishga tushsa
        # davom etadi. Faqat navbatni jo'natishga urinamiz.
        sender.flush(force=True)
        cam.release()
        if args.preview:
            cv2.destroyAllWindows()
        log("To'xtadi.")


if __name__ == "__main__":
    main()
