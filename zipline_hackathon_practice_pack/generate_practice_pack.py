"""Generate a coherent, fictitious drone-delivery operations data pack.

No real Zipline operational data is represented here.  Run with Python 3.11+:
    python generate_practice_pack.py
"""
from __future__ import annotations

import csv
import math
import random
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

SEED = 20250716
random.seed(SEED)
OUT = Path(__file__).parent / "data"
OUT.mkdir(exist_ok=True)

START = date(2025, 1, 1)
DAYS = 90
DRONES = [f"ZIP-{i:03d}" for i in range(1, 31)]
HUBS = {
    "Nest_Alpha": (0.0, 0.0), "Nest_Beta": (0.74, -0.22),
    "Nest_Gamma": (-0.51, 0.43), "Nest_Delta": (0.22, 0.66),
}
# Aircraft normally operate from one home nest.  Cross-nest dispatch is an
# exception that an operator must explicitly justify; it is not silently baked
# into routine historical operations.
FLEET_HOME = {d: ("Nest_Alpha" if i <= 8 else "Nest_Beta" if i <= 16 else "Nest_Gamma" if i <= 23 else "Nest_Delta")
              for i, d in enumerate(DRONES, start=1)}
DESTS = [
    ("Kigali_East_Clinic", "Nest_Alpha", 26.5), ("Kabuga_Health_Center", "Nest_Alpha", 34.2),
    ("Rwamagana_Clinic", "Nest_Alpha", 28.5), ("Bugesera_Health_Post", "Nest_Alpha", 52.3),
    ("Ngoma_Health_Post", "Nest_Alpha", 55.1), ("Kayonza_Clinic", "Nest_Alpha", 47.8),
    ("Nyanza_District_Hospital", "Nest_Beta", 41.7), ("Huye_District_Hospital", "Nest_Beta", 36.4),
    ("Kamonyi_Health_Center", "Nest_Beta", 44.6), ("Gisagara_Clinic", "Nest_Beta", 29.4),
    ("Musanze_Clinic", "Nest_Gamma", 30.1), ("Rubavu_Clinic", "Nest_Gamma", 31.8),
    ("Gakenke_Health_Post", "Nest_Gamma", 48.7), ("Nyabihu_Clinic", "Nest_Gamma", 42.5),
    ("Kicukiro_Health_Center", "Nest_Delta", 23.1), ("Rulindo_Clinic", "Nest_Delta", 37.9),
    ("Gicumbi_Hospital", "Nest_Delta", 50.6), ("Mageragere_Clinic", "Nest_Delta", 33.8),
]
DEST_BY_HUB = defaultdict(list)
for d in DESTS: DEST_BY_HUB[d[1]].append(d)

PAYLOADS = [
    ("blood_product", "O_negative_whole_blood", 1.35), ("blood_product", "platelets_2_units", 1.55),
    ("vaccine", "routine_vaccines", 0.75), ("medication", "insulin_cold_chain", 0.65),
    ("medication", "antiretroviral_supply", 1.05), ("supplies", "diagnostic_test_kits", 0.9),
]
FIELDNAMES = {}

def write_csv(name, rows):
    rows = list(rows)
    if not rows: return
    FIELDNAMES[name] = list(rows[0])
    with (OUT / name).open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES[name], extrasaction="ignore")
        w.writeheader(); w.writerows(rows)

def clamp(x, low, high): return max(low, min(high, x))
def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%S")

def weather_for(hub, dt):
    day = (dt.date() - START).days
    hour_wave = math.sin((dt.hour - 11) * math.pi / 12)
    storm = 0
    # known operational weather event, 10:00–14:00 on Jan 30 at Alpha
    if hub == "Nest_Alpha" and day == 29 and 10 <= dt.hour <= 14: storm = 18 + (3 if dt.hour in (11, 12) else 0)
    # Fog in Gamma, dawn of Feb 16
    fog = hub == "Nest_Gamma" and day == 46 and 5 <= dt.hour <= 8
    base = {"Nest_Alpha": 13, "Nest_Beta": 11, "Nest_Gamma": 10, "Nest_Delta": 12}[hub]
    wind = clamp(base + hour_wave * 5 + random.gauss(0, 2.4) + storm, 2, 42)
    gust = clamp(wind + random.uniform(2, 10) + storm * .25, wind, 50)
    visibility = clamp(15 - storm * .28 - (9 if fog else 0) + random.gauss(0, 1), .7, 18)
    precip = clamp((storm - 14) * .3 + random.gauss(.05, .12), 0, 4.5)
    return {"observed_at": iso(dt), "hub": hub, "wind_speed_kph": round(wind, 1),
      "wind_gust_kph": round(gust, 1), "wind_direction": random.choice(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]),
      "temperature_c": round(21 + 4*math.sin((dt.hour-7)*math.pi/12) + random.gauss(0,.7), 1),
      "humidity_pct": round(clamp(58 + precip*7 + random.gauss(0, 9), 25, 99), 1),
      "precipitation_mm": round(precip, 2), "visibility_km": round(visibility, 1),
      "operational_weather_status": "no_go" if wind > 35 or gust > 42 or visibility < 3 else ("caution" if wind > 25 or visibility < 7 else "go")}

