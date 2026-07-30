from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "zipline_hackathon_practice_pack" / "data_us_commercial"
OUTPUT = Path(__file__).resolve().parents[1] / "app" / "data" / "live-scenarios.json"

SCENARIOS = [
    {
        "id": "battery-grounding",
        "label": "Battery grounding",
        "description": "ZIP-US-011 deterioration and assignment conflict",
        "now": "2025-05-15T14:40:00",
        "timelineStart": "2025-05-15T14:00:00",
        "timelineEnd": "2025-05-15T14:40:00",
    },
    {
        "id": "eastside-weather",
        "label": "Eastside wind hold",
        "description": "Gusts exceed the launch-hold threshold",
        "now": "2025-05-06T17:45:00",
        "timelineStart": "2025-05-06T16:55:00",
        "timelineEnd": "2025-05-06T17:45:00",
    },
    {
        "id": "tether-variance",
        "label": "Tether variance",
        "description": "ZIP-US-019 differs from its historical baseline",
        "now": "2025-06-06T11:35:00",
        "timelineStart": "2025-06-06T11:00:00",
        "timelineEnd": "2025-06-06T11:35:00",
    },
    {
        "id": "merchant-readiness",
        "label": "Merchant readiness",
        "description": "Pasta Garden readiness uncertainty",
        "now": "2025-04-24T12:25:00",
        "timelineStart": "2025-04-24T12:00:00",
        "timelineEnd": "2025-04-24T12:25:00",
    },
]

PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}


def read_csv(name: str) -> list[dict[str, str]]:
    with (DATA / name).open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def number(value: str | None) -> float | None:
    return float(value) if value not in (None, "") else None


def truthy(value: str | None) -> bool:
    return str(value).lower() == "true"


def iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") if value else None


def compact_site(value: str) -> str:
    return value.replace("_Fulfillment", "").replace("_", " ")


def health_policy(row: dict[str, str]) -> tuple[str, list[str]]:
    capacity = number(row["battery_capacity_pct"]) or 0
    spread = number(row["cell_voltage_spread_mv"]) or 0
    vibration = number(row["motor_vibration_mm_s"]) or 0
    grounds: list[str] = []
    reviews: list[str] = []
    if capacity < 80:
        grounds.append("FLEET_GROUND_CAPACITY")
    if spread > 60:
        grounds.append("FLEET_GROUND_SPREAD")
    if vibration > 3:
        grounds.append("FLEET_GROUND_VIBRATION")
    if 80 <= capacity <= 84:
        reviews.append("FLEET_RESTRICT_CAPACITY")
    if 45 <= spread <= 60:
        reviews.append("FLEET_RESTRICT_SPREAD")
    if 2.2 <= vibration <= 3:
        reviews.append("FLEET_RESTRICT_VIBRATION")
    if grounds:
        return "ground", grounds
    if reviews:
        return "restrict", reviews
    return "normal", []


def weather_policy(row: dict[str, str]) -> tuple[str, list[str]]:
    wind = number(row["wind_speed_kph"]) or 0
    gust = number(row["wind_gust_kph"]) or 0
    visibility = number(row["visibility_km"]) or 0
    holds: list[str] = []
    reviews: list[str] = []
    if wind > 35:
        holds.append("WX_HOLD_WIND")
    if gust > 42:
        holds.append("WX_HOLD_GUST")
    if visibility < 3:
        holds.append("WX_HOLD_VIS")
    if 26 <= wind <= 35:
        reviews.append("WX_REVIEW_WIND")
    if 34 <= gust <= 42:
        reviews.append("WX_REVIEW_GUST")
    if 3 <= visibility <= 7:
        reviews.append("WX_REVIEW_VIS")
    if holds:
        return "hold", holds
    if reviews:
        return "review", reviews
    return "normal", []


def make_issue(
    issue_id: str,
    priority: str,
    category: str,
    title: str,
    summary: str,
    entity: str,
    rules: list[str],
    evidence: list[dict],
    actions: list[str],
    default_action: str,
    created_at: datetime,
    launch_blocking: bool = False,
    effect: str = "advisory",
    clearance_mode: str = "manual_resolution",
    recovery_at: datetime | None = None,
    recovery_label: str | None = None,
    recovery_evidence: list[dict] | None = None,
    affected_order_ids: list[str] | None = None,
    affected_drone_ids: list[str] | None = None,
) -> dict:
    if default_action not in actions:
        raise ValueError(f"Default action {default_action} must be in allowed actions")
    return {
        "id": issue_id,
        "priority": priority,
        "category": category,
        "title": title,
        "summary": summary,
        "entity": entity,
        "ruleIds": rules,
        "evidence": evidence,
        "allowedActions": actions,
        "defaultAction": default_action,
        "createdAt": iso(created_at),
        "launchBlocking": launch_blocking,
        "humanDecisionRequired": True,
        "status": "open",
        "effect": effect,
        "clearanceMode": clearance_mode,
        "recoveryAt": iso(recovery_at) if recovery_at else None,
        "recoveryLabel": recovery_label,
        "recoveryEvidence": recovery_evidence or [],
        "affectedOrderIds": affected_order_ids or [],
        "affectedDroneIds": affected_drone_ids or [],
    }


