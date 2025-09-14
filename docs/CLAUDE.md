# Documentation Index

This directory contains technical documentation for the home automation system.

## System Specifications

### Infrastructure Systems
- **[Water System](water_system_spec.md)** - Complete specification of multi-circuit water system including ground source, hot water heating, solar thermal, and heat pump integration
  - **[Water System Diagram](water_system_diagram.mermaid)** - Visual flow diagram of water circuits and components
  - **IMPORTANT**: Always keep the specification and diagram synchronized when making changes

### Component Documentation

#### HVAC and Climate Control
- **[Heat Pump](heat-pump/)** - Technical manuals and specifications for water-to-water heat pump system
- **[Air Conditioning](air-conditioning/)** - BAC-1000 Modbus controller documentation

#### Infrastructure
- **[Wiring](wiring/)** - Electrical load diagrams and wiring specifications

## Data Infrastructure

### InfluxDB Schema
- **[Complete InfluxDB Schema](influxdb-schema.md)** - Comprehensive documentation of time-series database measurements, fields, and data sources

## Quick Reference

### Monitoring Topics
- Water pump energy: `/modbus/secondary/water_pump/reading`
- Boiler temperatures: `homy/features/sensor/temperature_boiler_*/status`
- Solar panel temperature: `homy/features/sensor/temperature_solar_panel/status`
- Heat pump energy: `/modbus/tetriary/heat_pump/reading`

### Control Topics
- Boiler heater: `homy/features/relay/service_boiler_contactor/set`
- Solar circulation: `homy/features/relay/solar_heater_circulation/status`

### Dashboard Access
- Heat pump monitoring: `grafana/heatpump.json`
- System overview available in Home Assistant