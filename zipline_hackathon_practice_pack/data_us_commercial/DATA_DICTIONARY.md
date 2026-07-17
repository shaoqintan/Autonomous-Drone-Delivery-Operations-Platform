# Data dictionary

All records are synthetic. `order_id` connects orders, delivery operations, merchant readiness, feedback, and support. `flight_id` connects operations to telemetry. `drone_id`, site, and time connect health, maintenance, and weather.

## `service_area_weather_hourly.csv`

observed_at | fulfillment_site | wind_speed_kph | wind_gust_kph | precipitation_mm | temperature_c | visibility_km | operating_condition
## `commercial_delivery_operations.csv`

flight_id | order_id | drone_id | drone_model | fulfillment_site | merchant_id | merchant_name | merchant_category | delivery_zone | launch_at | delivered_at | distance_one_way_km | payload_weight_kg | service_level | promised_minutes | actual_minutes | battery_consumption_pct | wind_speed_kph | visibility_km | status | anomaly_flag | operator_note
## `commercial_orders.csv`

order_id | requested_at | merchant_id | merchant_name | merchant_category | fulfillment_site | delivery_zone | item_count | payload_weight_kg | service_level | promised_minutes | order_status
## `merchant_readiness_events.csv`

merchant_event_id | order_id | merchant_id | merchant_name | event_at | ready_status | estimated_prep_min | additional_delay_min | handoff_verified
## `flight_telemetry_phases.csv`

telemetry_id | flight_id | drone_id | recorded_at | phase | battery_pct | battery_temp_c | cell_voltage_spread_mv | motor_vibration_mm_s | gps_hdop | tether_descent_sec | sensor_status
## `customer_support_tickets.csv`

ticket_id | order_id | opened_at | contact_reason | resolution | refund_amount_usd | customer_sentiment
## `customer_feedback.csv`

order_id | rating | feedback_tag
## `maintenance_events.csv`

maintenance_id | drone_id | site | opened_at | closed_at | component | maintenance_type | action | reason | release_status
## `drone_health_daily.csv`

snapshot_date | drone_id | home_site | battery_capacity_pct | battery_cycle_count | cell_voltage_spread_mv | motor_vibration_mm_s | tether_descent_baseline_sec | maintenance_status
## `fleet_assets.csv`

drone_id | drone_model | home_site | max_payload_kg | normal_route_limit_km | planned_flights_per_day
## `merchant_directory.csv`

merchant_id | merchant_name | merchant_category | fulfillment_site | integration_type | standard_prep_target_min