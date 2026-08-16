"""
Rule-based per-blob change classification for BHU-DRISHTI.

Classifies a detected change contour into a land-use change category using
spectral cues (vegetation / soil / water proxies, brightness deltas between
the two epochs) and shape geometry (rectangularity, aspect ratio, solidity).

The dataset is RGB-only, so all indices are RGB proxies. The module is
structured so a trained model can later replace classify_blob() without
touching the rest of the pipeline.
"""

import cv2
import numpy as np

CAT_CONSTRUCTION = "New Construction"
CAT_DEFORESTATION = "Deforestation / Canopy Loss"
CAT_MINING = "Surface Excavation / Mining"
CAT_RIVERBED = "Riverbed Shift"
CAT_OTHER = "Cleared Ground / Other"

CATEGORIES = [CAT_CONSTRUCTION, CAT_DEFORESTATION, CAT_MINING, CAT_RIVERBED, CAT_OTHER]

_EPS = 1e-6


def _masked_mean_bgr(img_bgr, mask):
    """Mean BGR within mask -> (b, g, r) floats."""
    b, g, r = cv2.mean(img_bgr, mask=mask)[:3]
    return b, g, r


def _pixel_fraction(condition_mask, blob_mask):
    """Fraction of blob pixels where condition_mask is set."""
    blob_px = int(np.count_nonzero(blob_mask))
    if blob_px == 0:
        return 0.0
    hits = int(np.count_nonzero(cv2.bitwise_and(condition_mask, blob_mask)))
    return hits / blob_px


def extract_blob_features(t1_bgr, t2_bgr, contour, image_shape):
    """
    Compute spectral + shape features for one change contour.

    t1_bgr / t2_bgr: full-resolution color images (OpenCV BGR order).
    contour: cv2 contour of the change blob.
    image_shape: (height, width) of the imagery.
    """
    # Filled blob mask, lightly eroded so border pixels don't bleed in
    # surrounding land cover.
    blob_mask = np.zeros(image_shape[:2], dtype=np.uint8)
    cv2.drawContours(blob_mask, [contour], -1, 255, thickness=cv2.FILLED)
    eroded = cv2.erode(blob_mask, np.ones((3, 3), np.uint8), iterations=1)
    if cv2.countNonZero(eroded) > 0:
        blob_mask = eroded

    # --- Spectral means per epoch ---
    b1, g1, r1 = _masked_mean_bgr(t1_bgr, blob_mask)
    b2, g2, r2 = _masked_mean_bgr(t2_bgr, blob_mask)

    v1 = (b1 + g1 + r1) / 3.0
    v2 = (b2 + g2 + r2) / 3.0
    exg1 = (2.0 * g1 - r1 - b1) / (r1 + g1 + b1 + _EPS)
    exg2 = (2.0 * g2 - r2 - b2) / (r2 + g2 + b2 + _EPS)

    # --- Per-pixel land-cover fractions ---
    # Vegetation in this imagery is dark green: green channel dominant.
    b_ch1, g_ch1, r_ch1 = cv2.split(t1_bgr)
    b_ch2, g_ch2, r_ch2 = cv2.split(t2_bgr)
    veg1 = ((g_ch1 > r_ch1) & (g_ch1 > b_ch1)).astype(np.uint8) * 255
    veg2 = ((g_ch2 > r_ch2) & (g_ch2 > b_ch2)).astype(np.uint8) * 255
    # Water: dark, blue-dominant (blue >= red, green >= red).
    gray1 = cv2.cvtColor(t1_bgr, cv2.COLOR_BGR2GRAY)
    wat1 = ((b_ch1 >= r_ch1) & (g_ch1 >= r_ch1)).astype(np.uint8) * 255
    wat1[gray1 >= 120] = 0
    wat2 = ((b_ch2 >= r_ch2) & (g_ch2 >= r_ch2)).astype(np.uint8) * 255
    wat2[(t2_bgr.mean(axis=2) >= 120)] = 0

    veg_frac1 = _pixel_fraction(veg1, blob_mask)
    veg_frac2 = _pixel_fraction(veg2, blob_mask)
    water_frac1 = _pixel_fraction(wat1, blob_mask)
    water_frac2 = _pixel_fraction(wat2, blob_mask)

    # Soil proxy from T2 means: red-dominant tan/brown ordering.
    soil_t2 = bool(r2 > g2 > b2)

    # --- Texture in T2 (mottled bare earth / spoil vs flat roof) ---
    gray2 = cv2.cvtColor(t2_bgr, cv2.COLOR_BGR2GRAY)
    _, std2 = cv2.meanStdDev(gray2, mask=blob_mask)
    texture_t2 = float(std2[0][0])

    # --- Shape geometry ---
    area = cv2.contourArea(contour)
    (_, _), (rw, rh), _ = cv2.minAreaRect(contour)
    rect_area = max(rw * rh, _EPS)
    rectangularity = min(area / rect_area, 1.0)
    short_side = max(min(rw, rh), _EPS)
    aspect = max(rw, rh) / short_side
    hull = cv2.convexHull(contour)
    hull_area = max(cv2.contourArea(hull), _EPS)
    solidity = min(area / hull_area, 1.0)

    return {
        "v1": v1, "v2": v2, "dV": v2 - v1,
        "exg1": exg1, "exg2": exg2, "dExG": exg2 - exg1,
        "veg_frac1": veg_frac1, "veg_frac2": veg_frac2,
        "water_frac1": water_frac1, "water_frac2": water_frac2,
        "soil_t2": soil_t2,
        "texture_t2": texture_t2,
        "rectangularity": rectangularity,
        "aspect": aspect,
        "solidity": solidity,
    }


