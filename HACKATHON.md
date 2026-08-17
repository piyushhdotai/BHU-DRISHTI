# BHU-DRISHTI — Hackathon Presentation Guide

Speaker notes, demo script, and Q&A prep. Keep this off the projector; it's for the team.

---

## The 30-Second Pitch

> "Land changes fast — illegal and new construction, deforestation, mining — and authorities find out too late. BHU-DRISHTI ('drishti' = vision) watches the ground for you: it compares two satellite images of the same place, automatically finds what changed, classifies each change — construction, deforestation, mining, riverbed shift — and puts it on an interactive map with area, severity, and confidence. No ML training data needed: it's classical computer vision, so it works on any pair of RGB satellite tiles today, and the classifier is a plug-in point for a trained model tomorrow."

## Talk Track (5 minutes)

1. **Problem (45s)** — Land-use violations and environmental damage are detected manually, late, or never. Satellite imagery exists, but raw pixels don't tell anyone *what changed and where*.
2. **What it does (60s)** — Show the app: two time-points of the same site, changes as colored polygons, each with a category, confidence, area, and severity. Emphasize: **this is computed live, not canned** — then prove it in the demo by switching sites.
3. **How it works (90s)** — Walk the pipeline slide:
   - Images stored in MongoDB Atlas (GridFS) → FastAPI serves them
   - Illumination matching so lighting/season differences don't cause false alarms
   - Change vector analysis + Otsu thresholding → binary change mask
   - Contours → polygons → rule-based spectral/shape classifier (vegetation index, brightness delta, water, texture, rectangularity)
   - GeoJSON → MapLibre dual-map swipe UI
4. **Engineering highlights (45s)** — Pick 2–3:
   - Illumination normalization (the difference between a toy and a usable tool)
   - Rule-based classifier designed as a drop-in replacement point for an ML model
   - Full-stack: FastAPI + MongoDB GridFS + React/MapLibre, GeoJSON as the contract
   - Polygon repair/validation (Shapely), XSS-escaped popups, strict GeoJSON validation on the client
5. **Roadmap (30s)** — Real georeferencing (GeoTIFF), result caching / compute-on-ingest, trained classifier, live Sentinel-2 feed.

## Demo Script (practice this order)

1. Open app → splash → login: `admin@bhudrishti.gov.in` / `admin123`
2. App loads default site; point out: stats panel (change count, total area), legend, T1/T2 chips
3. **Drag the swipe slider** — the money shot: polygons stay glued to the ground on both epochs
4. **Click a polygon** — popup: category, area (m² + ha), severity, confidence
5. **Switch sites in the Region dropdown** — say "this is the pipeline running live on the server right now" (the loading state makes this visible)
6. Toggle dark/light mode if the room asks about UI polish
7. Optional: show `http://127.0.0.1:8000/docs` (auto-generated FastAPI Swagger UI) to prove it's a real API

Pre-demo checklist:

- [ ] MongoDB Atlas reachable from the venue network (test `/api/sites`!) — venue Wi-Fi is the #1 demo killer; a phone hotspot backup is wise
- [ ] Backend running (`uvicorn main:app --reload --host 127.0.0.1 --port 8000`), frontend running (`npm run dev`)
- [ ] `Backend/.env` never on screen (contains DB credentials)
- [ ] Browser zoom set so map + stats panel are readable from the back row
- [ ] If the network dies: have screenshots/screen recording of the full flow as fallback

## Anticipated Q&A — with honest answers

**"Is this ML?"**
No — deliberately. It's classical CV (Otsu, morphology, contours) plus a rule-based classifier using spectral indices like Excess Green. That means zero training data, instant inference, fully explainable decisions. The classifier is isolated behind `classify_blob()` so a trained model can replace it without touching the pipeline — that's the design, not an accident.

**"Are the results precomputed?"**
No. Every site selection triggers a live run of the full pipeline on the server — nothing is cached. (If asked about scale: that's the first thing we'd add — compute-on-ingest with cached results per site.)

**"Can users upload their own images?"**
Not yet — sites are pre-loaded into MongoDB via a migration script. The storage layer (`image_store.py`) already has an `upload_image()` function; an upload endpoint is a small addition.

**"Are those real coordinates?"**
Honest answer: the pipeline is real, but georeferencing is currently synthetic — a fixed anchor and assumed 0.5 m/px, because the demo dataset (LEVIR-CD-style RGB tiles) ships without georeference metadata. With GeoTIFF input, the same polygon step would emit real coordinates via affine transform.

**"Where does the imagery come from?"**
A standard bi-temporal change-detection dataset (T1/T2 pairs with ground-truth labels), bulk-loaded into MongoDB Atlas GridFS. When a ground-truth label exists, the pipeline can use it as the change mask; without one, the differencing algorithm does the detection itself.

**"Why MongoDB for images?"**
GridFS stores files with metadata (`site_id`, `epoch`) alongside the bytes — one query gets "all sites with both epochs," and there's no filesystem to manage. It also means the backend is stateless and the dataset survives redeploys.

**"False positives from lighting/seasons?"**
That's exactly what illumination matching handles: T2 is normalized to T1's per-channel mean and standard deviation before differencing, so global brightness shifts cancel out and only *structural* changes survive the threshold.

**"How does it tell construction from deforestation?"**
Construction brightens, is non-vegetated, and has rectangular, solid shapes. Deforestation is the opposite spectral signature: the Excess-Green vegetation index drops sharply and soil tones appear. Mining darkens with high texture; riverbed shifts flip water-presence and are elongated (high aspect ratio). Each blob is scored against all categories; confidence reflects the margin between the top two scores.

**"What was the hardest bug?"**
MapLibre GL v6's web worker breaks under Vite's pre-bundling — GeoJSON sources silently never rendered. Fixed by serving a static worker copy from `public/` and setting it via `maplibregl.setWorkerUrl()`.

**"Security?"**
Current login is a demo gate (client-side, hardcoded credentials). Real auth + role-based access is roadmap. CORS is open for local dev only.

## Category Color Key (for narrating the map)

| Color | Category |
|---|---|
| Orange | New / Unauthorized Construction |
| Red | Deforestation / Canopy Loss |
| Magenta | Surface Excavation / Mining |
| Blue | Riverbed Shift |
| Green | Cleared Ground / Other |

Severity is by changed area: **Critical** ≥ 0.15 ha, **Medium** ≥ 0.05 ha, **Low** below that.

## One-Slide Architecture Summary

```
MongoDB Atlas (GridFS: T1/T2/label PNGs)
        │  pymongo
FastAPI backend ── /api/analyze runs LIVE per request:
  illumination matching → change vector analysis → Otsu
  → morphology → contours → rule-based classifier → GeoJSON
        │  axios / image sources
React 19 + MapLibre GL: dual synced maps, swipe slider,
  colored change polygons, click popups, stats panel
```
