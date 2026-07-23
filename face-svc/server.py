import io
import base64
import os
import numpy as np
import cv2
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from insightface.model_zoo import ArcFaceONNX, SCRFD

app = FastAPI(title="Falcon AI OS — Face Recognition Service")

class ExtractRequest(BaseModel):
    image: str

class CompareRequest(BaseModel):
    embedding1: list[float]
    embedding2: list[float]

class LivenessRequest(BaseModel):
    image: str

detector = None
recognizer = None
liveness_session = None

BASE = os.path.expanduser("~/.insightface/models/buffalo_l")
MODEL_PATH = os.path.join(BASE, "w600k_r50.onnx")
DET_PATH = os.path.join(BASE, "det_10g.onnx")
LIVENESS_MODEL = "/app/models/liveness.onnx"

LIVENESS_SIZE = 128
LIVENESS_LOGIT_THRESHOLD = 0.0

@app.on_event("startup")
async def load_model():
    global detector, recognizer, liveness_session
    if not os.path.exists(DET_PATH) or not os.path.exists(MODEL_PATH):
        files = os.listdir(BASE) if os.path.isdir(BASE) else []
        print(f"[FACE] Model files missing. In {BASE}: {files}")
        return

    detector = SCRFD(model_file=DET_PATH)
    detector.prepare(ctx_id=-1, det_thresh=0.5)
    print(f"[FACE] Detector loaded. Input size: {detector.input_size}")

    recognizer = ArcFaceONNX(model_file=MODEL_PATH)
    recognizer.prepare(ctx_id=-1)
    print(f"[FACE] Recognizer loaded. Output dim: {recognizer.output_shape[-1]}")

    if os.path.exists(LIVENESS_MODEL):
        liveness_session = ort.InferenceSession(LIVENESS_MODEL, providers=["CPUExecutionProvider"])
        print(f"[FACE] Liveness model loaded: {LIVENESS_MODEL}")
    else:
        print(f"[FACE] WARNING: Liveness model not found at {LIVENESS_MODEL}")


def _crop_face(img, bbox, margin=1.5):
    h, w = img.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in bbox[:4]]
    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
    size = int(max(x2 - x1, y2 - y1) * margin)
    x1 = max(0, cx - size // 2)
    y1 = max(0, cy - size // 2)
    x2 = min(w, x1 + size)
    y2 = min(h, y1 + size)
    return img[y1:y2, x1:x2]


def _predict_liveness(face_img):
    if liveness_session is None:
        return 1.0

    face_rgb = cv2.cvtColor(face_img, cv2.COLOR_BGR2RGB)
    h_f, w_f = face_rgb.shape[:2]
    scale = LIVENESS_SIZE / max(h_f, w_f)
    new_w = int(w_f * scale)
    new_h = int(h_f * scale)
    resized = cv2.resize(face_rgb, (new_w, new_h))

    dw = LIVENESS_SIZE - new_w
    dh = LIVENESS_SIZE - new_h
    padded = cv2.copyMakeBorder(
        resized, dh // 2, dh - dh // 2, dw // 2, dw - dw // 2,
        cv2.BORDER_REFLECT_101
    )

    blob = padded.transpose(2, 0, 1).astype(np.float32)[np.newaxis, ...] / 255.0
    logits = liveness_session.run(None, {liveness_session.get_inputs()[0].name: blob})[0]
    diff = float(logits[0][0] - logits[0][1])
    score = round(float(1.0 / (1.0 + np.exp(-diff))), 4)
    return score


@app.get("/health")
async def health():
    return {
        "status": "ok" if detector and recognizer else "error",
        "detector": "SCRFD" if detector else None,
        "recognizer": "ArcFace(w600k_r50)" if recognizer else None,
        "liveness": "MiniFASNetV2" if liveness_session else None,
        "embedding_dim": recognizer.output_shape[-1] if recognizer and recognizer.output_shape else 0,
    }


@app.post("/extract")
async def extract_face(req: ExtractRequest):
    if detector is None or recognizer is None:
        raise HTTPException(503, "Model yuklanmagan")

    try:
        img_bytes = base64.b64decode(req.image)
        img_arr = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(400, "Noto'g'ri rasm formati")

        bboxes, kpss = detector.detect(img)
        if bboxes is None or len(bboxes) == 0:
            return {"success": False, "error": "Yuz topilmadi", "count": 0}

        best_idx = int(np.argmax(bboxes[:, 4])) if len(bboxes.shape) > 1 else 0
        bbox = bboxes[best_idx]
        kps = kpss[best_idx] if kpss is not None and len(kpss) > 0 else None

        face_input = (bbox, kps) if kps is not None else bbox
        embedding = recognizer.get(img, face_input)
        if embedding is None:
            return {"success": False, "error": "Yuz aniqlanmadi", "count": 0}

        if hasattr(embedding, 'tolist'):
            embedding = embedding.tolist()

        bbox_int = [int(v) for v in bbox[:4]]
        face_crop = _crop_face(img, bbox_int, margin=1.5)
        liveness_score = _predict_liveness(face_crop)

        return {
            "success": True,
            "embedding": embedding,
            "dim": len(embedding) if isinstance(embedding, list) else 0,
            "det_score": float(bbox[4]) if len(bbox) > 4 else 1.0,
            "bbox": bbox_int,
            "count": len(bboxes),
            "liveness_score": liveness_score,
            "is_live": liveness_score >= 0.5,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/liveness")
async def check_liveness(req: LivenessRequest):
    if detector is None:
        raise HTTPException(503, "Detector yuklanmagan")

    try:
        img_bytes = base64.b64decode(req.image)
        img_arr = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(400, "Noto'g'ri rasm formati")

        bboxes, _ = detector.detect(img)
        if bboxes is None or len(bboxes) == 0:
            return {"success": False, "error": "Yuz topilmadi", "count": 0, "liveness_score": 0.0, "is_live": False}

        best_idx = int(np.argmax(bboxes[:, 4])) if len(bboxes.shape) > 1 else 0
        bbox = [int(v) for v in bboxes[best_idx][:4]]
        face_crop = _crop_face(img, bbox, margin=1.5)
        liveness_score = _predict_liveness(face_crop)

        return {
            "success": True,
            "liveness_score": liveness_score,
            "is_live": liveness_score >= 0.5,
            "det_score": float(bboxes[best_idx][4]),
            "count": len(bboxes),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/compare")
async def compare_embeddings(req: CompareRequest):
    try:
        e1 = np.array(req.embedding1, dtype=np.float64)
        e2 = np.array(req.embedding2, dtype=np.float64)
        e1 = e1 / np.linalg.norm(e1)
        e2 = e2 / np.linalg.norm(e2)
        similarity = float(np.dot(e1, e2))
        distance = float(1 - similarity)
        return {
            "similarity": round(similarity, 6),
            "distance": round(distance, 6),
            "confidence": round(max(0, similarity), 6),
        }
    except Exception as e:
        raise HTTPException(500, str(e))
