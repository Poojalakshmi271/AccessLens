from fastapi import FastAPI, File, UploadFile
from ultralytics import YOLO
from PIL import Image
import io

app = FastAPI()

model = YOLO("yolov8n.pt")  # lightweight model

@app.post("/detect")
async def detect_objects(file: UploadFile = File(...)):
    image_bytes = await file.read()
    image = Image.open(io.BytesIO(image_bytes))

    results = model(image)

    detections = []
    for r in results:
        for box in r.boxes:
            cls = int(box.cls[0])
            detections.append(model.names[cls])

    return {
        "objects_detected": list(set(detections))
    }
