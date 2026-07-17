"""Generate a fictitious U.S. commercial autonomous-delivery practice pack.

The ready-made files are written to data_us_commercial/. This is synthetic data,
not real Zipline, merchant, customer, or operating-policy information.
"""
from __future__ import annotations
import csv, math, random
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

random.seed(20260716)
OUT = Path(__file__).parent / "data_us_commercial"; OUT.mkdir(exist_ok=True)
START, DAYS = date(2025, 4, 1), 90
HUBS = ["Northside_Fulfillment", "Central_Fulfillment", "Eastside_Fulfillment"]
DRONES = [f"ZIP-US-{i:03d}" for i in range(1, 25)]
HOME = {d: HUBS[0] if i < 8 else HUBS[1] if i < 16 else HUBS[2] for i,d in enumerate(DRONES)}
MERCHANTS = [
 ("M-001","Green Basket Market","grocery","Northside_Fulfillment"),("M-002","Crisp & Co.","prepared_food","Northside_Fulfillment"),
 ("M-003","Pasta Garden","prepared_food","Northside_Fulfillment"),("M-004","QuickCare Pharmacy","pharmacy","Northside_Fulfillment"),
 ("M-005","Corner Table","prepared_food","Central_Fulfillment"),("M-006","Fresh Roots Grocery","grocery","Central_Fulfillment"),
 ("M-007","Home & Handy","retail","Central_Fulfillment"),("M-008","Noodle House","prepared_food","Central_Fulfillment"),
 ("M-009","Daily Mart","grocery","Eastside_Fulfillment"),("M-010","Burger District","prepared_food","Eastside_Fulfillment"),
 ("M-011","Wellness Pharmacy","pharmacy","Eastside_Fulfillment"),("M-012","Tech Stop","retail","Eastside_Fulfillment")]
M_BY_HUB=defaultdict(list)
for m in MERCHANTS: M_BY_HUB[m[3]].append(m)
ZONES={"Northside_Fulfillment":[("Maplewood",2.7),("Cedar Park",4.4),("North Hills",6.8),("Brookfield",8.9)],
       "Central_Fulfillment":[("Downtown",2.2),("Riverside",4.1),("Westgate",6.3),("South Park",9.2)],
       "Eastside_Fulfillment":[("Lakeside",2.9),("Meadowview",5.0),("East Ridge",7.1),("Harbor Point",9.5)]}
FIELDS={}
def write(name, rows):
 rows=list(rows); FIELDS[name]=list(rows[0]) if rows else []
 with (OUT/name).open("w",newline="",encoding="utf-8") as f:
  w=csv.DictWriter(f,fieldnames=FIELDS[name]); w.writeheader(); w.writerows(rows)
def cap(x,a,b): return max(a,min(b,x))
def fmt(dt): return dt.strftime("%Y-%m-%dT%H:%M:%S")

# Hourly micro-weather by service area, including two recognizable operational disruptions.
weather=[]; wx={}
for di in range(DAYS):
 for hub in HUBS:
  for hour in range(24):
   dt=datetime.combine(START+timedelta(days=di),datetime.min.time())+timedelta(hours=hour)
   storm=17 if hub=="Eastside_Fulfillment" and di==35 and 14<=hour<=18 else 0
   low_vis=8 if hub=="Northside_Fulfillment" and di==61 and 6<=hour<=9 else 0
   wind=cap(11+4*math.sin((hour-11)*math.pi/12)+storm+random.gauss(0,2),2,45)
   gust=cap(wind+random.uniform(2,9)+storm*.2,wind,50); vis=cap(16-low_vis-storm*.25+random.gauss(0,1),.8,18)
   row={"observed_at":fmt(dt),"fulfillment_site":hub,"wind_speed_kph":round(wind,1),"wind_gust_kph":round(gust,1),
    "precipitation_mm":round(cap((storm-12)*.22+random.gauss(.03,.1),0,5),2),"temperature_c":round(18+7*math.sin((hour-7)*math.pi/12)+random.gauss(0,.8),1),
    "visibility_km":round(vis,1),"operating_condition":"hold" if wind>35 or gust>42 or vis<3 else ("caution" if wind>25 or vis<7 else "normal")}
   weather.append(row); wx[(hub,di,hour)]=row
write("service_area_weather_hourly.csv",weather)

maintenance=[]; grounded=defaultdict(set)
for d in range(90):
 if 45<=d<=49: grounded["ZIP-US-011"].add(d)
 if 68<=d<=70: grounded["ZIP-US-019"].add(d)
