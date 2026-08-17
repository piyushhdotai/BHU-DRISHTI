import hashlib
import os
import re
import threading
from contextlib import asynccontextmanager
from datetime import datetime
from functools import lru_cache

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from shapely.geometry import shape

from change_detector import process_change_detection
from image_store import get_image_bytes, list_complete_sites, warm_cache
from services.report_generator import generate_pdf_report

load_dotenv()


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Pre-download all imagery from Atlas in the background so first clicks
    # don't pay the ~7s-per-image download cost. Cache fills lazily anyway,
    # so startup is never blocked on this.
    threading.Thread(target=warm_cache, daemon=True).start()
    yield


app = FastAPI(
    title="BHU-DRISHTI Geospatial Analytics Engine",
    version="1.0.0",
    lifespan=_lifespan,
)


@lru_cache
def _async_client():
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise RuntimeError(
            "MONGODB_URI is not set. Copy .env.example to .env and fill in "
            "your MongoDB Atlas connection string."
        )
    return AsyncIOMotorClient(uri)


def _async_db():
    return _async_client()[os.environ.get("MONGODB_DB", "bhu_drishti")]


def _format_lat_lon(lon: float, lat: float) -> str:
    lat_dir = "N" if lat >= 0 else "S"
    lon_dir = "E" if lon >= 0 else "W"
    return f"{abs(lat):.4f}° {lat_dir}, {abs(lon):.4f}° {lon_dir}"


def _coerce_float(value, default: float = 0.0) -> float:
    if value is None or value in ("", "-", "N/A"):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _compute_area_ha_from_geometry(geometry_obj) -> float | None:
    if not geometry_obj:
        return None
    try:
        geom = shape(geometry_obj)
    except Exception:
        return None
    try:
        return round(geom.area / 10000.0, 4)
    except Exception:
        return None


def _compute_coords_from_geometry(geometry_obj):
    if not geometry_obj:
        return None
    try:
        geom = shape(geometry_obj)
    except Exception:
        return None
    try:
        centroid = geom.centroid
    except Exception:
        return None
    return _format_lat_lon(float(centroid.x), float(centroid.y))


def _build_incident_payload(site_id: str, region_doc: dict | None) -> dict:
    region_doc = region_doc or {}
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    hash_suffix = hashlib.md5(f"{site_id}:{timestamp}".encode("utf-8")).hexdigest()[:6].upper()

    region_id = region_doc.get("region_id") or region_doc.get("site_id") or site_id
    default_category = "Detected Land Surface Alteration"
    default_severity = "Medium"
    default_coordinates = "30.2672° N, 97.7431° W"
    default_area_ha = 1.7254

    geometry_obj = (
        region_doc.get("geometry")
        or region_doc.get("geojson")
        or region_doc.get("feature")
        or region_doc.get("geo_geometry")
    )

    area_ha = (
        _coerce_float(region_doc.get("area_ha"), default_area_ha)
        or _coerce_float(region_doc.get("total_change_ha"), default_area_ha)
        or _coerce_float(region_doc.get("affected_area_ha"), default_area_ha)
        or _coerce_float(region_doc.get("area_m2"), default_area_ha * 10000.0) / 10000.0
        or _compute_area_ha_from_geometry(geometry_obj)
        or default_area_ha
    )

    coordinates = (
        region_doc.get("coordinates")
        or region_doc.get("center")
        or region_doc.get("centroid")
        or _compute_coords_from_geometry(geometry_obj)
        or default_coordinates
    )

    if isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
        coordinates = _format_lat_lon(float(coordinates[0]), float(coordinates[1]))
    elif isinstance(coordinates, dict):
        lon = coordinates.get("lon")
        lat = coordinates.get("lat")
        if lon is None:
            lon = coordinates.get("longitude")
        if lat is None:
            lat = coordinates.get("latitude")
        if lon is not None and lat is not None:
            coordinates = _format_lat_lon(float(lon), float(lat))

    incident_data = {
        "site_id": region_id,
        "change_id": region_doc.get("change_id") or region_doc.get("incident_id") or f"CHG-{site_id}-{hash_suffix}",
        "coordinates": str(coordinates),
        "area_ha": float(area_ha),
        "category": region_doc.get("category") or region_doc.get("change_category") or default_category,
        "severity": region_doc.get("severity") or region_doc.get("severity_level") or default_severity,
        "date": region_doc.get("date") or region_doc.get("T2_timestamp") or region_doc.get("detected_at") or region_doc.get("incident_date") or timestamp,
        "status": "FLAGGED FOR INSPECTION",
    }
    return incident_data


async def _fetch_site_document(site_id: str):
    db = _async_db()

    try:
        collection_names = await db.list_collection_names()
    except Exception:
        collection_names = []

    for collection_name in ("regions", "sites", "site_reports", "incidents", "land_use_incidents"):
        if collection_name not in collection_names:
            continue
        collection = db[collection_name]
        doc = await collection.find_one({"$or": [{"site_id": site_id}, {"siteId": site_id}, {"region_id": site_id}]})
        if doc is not None:
            return doc

    return None


async def _fetch_gridfs_image_bytes(site_id: str, epoch: str) -> bytes | None:
    db = _async_db()
    bucket = AsyncIOMotorGridFSBucket(db, bucket_name="images")
    file_doc = await db["images.files"].find_one({
        "metadata.site_id": site_id,
        "metadata.epoch": epoch,
    })
    if file_doc is None:
        return None
    stream = await bucket.open_download_stream(file_doc["_id"])
    return await stream.read()

# Enable CORS for React frontend cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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

# Cache analysis results per site: the OpenCV pass costs ~2.5s and its output
# only changes when imagery is re-uploaded, so repeat site switches during a
# demo should be served from memory. Cleared on process restart.
_cached_analysis = lru_cache(maxsize=32)(process_change_detection)


@app.get("/api/analyze/{site_id}")
def analyze_site(site_id: str):
    """
    Analyzes satellite site imagery by ID (e.g., train_1)
    and returns GeoJSON change polygons and affected area metrics.
    """
    try:
        result = _cached_analysis(site_id)
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
    # Let the browser cache imagery: switching back to a previously viewed
    # site then skips the network entirely.
    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.post("/api/reports/generate/{site_id}")
async def generate_report(site_id: str):
    """Generate and stream a PDF incident report for a selected site."""
    try:
        site_data = await _fetch_site_document(site_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"MongoDB lookup failed: {exc}") from exc

    incident_data = _build_incident_payload(site_id, site_data)

    try:
        before_img_bytes = await _fetch_gridfs_image_bytes(site_id, "T1")
        after_img_bytes = await _fetch_gridfs_image_bytes(site_id, "T2")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Image lookup failed: {exc}") from exc

    if before_img_bytes is None and after_img_bytes is None:
        raise HTTPException(status_code=404, detail=f"No imagery found for site '{site_id}'.")

    if before_img_bytes is None:
        raise HTTPException(status_code=404, detail=f"Missing T1 image for site '{site_id}'.")
    if after_img_bytes is None:
        raise HTTPException(status_code=404, detail=f"Missing T2 image for site '{site_id}'.")

    pdf_bytes = generate_pdf_report(incident_data, before_img_bytes, after_img_bytes)
    safe_site_id = re.sub(r"[^A-Za-z0-9_-]+", "_", site_id)
    response = Response(content=pdf_bytes, media_type="application/pdf")
    response.headers["Content-Disposition"] = (
        f"attachment; filename=BHU_DRISHTI_Report_{safe_site_id}.pdf"
    )
    return response