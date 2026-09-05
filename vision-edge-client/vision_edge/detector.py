"""RTSP video oqimi + odam aniqlash (YOLOv8, GPU).

Har bir kamera o'z fonda ishlaydigan o'qish thread'iga ega (faqat
ENG SO'NGGI kadrni saqlaydi — RTSP bufer kechikishini oldini olish
uchun eski kadrlar tashlanadi). Aniqlashning o'zi BITTA umumiy model
bilan navbat asosida ishlaydi — GPU xotirasi bir nechta nusxaga
sarflanmasin.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass

import cv2
import numpy as np

logger = logging.getLogger("vision_edge.detector")

PERSON_CLASS_ID = 0  # COCO datasetda 'person' = 0 (ultralytics standart)
RECONNECT_DELAY_SECONDS = 5


class CameraStream:
    """Fonda RTSP'dan o'qiydi, faqat oxirgi kadrni saqlaydi."""

    def __init__(self, camera_id: str, rtsp_url: str):
        self.camera_id = camera_id
        self._rtsp_url = rtsp_url
        self._frame: np.ndarray | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name=f"cam-{camera_id}")

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            cap = cv2.VideoCapture(self._rtsp_url)
            if not cap.isOpened():
                logger.warning("[%s] RTSP ochilmadi, %ss dan keyin qayta urinish", self.camera_id, RECONNECT_DELAY_SECONDS)
                time.sleep(RECONNECT_DELAY_SECONDS)
                continue
            logger.info("[%s] RTSP ulandi", self.camera_id)
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    logger.warning("[%s] kadr o'qilmadi, qayta ulanmoqda", self.camera_id)
                    break
                with self._lock:
                    self._frame = frame
            cap.release()
            if not self._stop.is_set():
                time.sleep(RECONNECT_DELAY_SECONDS)

    def latest_frame(self) -> np.ndarray | None:
        with self._lock:
            return None if self._frame is None else self._frame.copy()


@dataclass
class PersonDetection:
    found: bool
    confidence: float = 0.0
    bbox: tuple | None = None


class PersonDetector:
    def __init__(self, model_path: str, device: str, conf_threshold: float):
        from ultralytics import YOLO  # import shu yerda — modul yuklanishi sekin

        self._model = YOLO(model_path)
        self._device = device
        self._conf_threshold = conf_threshold
        self.model_version = f"{model_path}@{device}"

    def detect(self, frame: np.ndarray) -> PersonDetection:
        results = self._model.predict(
            frame, device=self._device, classes=[PERSON_CLASS_ID],
            conf=self._conf_threshold, verbose=False,
        )
        if not results:
            return PersonDetection(found=False)
        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return PersonDetection(found=False)
        best_idx = int(boxes.conf.argmax())
        confidence = float(boxes.conf[best_idx])
        bbox = tuple(float(x) for x in boxes.xyxy[best_idx].tolist())
        return PersonDetection(found=True, confidence=confidence, bbox=bbox)
