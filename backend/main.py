"""FastAPI service for trailer ID OCR and spreadsheet exports."""

from __future__ import annotations

import csv
import importlib
import importlib.util
import io
import os
import re
import tempfile
import threading
from copy import copy
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel, Field

try:
    import cv2
except ImportError:  # pragma: no cover - reported by the API when OCR is used
    cv2 = None

MAX_UPLOAD_BYTES = 150 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/bmp"}
ALLOWED_VIDEO_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "video/x-msvideo",
}
TRAILER_ID_RE = re.compile(r"(?=[A-Z0-9-]{4,14}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)?")
EXPORT_COLUMNS = ["Trailer ID", "Captured At", "Source", "Confidence", "Notes"]

app = FastAPI(title="Trailer ID Scanner API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_reader = None
_reader_lock = threading.Lock()
_easyocr_available = importlib.util.find_spec("easyocr") is not None


class Scan(BaseModel):
    trailer_id: str = Field(min_length=1, max_length=32)
    captured_at: str
    source: str = Field(default="Manual", max_length=100)
    confidence: float | None = Field(default=None, ge=0, le=1)
    notes: str = Field(default="", max_length=500)


class ExportRequest(BaseModel):
    records: list[Scan]


def get_reader():
    """Load the OCR model on first use so the API can start quickly."""
    global _reader
    if not _easyocr_available:
        raise HTTPException(status_code=503, detail="EasyOCR is not installed on the server.")
    with _reader_lock:
        if _reader is None:
            try:
                easyocr = importlib.import_module("easyocr")
                model_dir = os.getenv("EASYOCR_MODEL_DIR")
                options = {"model_storage_directory": model_dir} if model_dir else {}
                _reader = easyocr.Reader(["en"], gpu=False, **options)
            except Exception as exc:
                raise HTTPException(status_code=503, detail=f"OCR model could not be loaded: {exc}") from exc
    return _reader


def normalize_candidates(text: str) -> list[str]:
    """Return likely trailer IDs from noisy OCR text, preserving order."""
    upper = text.upper().replace("_", "-")
    upper = re.sub(r"\b(?:TRAILER|TRLR|UNIT|NUMBER|NO|ID)\b", " ", upper)
    variants = [upper, re.sub(r"[\s.:/]+", "", upper)]
    candidates: list[str] = []
    for variant in variants:
        for match in TRAILER_ID_RE.findall(variant):
            cleaned = match.strip("-")
            if cleaned and cleaned not in candidates:
                candidates.append(cleaned)
    return candidates


def scan_frame(frame, timestamp_seconds: float | None = None) -> list[dict]:
    if cv2 is None:
        raise HTTPException(status_code=503, detail="OpenCV is not installed on the server.")

    reader = get_reader()
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 7, 45, 45)
    detections = reader.readtext(
        gray,
        detail=1,
        paragraph=False,
        allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
    )
    scans: dict[str, dict] = {}

    for _box, raw_text, confidence in detections:
        for trailer_id in normalize_candidates(str(raw_text)):
            current = scans.get(trailer_id)
            item = {
                "trailer_id": trailer_id,
                "confidence": round(float(confidence), 3),
                "raw_text": str(raw_text),
                "timestamp_seconds": timestamp_seconds,
            }
            if current is None or item["confidence"] > current["confidence"]:
                scans[trailer_id] = item
    return list(scans.values())


async def save_upload(file: UploadFile, allowed_types: set[str]) -> Path:
    content_type = (file.content_type or "").lower()
    if content_type not in allowed_types:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {content_type or 'unknown'}")

    suffix = Path(file.filename or "upload").suffix.lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
        total = 0
        while chunk := await file.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                Path(handle.name).unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="Upload exceeds the 150 MB limit.")
            handle.write(chunk)
        return Path(handle.name)


@app.get("/api/health")
def health():
    return {"status": "ok", "ocr_ready": _easyocr_available and cv2 is not None}


@app.post("/api/scan/image")
async def scan_image(
    file: Annotated[UploadFile, File(...)],
    source: Annotated[str, Form()] = "Uploaded image",
):
    path = await save_upload(file, ALLOWED_IMAGE_TYPES)
    try:
        frame = cv2.imread(str(path)) if cv2 is not None else None
        if frame is None:
            raise HTTPException(status_code=422, detail="The image could not be decoded.")
        return {"scans": scan_frame(frame), "source": source}
    finally:
        path.unlink(missing_ok=True)


@app.post("/api/scan/video")
async def scan_video(
    file: Annotated[UploadFile, File(...)],
    interval_seconds: Annotated[float, Form(ge=0.5, le=10)] = 1.5,
    max_frames: Annotated[int, Form(ge=1, le=120)] = 40,
):
    if cv2 is None:
        raise HTTPException(status_code=503, detail="OpenCV is not installed on the server.")
    path = await save_upload(file, ALLOWED_VIDEO_TYPES)
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="The video could not be decoded.")

    try:
        fps = capture.get(cv2.CAP_PROP_FPS) or 30
        total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        step = max(1, int(fps * interval_seconds))
        aggregated: dict[str, dict] = {}
        processed = 0
        frame_number = 0

        while processed < max_frames and (total_frames <= 0 or frame_number < total_frames):
            capture.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            ok, frame = capture.read()
            if not ok:
                break
            timestamp = round(frame_number / fps, 2)
            for item in scan_frame(frame, timestamp):
                existing = aggregated.get(item["trailer_id"])
                if existing is None or item["confidence"] > existing["confidence"]:
                    aggregated[item["trailer_id"]] = item
            processed += 1
            frame_number += step

        return {"scans": list(aggregated.values()), "frames_processed": processed}
    finally:
        capture.release()
        path.unlink(missing_ok=True)


def record_row(record: Scan) -> list[str | float | None]:
    return [
        record.trailer_id,
        record.captured_at,
        record.source,
        round(record.confidence * 100, 1) if record.confidence is not None else None,
        record.notes,
    ]


@app.post("/api/export")
def export_records(
    payload: ExportRequest,
    format: Literal["csv", "xlsx"] = Query(default="xlsx"),
):
    if not payload.records:
        raise HTTPException(status_code=422, detail="Add at least one trailer before exporting.")

    stamp = datetime.now().strftime("%Y-%m-%d")
    if format == "csv":
        text = io.StringIO(newline="")
        writer = csv.writer(text)
        writer.writerow(EXPORT_COLUMNS)
        writer.writerows(record_row(record) for record in payload.records)
        output = io.BytesIO(text.getvalue().encode("utf-8-sig"))
        media_type = "text/csv; charset=utf-8"
        filename = f"trailer-scans-{stamp}.csv"
    else:
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Trailer scans"
        sheet.append(EXPORT_COLUMNS)
        for record in payload.records:
            sheet.append(record_row(record))
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        widths = {"A": 18, "B": 24, "C": 22, "D": 14, "E": 40}
        for column, width in widths.items():
            sheet.column_dimensions[column].width = width
        for cell in sheet[1]:
            header_font = copy(cell.font)
            header_font.bold = True
            cell.font = header_font
        output = io.BytesIO()
        workbook.save(output)
        output.seek(0)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"trailer-scans-{stamp}.xlsx"

    return StreamingResponse(
        output,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/upload/")
async def upload_image(file: Annotated[UploadFile, File(...)]):
    """Backward-compatible route retained for the original client."""
    return await scan_image(file=file, source="Uploaded image")
