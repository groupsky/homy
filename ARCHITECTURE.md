# Home Automation System Architecture

## Executive Summary

This is a comprehensive Docker-based home automation system designed around a data flow architecture that progresses from raw hardware sensors through abstracted features to intelligent automation and user interfaces. The system is currently running in production and handles real-time monitoring and control of lighting, HVAC, irrigation, security, and energy management across a residential property.

## High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Physical      │    │    Modbus       │    │    MQTT         │    │  Applications   │
│   Hardware      │───▶│   Services      │───▶│   Broker        │───▶│  & Interfaces   │
│                 │    │                 │    │                 │    │                 │
│ • Sensors       │    │ • main-power    │    │ Raw data topics │    │ • Home Assist.  │
│ • Relays        │    │ • dry-switches  │    │ /modbus/...     │    │ • Grafana       │
│ • Controllers   │    │ • monitoring    │    │                 │    │ • Automations   │
│ • Thermostats   │    │ • inverter      │    │ Feature topics  │    │                 │
│ • Energy Meters │    │ • solar         │    │ homy/features/  │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
                                                        │
                                              ┌─────────────────┐
                                              │    Features     │
                                              │    Service      │◀──────────────┐
                                              │                 │               │
                                              │ • State Mapping │               │
                                              │ • Abstractions  │               │
                                              └─────────────────┘               │
                                                        │                       │
                                              ┌─────────────────┐               │
                                              │   Automation    │               │
                                              │    Engine       │───────────────┘
                                              │                 │
                                              │ • Bots          │
                                              │ • Rules         │
                                              │ • Schedules     │
                                              └─────────────────┘
