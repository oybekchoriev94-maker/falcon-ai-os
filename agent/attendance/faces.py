# -*- coding: utf-8 -*-
"""
Yuz tanish dvigateli — OpenCV YuNet (aniqlash) + SFace (tanish).

Bu modul "Kamera" loyihasidagi faces.py asosida olingan. O'zgarishlar:
  - Modellar yo'q bo'lsa avtomatik yuklab olinadi (OpenCV Zoo)
  - build_db() yuzi topilmagan suratlarni aniq xabar bilan qaytaradi
  - Chegaraviy qiymat davomat uchun qat'iyroq (pastda izoh bor)

MUHIM: bu yerda yasalgan embeddinglar (yuz shablonlari) FAQAT shu
kompyuterda qoladi. Serverga hech qachon yuborilmaydi.
"""
import hashlib
import json
import os
import sys
import urllib.request

import cv2
import numpy as np

# OpenCV 5.0 har model yuklashda "Targets are not supported by the new
# graph engine" deb ogohlantiradi. Bu ONNX'ni CPU'da yurgizishga ta'sir
# qilmaydi, lekin loglarni ifloslantiradi va haqiqiy xatoni yashiradi.
try:
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
except Exception:
    pass

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
FACES_DIR = os.path.join(BASE_DIR, "faces")
DB_PATH = os.path.join(BASE_DIR, "data", "faces_db.json")

DET_MODEL = os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
REC_MODEL = os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx")

_ZOO = "https://github.com/opencv/opencv_zoo/raw/main/models"
MODEL_URLS = {
    DET_MODEL: f"{_ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    REC_MODEL: f"{_ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
}

IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

# SFace kosinus chegarasi.
#
# Manba loyihada 0.363 (OpenCV tavsiyasi), webcam konfiguratsiyasida 0.30
# qo'yilgan edi. Davomat uchun 0.30 XAVFLI: past chegara "noto'g'ri qabul"
# ehtimolini oshiradi — ya'ni A xodim kirganda B xodim "keldi" deb
# belgilanadi. Bu davomat tizimining eng yomon xatosi.
#
# "O'tkazib yuborish" esa zararsiz: odam kadrda bir necha marta ko'rinadi,
# keyingi kadrda taniladi. Shuning uchun QAT'IYROQ chegara olamiz.
COSINE_THRESHOLD = 0.40


def ensure_models(log=print):
    """Modellar yo'q bo'lsa yuklab oladi (~10 MB, bir marta)."""
    os.makedirs(MODELS_DIR, exist_ok=True)
    for path, url in MODEL_URLS.items():
        if os.path.exists(path) and os.path.getsize(path) > 100_000:
            continue
        log(f"Model yuklanmoqda: {os.path.basename(path)}")
        tmp = path + ".part"
        urllib.request.urlretrieve(url, tmp)
        os.replace(tmp, path)
        log(f"  ✓ {os.path.basename(path)}")


def _is_image(name):
    return os.path.splitext(name)[1].lower() in IMG_EXTENSIONS


def _iter_images(folder):
    if not os.path.isdir(folder):
        return
    for root, _, files in os.walk(folder):
        for f in files:
            if _is_image(f):
                yield os.path.join(root, f)


def _normalize(v):
    v = np.asarray(v, dtype=np.float32).flatten()
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


class FaceEngine:
    def __init__(self, det_size=(320, 320), score_thresh=0.7, nms=0.3, top_k=5000,
                 cosine_thresh=COSINE_THRESHOLD, log=print):
        ensure_models(log=log)
        self.detector = cv2.FaceDetectorYN.create(
            DET_MODEL, "", det_size, score_thresh, nms, top_k)
        self.recognizer = cv2.FaceRecognizerSF.create(REC_MODEL, "")
        self.cosine_thresh = cosine_thresh

    def detect(self, frame):
        """Yuzlar: (N x 15) massiv yoki bo'sh ro'yxat."""
        h, w = frame.shape[:2]
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(frame)
        return faces if faces is not None else []

    def embed(self, frame, face_row):
        aligned = self.recognizer.alignCrop(frame, face_row)
        return _normalize(self.recognizer.feature(aligned))

    def match(self, feat, db_matrix, names):
        """(ism yoki None, eng yuqori o'xshashlik)."""
        if db_matrix is None or len(db_matrix) == 0:
            return None, 0.0
        sims = db_matrix @ feat          # hammasi normallashtirilgan -> kosinus
        idx = int(np.argmax(sims))
        best = float(sims[idx])
        return (names[idx], best) if best >= self.cosine_thresh else (None, best)


def folder_signature(faces_dir=FACES_DIR):
    """faces/ o'zgarganini sezish uchun imzo."""
    items = []
    for p in _iter_images(faces_dir):
        try:
            st = os.stat(p)
            items.append(f"{p}|{int(st.st_mtime)}|{st.st_size}")
        except OSError:
            pass
    items.sort()
    return hashlib.md5("\n".join(items).encode("utf-8")).hexdigest()


def _person_images(faces_dir):
    """
    {ism: [yo'llar]}
      faces/Ali.jpg            -> "Ali"
      faces/Ali/1.jpg, 2.jpg   -> "Ali"
    """
    people = {}
    if not os.path.isdir(faces_dir):
        return people
    for p in _iter_images(faces_dir):
        rel = os.path.relpath(p, faces_dir)
        name = (os.path.splitext(os.path.basename(p))[0]
                if os.sep not in rel else rel.split(os.sep)[0])
        people.setdefault(name, []).append(p)
    return people


def build_db(engine=None, faces_dir=FACES_DIR, db_path=DB_PATH, log=print):
    """faces/ dan bazani quradi -> data/faces_db.json (LOKAL, chiqmaydi)."""
    if engine is None:
        engine = FaceEngine(log=log)
    people = _person_images(faces_dir)
    db = {"people": {}, "signature": folder_signature(faces_dir), "errors": []}

    for name, paths in sorted(people.items()):
        embs = []
        for p in paths:
            img = cv2.imread(p)
            if img is None:
                db["errors"].append(f"{name}: '{os.path.basename(p)}' o'qib bo'lmadi")
                continue
            faces = engine.detect(img)
            if len(faces) == 0:
                db["errors"].append(f"{name}: '{os.path.basename(p)}' — yuz topilmadi")
                continue
            # Eng katta yuz (guruh suratda asosiy odam)
            faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
            embs.append(engine.embed(img, faces[0]).tolist())
        if embs:
            db["people"][name] = embs
            log(f"  ✓ {name}: {len(embs)} ta surat")
        else:
            log(f"  ✗ {name}: yaroqli yuz topilmadi")

    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    tmp = db_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False)
    os.replace(tmp, db_path)
    return db


def load_db(db_path=DB_PATH):
    """(matritsa (M x D), ismlar, imzo)."""
    if not os.path.exists(db_path):
        return None, [], ""
    with open(db_path, "r", encoding="utf-8") as f:
        db = json.load(f)
    matrix, names = [], []
    for name, embs in db.get("people", {}).items():
        for e in embs:
            matrix.append(e)
            names.append(name)
    mat = np.asarray(matrix, dtype=np.float32) if matrix else None
    return mat, names, db.get("signature", "")
