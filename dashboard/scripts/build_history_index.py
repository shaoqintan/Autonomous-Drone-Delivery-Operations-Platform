from __future__ import annotations

import csv
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "zipline_hackathon_practice_pack" / "data_us_commercial"
OUTPUT = ROOT / "dashboard" / "app" / "data" / "history-index.json"


def read_csv(name: str) -> list[dict[str, str]]:
    with (DATA_DIR / name).open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def number(value: str) -> float | None:
    if value == "":
        return None
    return float(value)


def compact_operation(row: dict[str, str]) -> dict[str, object]:
    return {
        "flightId": row["flight_id"],
        "orderId": row["order_id"],
        "droneId": row["drone_id"],
        "site": row["fulfillment_site"],
        "merchantId": row["merchant_id"],
        "merchant": row["merchant_name"],
        "zone": row["delivery_zone"],
        "launchAt": row["launch_at"],
        "deliveredAt": row["delivered_at"] or None,
        "status": row["status"],
        "anomaly": row["anomaly_flag"],
        "operatorNote": row["operator_note"],
        "promisedMinutes": number(row["promised_minutes"]),
        "actualMinutes": number(row["actual_minutes"]),
        "batteryConsumptionPct": number(row["battery_consumption_pct"]),
        "windKph": number(row["wind_speed_kph"]),
        "visibilityKm": number(row["visibility_km"]),
    }


def compact_readiness(row: dict[str, str]) -> dict[str, object]:
    return {
        "id": row["merchant_event_id"],
        "orderId": row["order_id"],
        "merchantId": row["merchant_id"],
        "merchant": row["merchant_name"],
        "eventAt": row["event_at"],
        "status": row["ready_status"],
        "estimatedPrepMinutes": number(row["estimated_prep_min"]),
        "additionalDelayMinutes": number(row["additional_delay_min"]),
        "handoffVerified": row["handoff_verified"].lower() == "true",
    }


def compact_health(row: dict[str, str]) -> dict[str, object]:
    return {
        "date": row["snapshot_date"],
        "droneId": row["drone_id"],
        "site": row["home_site"],
        "batteryCapacityPct": number(row["battery_capacity_pct"]),
        "cellSpreadMv": number(row["cell_voltage_spread_mv"]),
        "motorVibrationMmS": number(row["motor_vibration_mm_s"]),
        "tetherDescentBaselineSec": number(row["tether_descent_baseline_sec"]),
        "maintenanceStatus": row["maintenance_status"],
    }


def compact_weather(row: dict[str, str]) -> dict[str, object]:
    return {
        "observedAt": row["observed_at"],
        "site": row["fulfillment_site"],
        "windKph": number(row["wind_speed_kph"]),
        "gustKph": number(row["wind_gust_kph"]),
        "visibilityKm": number(row["visibility_km"]),
        "condition": row["operating_condition"],
    }


