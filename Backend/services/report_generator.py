import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _clean_fallback(value: Any, fallback: str = "N/A") -> str:
    if value is None:
        return fallback
    if isinstance(value, str):
        clean = value.strip()
        if not clean or clean.lower() in {"-", "n/a", "na", "none", "null", "unknown", "nan"}:
            return fallback
        return clean
    if isinstance(value, (float, int)):
        if value != value or value in (float("inf"), float("-inf")):
            return fallback
        return str(value)
    return str(value)


def _as_text(value: Any, fallback: str = "N/A") -> str:
    if value is None:
        return fallback
    if isinstance(value, (list, tuple)):
        if not value:
            return fallback
        parts = [_clean_fallback(item, fallback) for item in value]
        return ", ".join(part for part in parts if part not in {fallback})
    return _clean_fallback(value, fallback)


def _normalize_coordinates(value: Any) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, dict):
        lon = value.get("lon")
        lat = value.get("lat")
        if lon is None and "longitude" in value:
            lon = value.get("longitude")
        if lat is None and "latitude" in value:
            lat = value.get("latitude")
        if lon is not None and lat is not None:
            return f"{_clean_fallback(lon, '0.0000')}, {_clean_fallback(lat, '0.0000')}"
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return f"{_clean_fallback(value[0], '0.0000')}, {_clean_fallback(value[1], '0.0000')}"
    cleaned = _clean_fallback(value, "N/A")
    return cleaned if cleaned != "N/A" else "N/A"


def _normalize_area(value: Any) -> str:
    if value is None:
        return "N/A"
    try:
        area = float(value)
        if area != area or area in (float("inf"), float("-inf")):
            return "N/A"
        return f"{area:.3f} ha"
    except (TypeError, ValueError):
        cleaned = _clean_fallback(value, "N/A")
        if cleaned == "N/A":
            return "N/A"
        return cleaned


def _card_image(raw_bytes: bytes | None, caption: str):
    if not raw_bytes:
        styles = getSampleStyleSheet()
        return Paragraph(f"{caption}: image unavailable", styles["BodyText"])

    try:
        return Image(io.BytesIO(raw_bytes), width=240, height=180, kind="proportional")
    except Exception:
        styles = getSampleStyleSheet()
        return Paragraph(f"{caption}: unable to render image", styles["BodyText"])


def generate_pdf_report(site_data: dict, before_img_bytes: bytes, after_img_bytes: bytes) -> bytes:
    """Build an in-memory PDF report for a flagged land-use incident."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=LETTER,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
        title="BHU-DRISHTI Land-Use Change Detection Report",
        author="BHU-DRISHTI",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "TitleStyle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=20,
        textColor=colors.HexColor("#1d4ed8"),
        spaceAfter=12,
        alignment=1,
    )
    heading_style = ParagraphStyle(
        "HeadingStyle",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=12,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=10,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        "BodyText",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#1f2937"),
    )

    site_id = site_data.get("site_id") or site_data.get("siteId") or "unknown-site"
    report_id = site_data.get("change_id") or site_data.get("incident_id") or site_data.get("id") or "N/A"
    coordinates = site_data.get("coordinates") or site_data.get("location") or site_data.get("geo_coordinates") or "-"
    category = site_data.get("category") or site_data.get("change_category") or site_data.get("land_use_category") or "Unspecified"
    severity = site_data.get("severity") or site_data.get("severity_level") or "Unspecified"
    area_ha = (
        site_data.get("affected_area_ha")
        or site_data.get("affected_area")
        or site_data.get("area_ha")
        or site_data.get("area_hectares")
        or site_data.get("total_area_ha")
        or 0
    )
    report_date = site_data.get("date") or site_data.get("detected_at") or site_data.get("incident_date") or "N/A"

    metadata = [
        [Paragraph("Field", heading_style), Paragraph("Value", heading_style)],
        [Paragraph("Site ID", body_style), Paragraph(_as_text(site_id), body_style)],
        [Paragraph("Change ID", body_style), Paragraph(_as_text(report_id), body_style)],
        [Paragraph("Coordinates", body_style), Paragraph(_normalize_coordinates(coordinates), body_style)],
        [Paragraph("Affected Area (ha)", body_style), Paragraph(_normalize_area(area_ha), body_style)],
        [Paragraph("Change Category", body_style), Paragraph(_as_text(category), body_style)],
        [Paragraph("Severity Level", body_style), Paragraph(_as_text(severity), body_style)],
        [Paragraph("Incident Date", body_style), Paragraph(_as_text(report_date), body_style)],
        [Paragraph("Status", body_style), Paragraph("FLAGGED FOR INSPECTION", body_style)],
    ]

    table = Table(metadata, colWidths=[190, 320], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dbeafe")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 1, colors.HexColor("#cbd5e1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )

    image_row = [
        [
            _card_image(before_img_bytes, "T1 - Baseline"),
            _card_image(after_img_bytes, "T2 - Detected Anomaly"),
        ]
    ]
    image_table = Table(image_row, colWidths=[250, 250])
    image_table.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )

    action_text = (
        "Recommended enforcement action: dispatch a field inspection team, validate the flagged land-use change "
        "against site permits, and initiate regulatory follow-up if the activity is confirmed to be unauthorized."
    )

    story = [
        Paragraph("BHU-DRISHTI: Land-Use Change Detection Report", title_style),
        Paragraph(f"Prepared for site: {site_id}", body_style),
        Spacer(1, 12),
        Paragraph("Incident metadata", heading_style),
        table,
        Spacer(1, 16),
        Paragraph("Baseline vs detected anomaly imagery", heading_style),
        image_table,
        Spacer(1, 16),
        Paragraph("Recommended Enforcement Action", heading_style),
        Paragraph(action_text, body_style),
    ]

    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes
