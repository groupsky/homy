# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a comprehensive home automation system built around Docker containers that provides:
- Home Assistant integration for smart home management
- MQTT-based device communication and automation
- Modbus serial communication for various hardware devices
- Time-series data collection with InfluxDB and visualization with Grafana
- Custom automation engine with configurable bots

## Development Commands

### Testing
```bash
# Run tests for the automations service
cd docker/automations
npm test

# Run individual test files
npx jest bots/irrigation.test.js
```

### Docker Environment
```bash
# Start the entire system
docker compose up -d

# Start specific services
docker compose up -d broker automations features

# View logs for specific services
docker compose logs -f automations
docker compose logs -f ha

# Rebuild and restart a service
docker compose up -d --build automations
```

### Automation Development
```bash
# Test automation configurations
cd docker/automations
node index.js  # Uses CONFIG env var or ./config file
```

## Architecture

### Service Architecture
The system is built around multiple Docker services:

- **broker** (Mosquitto): MQTT message broker for device communication
- **automations**: Custom automation engine that processes MQTT messages
- **features**: Feature state management service
- **ha_discovery**: Home Assistant auto-discovery service
- **ha**: Home Assistant for UI and advanced automations
- **modbus-serial**: Multiple instances for reading different Modbus devices
- **influxdb/grafana**: Time-series data storage and visualization
- **mongo**: Document storage for historical data

### Automation Engine (`docker/automations/`)

The core automation logic is built around:

- **Bots**: Individual automation units defined in configuration files
- **Features**: Abstracted device states (lights, switches, sensors)
- **Functions**: Reusable transformation utilities in `funcs/`
- **Resolver**: Dynamic module loading system (`lib/resolve.js`)

Key patterns:
- Bots are configured declaratively and loaded dynamically
- MQTT topics follow structured patterns like `/modbus/{bus}/{device}/{action}`
- Feature states are managed through `homy/features/{type}/{name}/{action}` topics
- Time-based automations use cron expressions and solar calculations

### Configuration Structure

- `config/automations/config.js`: Main automation bot configurations
- `config/automations/features.js`: Feature definitions and mappings
- `config/automations/ha_discovery.js`: Home Assistant integration setup
- `config/modbus-serial/*.js`: Modbus device configurations for different buses
- Environment variables control service connections and secrets

### Common Bot Types

- `feature-toggle-on-feature-change`: Toggle outputs when inputs change
- `bac002-*`: HVAC thermostat control and synchronization
- `bath-lights`: Bathroom lighting automation with occupancy detection
- `irrigation`: Scheduled watering systems with cron expressions
- `solar-emitter`: Sunrise/sunset based device control
- `timeout-emit`: Safety timeouts for devices

### MQTT Topic Patterns

- `/modbus/{bus}/{device}/reading` - Device status readings
- `/modbus/{bus}/{device}/write` - Device control commands
- `homy/features/{type}/{name}/status` - Feature state
- `homy/features/{type}/{name}/set` - Feature control
- `homeassistant/*/config` - Home Assistant discovery messages

### Hardware Integration

The system integrates with:
- Multiple Modbus RTU/TCP devices (energy meters, thermostats, I/O modules)
- Arduino Mega for local I/O control
- Various sensors and actuators through custom device drivers
- Solar inverters, irrigation valves, lighting controls

## Documentation

### Architecture
- **System Architecture**: `ARCHITECTURE.md` - Comprehensive architectural overview covering data flow, service architecture, current state, and future direction for planning new features and improvements

### Automation Bot Documentation
- **Bathroom Controller**: `docker/automations/docs/bathroom-controller.md` - Comprehensive guide for bathroom lighting automation including configuration for Bath1 (guest/daytime), Bath2 (kids), and Bath3 (master) bathrooms

### Configuration Files
- **Automations Configuration**: `config/automations/config.js` - Main bot configurations including bathroom light controllers, irrigation schedules, HVAC automation, and Home Assistant discovery setup

## File Structure Notes

- Each Docker service has its own directory under `docker/`
- Configuration files are mounted from `config/` directory
- Persistent data is stored in `data/` directory
- Secrets are managed through Docker secrets in `secrets/`
- The `modbus-serial` service has device drivers in `devices/` subdirectory