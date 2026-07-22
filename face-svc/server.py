import io
import base64
import os
import numpy as np
import cv2
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from insightface.model_zoo import ArcFaceONNX

app = FastAPI(title="Falcon AI OS — Face Recognition Service")

class ExtractRequest(BaseModel):
    image: str

class CompareRequest(BaseModel):
    embedding1: list[float]
    embedding2: list[float]

model = None
MODEL_PATH = os.path.expanduser("~/.insightface/models/buffalo_l/w600k_r50.onnx")

@app.on_event("startup")
async def load_model():
    global model
    if not os.path.exists(MODEL_PATH):
        print(f"[FACE] Model not found at {MODEL_PATH}")
        print(f"[FACE] Contents of model dir: {os.listdir(os.path.dirname(MODEL_PATH))}")
        return

    model = ArcFaceONNX(model_file=MODEL_PATH)
    model.prepare(ctx_id=-1)
    emb_dim = model.output_shape[-1] if model.output_shape else 512
    print(f"[FACE] Model loaded OK. Embedding dim: {emb_dim}")

@app.get("/health")
async def health():
    return {
        "status": "ok" if model else "error",
        "model": "buffalo_l/w600k_r50",
        "embedding_dim": model.output_shape[-1] if model and model.output_shape else 0,
        "model_loaded": model is not None,
    }

@app.post("/extract")
async def extract_face(req: ExtractRequest):
    global model
    if model is None:
        raise HTTPException(503, "Model yuklanmagan")

    try:
        img_bytes = base64.b64decode(req.image)
        img_arr = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(400, "Noto'g'ri rasm formati")

        faces = model.get(img)
        if not faces or len(faces) == 0:
            return {"success": False, "error": "Yuz topilmadi", "count": 0}

        face = max(faces, key=lambda f: float(f.det_score))
        embedding = face.embedding.tolist()

        return {
            "success": True,
            "embedding": embedding,
            "dim": len(embedding),
            "det_score": float(face.det_score),
            "bbox": [float(x) for x in face.bbox] if hasattr(face, 'bbox') else None,
            "count": len(faces),
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
