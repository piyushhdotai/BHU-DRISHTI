# BHU-DRISHTI: Bi-temporal Geospatial Change Detection

BHU-DRISHTI is a full-stack web application for **detecting and classifying land changes from satellite imagery**. It compares a "before" (T1) and "after" (T2) image of the same site, extracts the regions that changed, classifies each change by type (construction, deforestation, mining, riverbed shift), and renders the results as interactive polygons on a synchronized before/after map.

---

## How It Works

```
┌──────────────────────────────────────────────────────────────────┐
│  MongoDB Atlas (GridFS)                                          │
│  Bi-temporal tiles: {site_id, epoch: T1 | T2 | label} → PNG      │
└──────────────▲───────────────────────────────────────────────────┘
               │ pymongo / GridFS
┌──────────────┴───────────────────────────────────────────────────┐
│  Backend — FastAPI (Python, OpenCV, NumPy, Shapely)              │
│                                                                  │
│  GET /api/analyze/{site_id}  runs the pipeline LIVE per request: │
│    1. Load T1/T2 PNGs from GridFS                                │
│    2. Build change mask (stored label, or CVA + Otsu fallback)   │
│    3. Morphological cleanup                                      │
│    4. Contour extraction + polygon simplification                │
│    5. Rule-based per-blob classification + confidence            │
│    6. Pixel → lon/lat mapping, area & severity metrics           │
│    → GeoJSON FeatureCollection                                   │
└──────────────▲───────────────────────────────────────────────────┘
               │ HTTP / GeoJSON / PNG
┌──────────────┴───────────────────────────────────────────────────┐
│  Frontend — React 19 + Vite + MapLibre GL JS                     │
│  Two synchronized maps (T1 left, T2 right) with a draggable      │
│  swipe slider, color-coded change polygons on both panes,        │
│  click popups (category, area, severity, confidence), stats      │
│  panel, category legend, dark/light theme.                       │
└──────────────────────────────────────────────────────────────────┘
```

### The detection pipeline (`Backend/change_detector.py`)

1. **Load imagery** — T1/T2 PNGs are fetched from MongoDB GridFS and decoded with OpenCV.
2. **Change mask** — if the site has a stored ground-truth `label` mask, it is used directly. Otherwise the algorithm computes one: Gaussian blur → **illumination matching** (T2 is normalized to T1's per-channel mean/std so global lighting drift doesn't trigger false changes) → **change vector analysis** (per-pixel Euclidean magnitude of the RGB difference) → **Otsu thresholding** to a binary mask.
3. **Morphological cleanup** — 5×5 opening then closing to remove noise and fill holes.
4. **Polygonization** — `cv2.findContours` (external contours only), blobs < 100 px² discarded, shapes simplified with `approxPolyDP` (ε = 1% of perimeter), invalid rings repaired with Shapely `buffer(0)`.
5. **Classification** (`Backend/change_classifier.py`) — a rule-based additive scoring system over spectral features (brightness delta, Excess-Green vegetation index delta, vegetation/water pixel fractions, soil proxy, texture) and shape features (rectangularity, aspect ratio, solidity). Categories:
   - `New Construction`
   - `Deforestation / Canopy Loss`
   - `Surface Excavation / Mining`
   - `Riverbed Shift`
   - `Cleared Ground / Other` (fallback)

   Confidence = `0.5 + 0.5·(top_score − second_score)/top_score`, clamped to [0.5, 1.0]. The module is deliberately structured so a trained ML model can later replace `classify_blob()`.
6. **Georeferencing & metrics** — pixels are mapped to lon/lat around a fixed anchor (currently synthetic — see Limitations). Area assumes 0.5 m/px ground resolution (px² × 0.25 m²) and is reported in m² and hectares. Severity by area: ≥ 0.15 ha Critical, ≥ 0.05 ha Medium, else Low.