maintenance += [
 {"maintenance_id":"MNT-001","drone_id":"ZIP-US-011","site":"Central_Fulfillment","opened_at":"2025-05-16T08:30:00","closed_at":"2025-05-20T16:00:00","component":"battery_pack","maintenance_type":"corrective","action":"replace","reason":"Cell voltage imbalance and high consumption trend","release_status":"validated_return_to_service"},
 {"maintenance_id":"MNT-002","drone_id":"ZIP-US-019","site":"Eastside_Fulfillment","opened_at":"2025-06-08T09:00:00","closed_at":"2025-06-10T14:00:00","component":"tether_descent_motor","maintenance_type":"corrective","action":"service","reason":"Descent time variability","release_status":"validated_return_to_service"}]

ops=[]; telemetry=[]; orders=[]; merchant_events=[]; feedback=[]; support=[]; n=30000
for di in range(DAYS):
 day=START+timedelta(days=di)
 for hub in HUBS:
  # about 40 commercial orders/site/day; sufficient data but still hackathon friendly
  for _ in range(random.randint(36,45)):
   m_id,merchant,category,_=random.choice(M_BY_HUB[hub]); zone,distance=random.choice(ZONES[hub]); drone=random.choice([d for d in DRONES if HOME[d]==hub and di not in grounded[d]])
   requested=datetime.combine(day,datetime.min.time())+timedelta(hours=random.randint(8,20),minutes=random.randrange(0,60,5))
   launch=requested+timedelta(minutes=random.randint(8,32)); w=wx[(hub,di,launch.hour)]
   priority=random.choices(["standard","priority","time_sensitive"],[61,31,8])[0]
   promise=25 if priority=="time_sensitive" else 35 if priority=="priority" else 55
   items=random.randint(1,5); weight=round(random.uniform(.15,1.65),2)
   prep=round(cap(8+items*2+random.gauss(0,3),3,35),1)
   # Merchant-specific story: a POS / kitchen readiness integration defect in May.
   merchant_status="ready_on_time"; prep_delay=0
   if merchant=="Pasta Garden" and 21<=di<=29:
    prep_delay=random.choice([0,0,8,12,16]); merchant_status="ready_late" if prep_delay else "ready_on_time"
   planned=round(7+distance*.6+random.gauss(0,1),1); status="delivered"; anomaly="none"; note=""
   if w["operating_condition"]=="hold": status="cancelled_weather"; anomaly="weather_limit"; note="Release held by weather policy."; actual=0
   else:
    actual=planned+prep_delay
    if drone=="ZIP-US-011" and 38<=di<=44:
     anomaly="battery_drain_fast"; actual+=random.uniform(2,6); note="Battery performance flag under monitoring."
    if drone=="ZIP-US-019" and 64<=di<=67:
     anomaly="tether_descent_slow"; actual+=random.uniform(2,5); note="Tether descent slower than baseline."
    if w["operating_condition"]=="caution" and random.random()<.12:
     status="returned_to_site"; anomaly="weather_diversion"; note="Conservative return after conditions deteriorated."; actual=round(planned*.35,1)
    elif random.random()<.025:
     anomaly=random.choice(["customer_drop_zone_unavailable","merchant_handoff_mismatch","airspace_hold"]); status="delivered_late"; actual+=random.randint(6,14)
    elif actual>promise: status="delivered_late"
   flight=f"FL-US-{n}"; order=f"ORD-US-{n}"; n+=1
   delivered=launch+timedelta(minutes=actual) if actual else None
   drain=0 if not actual else cap(18+distance*3.1+weight*3+max(0,w["wind_speed_kph"]-14)*.6+random.gauss(0,2),8,85)
   ops.append({"flight_id":flight,"order_id":order,"drone_id":drone,"drone_model":"standardized_commercial_delivery_platform","fulfillment_site":hub,"merchant_id":m_id,"merchant_name":merchant,"merchant_category":category,"delivery_zone":zone,"launch_at":fmt(launch),"delivered_at":fmt(delivered) if delivered else "","distance_one_way_km":distance,"payload_weight_kg":weight,"service_level":priority,"promised_minutes":promise,"actual_minutes":round(actual,1),"battery_consumption_pct":round(drain,1),"wind_speed_kph":w["wind_speed_kph"],"visibility_km":w["visibility_km"],"status":status,"anomaly_flag":anomaly,"operator_note":note})
   orders.append({"order_id":order,"requested_at":fmt(requested),"merchant_id":m_id,"merchant_name":merchant,"merchant_category":category,"fulfillment_site":hub,"delivery_zone":zone,"item_count":items,"payload_weight_kg":weight,"service_level":priority,"promised_minutes":promise,"order_status":"fulfilled" if status.startswith("delivered") else ("cancelled" if status=="cancelled_weather" else "returned_or_reassigned")})
   merchant_events.append({"merchant_event_id":f"ME-{n}","order_id":order,"merchant_id":m_id,"merchant_name":merchant,"event_at":fmt(requested+timedelta(minutes=prep+prep_delay)),"ready_status":merchant_status,"estimated_prep_min":prep,"additional_delay_min":prep_delay,"handoff_verified":anomaly!="merchant_handoff_mismatch"})
   for phase,fraction in (("pickup",0),("outbound",.5),("recovery",.95)):
    batt=100-drain*fraction; temp=27+drain*.1+random.gauss(0,1); spread=20+random.gauss(0,4)
    if drone=="ZIP-US-011" and 38<=di<=44: temp+=3; spread+=35
    vibration=1+random.gauss(0,.15)
    if drone=="ZIP-US-019" and 64<=di<=67: vibration+=.8
    telemetry.append({"telemetry_id":f"TEL-{n}-{phase}","flight_id":flight,"drone_id":drone,"recorded_at":fmt(launch+timedelta(minutes=actual*fraction)),"phase":phase,"battery_pct":round(cap(batt,0,100),1),"battery_temp_c":round(temp,1),"cell_voltage_spread_mv":round(cap(spread,5,110),1),"motor_vibration_mm_s":round(cap(vibration,.4,4),2),"gps_hdop":round(cap(.8+random.gauss(0,.2),.5,3),2),"tether_descent_sec":round(37+(11 if drone=="ZIP-US-019" and 64<=di<=67 else random.gauss(0,1)),1),"sensor_status":"flagged" if anomaly!="none" else "nominal"})
   if status in ("delivered_late","returned_to_site") or anomaly in ("customer_drop_zone_unavailable","merchant_handoff_mismatch"):
    support.append({"ticket_id":f"CS-{n}","order_id":order,"opened_at":fmt((delivered or launch)+timedelta(minutes=3)),"contact_reason":"late_delivery" if status=="delivered_late" else "delivery_exception","resolution":"credit_issued" if random.random()<.65 else "explanation_provided","refund_amount_usd":round(random.choice([0,3,5,8,12]),2),"customer_sentiment":random.choice(["neutral","negative","negative","positive"])})
   feedback.append({"order_id":order,"rating":random.choices([1,2,3,4,5],[3,5,10,30,52] if status=="delivered" else [20,25,25,20,10])[0],"feedback_tag":"on_time" if status=="delivered" else ("merchant_delay" if prep_delay else "delivery_issue")})
