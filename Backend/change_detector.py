import cv2
import numpy as np
from shapely.geometry import Polygon, mapping

from change_classifier import extract_blob_features, classify_blob
from image_store import get_image_bytes

BASE_LON = -97.7431
BASE_LAT = 30.2672
SCALE_DEG = 0.005 / 1024.0

# Geographic footprint of a full 1024x1024 site image, matching the
# pixel -> lon/lat mapping used for polygons below.
# Order: top-left, top-right, bottom-right, bottom-left (MapLibre image source).
_HALF_SPAN = 512.0 * SCALE_DEG
IMAGE_BOUNDS = [
    [BASE_LON - _HALF_SPAN, BASE_LAT + _HALF_SPAN],
    [BASE_LON + _HALF_SPAN, BASE_LAT + _HALF_SPAN],
    [BASE_LON + _HALF_SPAN, BASE_LAT - _HALF_SPAN],
    [BASE_LON - _HALF_SPAN, BASE_LAT - _HALF_SPAN],
]


def _detect_change_mask(t1_color, t2_color):
    """
    Fallback change detection when no ground-truth label exists:
    blur, per-channel illumination matching of T2 to T1 (so global
    lighting drift doesn't dominate), difference magnitude (change
    vector analysis), Otsu threshold, then morphological cleanup.
    """
    t1 = cv2.GaussianBlur(t1_color, (5, 5), 0).astype(np.float32)
    t2 = cv2.GaussianBlur(t2_color, (5, 5), 0).astype(np.float32)
    for c in range(3):
        m1, s1 = cv2.meanStdDev(t1[:, :, c])
        m2, s2 = cv2.meanStdDev(t2[:, :, c])
        t2[:, :, c] = (t2[:, :, c] - m2[0][0]) * (s1[0][0] / max(s2[0][0], 1e-6)) + m1[0][0]

    diff = np.abs(t2 - t1)
    magnitude = np.sqrt((diff ** 2).sum(axis=2))
    magnitude = cv2.normalize(magnitude, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    _, mask = cv2.threshold(magnitude, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return mask


def _load_stored_image(site_id: str, epoch: str, flags):
    """Fetch PNG bytes from MongoDB and decode them with OpenCV."""
    data = get_image_bytes(site_id, epoch)
    if data is None:
        return None
    return cv2.imdecode(np.frombuffer(data, np.uint8), flags)


def process_change_detection(site_id: str):
    t1_color = _load_stored_image(site_id, "T1", cv2.IMREAD_COLOR)
    t2_color = _load_stored_image(site_id, "T2", cv2.IMREAD_COLOR)
    if t1_color is None or t2_color is None:
        return {"error": f"Image data for {site_id} not found."}

    mask = _load_stored_image(site_id, "label", cv2.IMREAD_GRAYSCALE)
    if mask is None:
        mask = _detect_change_mask(t1_color, t2_color)

    kernel = np.ones((5, 5), np.uint8)
    mask_clean = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask_clean = cv2.morphologyEx(mask_clean, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(mask_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    features = []
    category_summary = {}

    for idx, cnt in enumerate(contours):
        if cv2.contourArea(cnt) < 100:
            continue

        epsilon = 0.01 * cv2.arcLength(cnt, True)
        approx_cnt = cv2.approxPolyDP(cnt, epsilon, True)

        if len(approx_cnt) < 3:
            continue

        blob_features = extract_blob_features(t1_color, t2_color, cnt, mask.shape)
        category, confidence = classify_blob(blob_features)

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

        category_summary[category] = category_summary.get(category, 0) + 1

        feature = {
            "type": "Feature",
            "properties": {
                "id": idx + 1,
                "site_id": site_id,
                "category": category,
                "confidence": confidence,
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
        "category_summary": category_summary,
        "image_bounds": IMAGE_BOUNDS,
        "features": features
    }
