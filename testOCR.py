from PIL import Image
import pytesseract
import cv2
import numpy as np
import os
import sys
import platform

# Auto-detect Tesseract path based on platform
if platform.system() == 'Windows':
    # Try common Windows installation paths
    possible_paths = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for path in possible_paths:
        if os.path.exists(path):
            pytesseract.pytesseract.tesseract_cmd = path
            break

# Use relative path for the image file
image_path = 'pictures/trailerid2.png'

# Check if image file exists
if not os.path.exists(image_path):
    print(f"Error: Image file not found at {image_path}")
    print("Please ensure the image exists in the pictures/ directory")
    sys.exit(1)

# Load image with OpenCV for preprocessing
cv_img = cv2.imread(image_path)
if cv_img is None:
    raise FileNotFoundError(f'Could not load image at {image_path}')

# Convert to grayscale
gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)

# Apply thresholding to make text stand out
_, thresh = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)

# Convert back to PIL Image for pytesseract
preprocessed_image = Image.fromarray(thresh)

# Only show image if in interactive mode (not headless)
if os.environ.get('DISPLAY') or platform.system() == 'Windows':
    try:
        preprocessed_image.show()
    except Exception as e:
        print(f"Note: Could not display image preview: {e}")

# Perform OCR on the preprocessed image
text = pytesseract.image_to_string(preprocessed_image, lang='eng')

# Output the result
print("Detected Text:")
# Expected output: "LR7664"
print(text)