orders = read_csv("commercial_orders.csv")
operations = read_csv("commercial_delivery_operations.csv")
telemetry = read_csv("flight_telemetry_phases.csv")
weather = read_csv("service_area_weather_hourly.csv")
health = read_csv("drone_health_daily.csv")
readiness = read_csv("merchant_readiness_events.csv")
maintenance = read_csv("maintenance_events.csv")
assets = read_csv("fleet_assets.csv")
merchants = read_csv("merchant_directory.csv")

order_by_id = {row["order_id"]: row for row in orders}
operation_by_order = {row["order_id"]: row for row in operations}
readiness_by_order = {row["order_id"]: row for row in readiness}
merchant_by_id = {row["merchant_id"]: row for row in merchants}
asset_by_drone = {row["drone_id"]: row for row in assets}

telemetry_by_flight: dict[str, list[dict[str, str]]] = defaultdict(list)
for row in telemetry:
    telemetry_by_flight[row["flight_id"]].append(row)
for rows in telemetry_by_flight.values():
    rows.sort(key=lambda row: dt(row["recorded_at"]) or datetime.min)

operations_by_drone: dict[str, list[dict[str, str]]] = defaultdict(list)
for row in operations:
    operations_by_drone[row["drone_id"]].append(row)

health_by_key = {
    (row["snapshot_date"], row["drone_id"]): row
    for row in health
}
weather_by_key = {
    (row["observed_at"], row["fulfillment_site"]): row
    for row in weather
}

def first_normal_weather_after(site: str, after: datetime) -> dict[str, str] | None:
    candidates = sorted(
        (
            row
            for row in weather
            if row["fulfillment_site"] == site
            and (dt(row["observed_at"]) or datetime.min) > after
            and weather_policy(row)[0] == "normal"
        ),
        key=lambda row: row["observed_at"],
    )
    return candidates[0] if candidates else None


def first_validated_fleet_recovery(
    drone_id: str,
    after: datetime,
) -> tuple[datetime | None, list[dict]]:
    related_maintenance = sorted(
        (
            row
            for row in maintenance
            if row["drone_id"] == drone_id
            and (dt(row["closed_at"]) or datetime.min) > after
            and row["release_status"] == "validated_return_to_service"
        ),
        key=lambda row: row["closed_at"],
    )
    release = related_maintenance[0] if related_maintenance else None
    release_at = dt(release["closed_at"]) if release else after
    normal_health = sorted(
        (
            row
            for row in health
            if row["drone_id"] == drone_id
            and (dt(f"{row['snapshot_date']}T00:00:00") or datetime.min) >= release_at
            and health_policy(row)[0] == "normal"
            and row["maintenance_status"] == "operational"
        ),
        key=lambda row: row["snapshot_date"],
    )
    if not normal_health:
        return None, []
    health_row = normal_health[0]
    recovery_at = dt(f"{health_row['snapshot_date']}T00:00:00")
    evidence = [
        {
            "id": f"health:{health_row['snapshot_date']}:{drone_id}",
            "dataset": "drone_health_daily.csv",
            "label": "Normal health snapshot",
            "value": (
                f"Capacity {health_row['battery_capacity_pct']}% · "
                f"Spread {health_row['cell_voltage_spread_mv']} mV · "
                f"Vibration {health_row['motor_vibration_mm_s']} mm/s"
            ),
            "timestamp": f"{health_row['snapshot_date']}T00:00:00",
        }
    ]
    if release:
        evidence.append(
            {
                "id": f"maintenance:{release['maintenance_id']}",
                "dataset": "maintenance_events.csv",
                "label": "Validated maintenance release",
                "value": f"{release['component']} · {release['release_status']}",
                "timestamp": release["closed_at"],
            }
        )
    return recovery_at, evidence


