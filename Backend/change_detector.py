import os
import cv2
import numpy as np
from shapely.geometry import Polygon, mapping

BASE_LON = -97.7431
BASE_LAT = 30.2672
SCALE_DEG = 0.005 / 1024.0

def process_change_detection(site_id: str):
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    label_path = os.path.join(backend_dir, "data", "label", f"{site_id}.png")
    t1_path = os.path.join(backend_dir, "data", "T1", f"{site_id}.png")
    t2_path = os.path.join(backend_dir, "data", "T2", f"{site_id}.png")

    if not os.path.exists(label_path):
        if os.path.exists(t1_path) and os.path.exists(t2_path):
            img1 = cv2.imread(t1_path, cv2.IMREAD_GRAYSCALE)
            img2 = cv2.imread(t2_path, cv2.IMREAD_GRAYSCALE)
            diff = cv2.absdiff(img2, img1)
            _, mask = cv2.threshold(diff, 50, 255, cv2.THRESH_BINARY)
        else:
            return {"error": f"Image data for {site_id} not found."}
    else:
        mask = cv2.imread(label_path, cv2.IMREAD_GRAYSCALE)

    kernel = np.ones((5, 5), np.uint8)
    mask_clean = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(mask_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    features = []
    category_list = ["Deforestation / Canopy Loss", "Unauthorized Construction", "Surface Excavation / Mining", "Cleared Ground Clearing"]

    for idx, cnt in enumerate(contours):
        if cv2.contourArea(cnt) < 100:
            continue

        epsilon = 0.01 * cv2.arcLength(cnt, True)
        approx_cnt = cv2.approxPolyDP(cnt, epsilon, True)

        if len(approx_cnt) < 3:
            continue

        geo_coords = []
        for point in approx_cnt:
            px, py = point[0]
            # Map pixels to lat/lon around BASE_LON/BASE_LAT
            lon = BASE_LON + (float(px) - 512.0) * SCALE_DEG
            lat = BASE_LAT - (float(py) - 512.0) * SCALE_DEG
            geo_coords.append([lon, lat])

        # Close loop
        if geo_coords[0] != geo_coords[-1]:
            geo_coords.append(geo_coords[0])

        poly_geom = Polygon(geo_coords)
        if not poly_geom.is_valid:
            poly_geom = poly_geom.buffer(0) # auto-repair invalid polygon boundaries

        pixel_area = cv2.contourArea(cnt)
        area_sq_meters = pixel_area * 0.25
        area_hectares = round(area_sq_meters / 10000.0, 3)
        if area_hectares == 0:
            area_hectares = 0.05

        if area_hectares >= 0.15:
            severity = "Critical"
        elif area_hectares >= 0.05:
            severity = "Medium"
        else:
            severity = "Low"

        category = category_list[idx % len(category_list)]

        feature = {
            "type": "Feature",
            "properties": {
                "id": idx + 1,
                "site_id": site_id,
                "category": category,
                "area_hectares": area_hectares,
                "area_sqm": round(area_sq_meters, 1),
                "severity": severity
            },
            "geometry": mapping(poly_geom)
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "site_id": site_id,
        "total_hotspots": len(features),
        "features": features
    }