# -*- coding: utf-8 -*-
"""
Xodimlar davomati agenti — Rapoo (yoki istalgan USB) web-kamera.

OQIM:
    kamera -> yuz aniqlash -> tanish -> keldi/ketdi -> navbat -> server

MUHIM QOIDA: yuz shablonlari (data/faces_db.json) SHU KOMPYUTERDA
qoladi. Serverga faqat {ism, yo'nalish, vaqt} yuboriladi.

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


# ── Kamera ────────────────────────────────────────────────────

class Camera:
    """USB web-kamera. Eskirgan kadrni bermasligi uchun bufer 1 va
    retrieve oldidan bir necha grab qilinadi."""

    def __init__(self, device, width, height):
        backend = cv2.CAP_DSHOW if sys.platform.startswith("win") else cv2.CAP_V4L2
        self.cap = cv2.VideoCapture(device, backend)
        if not self.cap.isOpened():
            self.cap = cv2.VideoCapture(device)      # zaxira: avtomatik backend
        if not self.cap.isOpened():
            raise RuntimeError(f"Kamera {device} ochilmadi")

        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        try:
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        for _ in range(5):
            self.cap.grab()                          # isitish

        w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        log(f"Kamera {device}: {w}x{h}")
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

    KETDI — odam `absence_timeout` soniya ko'rinmadi.
      Vaqt sifatida OXIRGI KO'RINGAN payt yoziladi (hozirgi emas) —
      aks holda hamma "ketdi" vaqti bir xil chiqadi.
    """

    def __init__(self, cfg, on_event):
        a = cfg["attendance"]
        self.absence_timeout = a.get("absence_timeout_sec", 180)
        self.confirm_frames = a.get("confirm_frames", 3)
        self.confirm_window = a.get("confirm_window_sec", 10)
        self.on_event = on_event

        self.today = date.today().isoformat()
        self.people = {}                  # ism -> holat
        self.recent = {}                  # ism -> ko'rilgan vaqtlar (deque)

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

    def seen(self, name, now, score):
        """Yuz tanildi. Tasdiqlangandan keyingina 'keldi' yoziladi."""
        st = self._st(name)
        st["last_seen"] = now

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
        log(f"KELDI: {name}  {when.strftime('%H:%M:%S')}  (o'xshashlik {score:.2f})")
        self.on_event(name, "in", when, score)

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

    def __init__(self, cfg):
        s = cfg["server"]
        self.url = s["url"].rstrip("/") + "/api/attendance/events"
        self.token = s["device_token"]
        self.batch = s.get("batch_size", 50)
        self.interval = s.get("send_interval_sec", 20)
        self.timeout = s.get("timeout_sec", 15)
        self.last_send = 0.0
        self.queue = self._load()
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

    def add(self, name, direction, when, score):
        ev = {
            "person_name": name,
            "direction": direction,
            "occurred_at": when.astimezone().isoformat(timespec="seconds"),
        }
        if score is not None:
            ev["confidence"] = round(float(score), 3)
        self.queue.append(ev)
        self._persist()

    def flush(self, force=False):
        now = time.time()
        if not self.queue:
            return
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


def write_state(att, online, faces_in_frame, enrolled):
    state = att.snapshot()
    state.update({"online": online, "faces_in_frame": faces_in_frame, "enrolled": enrolled})
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
    ap.add_argument("--preview", action="store_true", help="oynada ko'rsatish (sozlash uchun)")
    args = ap.parse_args()

    cfg = load_config()
    cam_cfg = cfg["camera"]
    fcfg = cfg["faces"]

    engine = faces_mod.FaceEngine(
        score_thresh=fcfg.get("det_score", 0.7),
        cosine_thresh=fcfg.get("cosine_threshold", faces_mod.COSINE_THRESHOLD),
        log=log,
    )
    db_mat, db_names, db_sig = faces_mod.load_db()
    if db_mat is None:
        log("Yuz bazasi bo'sh. Avval: python enroll.py")
    else:
        log(f"Bazada {len(set(db_names))} ta xodim ({len(db_names)} surat)")

    sender = Sender(cfg)
    att = Attendance(cfg, on_event=sender.add)

    cam = Camera(cam_cfg["device"], cam_cfg.get("width", 1920), cam_cfg.get("height", 1080))
    process_width = cam_cfg.get("process_width", 960)
    min_face = fcfg.get("min_face_px", 80)
    poll = cfg.get("poll_interval_sec", 0.3)

    log(f"Boshlandi. Minimal yuz: {min_face}px, chegara: {engine.cosine_thresh}")
    log("To'xtatish: Ctrl+C")

    last_sig_check = 0.0
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

            drawn = 0
            for f in detected:
                fw_small = float(f[2])
                fw_full = fw_small / scale          # asl kadrdagi kenglik
                if fw_full < min_face:
                    continue                        # juda uzoq — ishonchsiz

                # Koordinatalarni asl o'lchamga qaytaramiz
                f_full = np.array(f, dtype=np.float32).copy()
                f_full[:14] = f_full[:14] / scale

                try:
                    feat = engine.embed(frame, f_full)
                    name, score = engine.match(feat, db_mat, db_names)
                except Exception:
                    continue

                drawn += 1
                if name:
                    att.seen(name, now, score)

                if args.preview:
                    x, y = int(f_full[0]), int(f_full[1])
                    w_, h_ = int(f_full[2]), int(f_full[3])
                    ok = name is not None
                    color = (80, 220, 100) if ok else (80, 80, 220)
                    label = f"{name} {score:.2f}" if ok else f"? {score:.2f} ({int(fw_full)}px)"
                    cv2.rectangle(frame, (x, y), (x + w_, y + h_), color, 2)
                    cv2.putText(frame, label, (x, max(16, y - 6)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2, cv2.LINE_AA)

            att.tick(now)
            sender.flush()
            write_state(att, True, drawn, len(set(db_names)))

            if args.preview:
                present = ", ".join(att.snapshot()["present"]) or "—"
                cv2.putText(frame, f"Ichkarida: {present}", (10, 28),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (235, 240, 245), 2, cv2.LINE_AA)
                cv2.imshow("Davomat (chiqish: q)", frame)
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