write("commercial_delivery_operations.csv",ops); write("commercial_orders.csv",orders); write("merchant_readiness_events.csv",merchant_events); write("flight_telemetry_phases.csv",telemetry); write("customer_support_tickets.csv",support); write("customer_feedback.csv",feedback); write("maintenance_events.csv",maintenance)

health=[]
for di in range(DAYS):
 for d in DRONES:
  capacity=96-di*.03+random.gauss(0,.35); spread=20+random.gauss(0,4); tether=37+random.gauss(0,1); status="operational"
  if d=="ZIP-US-011" and 38<=di<=44: capacity-=8+(di-38)*1.2; spread+=32+(di-38)*4; status="monitoring" if di<43 else "grounded"
  if d=="ZIP-US-011" and di>=50: capacity=99-random.random()*.5; spread=15+random.random()*5
  if d=="ZIP-US-019" and 64<=di<=67: tether+=10; status="monitoring"
  if di in grounded[d]: status="grounded"
  health.append({"snapshot_date":str(START+timedelta(days=di)),"drone_id":d,"home_site":HOME[d],"battery_capacity_pct":round(cap(capacity,65,100),1),"battery_cycle_count":int(130+di*1.5+int(d[-3:])*3),"cell_voltage_spread_mv":round(cap(spread,5,110),1),"motor_vibration_mm_s":round(cap(1+random.gauss(0,.15),.5,4),2),"tether_descent_baseline_sec":round(tether,1),"maintenance_status":status})
write("drone_health_daily.csv",health)
write("fleet_assets.csv",({"drone_id":d,"drone_model":"standardized_commercial_delivery_platform","home_site":HOME[d],"max_payload_kg":1.75,"normal_route_limit_km":10,"planned_flights_per_day":5} for d in DRONES))
write("merchant_directory.csv",({"merchant_id":a,"merchant_name":b,"merchant_category":c,"fulfillment_site":d,"integration_type":"merchant_order_api","standard_prep_target_min":12 if c=="prepared_food" else 8} for a,b,c,d in MERCHANTS))

