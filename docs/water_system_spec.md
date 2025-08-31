# Water System Specification

## System Overview
Multi-circuit water system with ground source, hot water heating, solar thermal, and heat pump integration.

```yaml
water_system:
  metadata:
    version: "1.0"
    created: "2025-01-30"
    house:
      floors: 2
      floor_height: "3m"
      ground_level: 0
      roof_level: "7m"
    
  components:
    # Ground Water Source
    ground_water_source:
      type: "borehole"
      depth: "13m"
      location: {floor: "underground", coords: [x, y, -13]}
      pump:
        model: "Grundfos SQE3-80"
        specs:
          power: "1.68kW"
          voltage: "200-240V 1Ph"
          diameter: "3 inch"
          type: "multi-stage submersible"
          protection: ["dry-running", "overvoltage", "undervoltage", "overload", "overtemperature"]
        controller:
          model: "CU301"
          type: "constant_pressure"
          pressure_range: "2-5 bar (29-72 psi)"
          current_setting: "2 bar"
          communication: "Power Line Communication"
        monitoring:
          mqtt_topic: "/modbus/secondary/water_pump/reading"
          energy_tracking: true
    
    # Filtration System
    filtration:
      location: {floor: 1, room: "service"}
      sequence:
        - type: "pressure_tank"
          purpose: "pump controller stabilization"
        - type: "mechanical_filter"
          mesh: "50 micron"
          replacement_schedule: "end of summer"
        - type: "mechanical_filter" 
          mesh: "5 micron"
          replacement_schedule: "end of summer"
    
    # Hot Water System
    boiler:
      model: "Eldom FV20060S2"
      capacity: "200L"
      location: {floor: 1, room: "service", elevation: "ground"}
      physical:
        height: "140cm"
        type: "vertical_cylindrical"
        material: "enameled_steel"
        insulation: "polyurethane_75mm"
        max_pressure: "8 bar"
        max_temperature: "95°C"
      serpentines:
        upper:
          volume: "1.79L" 
          surface: "0.86m²"
          purpose: "instant_heating"
          connection: "unused"
        lower:
          volume: "4.2L"
          surface: "0.35m²" 
          purpose: "solar_accumulation"
          connection: "solar_circuit"
      electric_heater:
        power: "3kW"
        voltage: "230V 1Ph"
        control_topic: "homy/features/relay/service_boiler_contactor/set"
        status_topic: "homy/features/relay/service_boiler_contactor/status"
        schedule: "sunset_to_nadir"
      sensors:
        bottom:
          height: "45cm"
          location: "inside_lower_serpentine_20cm"
          mqtt_topic: "homy/features/sensor/temperature_boiler_low/status"
        top:
          height: "107cm" 
          location: "inside_lower_serpentine_20cm"
          mqtt_topic: "homy/features/sensor/temperature_boiler_high/status"
      monitoring:
        energy_topic: "/modbus/secondary/boiler/reading"
        heating_detection: "power > 10W"
    
    # Solar Thermal System
    solar_thermal:
      panels:
        count: 2
        location: {floor: "roof", elevation: "7m"}
        temperature_sensor:
          mqtt_topic: "homy/features/sensor/temperature_solar_panel/status"
      circulation:
        pump: "controlled_by_external_solar_controller"
        controller: 
          monitoring_topic: "/modbus/monitoring/solar_heater/reading"
          sensors: ["t1_boiler_bottom", "t2_boiler_top", "t3_solar_panel", "t6_service_room"]
        expansion_tank: true
        pressure_relief_valve: true
        pump_status_topic: "homy/features/relay/solar_heater_circulation/status"
    
    # Heat Pump
    heat_pump:
      type: "water-to-water"
      compressor:
        model: "Copeland ZR36K3-TFD"
        specs:
          power: "3kW"
          voltage: "3Ph"
          type: "scroll_compressor"
          year: "~2016 (potentially older/discontinued model)"
          refrigerant: "R22"
      location: {floor: 1, room: "service"}
      controller:
        type: "modbus_controller"
        status: "non_responsive_since_2024"
        temperature_sensor: "return_pipe_underfloor_heating"
      circulation_pump:
        purpose: "underfloor_heating"
        operation: "continuous"
        status: "intermittent_stops"
      monitoring:
        energy_topics: 
          - "/modbus/tetriary/heat_pump/reading"           # Current (after 2023-10-15)
          - "obsolete/modbus/tetriary/heat_pump/reading"   # Historic (until 2023-10-15)
        ha_sensors:
          - "sensor.heat_pump_dds024mr_tot_act"           # Current
          - "sensor.heat_pump_energy_used"                # Historic
        alarm: "consumption < 20W → manual_restart_required"
        grafana_dashboard: "heatpump.json"
      distributions:
        floor1_underfloor: "active"
        floor2_underfloor: "active"
    
    # Hot Water Circulation (Currently Disconnected)
    hot_water_circulation:
      pump:
        model: "unknown"
        status: "disconnected" 
        intended_location: "between_distribution2_and_boiler"
        control: "planned_manual_or_automatic"
  
  circuits:
    # Cold Water Main Circuit
    cold_water_main:
      source: "ground_water_source"
      path: "borehole → pump → pressure_tank → 50μm_filter → 5μm_filter → main_split"
      pipe_material: "HDPE"
      splits:
        irrigation: "50mm HDPE"
        domestic: "32mm HDPE"
    
    # Irrigation Circuit  
    irrigation:
      source: "cold_water_main"
      main_pipe: "50mm HDPE"
      zones:
        zone_a:
          path: "50mm → 40mm → 32mm HDPE"
        zone_b: 
          path: "50mm → 40mm → 32mm HDPE"
    
    # Domestic Cold Water
    domestic_cold:
      source: "cold_water_main" 
      main_pipe: "32mm HDPE underground"
      heat_pump_connection:
        inlet: "32mm HDPE T-connector"
        outlet: "25mm HDPE to 250mm underground drainage"
        destination: "irrigation_channel_off_plot"
      distribution_split:
        pipe: "3/4 inch PPR"
        household_branch:
          consumers:
            - {name: "bath1_toilet", floor: 1}
            - {name: "bath1_sink", floor: 1, sequence: "before_shower"}
            - {name: "bath1_shower", floor: 1, sequence: "after_sink"}
            - {name: "bath2_toilet", floor: 2}
            - {name: "bath2_sink", floor: 2, sequence: "before_shower", elevation: "+3m"}
            - {name: "bath2_shower", floor: 2, sequence: "after_sink", elevation: "+3m"}
            - {name: "bath3_toilet", floor: 2, elevation: "+3m"}
            - {name: "bath3_sink", floor: 2, sequence: "before_shower", elevation: "+3m"}
            - {name: "bath3_shower", floor: 2, sequence: "after_sink", elevation: "+3m"}
            - {name: "kitchen_sink", floor: 1}
            - {name: "washing_machine", floor: 1, location: "next_to_kitchen_sink"}
            - {name: "laundry_room", floor: 2, location: "next_to_bath3"}
            - {name: "boiler_inlet", floor: 1, room: "service"}
            - {name: "reserve_connection", status: "unused"}
            - {name: "exit_outside_behind_bath1", floor: 1, purpose: "external_cold"}
        external_branch:
          consumers:
            - {name: "terrace", floor: 2}
            - {name: "external_sink_east_wall", location: "3m_from_south", floor: 1}
            - {name: "unused_irrigation_east_wall", location: "5-6m_from_south", status: "unused"}
    
    # Hot Water Circuit (Planned)
    hot_water_circulation:
      source: "boiler"
      status: "circulation_pump_disconnected"
      path: "boiler → distribution1 → consumers → distribution2 → [pump] → boiler"
      distributions:
        distribution1:
          type: "manifold_hot_out"
          location: "near_boiler_or_central" # clarify location
          valve_type: "manual_per_consumer"
        distribution2:
          type: "manifold_return"
          location: "near_boiler_or_central" # clarify location
          valve_type: "manual_per_consumer"
      consumers:
        - {name: "bath1_sink", floor: 1, valve: "manual"}
        - {name: "bath1_shower", floor: 1, valve: "manual", sequence: "after_sink"}
        - {name: "bath2_sink", floor: 2, valve: "manual", elevation: "+3m"}
        - {name: "bath2_shower", floor: 2, valve: "manual", sequence: "after_sink", elevation: "+3m"}
        - {name: "bath3_sink", floor: 2, valve: "manual", elevation: "+3m"}
        - {name: "bath3_shower", floor: 2, valve: "manual", sequence: "after_sink", elevation: "+3m"}
        - {name: "kitchen_sink", floor: 1, valve: "manual"}
        - {name: "unused_outside_behind_bath1", status: "unused", valve: "manual"}
        - {name: "reserve", status: "unused", valve: "manual"}
      reverse_valves:
        status: "currently_closed"
        location: "unknown" # clarify location and purpose
    
    # Solar Heating Circuit
    solar_heating:
      source: "solar_panels"
      path: "solar_panels → circulation_pump → boiler_lower_serpentine → expansion_tank"
      controller:
        type: "external_solar_controller"
        monitoring_only: true
        mqtt_topic: "/modbus/monitoring/solar_heater/reading"
        controlled_devices: ["circulation_pump"]
        temperature_inputs: ["solar_panel", "boiler_top", "boiler_bottom", "service_room"]
      safety:
        expansion_tank: "installed"
        pressure_relief_valve: "installed"
        
    # Heat Pump Circuit
    heat_pump_cooling:
      source: "cold_water_main"
      path: "32mm_hdpe → heat_pump → 25mm_hdpe → 250mm_underground → irrigation_channel"
      purpose: "ground_source_cooling"
      drainage:
        pipe: "250mm OD underground"
        inclination: "sloped"
        destination: "irrigation_channel_off_plot"
        
    # Underfloor Heating Circuit  
    underfloor_heating:
      source: "heat_pump"
      distributions:
        floor1: "active"
        floor2: "active"
      circulation_pump:
        operation: "continuous"
        issues: "intermittent_stops"
        location: "heat_pump_unit"
      controller:
        status: "modbus_non_responsive_since_2024"
        temperature_sensor: "return_pipe"

  monitoring:
    mqtt_topics:
              energy:
        - "/modbus/secondary/water_pump/reading"         # Ground water pump
        - "/modbus/secondary/waste_pump/reading"         # Waste water pump  
        - "/modbus/secondary/boiler/reading"             # Boiler electric heater
        - "/modbus/tetriary/heat_pump/reading"           # Heat pump (current)
        - "obsolete/modbus/tetriary/heat_pump/reading"   # Heat pump (historic)
      temperatures:
        - "homy/features/sensor/temperature_boiler_low/status"
        - "homy/features/sensor/temperature_boiler_high/status" 
        - "homy/features/sensor/temperature_solar_panel/status"
        - "homy/features/sensor/temperature_room_service/status"
      controls:
        - "homy/features/relay/service_boiler_contactor/set"
        - "homy/features/relay/solar_heater_circulation/status"
        
    grafana:
      dashboards:
        - "heatpump.json"
      alarms:
        heat_pump_failure: "consumption < 20W"
        
    home_assistant:
      entities:
        - "sensor.water_pump_energy_used"
        - "sensor.waste_pump_energy_used" 
        - "sensor.boiler_energy_used"
        - "binary_sensor.boiler_heating"

  issues:
    current:
      - "hot water circulation pump disconnected"
      - "heat pump modbus controller non-responsive since 2024"
      - "heat pump circulation pump intermittent stops"
      - "reverse valves closed (location/purpose unclear)"
    
  planned_improvements:
    - "connect hot water circulation pump"
    - "investigate heat pump modbus communication"
    - "identify reverse valve locations and purpose"
    - "clarify distribution1/distribution2 physical locations"
```

## Key Clarifications Needed

**High Priority:**
1. Distribution manifold locations - where exactly are distribution1 and distribution2?
2. Reverse valve locations and intended function

**Medium Priority:**
3. Hot water circulation pump specifications
4. Pressure tank size and location details
5. Physical pipe routing maps
6. Valve numbering/identification system

## Extension Framework

This structure supports future additions for:
- **Electrical:** `electrical_system:` with similar component/circuit structure
- **HVAC:** `hvac_system:` for air ducts, thermostats, dampers  
- **Irrigation:** `irrigation_system:` for zones, schedules, sensors
- **Sensors:** Cross-system sensor registry with unified monitoring
- **Automation:** Links to MQTT topics, Node-RED flows, HA entities

Would you like me to:
A) Refine this YAML structure based on missing details
B) Add electrical system framework 
C) Create visualization layer (Mermaid diagrams)
D) Design query/management system architecture