weather = []
weather_idx = {}
for day_i in range(DAYS):
    for h in HUBS:
        for hour in range(24):
            row = weather_for(h, datetime.combine(START + timedelta(days=day_i), datetime.min.time()) + timedelta(hours=hour))
            weather.append(row); weather_idx[(h, day_i, hour)] = row
write_csv("nest_weather_hourly.csv", weather)

# Planned-maintenance and groundings used across related files.
maintenance = []
grounded = defaultdict(set)
for d_i in range(DAYS):
    if 32 <= d_i <= 36: grounded["ZIP-005"].add(d_i) # failing pack exchanged Feb 6
    if 50 <= d_i <= 53: grounded["ZIP-003"].add(d_i) # motor bearing replacement
    if 62 <= d_i <= 63: grounded["ZIP-014"].add(d_i) # tether descent motor
for drone, start_i, end_i, component, action, reason in [
    ("ZIP-005",32,36,"battery_pack","replace","Cell 3 internal resistance and high-drain trend"),
    ("ZIP-003",50,53,"motor_2","replace","Bearing wear confirmed after vibration trend"),
    ("ZIP-014",62,63,"tether_descent_motor","service","Intermittent descent-speed variance"),
]:
    maintenance.append({"maintenance_id":f"MNT-{len(maintenance)+1:04d}","drone_id":drone,"home_hub":FLEET_HOME[drone],
      "opened_at":iso(datetime.combine(START+timedelta(days=start_i), datetime.min.time())+timedelta(hours=9)),
      "closed_at":iso(datetime.combine(START+timedelta(days=end_i), datetime.min.time())+timedelta(hours=16)),
      "component":component,"maintenance_type":"corrective","action":action,"reason":reason,
      "parts_used":component+"_replacement","labor_hours":round(random.uniform(3,7),1),"release_status":"returned_to_service"})

