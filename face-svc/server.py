import io
import base64
import os
import numpy as np
import cv2
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from insightface.model_zoo import ArcFaceONNX, SCRFD

app = FastAPI(title="Falcon AI OS — Face Recognition Service")

class ExtractRequest(BaseModel):
    image: str

class CompareRequest(BaseModel):
    embedding1: list[float]
    embedding2: list[float]

detector = None
recognizer = None
BASE = os.path.expanduser("~/.insightface/models/buffalo_l")
MODEL_PATH = os.path.join(BASE, "w600k_r50.onnx")
DET_PATH = os.path.join(BASE, "det_10g.onnx")

@app.on_event("startup")
async def load_model():
    global detector, recognizer
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

@app.get("/health")
async def health():
    return {
        "status": "ok" if detector and recognizer else "error",
        "detector": "SCRFD" if detector else None,
        "recognizer": "ArcFace(w600k_r50)" if recognizer else None,
        "embedding_dim": recognizer.output_shape[-1] if recognizer and recognizer.output_shape else 0,
    }

@app.post("/extract")
async def extract_face(req: ExtractRequest):
    global detector, recognizer
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
        kps = kpss[best_idx] if kpss is not None else None

        embedding = recognizer.get(img, kps)
        if embedding is None:
            return {"success": False, "error": "Yuz aniqlanmadi", "count": 0}

        if hasattr(embedding, 'tolist'):
            embedding = embedding.tolist()

        return {
            "success": True,
            "embedding": embedding,
            "dim": len(embedding) if isinstance(embedding, list) else 0,
            "det_score": float(bbox[4]) if len(bbox) > 4 else 1.0,
            "bbox": [float(x) for x in bbox[:4]],
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
