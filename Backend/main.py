from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from change_detector import process_change_detection
from image_store import get_image_bytes, list_complete_sites

app = FastAPI(
    title="BHU-DRISHTI Geospatial Analytics Engine",
    version="1.0.0"
)

# Enable CORS for React frontend cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return {
        "status": "Online",
        "system": "BHU-DRISHTI Change Detection API",
        "docs_url": "http://127.0.0.1:8000/docs"
    }

@app.get("/api/analyze/{site_id}")
def analyze_site(site_id: str):
    """
    Analyzes satellite site imagery by ID (e.g., train_1) 
    and returns GeoJSON change polygons and affected area metrics.
    """
    try:
        result = process_change_detection(site_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result

@app.get("/api/sites")
def list_sites():
    """Lists site IDs that have both T1 and T2 imagery available."""
    try:
        return {"sites": list_complete_sites()}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

@app.get("/api/sites/{site_id}/image/{epoch}")
def site_image(site_id: str, epoch: str):
    """
    Serves the raw T1 (before) / T2 (after) site imagery from MongoDB so the
    frontend can display the actual epoch images on the maps.
    """
    if epoch not in ("T1", "T2"):
        raise HTTPException(status_code=400, detail="epoch must be 'T1' or 'T2'")
    try:
        data = get_image_bytes(site_id, epoch)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    if data is None:
        raise HTTPException(status_code=404, detail=f"Image {epoch}/{site_id} not found.")
    return Response(content=data, media_type="image/png")