# Flight log and per-phase telemetry.  It has normal variation plus linked failure narratives.
flights, telemetry, orders = [], [], []
flight_num = 10000
drone_cycles = defaultdict(int)
for day_i in range(DAYS):
    cur_date = START + timedelta(days=day_i)
    for hub in HUBS:
        count = random.randint(29, 39)
        available = [x for x in DRONES if FLEET_HOME[x] == hub and day_i not in grounded[x]]
        for j in range(count):
            drone = random.choice(available)
            dest, _, distance = random.choice(DEST_BY_HUB[hub])
            payload_type, payload_item, weight = random.choice(PAYLOADS)
            urgency = random.choices(["routine","scheduled","urgent","emergency"],[44,28,20,8])[0]
            launch = datetime.combine(cur_date, datetime.min.time()) + timedelta(hours=random.randint(6,18), minutes=random.randrange(0,60,5))
            wx = weather_idx[(hub, day_i, launch.hour)]
            flight_id = f"FL-{flight_num}"; flight_num += 1
            # fixed-wing round-trip operation; route distance refers to one-way delivery distance
            expected_drain = 22 + distance*.78 + weight*2.8 + max(0, float(wx["wind_speed_kph"])-13)*.55
            issue, status, notes = "none", "completed", ""
            # systemic headwind margin: Alpha → Ngoma during SE headwinds
            if hub == "Nest_Alpha" and dest == "Ngoma_Health_Post" and wx["wind_direction"] == "SE" and float(wx["wind_speed_kph"]) > 19:
                expected_drain += 5.5; issue = "route_headwind_margin"; notes = "Route margin reduced by southeast headwind."
            # battery failure escalation Feb 1–5, then ground and repair
            if drone == "ZIP-005" and 25 <= day_i <= 31:
                expected_drain += 8 + (day_i-25)*1.2; issue = "battery_drain_fast"; notes = "Cell-voltage imbalance monitored."
                if day_i >= 30: status = "completed_delayed"
            # motor deterioration
            vibration = clamp(1.0 + random.gauss(0,.18), .5, 2.0)
            if drone == "ZIP-003" and 43 <= day_i <= 49:
                vibration += (day_i-42)*.34; issue = "motor_vibration_warning"; notes = "Motor 2 vibration above baseline."
                if day_i >= 48: status = "completed_restricted"
            if drone == "ZIP-014" and 58 <= day_i <= 61:
                issue = "tether_descent_slow"; notes = "Tether descent slower than nominal."; status = "completed_delayed"
            # weather is the only major cause of cancellation; safely no launch telemetry will show cancellation state.
            if wx["operational_weather_status"] == "no_go":
                status, issue, notes = "cancelled_weather", "weather_limit_exceeded", "Pre-launch cancelled: weather outside operating envelope."
            elif float(wx["wind_gust_kph"]) > 38 and random.random() < .18:
                status, issue, notes = "aborted_return_to_base", "gust_encountered", "Return-to-base after gust threshold exceeded."
            elif random.random() < .018:
                issue = random.choice(["gps_quality_low","recovery_wire_missed","parachute_release_delay","airspace_hold"])
                status = "completed_delayed" if issue != "gps_quality_low" else "aborted_return_to_base"
                notes = "Operator event recorded; see incident corpus where applicable."
            drain = clamp(expected_drain + random.gauss(0,2), 0, 92) if status not in ("cancelled_weather",) else 0
            start_pct = random.randint(96,100)
            end_pct = max(5, round(start_pct-drain,1)) if drain else start_pct
            duration = 0 if status == "cancelled_weather" else round((distance*2/101)*60 + 8 + max(0,float(wx["wind_speed_kph"])-15)*.22 + random.gauss(0,2),1)
            recovery = launch + timedelta(minutes=duration) if duration else None
            row = {"flight_id":flight_id,"drone_id":drone,"drone_model":"Zip_Mk4_standardized_fixed_wing","date":str(cur_date),
              "launch_time":iso(launch),"recovery_time":iso(recovery) if recovery else "","hub":hub,"destination":dest,
              "distance_one_way_km":distance,"payload_type":payload_type,"payload_item":payload_item,"payload_weight_kg":weight,
              "urgency":urgency,"cruise_speed_kph":round(clamp(102-random.gauss(0,2.3)-max(0,float(wx["wind_speed_kph"])-18)*.2,90,108),1),
              "cruise_altitude_m":round(random.uniform(95,115),1),"flight_duration_min":duration,"battery_start_pct":start_pct,
              "battery_end_pct":end_pct,"battery_consumption_pct":round(drain,1),"wind_speed_kph":wx["wind_speed_kph"],"wind_gust_kph":wx["wind_gust_kph"],
              "visibility_km":wx["visibility_km"],"status":status,"anomaly_flag":issue,"operator_notes":notes}
            flights.append(row); drone_cycles[drone] += int(status != "cancelled_weather")
            order_id = f"ORD-{flight_num-10000:05d}"
            orders.append({"order_id":order_id,"requested_at":iso(launch-timedelta(minutes=random.randint(10,140))),"flight_id":flight_id,
              "origin_hub":hub,"destination":dest,"clinical_category":payload_type,"urgency":urgency,"requested_item":payload_item,
              "payload_weight_kg":weight,"service_level_minutes":30 if urgency in ("emergency","urgent") else 180,
              "order_status":"fulfilled" if status.startswith("completed") else ("deferred" if status=="cancelled_weather" else "reassigned_or_delayed")})
            # Three phases per mission provide enough telemetry for trend queries without an impractical file.
            for phase, fraction in (("launch",0.0),("outbound_cruise",.48),("recovery",.96)):
                if status == "cancelled_weather": phase = "preflight"; fraction = 0
                batt = start_pct - drain*fraction
                temp = 27 + drain*.10 + random.gauss(0,1)
                if drone == "ZIP-005" and 25 <= day_i <=31: temp += 2.8; batt -= 1.2*fraction
                tel = {"telemetry_id":f"TEL-{flight_id[3:]}-{phase}","flight_id":flight_id,"drone_id":drone,"recorded_at":iso(launch+timedelta(minutes=duration*fraction)),
                  "flight_phase":phase,"battery_pct":round(clamp(batt,0,100),1),"battery_temp_c":round(temp,1),"cell_voltage_spread_mv":round(18+random.random()*12 + (40 if drone=="ZIP-005" and 25<=day_i<=31 else 0),1),
                  "motor_1_vibration_mm_s":round(vibration if drone=="ZIP-003" else clamp(1+random.gauss(0,.2),.5,2),2),
                  "motor_2_vibration_mm_s":round(vibration if drone=="ZIP-003" else clamp(1+random.gauss(0,.2),.5,2),2),
                  "gps_hdop":round(clamp(.8+random.gauss(0,.2),.5,2.5),2),"tether_descent_sec":round(37 + (11 if drone=="ZIP-014" and 58<=day_i<=61 else random.gauss(0,1.5)),1),
                  "parachute_release_latency_ms":round(clamp(120+random.gauss(0,30),50,700),0),"status":"nominal" if issue=="none" else "flagged"}
                telemetry.append(tel)
write_csv("flight_operations.csv", flights)
write_csv("flight_telemetry_phases.csv", telemetry)
write_csv("delivery_orders.csv", orders)

# Daily sensor-health snapshots make predictive maintenance a distinct, simple table task.
health = []
for day_i in range(DAYS):
    for drone in DRONES:
        battery_cap = 96 - day_i*.035 + random.gauss(0,.4)
        cell_spread = 20 + random.gauss(0,5); motor = 1.05 + random.gauss(0,.15); tether = 37 + random.gauss(0,1)
        status = "operational"
        if drone == "ZIP-005" and 25 <= day_i <= 31: battery_cap -= 8+(day_i-25)*1.3; cell_spread += 35+(day_i-25)*4; status="monitoring" if day_i<30 else "grounded"
        if drone == "ZIP-005" and day_i >= 37: battery_cap=99.2-random.random()*.6; cell_spread=15+random.random()*5
        if drone == "ZIP-003" and 43 <= day_i <=49: motor += (day_i-42)*.34; status="monitoring" if day_i<48 else "grounded"
        if drone == "ZIP-014" and 58 <= day_i <=61: tether += 10; status="monitoring"
        if day_i in grounded[drone]: status="grounded"
        health.append({"snapshot_date":str(START+timedelta(days=day_i)),"drone_id":drone,"battery_pack_capacity_pct":round(clamp(battery_cap,65,100),1),
          "battery_cycle_count":int(110+day_i*1.7+(int(drone[-3:])*3)%90),"cell_voltage_spread_mv":round(clamp(cell_spread,8,110),1),
          "motor_2_vibration_mm_s":round(clamp(motor,.5,4.5),2),"motor_2_temperature_c":round(41+motor*3+random.gauss(0,1),1),
          "tether_descent_motor_current_a":round(5.8+(tether-37)*.11+random.gauss(0,.2),2),"parachute_release_test_ms":round(120+random.gauss(0,18),0),
          "gps_module_health":"degraded" if drone=="ZIP-006" and day_i in range(38,42) else "nominal","maintenance_status":status})
write_csv("drone_health_daily.csv", health)
write_csv("maintenance_events.csv", maintenance)

# Reference tables make the operational constraints explicit rather than asking
# a model to infer policy from noisy historical records.
write_csv("fleet_assets.csv", ({"drone_id":d,"drone_model":"Zip_Mk4_standardized_fixed_wing","home_hub":FLEET_HOME[d],
    "commissioned_date":"2024-06-01","max_payload_kg":1.75,"normal_route_limit_km":55,
    "planned_flights_per_day":5,"current_configuration":"standard_medical_delivery"} for d in DRONES))
write_csv("route_reference.csv", ({"route_id":f"RTE-{i+1:03d}","origin_hub":hub,"destination":dest,"one_way_distance_km":distance,
    "nominal_battery_consumption_pct":round(22+distance*.78,1),"route_class":"long" if distance >= 45 else "standard",
    "known_operational_note":"Southeast headwinds reduce return margin; prefer early-morning release" if dest=="Ngoma_Health_Post" else ""}
    for i,(dest,hub,distance) in enumerate(DESTS)))
(OUT / "OPERATIONS_POLICY.md").write_text("""# Fictional Operations Policy Excerpt

This document is an authoritative source for the practice scenario only. It is not a real operating manual.

## Release envelope

- Do not launch when sustained wind exceeds 35 kph, gusts exceed 42 kph, or visibility is below 3 km.
- Require an operator weather review when sustained wind is 26–35 kph, gusts are 34–42 kph, or visibility is 3–7 km.
- A routine delivery may be deferred under a caution condition. Urgent and emergency requests require documented human review, an alternate-route assessment, and a stated risk decision.

## Fleet health escalation

- Ground an aircraft when battery capacity is below 80%, cell voltage spread exceeds 60 mV, or motor vibration exceeds 3.0 mm/s.
- Restrict to short routes and initiate a maintenance review when battery capacity is 80–84%, cell spread is 45–60 mV, or motor vibration is 2.2–3.0 mm/s.
- Any GPS-quality, recovery, or payload-release anomaly requires an operator review before the next release.

## Copilot boundary

The copilot may summarize evidence, surface policies, and recommend escalation. It must never state that a flight is authorized, safe, or cleared. Flight release remains a human operator decision.
""", encoding="utf-8")