def parse_incident(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    title_match = re.search(r"^#\s+([^:]+):\s*(.+)$", text, re.MULTILINE)
    date_match = re.search(r"^Date:\s*(.+)$", text, re.MULTILINE)
    topic_match = re.search(r"^Topic:\s*(.+)$", text, re.MULTILINE)
    narrative_match = re.search(
        r"## Narrative\s+(.+?)(?:\s+## Copilot use|\Z)",
        text,
        re.DOTALL,
    )
    return {
        "id": title_match.group(1).strip() if title_match else path.stem,
        "title": title_match.group(2).strip() if title_match else path.stem,
        "date": date_match.group(1).strip() if date_match else "",
        "topic": topic_match.group(1).strip() if topic_match else "operations",
        "narrative": " ".join(narrative_match.group(1).split())
        if narrative_match
        else "",
        "dataset": f"incident_and_handover_reports/{path.name}",
    }


def dataset_entry(name: str, rows: list[dict[str, str]]) -> dict[str, object]:
    return {
        "name": name,
        "records": len(rows),
    }


def main() -> None:
    operations_raw = read_csv("commercial_delivery_operations.csv")
    orders_raw = read_csv("commercial_orders.csv")
    readiness_raw = read_csv("merchant_readiness_events.csv")
    telemetry_raw = read_csv("flight_telemetry_phases.csv")
    support_raw = read_csv("customer_support_tickets.csv")
    feedback_raw = read_csv("customer_feedback.csv")
    maintenance_raw = read_csv("maintenance_events.csv")
    health_raw = read_csv("drone_health_daily.csv")
    fleet_raw = read_csv("fleet_assets.csv")
    merchant_raw = read_csv("merchant_directory.csv")
    weather_raw = read_csv("service_area_weather_hourly.csv")

    incidents = [
        parse_incident(path)
        for path in sorted((DATA_DIR / "incident_and_handover_reports").glob("CR-*.md"))
    ]

    policies = [
        {
            "id": "POL-WEATHER-HOLD",
            "section": "Weather and release",
            "text": "Hold launch when sustained wind exceeds 35 kph, gusts exceed 42 kph, or visibility is under 3 km.",
            "dataset": "OPERATING_POLICY.md",
        },
        {
            "id": "POL-WEATHER-REVIEW",
            "section": "Weather and release",
            "text": "Operator review is required at 26–35 kph sustained wind, 34–42 kph gusts, or 3–7 km visibility.",
            "dataset": "OPERATING_POLICY.md",
        },
        {
            "id": "POL-VERIFIED-COMPLETION",
            "section": "Customer and merchant handling",
            "text": "A delivery is successful only after verified completion. Returned or inaccessible drop zones are exceptions.",
            "dataset": "OPERATING_POLICY.md",
        },
        {
            "id": "POL-MERCHANT-READY",
            "section": "Customer and merchant handling",
            "text": "Use actual merchant-ready status, not order acceptance, when estimating a customer promise.",
            "dataset": "OPERATING_POLICY.md",
        },
        {
            "id": "POL-HUMAN-DECISION",
            "section": "Customer and merchant handling",
            "text": "For weather holds or operational exceptions, the copilot may recommend actions, but a human operator owns the decision.",
            "dataset": "OPERATING_POLICY.md",
        },
        {
            "id": "POL-FLEET-GROUND",
            "section": "Fleet escalation",
            "text": "Ground for battery capacity below 80%, cell-voltage spread over 60 mV, or motor vibration over 3.0 mm/s.",
            "dataset": "OPERATING_POLICY.md",
        },
        {
            "id": "POL-FLEET-RESTRICT",
            "section": "Fleet escalation",
            "text": "Restrict and open maintenance review for battery capacity 80–84%, spread 45–60 mV, or vibration 2.2–3.0 mm/s.",
            "dataset": "OPERATING_POLICY.md",
        },
        {
            "id": "POL-NO-AUTHORIZATION",
            "section": "Fleet escalation",
            "text": "The copilot may summarize evidence and policies. It must never state that a flight is authorized or safe to launch.",
            "dataset": "OPERATING_POLICY.md",
        },
    ]

    datasets = [
        dataset_entry("commercial_delivery_operations.csv", operations_raw),
        dataset_entry("commercial_orders.csv", orders_raw),
        dataset_entry("merchant_readiness_events.csv", readiness_raw),
        dataset_entry("flight_telemetry_phases.csv", telemetry_raw),
        dataset_entry("customer_support_tickets.csv", support_raw),
        dataset_entry("customer_feedback.csv", feedback_raw),
        dataset_entry("maintenance_events.csv", maintenance_raw),
        dataset_entry("drone_health_daily.csv", health_raw),
        dataset_entry("fleet_assets.csv", fleet_raw),
        dataset_entry("merchant_directory.csv", merchant_raw),
        dataset_entry("service_area_weather_hourly.csv", weather_raw),
        {
            "name": "incident_and_handover_reports",
            "records": len(incidents),
        },
        {
            "name": "OPERATING_POLICY.md",
            "records": len(policies),
        },
    ]

    operations = [compact_operation(row) for row in operations_raw]
    payload = {
        "summary": {
            "datasetCount": len(datasets),
            "recordCount": sum(int(item["records"]) for item in datasets),
            "dateFrom": min(row["launchAt"] for row in operations),
            "dateTo": max(row["launchAt"] for row in operations),
            "flightCount": len(operations),
            "incidentCount": len(incidents),
            "sites": sorted({str(row["site"]) for row in operations}),
        },
        "datasets": datasets,
        "policies": policies,
        "incidents": incidents,
        "operations": operations,
        "readiness": [compact_readiness(row) for row in readiness_raw],
        "health": [compact_health(row) for row in health_raw],
        "weather": [compact_weather(row) for row in weather_raw],
        "maintenance": maintenance_raw,
    }

    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
