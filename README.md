# YardScan — Trailer ID Scanner

YardScan is a simple local web app for yard managers, dispatchers, and drivers. It reads trailer IDs from a live camera, a photo, or recorded video, lets the operator correct the results, and exports the session as an Excel workbook or CSV file.

## What it does

- Uses a phone or laptop camera to capture a trailer ID
- Can auto-scan a live feed every four seconds
- Accepts JPG, PNG, WebP, MP4, MOV, and WebM uploads
- Samples recorded video and keeps each unique trailer ID
- Shows OCR confidence and allows IDs and notes to be edited
- Prevents duplicate IDs within a session
- Saves the current session in the browser
- Exports clean `.xlsx` and `.csv` logs with ID, time, source, confidence, and notes

All media is processed by the local FastAPI server. Temporary uploads are deleted as soon as processing finishes.

## Run locally

Python 3.10+ and Node.js 18+ are recommended. EasyOCR downloads its English model the first time a scan is made.

### 1. Start the API

```bash
# --clear also repairs an older or partially installed local environment
python3 -m venv --clear .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```

The API will run at `http://localhost:8000`. Its interactive documentation is at `http://localhost:8000/docs`.

### 2. Start the UI

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. Camera access works on localhost. On a deployed phone-facing site, HTTPS is required by modern browsers.

To point the UI at a different API address, create `frontend/.env.local`:

```text
VITE_API_URL=https://your-api.example.com
```

## Tests and production build

```bash
python -m unittest backend.test_main
cd frontend
npm test
npm run build
```

## API overview

- `GET /api/health` — service status
- `POST /api/scan/image` — OCR for one image or camera frame
- `POST /api/scan/video` — sampled OCR for a recorded video
- `POST /api/export?format=xlsx|csv` — spreadsheet generation from reviewed records

## Scanning tips

Fill the frame with the printed ID, hold the camera steady, and avoid glare or deep shadow. OCR can make mistakes on dirty or damaged labels, so review the editable session table before export.
