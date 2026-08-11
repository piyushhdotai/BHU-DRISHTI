# BHU-DRISHTI: Bi-temporal Geospatial Change Detection

BHU-DRISHTI is a full-stack web application designed for bi-temporal geospatial change detection and satellite imagery analysis. It provides a side-by-side comparison interface using MapLibre GL to visualize geographic data layers and polygon overlays across different regions.

---

## Project Structure

* **`Frontend/`** - React.js single-page application utilizing MapLibre GL for client-side map rendering.
* **`Backend/`** - Python backend API server serving geospatial analysis endpoints and GeoJSON payloads.

---

## Getting Started & Installation Instructions

Follow these steps to set up and run the project locally on your machine.

### Prerequisites
* **Node.js** (v16 or higher) installed for the frontend.
* **Python** (v3.8 or higher) installed for the backend.

---

### 1. Setting Up the Backend Server

1. Navigate to the backend directory:
   ```bash
   cd Backend

2. Create and activate a Python virtual environment:
   python -m venv venv
   
   # On Windows:
   venv\Scripts\activate
   
   # On macOS/Linux:
   source venv/bin/activate
3. pip install -r requirements.txt
4. uvicorn main:app --reload --host 127.0.0.1 --port 8000

### 2. Setting Up the Frontend Server

1. cd Frontend
2. npm install
3. npm install

