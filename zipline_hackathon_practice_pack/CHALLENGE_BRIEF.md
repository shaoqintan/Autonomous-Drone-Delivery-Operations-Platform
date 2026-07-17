# Hackathon Challenge Brief

## Client context

A U.S. retail-delivery client operates a standardized autonomous-delivery fleet from three fulfillment sites. Their customers order prepared food, groceries, pharmacy items, and small retail goods from local merchants. The operations team monitors merchant readiness, customer delivery promises, weather, aircraft health, maintenance, delivery outcomes, refunds, and written shift reports.

Today, staff manually move between spreadsheets and incident write-ups to understand what happened, identify emerging risk, and decide what needs operator review. This is slow and error-prone.

## Your assignment

Build an **Operations Intelligence Copilot** for the client’s operators. The interface should let a non-technical user ask plain-language questions and get useful, evidence-backed answers.

The copilot should support:

- Quantitative questions about deliveries, fleet health, weather, and maintenance.
- Evidence retrieval from unstructured incident reports and the operating-policy excerpt.
- Clear citations or links to its underlying records.
- Decision support that distinguishes facts, uncertainty, and a recommended operator follow-up.

The copilot must not claim to authorize or clear a flight. Humans make operational release decisions.

## Supplied materials

- `commercial_delivery_operations.csv` — mission-level outcomes and customer-promise context.
- `flight_telemetry_phases.csv` — launch, cruise, and recovery sensor measurements.
- `service_area_weather_hourly.csv` — weather observations by fulfillment site and hour.
- `drone_health_daily.csv` — daily component-health snapshots.
- `commercial_orders.csv` — consumer orders and service levels.
- `merchant_readiness_events.csv` — restaurant/store handoff timing.
- `customer_support_tickets.csv` and `customer_feedback.csv` — service recovery signals.
- `maintenance_events.csv` — corrective maintenance records.
- `fleet_assets.csv` and `merchant_directory.csv` — reference data.
- `incident_and_handover_reports/` — shift narratives to use as a RAG corpus.
- `OPERATING_POLICY.md` — the scenario’s authoritative policy excerpt.
- `DATA_DICTIONARY.md` — column names and join keys.

## Constraints

- Time available: **3.5 hours**.
- Deliverable: a runnable application and a five-minute operator-facing demonstration.
- You may make reasonable, documented assumptions. Do not fabricate measurements or cite data you did not retrieve.
- Optimize for a useful end-to-end workflow, not an exhaustive platform.