def build_scenario(meta: dict[str, str]) -> dict:
    now = dt(meta["now"])
    timeline_start = dt(meta["timelineStart"])
    assert now is not None
    assert timeline_start is not None
    today = now.date().isoformat()
    hour = now.replace(minute=0, second=0, microsecond=0).isoformat(timespec="seconds")
    upcoming_cutoff = now + timedelta(minutes=30)
    issues: list[dict] = []

    weather_rows: list[dict] = []
    for site in sorted({row["home_site"] for row in assets}):
        raw = weather_by_key[(hour, site)]
        state, rules = weather_policy(raw)
        affected = [
            row
            for row in operations
            if row["fulfillment_site"] == site
            and now < (dt(row["launch_at"]) or datetime.min) <= upcoming_cutoff
        ]
        weather_rows.append(
            {
                "site": site,
                "siteLabel": compact_site(site),
                "wind": number(raw["wind_speed_kph"]),
                "gust": number(raw["wind_gust_kph"]),
                "visibility": number(raw["visibility_km"]),
                "condition": raw["operating_condition"],
                "policyState": state,
                "ruleIds": rules,
                "observedAt": raw["observed_at"],
                "affectedFlights": len(affected),
            }
        )
        if state in {"hold", "review"}:
            recovery_weather = first_normal_weather_after(
                site,
                dt(raw["observed_at"]) or now,
            )
            recovery_at = (
                dt(recovery_weather["observed_at"]) if recovery_weather else None
            )
            if recovery_weather:
                weather_rows.append(
                    {
                        "site": site,
                        "siteLabel": compact_site(site),
                        "wind": number(recovery_weather["wind_speed_kph"]),
                        "gust": number(recovery_weather["wind_gust_kph"]),
                        "visibility": number(recovery_weather["visibility_km"]),
                        "condition": recovery_weather["operating_condition"],
                        "policyState": "normal",
                        "ruleIds": [],
                        "observedAt": recovery_weather["observed_at"],
                        "affectedFlights": 0,
                    }
                )
            priority = "P0" if state == "hold" else "P1"
            action = "HOLD_LAUNCH" if state == "hold" else "OPEN_OPERATOR_REVIEW"
            verb = "Hold threshold detected" if state == "hold" else "Review threshold detected"
            issues.append(
                make_issue(
                    f"ISS-WX-{site}-{now:%Y%m%d%H}",
                    priority,
                    "Weather",
                    f"{compact_site(site)} · {verb}",
                    f"{len(affected)} departure(s) within 30 minutes are affected.",
                    compact_site(site),
                    rules,
                    [
                        {
                            "id": f"weather:{site}:{hour}",
                            "dataset": "service_area_weather_hourly.csv",
                            "label": "Current site-hour observation",
                            "value": f"Wind {raw['wind_speed_kph']} kph · Gust {raw['wind_gust_kph']} kph · Visibility {raw['visibility_km']} km",
                            "timestamp": raw["observed_at"],
                        }
                    ],
                    [action, "DEFER_ORDER", "REASSIGN_ORDER", "CUSTOMER_OUTREACH"],
                    action,
                    dt(raw["observed_at"]) or now,
                    launch_blocking=state == "hold",
                    effect="site_weather_hold",
                    clearance_mode="human_release",
                    recovery_at=recovery_at,
                    recovery_label=(
                        f"Weather at {compact_site(site)} returned within operating limits."
                        if recovery_at
                        else None
                    ),
                    recovery_evidence=(
                        [
                            {
                                "id": f"weather:{site}:{recovery_weather['observed_at']}",
                                "dataset": "service_area_weather_hourly.csv",
                                "label": "Weather recovery observation",
                                "value": (
                                    f"Wind {recovery_weather['wind_speed_kph']} kph · "
                                    f"Gust {recovery_weather['wind_gust_kph']} kph · "
                                    f"Visibility {recovery_weather['visibility_km']} km"
                                ),
                                "timestamp": recovery_weather["observed_at"],
                            }
                        ]
                        if recovery_weather
                        else []
                    ),
                    affected_order_ids=[row["order_id"] for row in affected],
                    affected_drone_ids=sorted({row["drone_id"] for row in affected}),
                )
            )

    drone_rows: list[dict] = []
    for drone_id in sorted(asset_by_drone):
        asset = asset_by_drone[drone_id]
        health_row = health_by_key[(today, drone_id)]
        health_state, health_rules = health_policy(health_row)
        active_maintenance = [
            row
            for row in maintenance
            if row["drone_id"] == drone_id
            and (dt(row["opened_at"]) or datetime.max) <= now
            <= (dt(row["closed_at"]) or datetime.min)
        ]
        flights = operations_by_drone[drone_id]
        active = [
            row
            for row in flights
            if (dt(row["launch_at"]) or datetime.max) <= now
            < (dt(row["delivered_at"]) or datetime.min)
        ]
        upcoming = [
            row
            for row in flights
            if now < (dt(row["launch_at"]) or datetime.min) <= upcoming_cutoff
        ]
        active.sort(key=lambda row: dt(row["launch_at"]) or datetime.min, reverse=True)
        upcoming.sort(key=lambda row: dt(row["launch_at"]) or datetime.max)
        chosen = active[0] if active else None
        latest_tel = None
        if chosen:
            observed = [
                row
                for row in telemetry_by_flight[chosen["flight_id"]]
                if (dt(row["recorded_at"]) or datetime.max) <= now
            ]
            latest_tel = observed[-1] if observed else None

        categorical_ground = health_row["maintenance_status"] == "grounded"
        policy_ground = health_state == "ground"
        restricted = health_state == "restrict" or health_row["maintenance_status"] == "monitoring"
        assignment_conflict = bool((active or upcoming) and (categorical_ground or policy_ground or active_maintenance))
        duplicate_assignment = len(active) > 1 or len(upcoming) > 1

        if active_maintenance:
            status = "maintenance"
            activity = "Maintenance · assignment blocked"
        elif categorical_ground or policy_ground:
            status = "grounded"
            activity = (
                "Grounded · assignment conflict"
                if assignment_conflict
                else "Grounded · no assignment"
            )
        elif len(active) > 1:
            status = "conflict"
            activity = f"{len(active)} overlapping flights"
        elif active:
            status = "in_flight"
            activity = f"{latest_tel['phase'].title() if latest_tel else 'In flight'} · {chosen['delivery_zone']}"
        elif len(upcoming) > 1:
            status = "conflict"
            activity = f"{len(upcoming)} overlapping departures"
        elif upcoming:
            status = "preflight"
            minutes = int(((dt(upcoming[0]["launch_at"]) or now) - now).total_seconds() // 60)
            activity = f"Preflight · departs in {minutes}m"
        elif restricted:
            status = "review"
            activity = "Restricted · operator review"
        else:
            status = "idle"
            activity = "Idle · available for planning"

        drone_rows.append(
            {
                "droneId": drone_id,
                "site": asset["home_site"],
                "siteLabel": compact_site(asset["home_site"]),
                "status": status,
                "activity": activity,
                "flightId": chosen["flight_id"] if chosen else (upcoming[0]["flight_id"] if upcoming else None),
                "orderId": chosen["order_id"] if chosen else (upcoming[0]["order_id"] if upcoming else None),
                "batteryLevel": number(latest_tel["battery_pct"]) if latest_tel else None,
                "batteryCapacity": number(health_row["battery_capacity_pct"]),
                "cellSpread": number(latest_tel["cell_voltage_spread_mv"]) if latest_tel else number(health_row["cell_voltage_spread_mv"]),
                "vibration": number(latest_tel["motor_vibration_mm_s"]) if latest_tel else number(health_row["motor_vibration_mm_s"]),
                "batteryTemp": number(latest_tel["battery_temp_c"]) if latest_tel else None,
                "gpsHdop": number(latest_tel["gps_hdop"]) if latest_tel else None,
                "tetherDescent": number(latest_tel["tether_descent_sec"]) if latest_tel else number(health_row["tether_descent_baseline_sec"]),
                "phase": latest_tel["phase"] if latest_tel else None,
                "lastTelemetryAt": latest_tel["recorded_at"] if latest_tel else None,
                "healthStatus": health_row["maintenance_status"],
                "policyState": health_state,
                "policyRules": health_rules,
                "activeFlightCount": len(active),
                "upcomingFlightCount": len(upcoming),
                "assignmentConflict": assignment_conflict,
            }
        )

        if categorical_ground or policy_ground or active_maintenance:
            rules = list(health_rules)
            if categorical_ground:
                rules.append("DAILY_STATUS_GROUNDED")
            if active_maintenance:
                rules.append("ACTIVE_MAINTENANCE")
            issue_priority = "P0"
            evidence = [
                {
                    "id": f"health:{today}:{drone_id}",
                    "dataset": "drone_health_daily.csv",
                    "label": "Current daily health",
                    "value": (
                        f"Capacity {health_row['battery_capacity_pct']}% · "
                        f"Spread {health_row['cell_voltage_spread_mv']} mV · "
                        f"Vibration {health_row['motor_vibration_mm_s']} mm/s · "
                        f"Status {health_row['maintenance_status']}"
                    ),
                    "timestamp": today,
                }
            ]
            if active or upcoming:
                related = (active + upcoming)[:3]
                evidence.append(
                    {
                        "id": f"assignment:{drone_id}:{now:%Y%m%d%H%M}",
                        "dataset": "commercial_delivery_operations.csv",
                        "label": "Conflicting assignment",
                        "value": ", ".join(row["flight_id"] for row in related),
                        "timestamp": related[0]["launch_at"],
                        }
                    )
            fleet_recovery_at, fleet_recovery_evidence = (
                first_validated_fleet_recovery(drone_id, now)
            )
            issues.append(
                make_issue(
                    f"ISS-FLEET-{drone_id}-{today}",
                    issue_priority,
                    "Fleet",
                    f"{drone_id} · Grounding condition",
                    (
                        "An active or upcoming assignment conflicts with the grounding state."
                        if active or upcoming
                        else "The drone must remain outside flight assignment."
                    ),
                    drone_id,
                    sorted(set(rules)),
                    evidence,
                    ["GROUND_AIRCRAFT", "REMOVE_INVALID_ASSIGNMENT", "OPEN_OPERATOR_REVIEW"],
                    "GROUND_AIRCRAFT",
                    datetime.combine(now.date(), datetime.min.time()),
                    launch_blocking=True,
                    effect="aircraft_ground",
                    clearance_mode="human_release",
                    recovery_at=fleet_recovery_at,
                    recovery_label=(
                        f"Validated maintenance and normal health are available for {drone_id}."
                        if fleet_recovery_at
                        else None
                    ),
                    recovery_evidence=fleet_recovery_evidence,
                    affected_order_ids=[
                        row["order_id"] for row in (active + upcoming)
                    ],
                    affected_drone_ids=[drone_id],
                )
            )
        elif health_state == "restrict":
            fleet_recovery_at, fleet_recovery_evidence = (
                first_validated_fleet_recovery(drone_id, now)
            )
            issues.append(
                make_issue(
                    f"ISS-RESTRICT-{drone_id}-{today}",
                    "P1",
                    "Fleet",
                    f"{drone_id} · Restriction threshold",
                    "Daily health is within a policy restriction band.",
                    drone_id,
                    health_rules,
                    [
                        {
                            "id": f"health:{today}:{drone_id}",
                            "dataset": "drone_health_daily.csv",
                            "label": "Current daily health",
                            "value": f"Capacity {health_row['battery_capacity_pct']}% · Spread {health_row['cell_voltage_spread_mv']} mV",
                            "timestamp": today,
                        }
                    ],
                    ["RESTRICT_AND_OPEN_MAINTENANCE_REVIEW", "OPEN_OPERATOR_REVIEW"],
                    "RESTRICT_AND_OPEN_MAINTENANCE_REVIEW",
                    datetime.combine(now.date(), datetime.min.time()),
                    launch_blocking=False,
                    effect="aircraft_restrict",
                    clearance_mode="human_release",
                    recovery_at=fleet_recovery_at,
                    recovery_label=(
                        f"Health readings for {drone_id} returned within limits."
                        if fleet_recovery_at
                        else None
                    ),
                    recovery_evidence=fleet_recovery_evidence,
                    affected_order_ids=[
                        row["order_id"] for row in (active + upcoming)
                    ],
                    affected_drone_ids=[drone_id],
                )
            )

        if duplicate_assignment:
            related = active if len(active) > 1 else upcoming
            issues.append(
                make_issue(
                    f"ISS-ASSIGN-{drone_id}-{now:%Y%m%d%H%M}",
                    "P1",
                    "Data conflict",
                    f"{drone_id} · Overlapping assignments",
                    f"{len(related)} flights overlap in the replay data.",
                    drone_id,
                    ["CONFLICTING_STRUCTURED_RECORDS"],
                    [
                        {
                            "id": f"assignment-conflict:{drone_id}:{now:%Y%m%d%H%M}",
                            "dataset": "commercial_delivery_operations.csv",
                            "label": "Overlapping flight IDs",
                            "value": ", ".join(row["flight_id"] for row in related),
                            "timestamp": related[0]["launch_at"],
                        }
                    ],
                    ["OPEN_OPERATOR_REVIEW", "REMOVE_INVALID_ASSIGNMENT"],
                    "OPEN_OPERATOR_REVIEW",
                    max(
                        timeline_start,
                        (dt(related[0]["launch_at"]) or now) - timedelta(minutes=30),
                    ),
                    launch_blocking=False,
                    effect="assignment_conflict",
                    clearance_mode="manual_resolution",
                    affected_order_ids=[row["order_id"] for row in related],
                    affected_drone_ids=[drone_id],
                )
            )

        if meta["id"] == "tether-variance" and drone_id == "ZIP-US-019":
            recent_tether = [
                row
                for row in telemetry
                if row["drone_id"] == drone_id
                and now - timedelta(days=3) <= (dt(row["recorded_at"]) or datetime.min) <= now
                and (number(row["tether_descent_sec"]) or 0) > 39.4
            ]
            if recent_tether:
                tether_recovery_at, tether_recovery_evidence = (
                    first_validated_fleet_recovery(drone_id, now)
                )
                issues.append(
                    make_issue(
                        f"ISS-TETHER-{drone_id}-{today}",
                        "P2",
                        "Fleet pattern",
                        f"{drone_id} · Tether descent variance",
                        f"{len(recent_tether)} telemetry records exceed the historical 99th-percentile baseline.",
                        drone_id,
                        ["HISTORICAL_TETHER_PATTERN"],
                        [
                            {
                                "id": f"telemetry:tether:{recent_tether[-1]['telemetry_id']}",
                                "dataset": "flight_telemetry_phases.csv",
                                "label": "Latest elevated tether measurement",
                                "value": f"{recent_tether[-1]['tether_descent_sec']} seconds",
                                "timestamp": recent_tether[-1]["recorded_at"],
                            },
                            {
                                "id": "history:tether:p99",
                                "dataset": "drone_health_daily.csv",
                                "label": "Historical reference",
                                "value": "Normal-data 99th percentile: 39.4 seconds",
                                "timestamp": today,
                            },
                        ],
                        ["OPEN_OPERATOR_REVIEW", "RESTRICT_AND_OPEN_MAINTENANCE_REVIEW"],
                        "OPEN_OPERATOR_REVIEW",
                        dt(recent_tether[-1]["recorded_at"]) or now,
                        launch_blocking=False,
                        effect="aircraft_restrict",
                        clearance_mode="human_release",
                        recovery_at=tether_recovery_at,
                        recovery_label=(
                            f"Validated tether maintenance release is available for {drone_id}."
                            if tether_recovery_at
                            else None
                        ),
                        recovery_evidence=tether_recovery_evidence,
                        affected_drone_ids=[drone_id],
                    )
                )

    relevant_ops = [
        row
        for row in operations
        if dt(row["launch_at"])
        and (dt(row["launch_at"]) or datetime.min).date() == now.date()
        and (dt(order_by_id[row["order_id"]]["requested_at"]) or datetime.max) <= now
        and (dt(row["launch_at"]) or datetime.min) <= now + timedelta(minutes=45)
    ]

    def order_rank(row: dict[str, str]) -> tuple:
        launch_at = dt(row["launch_at"]) or datetime.min
        delivered_at = dt(row["delivered_at"])
        if launch_at <= now and delivered_at and delivered_at > now:
            state = 0
        elif launch_at > now:
            state = 1
        else:
            state = 2
        return (state, abs((launch_at - now).total_seconds()))

    relevant_ops.sort(key=order_rank)
    order_rows: list[dict] = []
    for op in relevant_ops[:36]:
        order = order_by_id[op["order_id"]]
        ready = readiness_by_order[op["order_id"]]
        launch_at = dt(op["launch_at"]) or datetime.min
        delivered_at = dt(op["delivered_at"])
        readiness_known = (dt(ready["event_at"]) or datetime.max) <= now
        if not truthy(ready["handoff_verified"]):
            actual_readiness_status = "unverified"
            actual_readiness_label = "Handoff unverified"
        elif ready["ready_status"] == "ready_late":
            actual_readiness_status = "late"
            actual_readiness_label = f"Ready late · +{ready['additional_delay_min']}m"
        else:
            actual_readiness_status = "ready"
            actual_readiness_label = "Ready and verified"

        if op["status"] == "cancelled_weather" and launch_at <= now:
            current_status = "cancelled"
        elif delivered_at and delivered_at <= now:
            current_status = "delivered_late" if op["status"] == "delivered_late" else "delivered"
        elif launch_at <= now and delivered_at and delivered_at > now:
            current_status = "in_flight"
        elif launch_at > now:
            current_status = "preflight"
        else:
            current_status = "exception"

        if not readiness_known:
            readiness_status = "awaiting_event"
            readiness_label = "Awaiting actual readiness"
        else:
            readiness_status = actual_readiness_status
            readiness_label = actual_readiness_label

        minutes_to_launch = int((launch_at - now).total_seconds() // 60)
        preflight_checks: list[dict] = []
        if current_status == "preflight":
            asset = asset_by_drone[op["drone_id"]]
            hrow = health_by_key[(today, op["drone_id"])]
            hstate, hrules = health_policy(hrow)
            wrow = weather_by_key[(launch_at.replace(minute=0, second=0, microsecond=0).isoformat(timespec="seconds"), op["fulfillment_site"])]
            wstate, wrules = weather_policy(wrow)
            checks = [
                (
                    "Weather",
                    "blocked" if wstate == "hold" else ("review" if wstate == "review" else "clear"),
                    f"Wind {wrow['wind_speed_kph']} · Gust {wrow['wind_gust_kph']} · Visibility {wrow['visibility_km']}",
                ),
                (
                    "Drone health",
                    "blocked" if hstate == "ground" or hrow["maintenance_status"] == "grounded" else ("review" if hstate == "restrict" else "clear"),
                    f"Capacity {hrow['battery_capacity_pct']}% · Spread {hrow['cell_voltage_spread_mv']} mV · Vibration {hrow['motor_vibration_mm_s']} mm/s",
                ),
                (
                    "Payload",
                    "blocked" if (number(op["payload_weight_kg"]) or 0) > (number(asset["max_payload_kg"]) or 0) else "clear",
                    f"{op['payload_weight_kg']} kg of {asset['max_payload_kg']} kg",
                ),
                (
                    "Route",
                    "blocked" if (number(op["distance_one_way_km"]) or 0) > (number(asset["normal_route_limit_km"]) or 0) else "clear",
                    f"{op['distance_one_way_km']} km of {asset['normal_route_limit_km']} km",
                ),
                (
                    "Merchant readiness",
                    "clear" if readiness_known and truthy(ready["handoff_verified"]) else "blocked",
                    readiness_label,
                ),
            ]
            preflight_checks = [
                {"label": label, "state": state, "detail": detail}
                for label, state, detail in checks
            ]
            if any(check["state"] == "blocked" for check in preflight_checks):
                preflight_state = "POLICY_HOLD_REQUIRED" if wstate == "hold" else (
                    "POLICY_GROUND_REQUIRED" if hstate == "ground" or hrow["maintenance_status"] == "grounded" else "CHECK_INCOMPLETE"
                )
            elif any(check["state"] == "review" for check in preflight_checks):
                preflight_state = "OPERATOR_REVIEW_REQUIRED"
            else:
                preflight_state = "NO_POLICY_EXCEPTION_DETECTED"
        else:
            preflight_state = None

        order_rows.append(
            {
                "orderId": op["order_id"],
                "flightId": op["flight_id"],
                "droneId": op["drone_id"],
                "merchantId": op["merchant_id"],
                "merchant": op["merchant_name"],
                "merchantCategory": op["merchant_category"],
                "site": op["fulfillment_site"],
                "siteLabel": compact_site(op["fulfillment_site"]),
                "zone": op["delivery_zone"],
                "serviceLevel": op["service_level"],
                "promisedMinutes": int(op["promised_minutes"]),
                "requestedAt": order["requested_at"],
                "launchAt": op["launch_at"],
                "deliveredAt": op["delivered_at"] or None,
                "minutesToLaunch": minutes_to_launch,
                "status": current_status,
                "readinessStatus": actual_readiness_status,
                "readinessLabel": actual_readiness_label,
                "readinessEventAt": ready["event_at"],
                "handoffVerified": truthy(ready["handoff_verified"]),
                "payloadKg": number(op["payload_weight_kg"]),
                "distanceKm": number(op["distance_one_way_km"]),
                "preflightState": preflight_state,
                "preflightChecks": preflight_checks,
            }
        )

        if (
            current_status == "preflight"
            and 0 <= minutes_to_launch <= 15
            and not readiness_known
        ):
            issues.append(
                make_issue(
                    f"ISS-READY-{op['order_id']}",
                    "P0",
                    "Preflight",
                    f"{op['order_id']} · Readiness not confirmed",
                    f"{op['merchant_name']} has no actual-ready event before the planned departure.",
                    op["order_id"],
                    ["ACTUAL_READINESS_REQUIRED"],
                    [
                        {
                            "id": f"readiness:{ready['merchant_event_id']}",
                            "dataset": "merchant_readiness_events.csv",
                            "label": "Future readiness event excluded",
                            "value": f"Recorded at {ready['event_at']}; replay now is {iso(now)}",
                            "timestamp": ready["event_at"],
                        },
                        {
                            "id": f"flight:{op['flight_id']}",
                            "dataset": "commercial_delivery_operations.csv",
                            "label": "Planned departure",
                            "value": f"{op['flight_id']} at {op['launch_at']}",
                            "timestamp": op["launch_at"],
                        },
                    ],
                    ["REESTIMATE_PROMISE_FROM_ACTUAL_READY", "OPEN_OPERATOR_REVIEW"],
                    "REESTIMATE_PROMISE_FROM_ACTUAL_READY",
                    launch_at - timedelta(minutes=15),
                    launch_blocking=True,
                    effect="order_readiness_hold",
                    clearance_mode="automatic",
                    recovery_at=dt(ready["event_at"]),
                    recovery_label=f"Actual readiness confirmed for {op['order_id']}.",
                    recovery_evidence=[
                        {
                            "id": f"readiness:{ready['merchant_event_id']}",
                            "dataset": "merchant_readiness_events.csv",
                            "label": "Actual readiness event",
                            "value": (
                                f"{ready['ready_status']} · "
                                f"handoff verified {ready['handoff_verified']}"
                            ),
                            "timestamp": ready["event_at"],
                        }
                    ],
                    affected_order_ids=[op["order_id"]],
                    affected_drone_ids=[op["drone_id"]],
                )
            )

    if meta["id"] == "merchant-readiness":
        known_pasta_delays = [
            row
            for row in readiness
            if row["merchant_name"] == "Pasta Garden"
            and row["ready_status"] == "ready_late"
            and (dt(row["event_at"]) or datetime.max).date() == now.date()
            and (dt(row["event_at"]) or datetime.max) <= now
        ]
        if known_pasta_delays:
            latest = known_pasta_delays[-1]
            issues.append(
                make_issue(
                    f"ISS-MERCHANT-PASTA-{today}",
                    "P2",
                    "Merchant pattern",
                    "Pasta Garden · Repeated readiness delays",
                    f"{len(known_pasta_delays)} late-ready events are known so far today.",
                    "Pasta Garden",
                    ["ACTUAL_READINESS_PROMISE_BASIS", "HISTORICAL_READINESS_PATTERN"],
                    [
                        {
                            "id": f"readiness-pattern:Pasta-Garden:{today}",
                            "dataset": "merchant_readiness_events.csv",
                            "label": "Known late-ready events",
                            "value": f"{len(known_pasta_delays)} events; latest added delay {latest['additional_delay_min']} minutes",
                            "timestamp": latest["event_at"],
                        }
                    ],
                    [
                        "REESTIMATE_PROMISE_FROM_ACTUAL_READY",
                        "CUSTOMER_OUTREACH",
                        "OPEN_OPERATOR_REVIEW",
                    ],
                    "REESTIMATE_PROMISE_FROM_ACTUAL_READY",
                    dt(latest["event_at"]) or now,
                    launch_blocking=False,
                    effect="advisory",
                    clearance_mode="manual_resolution",
                )
            )

    issues.sort(
        key=lambda row: (
            PRIORITY_ORDER[row["priority"]],
            not row["launchBlocking"],
            row["createdAt"],
            row["id"],
        )
    )

    summary = {
        "airborne": sum(row["status"] == "in_flight" for row in drone_rows),
        "preflight": sum(row["status"] == "preflight" for row in drone_rows),
        "grounded": sum(row["status"] in {"grounded", "maintenance"} for row in drone_rows),
        "conflicts": sum(row["status"] == "conflict" or row["assignmentConflict"] for row in drone_rows),
        "openIssues": len([row for row in issues if row["priority"] in {"P0", "P1", "P2"}]),
        "criticalIssues": sum(row["priority"] == "P0" for row in issues),
    }

    return {
        **meta,
        "generatedFrom": [
            "commercial_delivery_operations.csv",
            "commercial_orders.csv",
            "merchant_readiness_events.csv",
            "flight_telemetry_phases.csv",
            "service_area_weather_hourly.csv",
            "drone_health_daily.csv",
            "maintenance_events.csv",
            "fleet_assets.csv",
            "merchant_directory.csv",
            "OPERATING_POLICY.md",
            "incident_and_handover_reports/",
        ],
        "summary": summary,
        "weather": weather_rows,
        "drones": drone_rows,
        "orders": order_rows,
        "issues": issues,
    }


payload = {
    "datasetNotice": "Synthetic practice data replay. Not real Zipline operations.",
    "policyNotice": "Recommendations never authorize flight. A human operator owns every release decision.",
    "scenarios": [build_scenario(scenario) for scenario in SCENARIOS],
}

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
print(f"Wrote {OUTPUT}")
