from change_detector import process_change_detection
from shapely.geometry import shape

result = process_change_detection("train_1")
for f in result["features"]:
    poly = shape(f["geometry"])
    print(
        f["properties"]["id"],
        "valid:", poly.is_valid,
        "area:", poly.area,
        "points:", len(f["geometry"]["coordinates"][0])
    )