```

## Data Flow Architecture

### Layer 1: Hardware Integration
Physical devices communicate via multiple protocols:
- **Energy Meters**: SDM120, SDM630, DTSU666 for power monitoring (Modbus)
- **I/O Modules**: MBSL32DI1/DI2 for digital inputs (switches, sensors) (Modbus)
- **Relay Modules**: 32-channel relay banks for device control (Modbus)
- **HVAC Controllers**: BAC002 thermostats with BACnet communication (Modbus)
- **Arduino Mega**: Local I/O for buttons, lights, and auxiliary devices (Modbus)
- **Zigbee Devices**: Wireless sensors, switches, and smart devices via Zigbee2MQTT bridge

### Layer 2: Protocol Bridge Services
Multiple containerized services read hardware and publish to MQTT:

**Modbus Services** (wired hardware):
- **main-power**: Primary electrical monitoring bus
- **secondary-power**: Secondary circuits and boiler monitoring
- **tetriary-power**: Additional power monitoring points
- **monitoring/monitoring2**: HVAC and environmental sensors
- **dry-switches**: Digital I/O for switches, sensors, and relays
- **solar/inverter**: Solar energy system monitoring

Each Modbus service publishes raw data to `/modbus/{bus}/{device}/reading` topics and listens for commands on `/modbus/{bus}/{device}/write` topics.

**Zigbee2MQTT Services** (wireless devices):
- **z2m-home1**: Zigbee network bridge for first floor/main house
- Future instances: z2m-home2, z2m-garage, etc. for additional Zigbee networks

Zigbee2MQTT services connect to network coordinators and publish device states to `z2m/{instance}/{device}` topics, accepting commands via `z2m/{instance}/{device}/set`. These services also publish Home Assistant auto-discovery messages directly, bypassing the features layer abstraction.

### Layer 3: MQTT Message Broker
Mosquitto broker serves as the central nervous system:
- **Raw Data Topics**: `/modbus/{bus}/{device}/{action}`
- **Zigbee Topics**: `z2m/{instance}/{device}/[state|set|get]` for Zigbee device control
- **Feature Topics**: `homy/features/{type}/{name}/{action}`
- **Home Assistant Topics**: `homeassistant/{component}/{device}/config`
- **Internal Topics**: Various automation and control channels

### Layer 4: Features Layer
Transforms raw Modbus data into semantic abstractions:
- **Switches**: Binary input states from door/window sensors
- **Lights**: Relay outputs controlling lighting circuits
- **Sensors**: Temperature, power, and environmental readings
- **Locks**: Door lock states and security monitoring
- **Relays**: General-purpose relay controls for irrigation, boilers, etc.

Features provide state management and semantic mapping, publishing to `homy/features/{type}/{name}/status` and accepting commands via `homy/features/{type}/{name}/set`.

**Note**: Zigbee devices bypass this layer intentionally. Zigbee2MQTT provides its own semantic abstraction and publishes directly to Home Assistant discovery, as these devices already have standardized capabilities defined by the Zigbee protocol.

### Layer 5: Automation Engine
Event-driven automation system with multiple bot types:
- **feature-toggle-on-feature-change**: Input/output mappings with debouncing
- **bac002-***: HVAC thermostat control and synchronization
- **bath-lights**: Occupancy-based bathroom lighting with timeout logic
- **irrigation**: Cron-scheduled watering systems with safety timeouts
- **solar-emitter**: Sunrise/sunset-based device automation
- **timeout-emit**: Safety mechanisms and automatic shutoffs

### Layer 6: User Interfaces & External Systems
Multiple interfaces for monitoring and control:
- **Home Assistant**: Primary UI with device discovery and dashboards (UI only)
- **Grafana**: Time-series visualization, energy monitoring, and alerting with Telegram notifications
- **InfluxDB**: Time-series data storage for historical analysis
- **MongoDB**: MQTT message logging and historical data storage

## Service Architecture

### Core Services
- **broker** (Mosquitto): MQTT message broker
- **automations**: Main automation engine processing
- **features**: Feature abstraction and state management
- **ha_discovery**: Home Assistant auto-discovery configuration
- **ha**: Home Assistant container for UI and visualization only
- **z2m-home1**: Zigbee2MQTT service for Zigbee device integration and Home Assistant discovery

### Data Services  
- **influxdb**: Time-series database for sensor data
- **grafana**: Visualization, dashboards, and alerting with Telegram integration
- **mongo**: MQTT message logging and historical data storage
- **mongo-express**: Database administration interface

### Infrastructure Services
- **ingress/ingressgen**: Nginx reverse proxy with dynamic configuration
- **vpn**: WireGuard VPN for remote access

### Data Pipeline Services
- **mqtt-influx-***: Multiple services bridging MQTT to InfluxDB
  - **mqtt-influx-primary/secondary/tetriary**: Modbus sensor data
- **mqtt-mongo-history**: MQTT message logging to MongoDB
- **historian-***: Manual data migration utilities

## Current State & Architectural Challenges

### Production Status
The system is actively running in production with:
- Real-time monitoring of electrical usage, HVAC, and security systems
- Automated lighting control with occupancy detection
- Scheduled irrigation with weather and safety considerations
- Energy management including solar generation tracking
- Multi-zone HVAC control with door/window interlocks
- Telegram alerting for system alarms and critical events

### Known Limitations
1. **Stateless Automations**: Automation bots lack persistent state, limiting complex scenarios
2. **No Event Sourcing**: State changes are not historically tracked or replayable  
3. **Limited Reactivity**: No reactive programming model for dependent computations
4. **Basic Feature Layer**: No device-specific protection mechanisms implemented yet

## Future Architecture Direction

### Event Sourcing Migration
- Implement persistent event store for all state changes
- Enable replay and audit capabilities for automation debugging
- Support for complex stateful automation scenarios

### Reactive Programming Model
- React Hooks-style API for automation development
- Vue.js Computed Properties pattern for derived states
- Automatic dependency tracking and re-evaluation
- Developer-friendly reactive programming primitives

### Enhanced Features Layer
- Device-specific protection mechanisms (thermal limits, power budgets)
- Automatic fault detection and recovery procedures
- Inter-device dependency management
- Safety interlocks and emergency shutdown procedures

### Operational Procedures (Summary)

**Monitoring**
- Grafana dashboards for system health and energy usage with Telegram alerting
- MongoDB logs for MQTT message history and troubleshooting
- MQTT topic monitoring for real-time troubleshooting
- InfluxDB queries for historical analysis and trending

**Maintenance**
- Docker Compose for service lifecycle management
- Automated backup system (volman) for persistent data
  - Comprehensive coverage: Home Assistant, MongoDB, InfluxDB, Grafana, Zigbee2MQTT, WireGuard, automation state
  - Point-in-time recovery capability for all critical volumes
  - TAR-based backup format with integrity validation
  - Recovery procedures documented in `docker/volman/CLAUDE.md`
- Configuration management through mounted config files
- Log rotation and retention policies

**Development**
- Jest testing framework for automation logic validation
- Hot-reload configuration for rapid development iteration  
- Modular bot architecture for easy feature additions
- Dynamic module resolution system for plugin capabilities

**Deployment**
- Blue-green deployment capability through Docker Compose
- Environment-specific configuration via Docker secrets
- Health checks and automatic restart policies
- Network isolation through Docker networks (automation, ingress, egress)

This architecture provides a solid foundation for intelligent home automation while positioning the system for evolution toward more sophisticated event-driven and reactive programming paradigms.