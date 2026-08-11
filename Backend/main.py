from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from change_detector import process_change_detection

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
    result = process_change_detection(site_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result