**Live vs. cached:** analysis is computed **fresh on every `/api/analyze` request** — results are never cached or stored. Only the raw input images are persisted (MongoDB GridFS). There is no user image-upload flow; sites are pre-loaded into the database.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, plain JSX + CSS (CSS-variable light/dark themes) |
| Mapping | MapLibre GL JS v6, `@maplibre/maplibre-gl-compare` (swipe slider) |
| HTTP | axios |
| Backend | Python, FastAPI, uvicorn |
| Image processing | OpenCV, NumPy |
| Geometry | Shapely |
| Storage | MongoDB Atlas via GridFS (pymongo, dnspython, python-dotenv) |
| ML | None — classical CV + rule-based classification (ML-ready design) |

---

## Project Structure

```
BHU-DRISHTI/
├── Backend/
│   ├── main.py                    # FastAPI app + API endpoints
│   ├── change_detector.py         # Detection pipeline (mask → contours → GeoJSON)
│   ├── change_classifier.py       # Rule-based change classification
│   ├── image_store.py             # MongoDB GridFS storage layer
│   ├── migrate_images_to_mongo.py # One-time dataset bulk loader (folder or zip)
│   ├── check_polygons.py          # Dev sanity check for polygon validity
│   ├── requirements.txt
│   └── .env.example               # MONGODB_URI, MONGODB_DB
└── Frontend/
    └── src/
        ├── main.jsx               # Entry point
        ├── App.jsx                # Splash → Auth → Map state machine, theme
        └── components/
            ├── SplashScreen.jsx   # Animated landing splash
            ├── AuthScreen.jsx     # Demo login screen
            └── MapViewer.jsx      # The app: dual maps, slider, polygons, stats
```

---

## API Reference

Base URL: `http://127.0.0.1:8000`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Health check |
| GET | `/api/sites` | List site IDs that have both T1 and T2 stored |
| GET | `/api/analyze/{site_id}` | Run the full pipeline live; returns GeoJSON FeatureCollection |
| GET | `/api/sites/{site_id}/image/{T1\|T2}` | Stream the raw epoch PNG (used as map image sources) |

`GET /api/analyze/{site_id}` response shape:

```json
{
  "type": "FeatureCollection",
  "site_id": "train_1",
  "total_hotspots": 3,
  "category_summary": { "Deforestation / Canopy Loss": 2, "..." : 1 },
  "image_bounds": [[lon, lat], ...],
  "features": [
    {
      "type": "Feature",
      "properties": {
        "id": 1,
        "site_id": "train_1",
        "category": "Unauthorized Construction",
        "confidence": 0.87,
        "area_hectares": 0.21,
        "area_sqm": 2100.5,
        "severity": "Critical"
      },
      "geometry": { "type": "Polygon", "coordinates": [...] }
    }
  ]
}
```

---

## Getting Started

### Prerequisites

- **Node.js** v16+ (frontend)
- **Python** 3.8+ (backend)
- A **MongoDB Atlas** cluster (free tier works)

### 1. Backend

```bash
cd Backend

python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt

cp .env.example .env   # then fill in your values
```

`.env`:

```
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=bhu_drishti
```

Load imagery into MongoDB (one-time, from a dataset folder or zip organized as `<site>/<T1|T2|label>/*.png`):

```bash
python migrate_images_to_mongo.py --src ./data [--max-mb 400]
```

Run the API:

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Interactive docs available at `http://127.0.0.1:8000/docs`.

### 2. Frontend

```bash
cd Frontend
npm install
npm run dev
```

Open the printed local URL, log in with the demo credentials (`admin@bhudrishti.gov.in` / `admin123`), and pick a site from the **Region** dropdown.

---

## Known Limitations & Roadmap

- **Synthetic georeferencing** — coordinates are generated around a fixed anchor point (`BASE_LON/BASE_LAT` in `change_detector.py`) at an assumed 0.5 m/px. Swapping in properly georeferenced (GeoTIFF) imagery is the top roadmap item.
- **No result caching** — every analyze call recomputes the pipeline. Next step: compute on ingest + cache results per site.
- **Rule-based classifier** — `classify_blob()` is designed to be replaced by a trained model (e.g. a change-detection network) without touching the rest of the pipeline.
- **Demo auth** — login is client-side only with hardcoded credentials.
- **Static dataset** — imagery is pre-loaded; wiring a live imagery source (Sentinel-2, etc.) is future work.
