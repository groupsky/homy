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
      diameter: "80mm"
      location: 
        manhole: "Sonda shahta"
        depth_in_manhole: "13m from surface"
      pump:
        model: "Grundfos SQE3-80"
        depth: "11m from surface"
        specs:
          power: "1.68kW"
          voltage: "200-240V 1Ph"
          diameter: "3 inch"
          type: "multi-stage submersible"
          protection: ["dry-running", "overvoltage", "undervoltage", "overload", "overtemperature"]
        controller:
          model: "CU301"
          type: "constant_pressure"
          location: "service_room"
          pressure_range: "2-5 bar (29-72 psi)"
          current_setting: "2 bar"
          communication: "Power Line Communication"
        monitoring:
          mqtt_topic: "/modbus/secondary/water_pump/reading"
          energy_tracking: true
    
    # Filtration System
    filtration:
      location: {manhole: "Sonda shahta"}
      sequence:
        - type: "pressure_tank"
          purpose: "pump controller stabilization"
          location: "Sonda_shahta_manhole"
          connection: "parallel (tee) before the filters, not in series"
          size: "~8L (owner's memory), part of the pump kit; exact model open in #1005"
        - type: "mechanical_filter"
          mesh: "50 micron"
          location: "Sonda_shahta_manhole"
          replacement_schedule: "end of summer"
        - type: "mechanical_filter" 
          mesh: "5 micron"
          location: "Sonda_shahta_manhole"
          replacement_schedule: "end of summer"
    
    # Hot Water System
    boiler:
      model: "Eldom FV20060S21"
      capacity: "184L"  # net, from the rating plate read on 2026-11-19
      rating_plate: "FV20060S21, 230V, 3000W, 0.8MPa, made 2018-11"
      location: {floor: 1, room: "service", elevation: "ground"}
      physical:
        height: "143cm"  # total, maker's sheet
        diameter: "60cm with 75mm insulation"
        type: "vertical_cylindrical"
        material: "enameled_steel"
        insulation: "polyurethane_75mm"
        max_pressure: "8 bar"
        max_temperature: "75°C with the element"
        standing_loss: "52W"
        hot_water_40c: "229L from a full tank (EN 12897, solar coil off)"
      # Hot water leaves through the highest side outlet (port 3).
      # The socket on the top of the tank (port 4) is closed, as the label says.
      #
      # Port map, owner 2026-11-19. Numbers and heights are from the maker's sheet
      # "FV 200-500 (I) S21" (BG, 2025), column FV20060S21, the 0 kW version:
      # https://eldominvest.com/download/products/22207/FV_200-500-I-S21_0kW_BG_2025.pdf
      # Ours has the 3 kW element in the flange too. Heights are from the bottom.
      # Do not use the "FV 150-500S2" sheet: it is a different model.
      ports:
        - {no: 7,  use: "thermometer",                       height: "1170mm (H3)"}
        - {no: 9,  use: "solar circuit (coil S1 inlet)",     height: "1170mm (H3)"}
        - {no: 3,  use: "hot water outlet",                  height: "1170mm (H3)"}
        - {no: 4,  use: "closed (top socket)",               height: "top of the tank"}
        - {no: 11, use: "top sensor (coil S2 inlet port)",   height: "1065mm (HS2 + S2)"}
        - {no: 2,  use: "recirculation inlet, pump not connected", height: "855mm (H2); 805mm on the older English sheet with the element"}
        - {no: 8,  use: "bottom sensor (sensor socket)",     height: "about 470-530mm (scaled from the drawings)"}
        - {no: 12, use: "not used (coil S2 outlet)",         height: "365mm (HS2)"}
        - {no: 10, use: "solar circuit (coil S1 outlet)",    height: "260mm (HS1)"}
        - {no: 1,  use: "cold inlet / drain (lowest)",       height: "210mm (H1)"}
        - {no: 6,  use: "flange with the 3 kW element",      height: "centre about 250mm (scaled)"}
      # Two parallel coils. The solar coil covers almost the whole height of the tank.
      serpentines:
        s1:
          volume: "4.3L"
          surface: "0.90m²"
          span: "260mm to 1170mm"
          ports: "9 (inlet, top middle) and 10 (outlet, bottom left)"
          purpose: "solar"
          connection: "solar_circuit"
        s2:
          volume: "3.2L"
          surface: "0.67m²"
          span: "365mm to 1065mm"
          ports: "11 (inlet) and 12 (outlet)"
          purpose: "second coil"
          connection: "unused"
      electric_heater:
        power: "3kW"
        voltage: "230V 1Ph"
        max_temperature: "75°C"  # English sheet "FV 200-500 S21": 230 min to 70 °C
        control_topic: "homy/features/relay/service_boiler_contactor/set"
        status_topic: "homy/features/relay/service_boiler_contactor/status"
        schedule: "sunset_to_nadir"
      sensors:
        bottom:
          height: "about 47cm"  # port 8, scaled from the drawings: 470-530mm
          location: "sensor socket, port 8"
          mqtt_topic: "homy/features/sensor/temperature_boiler_low/status"
        top:
          height: "106.5cm"  # port 11, the S2 coil inlet port, used as a sensor socket
          location: "port 11"
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
      source_side_flow_indicator:
        model: "BRV BR04654DN20-42, DN20"
        position: "outlet of the groundwater (source) line"
        scale: "5-42 L/min (from the code; no maker page found)"
        setting: "~30 L/min (~1.8 m3/h), set by owner 2026-10-29"
        output: "most likely visual only (float and scale); not confirmed by maker"
        note: "at 1.8 m3/h each kW taken from the groundwater cools it only ~0.48 K"
      building_side_loop: "PPR 40mm (separate circuit)"
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
    
    # Hot Water System
    hot_water_distribution:
      status: "operational"
      source: "boiler"
      path: "boiler → distribution1 → consumers → distribution2"
      distributions:
        distribution1:
          type: "manifold_hot_out"
          location: "service_room_near_boiler"
          valve_type: "manual_per_consumer"
        distribution2:
          type: "manifold_return"
          location: "service_room_near_boiler"
          valve_type: "manual_per_consumer"
      consumers:
        - {name: "bath1", floor: 1, valve: "manual", includes: ["sink", "shower"]}
        - {name: "bath2", floor: 2, valve: "manual", elevation: "+3m", includes: ["sink", "shower"]}
        - {name: "bath3", floor: 2, valve: "manual", elevation: "+3m", includes: ["sink", "shower"]}
        - {name: "kitchen_sink", floor: 1, valve: "manual"}
        - {name: "unused_outside_behind_bath1", status: "unused", valve: "manual"}
        - {name: "reserve", status: "unused", valve: "manual"}
      reverse_valves:
        type: "PPR_Ball_Valve"
        status: "currently_closed"
        reference_image: "https://europlastica.bg/resources/KRAN-SFERICHEN-1519127993448.png"
        location: "unknown" # clarify location and purpose

    hot_water_recirculation:
      pump:
        model: "unknown"
        status: "electrically_disconnected" 
        intended_location: "between_distribution2_and_boiler"
        control: "planned_manual_or_automatic"
  
  circuits:
    # Cold Water Main Circuit
    cold_water_main:
      source: "ground_water_source"
      path: "borehole → pump → (tee: pressure_tank) → 50μm_filter → 5μm_filter → main_split"
      feeds: "heat pump, fan coils and irrigation only from the borehole; house taps from city water and borehole, whichever has the higher pressure"
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
            - {name: "bath1", floor: 1, includes: ["toilet", "sink", "shower"]}
            - {name: "bath2", floor: 2, elevation: "+3m", includes: ["toilet", "sink", "shower"]}
            - {name: "bath3", floor: 2, elevation: "+3m", includes: ["toilet", "sink", "shower"]}
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
    
    # Hot Water Circuit (Operational)
    hot_water_distribution:
      source: "boiler"
      status: "operational"
      path: "boiler → distribution1 → consumers → distribution2"
      distributions:
        distribution1:
          type: "manifold_hot_out"
          location: "service_room_near_boiler"
          valve_type: "manual_per_consumer"
        distribution2:
          type: "manifold_return"
          location: "service_room_near_boiler"
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
        type: "PPR_Ball_Valve"
        status: "currently_closed"
        reference_image: "https://europlastica.bg/resources/KRAN-SFERICHEN-1519127993448.png"
        location: "unknown" # clarify location and purpose
    
    hot_water_recirculation:
      source: "distribution2"
      status: "pump_electrically_disconnected"
      path: "distribution2 → [disconnected_pump] → boiler"
      pump:
        model: "unknown"
        status: "electrically_disconnected" 
        intended_location: "between_distribution2_and_boiler"
        control: "planned_manual_or_automatic"
    
    # Solar Heating Circuit
    solar_heating:
      source: "solar_panels"
      path: "solar_panels → circulation_pump → boiler_solar_coil_s1 → expansion_tank"
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
        
    # Fan-coil cooling (summer only)
    fan_coils:
      units: "4 x SILP Klimafan IO 030, see docs/air-conditioning/README.md"
      source: "borehole water directly, not from the heat pump"
      feed: "branch of the heat-pump source line: HDPE 32 → PPR DN50, one size smaller after each branch"
      flow_limit: "manual valve on each unit"
      return: "joins an HDPE 25 outside the house"
      drainage: "agricultural irrigation channel outside the plot (same as the heat pump)"
      shared_with_heat_pump: "only the borehole source"

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
1. ~~Distribution manifold locations~~ ✅ *Resolved: service room near boiler*
2. ~~Reverse valve specifications~~ ✅ *Resolved: PPR Ball Valves* - location still unknown

**Medium Priority:**
3. Hot water circulation pump specifications → [Issue #1003](https://github.com/groupsky/homy/issues/1003)
4. Pressure tank exact model (~8L, tee before the filters is known) → [Issue #1005](https://github.com/groupsky/homy/issues/1005)
5. Physical pipe routing maps
6. Valve numbering/identification system → [Issue #1006](https://github.com/groupsky/homy/issues/1006)

**Related Documentation:**
- Electrical system specification → [Issue #1004](https://github.com/groupsky/homy/issues/1004)

## Extension Framework

This structure supports future additions for:
- **Electrical:** `electrical_system:` with similar component/circuit structure
- **HVAC:** `hvac_system:` for air ducts, thermostats, dampers  
- **Irrigation:** `irrigation_system:` for zones, schedules, sensors
- **Sensors:** Cross-system sensor registry with unified monitoring
- **Automation:** Links to MQTT topics and HA entities