def classify_blob(f):
    """
    Score-based classification. Returns (category, confidence in [0.5, 1.0]).
    """
    scores = {cat: 0.0 for cat in CATEGORIES}

    # Unauthorized Construction: brightening to a non-vegetated, compact,
    # rectangular patch (rooftop / paved structure).
    if f["dV"] > 25:
        scores[CAT_CONSTRUCTION] += 2
    elif f["dV"] > 10:
        scores[CAT_CONSTRUCTION] += 1
    if f["veg_frac2"] < 0.2 and f["dExG"] <= 0:
        scores[CAT_CONSTRUCTION] += 1
    if f["rectangularity"] > 0.55:
        scores[CAT_CONSTRUCTION] += 1
    if f["solidity"] > 0.85:
        scores[CAT_CONSTRUCTION] += 1
    if f["water_frac2"] > 0.3:
        scores[CAT_CONSTRUCTION] -= 2

    # Deforestation / Canopy Loss: vegetation present in T1, gone in T2,
    # canopy (dark green) replaced by brighter soil.
    if f["dExG"] < -0.05:
        scores[CAT_DEFORESTATION] += 2
    if f["veg_frac1"] - f["veg_frac2"] > 0.2:
        scores[CAT_DEFORESTATION] += 2
    if f["dV"] > 10:
        scores[CAT_DEFORESTATION] += 1
    if f["soil_t2"]:
        scores[CAT_DEFORESTATION] += 1

    # Surface Excavation / Mining: darkening pits or mottled spoil,
    # irregular outline, no water signature.
    if f["dV"] < -15:
        scores[CAT_MINING] += 2
    if f["texture_t2"] > 45:
        scores[CAT_MINING] += 1
    if f["rectangularity"] < 0.45:
        scores[CAT_MINING] += 1
    if f["dExG"] < 0:
        scores[CAT_MINING] += 1
    if f["water_frac2"] > 0.4:
        scores[CAT_MINING] -= 2

    # Riverbed Shift: elongated blob where water was gained or lost
    # between epochs.
    water_flip = (f["water_frac1"] > 0.4) != (f["water_frac2"] > 0.4)
    if water_flip:
        scores[CAT_RIVERBED] += 3
    if f["aspect"] > 4.0:
        scores[CAT_RIVERBED] += 2
    elif f["aspect"] > 2.5:
        scores[CAT_RIVERBED] += 1
    if f["water_frac2"] > 0.4 and f["dV"] < -10:
        scores[CAT_RIVERBED] += 1

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    top_cat, top_score = ranked[0]
    second_score = ranked[1][1]

    if top_score < 2:
        return CAT_OTHER, 0.5

    confidence = 0.5 + 0.5 * (top_score - max(second_score, 0.0)) / top_score
    return top_cat, round(min(confidence, 1.0), 2)