# Narrative corpus: individual reports make file/source citation straightforward for RAG.
inc_dir = OUT / "incident_reports"; inc_dir.mkdir(exist_ok=True)
stories = [
 ("IR-001","2025-01-30","Nest_Alpha weather suspension","weather","A fast-moving storm lifted gusts above the operating limit from 10:00 through 14:00. Four deliveries were deferred; an urgent blood order was reassigned to Nest_Beta. Recommendation: 15-minute weather feeds and a formal cross-nest reassignment playbook."),
 ("IR-002","2025-01-26","ZIP-005 battery degradation begins","battery","Battery Cell 3 showed widening voltage spread and consumption 9% above route expectation. The drone was restricted from routes over 45 km and entered daily monitoring."),
 ("IR-003","2025-02-02","ZIP-005 grounded for battery pack replacement","battery","The capacity estimate fell below 78% and Cell 3 internal resistance was elevated. The pack was removed before a thermal or return-margin event. A new pack was installed and five validation flights were required."),
 ("IR-004","2025-02-07","ZIP-005 post-replacement validation","battery","Five flights, including a 52 km route, completed within expected consumption and temperature bands. ZIP-005 was returned to unrestricted service."),
 ("IR-005","2025-02-13","ZIP-003 motor-2 vibration escalation","motor","Motor-2 vibration grew from 1.4 to 3.1 mm/s over seven operating days. Operators restricted the aircraft to short routes and scheduled bearing inspection."),
 ("IR-006","2025-02-20","ZIP-003 motor bearing replacement","motor","Inspection confirmed bearing wear. Motor 2 was replaced, balance-tested, and returned to service after two nominal validation missions."),
 ("IR-007","2025-02-28","ZIP-014 tether descent variance","recovery","Tether descent time rose to 48 seconds, versus a 35–40 second baseline. The descent motor was serviced on March 4 and a preflight tether check was added for the fleet."),
 ("IR-008","2025-02-16","Nest_Gamma fog operational hold","weather","Dawn visibility fell below 3 km. Flights were held until 09:00; no aircraft launched into the restricted visibility window."),
 ("IR-009","2025-02-08","Ngoma route headwind margin","route","Repeated southeast headwinds reduced return battery margin on the 55 km Ngoma route across multiple healthy drones. This is a route-weather interaction, not a single-drone defect. Recommend early-morning scheduling or an alternate approach vector."),
 ("IR-010","2025-02-09","GPS quality event on ZIP-006","gps","GPS HDOP exceeded the flight threshold during outbound cruise. The aircraft executed a controlled return-to-base. The emergency payload was reassigned and delivered without patient impact."),
]
generic = ["recovery-wire missed approach resolved on second pass", "parachute release latency inspection", "airspace coordination hold", "unexpected battery temperature reading", "operator note on route congestion"]
for i in range(75):
    if i < len(stories): rid, when, title, category, body = stories[i]
    else:
        pick = flights[(i*137) % len(flights)]; rid=f"IR-{i+1:03d}"; when=pick["date"]; title=generic[i%len(generic)].title(); category="operations"
        body=(f"Flight {pick['flight_id']} on {pick['drone_id']} was reviewed after a {title.lower()}. "
              f"Conditions included wind {pick['wind_speed_kph']} kph and visibility {pick['visibility_km']} km. "
              "The operator followed the applicable checklist, documented the observation, and released the aircraft only after a successful functional check.")
    content=f"# {rid}: {title}\n\nDate: {when}\nCategory: {category}\n\n## Operator narrative\n\n{body}\n\n## Operator decision\n\nNo autonomous action is authorized by this report. Use this report with the flight, weather, and health records; escalate uncertain or safety-relevant cases to an operator.\n\n## Tags\n\n{category}, operations, maintenance, safety\n"
    (inc_dir / f"{rid}.md").write_text(content, encoding="utf-8")

schema = ["# Data dictionary", "", "All data are synthetic and internally joinable. `flight_id` connects flight operations, phase telemetry, orders, and some incident narratives. `drone_id`, hub, and time connect the remaining tables.", ""]
for n, cols in FIELDNAMES.items(): schema += [f"## `{n}`", "", " | ".join(cols), ""]
(OUT / "DATA_DICTIONARY.md").write_text("\n".join(schema), encoding="utf-8")
print(f"Wrote {len(flights):,} flights, {len(telemetry):,} telemetry rows, {len(weather):,} weather observations, {len(health):,} health snapshots, {len(orders):,} orders, and 75 incident reports to {OUT}")
