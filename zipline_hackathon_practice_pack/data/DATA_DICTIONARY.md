# Data dictionary

All data are synthetic and internally joinable. `flight_id` connects flight operations, phase telemetry, orders, and some incident narratives. `drone_id`, hub, and time connect the remaining tables.

## `nest_weather_hourly.csv`

observed_at | hub | wind_speed_kph | wind_gust_kph | wind_direction | temperature_c | humidity_pct | precipitation_mm | visibility_km | operational_weather_status

## `flight_operations.csv`

flight_id | drone_id | drone_model | date | launch_time | recovery_time | hub | destination | distance_one_way_km | payload_type | payload_item | payload_weight_kg | urgency | cruise_speed_kph | cruise_altitude_m | flight_duration_min | battery_start_pct | battery_end_pct | battery_consumption_pct | wind_speed_kph | wind_gust_kph | visibility_km | status | anomaly_flag | operator_notes

## `flight_telemetry_phases.csv`

telemetry_id | flight_id | drone_id | recorded_at | flight_phase | battery_pct | battery_temp_c | cell_voltage_spread_mv | motor_1_vibration_mm_s | motor_2_vibration_mm_s | gps_hdop | tether_descent_sec | parachute_release_latency_ms | status

## `delivery_orders.csv`

order_id | requested_at | flight_id | origin_hub | destination | clinical_category | urgency | requested_item | payload_weight_kg | service_level_minutes | order_status

## `drone_health_daily.csv`

snapshot_date | drone_id | battery_pack_capacity_pct | battery_cycle_count | cell_voltage_spread_mv | motor_2_vibration_mm_s | motor_2_temperature_c | tether_descent_motor_current_a | parachute_release_test_ms | gps_module_health | maintenance_status

## `maintenance_events.csv`

maintenance_id | drone_id | home_hub | opened_at | closed_at | component | maintenance_type | action | reason | parts_used | labor_hours | release_status

## `fleet_assets.csv`

drone_id | drone_model | home_hub | commissioned_date | max_payload_kg | normal_route_limit_km | planned_flights_per_day | current_configuration

## `route_reference.csv`

route_id | origin_hub | destination | one_way_distance_km | nominal_battery_consumption_pct | route_class | known_operational_note
