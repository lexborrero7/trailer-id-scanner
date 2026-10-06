import csv
import io
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from openpyxl import load_workbook

from backend.main import app, normalize_candidates


class NormalizeCandidatesTests(unittest.TestCase):
    def test_extracts_common_trailer_ids(self):
        self.assertEqual(normalize_candidates("Trailer: LR 7664"), ["LR7664"])
        self.assertEqual(normalize_candidates("ABCU-123456"), ["ABCU-123456"])

    def test_rejects_words_and_plain_numbers(self):
        self.assertEqual(normalize_candidates("TRAILER 123456"), [])


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health(self):
        self.assertEqual(self.client.get("/api/health").status_code, 200)

    def test_csv_export(self):
        response = self.client.post(
            "/api/export?format=csv",
            json={
                "records": [
                    {
                        "trailer_id": "LR7664",
                        "captured_at": "2026-10-05T12:00:00Z",
                        "source": "Camera",
                        "confidence": 0.921,
                        "notes": "Dock 4",
                    }
                ]
            },
        )
        self.assertEqual(response.status_code, 200)
        rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
        self.assertEqual(rows[0][0], "Trailer ID")
        self.assertEqual(rows[1][0], "LR7664")
        self.assertEqual(rows[1][3], "92.1")

    def test_excel_export_is_filterable_and_readable(self):
        response = self.client.post(
            "/api/export?format=xlsx",
            json={
                "records": [
                    {
                        "trailer_id": "AV2204",
                        "captured_at": "2026-10-05T12:00:00Z",
                        "source": "Recorded video",
                        "confidence": 0.942,
                        "notes": "Reviewed",
                    }
                ]
            },
        )
        self.assertEqual(response.status_code, 200)
        sheet = load_workbook(io.BytesIO(response.content)).active
        self.assertEqual(sheet["A1"].value, "Trailer ID")
        self.assertEqual(sheet["A2"].value, "AV2204")
        self.assertEqual(sheet.freeze_panes, "A2")
        self.assertEqual(sheet.auto_filter.ref, "A1:E2")

    @patch("backend.main.scan_frame", return_value=[{"trailer_id": "LR7664", "confidence": 0.9}])
    @patch("backend.main.cv2")
    def test_image_scan(self, mock_cv2, _mock_scan):
        mock_cv2.imread.return_value = object()
        response = self.client.post(
            "/api/scan/image",
            files={"file": ("trailer.jpg", b"image bytes", "image/jpeg")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["scans"][0]["trailer_id"], "LR7664")

    @patch("backend.main.scan_frame", return_value=[{"trailer_id": "AV2204", "confidence": 0.94}])
    @patch("backend.main.cv2")
    def test_recorded_video_is_sampled_and_deduplicated(self, mock_cv2, _mock_scan):
        mock_cv2.CAP_PROP_FPS = 5
        mock_cv2.CAP_PROP_FRAME_COUNT = 7
        capture = mock_cv2.VideoCapture.return_value
        capture.isOpened.return_value = True
        capture.get.side_effect = lambda prop: 30 if prop == 5 else 61
        capture.read.side_effect = [(True, object()), (True, object())]
        response = self.client.post(
            "/api/scan/video",
            files={"file": ("yard.mp4", b"video bytes", "video/mp4")},
            data={"interval_seconds": "1.5", "max_frames": "20"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["frames_processed"], 2)
        self.assertEqual(response.json()["scans"], [{"trailer_id": "AV2204", "confidence": 0.94}])
        capture.release.assert_called_once()


if __name__ == "__main__":
    unittest.main()