docs=OUT/"incident_and_handover_reports"; docs.mkdir(exist_ok=True)
stories=[
 ("CR-001","2025-04-22","Pasta Garden readiness integration delay","merchant","Pasta Garden orders were marked ready by the merchant integration before kitchen completion. Pickup waits increased and priority orders missed their customer promise. The client should separate order-accepted from physically-ready events and show merchant readiness uncertainty to the operator."),
 ("CR-002","2025-05-09","ZIP-US-011 battery trend","fleet","ZIP-US-011 showed elevated cell-voltage spread, battery temperature, and route-normalized consumption. It was restricted, then grounded for a battery replacement before a customer-facing failure occurred."),
 ("CR-003","2025-05-16","ZIP-US-011 battery replacement and validation","fleet","The battery pack was replaced and the aircraft completed validation missions within normal temperature and consumption bounds. The return-to-service record is in maintenance history."),
 ("CR-004","2025-05-06","Eastside wind hold","weather","Strong afternoon wind and gusts required a temporary delivery hold at Eastside. Customer orders were deferred or cancelled under the commercial service-recovery playbook."),
 ("CR-005","2025-06-01","Northside low-visibility morning hold","weather","Visibility dropped below the defined release threshold. No launch was permitted until conditions returned to normal."),
 ("CR-006","2025-06-05","ZIP-US-019 tether descent variance","fleet","ZIP-US-019 showed repeated slow tether descent events. The aircraft was removed for service, then validated before release."),
 ("CR-007","2025-05-02","Customer drop-zone access exception","customer","A delivery area was temporarily obstructed. The aircraft returned conservatively and support offered an appropriate customer resolution. The event must not be reported as a successful delivery."),
 ("CR-008","2025-05-14","Merchant handoff mismatch","merchant","The handoff verification did not match the order payload. The operator followed the exception workflow and customer support resolved the affected order.")]
for i in range(75):
 if i<len(stories): rid,when,title,topic,body=stories[i]
 else:
  x=ops[(i*149)%len(ops)]; rid=f"CR-{i+1:03d}"; when=x["launch_at"][:10]; topic="operations"; title="Commercial delivery shift handover"
  body=f"Order {x['order_id']} / flight {x['flight_id']} from {x['merchant_name']} to {x['delivery_zone']} was reviewed. Status: {x['status']}; observed condition: {x['anomaly_flag']}. The shift lead recorded the outcome and followed the customer and fleet escalation checklist where needed."
 (docs/f"{rid}.md").write_text(f"# {rid}: {title}\n\nDate: {when}\nTopic: {topic}\n\n## Narrative\n\n{body}\n\n## Copilot use\n\nUse this report as supporting evidence only. Link it to the structured order, delivery, weather, fleet-health, and maintenance records before making a recommendation.\n",encoding="utf-8")

(OUT/"OPERATING_POLICY.md").write_text("""# Fictional Commercial Delivery Policy

This is authoritative only for this interview-practice scenario, not real operational guidance.

## Weather and release

- Hold launch when sustained wind exceeds 35 kph, gusts exceed 42 kph, or visibility is under 3 km.
- An operator review is required at 26–35 kph sustained wind, 34–42 kph gusts, or 3–7 km visibility.

## Customer and merchant handling

- A delivery is successful only after verified completion. A returned or inaccessible drop zone is an exception, not a completion.
- Use actual merchant-ready status, not order acceptance, when estimating a customer promise.
- For a weather hold or operational exception, the copilot may recommend deferral, cancellation, reassignment, or customer outreach; a human operator owns the decision.

## Fleet escalation

- Ground for battery capacity below 80%, cell-voltage spread over 60 mV, or motor vibration over 3.0 mm/s.
- Restrict and open a maintenance review for battery capacity 80–84%, spread 45–60 mV, or vibration 2.2–3.0 mm/s.
- The copilot may summarize evidence and policies. It must never state that a flight is authorized or safe to launch.
""",encoding="utf-8")
(OUT/"DATA_DICTIONARY.md").write_text("# Data dictionary\n\nAll records are synthetic. `order_id` connects orders, delivery operations, merchant readiness, feedback, and support. `flight_id` connects operations to telemetry. `drone_id`, site, and time connect health, maintenance, and weather.\n\n"+"\n".join(f"## `{n}`\n\n"+" | ".join(c) for n,c in FIELDS.items()),encoding="utf-8")
print(f"Wrote {len(ops):,} commercial deliveries, {len(telemetry):,} telemetry rows, {len(weather):,} weather readings, {len(support):,} support tickets, and 75 RAG reports to {OUT}")
