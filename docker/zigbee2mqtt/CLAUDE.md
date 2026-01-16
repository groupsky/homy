# Zigbee2MQTT Service

This directory contains the Zigbee2MQTT service configuration for managing Zigbee devices in the home automation system.

## Overview

Zigbee2MQTT is a Zigbee to MQTT bridge that allows you to use Zigbee devices without the vendor's bridge or gateway. It connects to your Zigbee network through a coordinator (USB adapter or network-accessible device) and exposes devices through MQTT messages.

**Key Features:**
- MQTT integration with the automation system
- Home Assistant auto-discovery
- Web-based frontend for device management
- Over-The-Air (OTA) firmware updates
- Support for 5000+ Zigbee devices
- Device renaming and configuration through the UI

## Quick Start

### Initial Setup

Follow these steps to get Zigbee2MQTT running:

**1. Generate Required Secrets**
```bash
# Generate network key (128-bit encryption key for Zigbee network)
node -e "console.log(JSON.stringify(Array.from({length: 16}, () => Math.floor(Math.random() * 256))))" > secrets/z2m_home1_network_key

# Generate frontend auth token
openssl rand -base64 32 > secrets/z2m_home1_frontend_auth_token

# Set your network coordinator address (network-based coordinator)
echo "tcp://192.168.1.100:6638" > secrets/z2m_home1_serial_port

# Set adapter type (use 'auto' for automatic detection)
echo "auto" > secrets/z2m_home1_adapter
```

**2. Create Data Directory**
```bash
mkdir -p data/zigbee2mqtt/home1
chown ${PUID}:${PGID} data/zigbee2mqtt/home1
```

**3. Configure Environment Variables**
Add to your `.env` file (or verify in `example.env`):
```bash
Z2M_HOME1_DOMAIN=home1.z2m.${DOMAIN}
Z2M_HOME1_DATA_PATH=./data/zigbee2mqtt/home1
```

**4. Start the Service**
```bash
docker compose up -d z2m-home1
```

**5. Verify Service is Running**
```bash
# Check logs for successful startup
docker compose logs -f z2m-home1

# Look for these success indicators:
# ✅ Loaded ZIGBEE2MQTT_CONFIG_SERIAL_PORT from /run/secrets/z2m_home1_serial_port
# ✅ Loaded ZIGBEE2MQTT_CONFIG_ADVANCED_NETWORK_KEY from /run/secrets/z2m_home1_network_key
# ✅ All required configuration validated
# Zigbee2MQTT:info ... Successfully connected to MQTT broker
# Zigbee2MQTT:info ... Currently 0 devices are joined

# Check health status
docker inspect --format='{{json .State.Health}}' $(docker compose ps -q z2m-home1) | jq .
```

**6. Access Web UI**
```bash
# Via VPN, access: http://home1.z2m.${DOMAIN}
# Authenticate with the token from secrets/z2m_home1_frontend_auth_token
```

**7. Pair Your First Device**
1. Click "Permit Join" in the web UI (enables pairing for 254 seconds)
2. Put your Zigbee device in pairing mode (refer to device manual)
3. Device should appear in the UI within 30-60 seconds
4. Rename device with a descriptive name (e.g., "living_room_light")
5. Device automatically appears in Home Assistant

### Verification Checklist

After initial deployment, verify everything is working:

- [ ] Container is running: `docker compose ps z2m-home1`
- [ ] Secrets loaded successfully (check logs for ✅ messages)
- [ ] Coordinator connected (no connection errors in logs)
- [ ] MQTT broker connected: `docker compose exec broker mosquitto_sub -v -t 'z2m/house1/bridge/state' -C 1`
- [ ] Web UI accessible via VPN
- [ ] Health check passing: `docker inspect --format='{{.State.Health.Status}}' $(docker compose ps -q z2m-home1)`

### Common First-Time Issues

**Coordinator Not Found:**
```bash
# Verify network coordinator is reachable
telnet 192.168.1.100 6638

# Check secret file has correct address
cat secrets/z2m_home1_serial_port
```

**Permission Denied on Data Directory:**
```bash
# Fix ownership
sudo chown -R ${PUID}:${PGID} data/zigbee2mqtt/home1
```

**Web UI Not Accessible:**
```bash
# Verify nginx ingress is running
docker compose ps ingress

# Check service has VIRTUAL_HOST set
docker compose exec z2m-home1 env | grep VIRTUAL_HOST
```

## Instance Naming Convention

This service is named `z2m-home1` to support multiple Zigbee2MQTT instances in the future. Each instance can manage a separate Zigbee network with its own coordinator.

**Subdomain Pattern:** Each instance uses a subdomain under `z2m.${DOMAIN}`:
- `home1.z2m.${DOMAIN}` - First floor Zigbee network
- `home2.z2m.${DOMAIN}` - Second floor Zigbee network
- `home3.z2m.${DOMAIN}` - Third floor Zigbee network
- `garage.z2m.${DOMAIN}` - Garage/workshop instance
- etc.

This pattern allows clean organization and DNS-based routing for multiple Zigbee networks across different floors or areas.

## MQTT Topic Prefix

The service uses `z2m/house1` as the MQTT base topic. This allows multiple Zigbee networks to coexist without topic conflicts.

**Topic Structure:**
- Device states: `z2m/house1/{device_friendly_name}`
- Bridge info: `z2m/house1/bridge/state`, `z2m/house1/bridge/info`
- Groups: `z2m/house1/{group_name}`

## Network Coordinator Configuration

This service is configured for **network-accessible coordinators** (Ethernet/WiFi-based Zigbee adapters like SLZB-05, SLZB-06, or ser2net setups).

**Serial Port Format:** `tcp://IP_ADDRESS:PORT`
Example: `tcp://192.168.1.100:6638`

**Benefits of Network Coordinators:**
- No USB device passthrough required
- No privileged mode needed
- Can be physically separated from the Docker host
- Easier to replace/upgrade without container restarts
- Multiple instances can connect to different network coordinators

**Important:** Use wired Ethernet connections, not WiFi. The Zigbee serial protocol lacks robustness for packet loss and latency delays. ([Zigbee2MQTT Remote Adapter Guide](https://www.zigbee2mqtt.io/advanced/remote-adapter/connect_to_a_remote_adapter.html))

### USB Coordinators

If you need to use a USB coordinator instead:
1. Add `privileged: true` to docker-compose.yml
2. Add volume mounts:
   ```yaml
   volumes:
     - /dev/bus/usb:/dev/bus/usb
     - /run/udev:/run/udev:ro
   ```
3. Update serial port to: `/dev/serial/by-id/usb-...` path
4. Add user to `dialout` group on host

## Environment Variables

**Core Configuration:**
```bash
Z2M_HOME1_DOMAIN=home1.z2m.${DOMAIN}      # Web UI subdomain
Z2M_HOME1_DATA_PATH=./data/zigbee2mqtt/home1  # Data directory path
```

**Zigbee2MQTT Configuration:**
All configuration is done via environment variables using the pattern:
`ZIGBEE2MQTT_CONFIG_<PATH>` where PATH is the uppercase configuration path with underscores.

Examples:
- `ZIGBEE2MQTT_CONFIG_MQTT_BASE_TOPIC=z2m/house1`
- `ZIGBEE2MQTT_CONFIG_MQTT_SERVER=mqtt://broker`
- `ZIGBEE2MQTT_CONFIG_HOMEASSISTANT_ENABLED=true`
- `ZIGBEE2MQTT_CONFIG_SERIAL_PORT_FILE=/run/secrets/z2m_home1_serial_port`

**Important:** Object properties require full path including sub-keys:
- ❌ Wrong: `ZIGBEE2MQTT_CONFIG_HOMEASSISTANT=true`
- ✅ Correct: `ZIGBEE2MQTT_CONFIG_HOMEASSISTANT_ENABLED=true`
- ❌ Wrong: `ZIGBEE2MQTT_CONFIG_AVAILABILITY=true`
- ✅ Correct: `ZIGBEE2MQTT_CONFIG_AVAILABILITY_ENABLED=true`

## User Permissions

The container runs as `user: ${PUID}:${PGID}` (typically `1000:1000`), matching your host user. This ensures:
- Proper file ownership for mounted volumes
- No permission issues with data directory
- Security best practice (non-root container)

**Important:** The data directory must be writable by this user for device renaming and configuration updates to work.

## Docker Secrets Support

This service implements a **custom entrypoint wrapper** to support the `_FILE` suffix pattern for Docker secrets. This pattern is common in Docker Official Images (MySQL, PostgreSQL, etc.) but is NOT natively supported by Zigbee2MQTT.

**How it works:**
1. The `docker-entrypoint-wrapper.sh` script runs before Zigbee2MQTT starts
2. It scans for environment variables ending in `_FILE`
3. Reads the content from the file path specified
4. Exports the value without the `_FILE` suffix
5. Calls the original Zigbee2MQTT entrypoint

**Example:**
```bash
# Environment variable: ZIGBEE2MQTT_CONFIG_SERIAL_PORT_FILE=/run/secrets/z2m_home1_serial_port
# File content: tcp://192.168.1.100:6638
# Result: ZIGBEE2MQTT_CONFIG_SERIAL_PORT=tcp://192.168.1.100:6638
```

This allows using Docker secrets (mounted at `/run/secrets/`) while maintaining compatibility with Zigbee2MQTT's environment variable configuration.

## Secrets Management

### Required Secrets

**1. Network Key** (`secrets/z2m_home1_network_key`)
- Zigbee network encryption key (128-bit, 16 values)
- Format: `[1, 3, 5, 7, 9, 11, 13, 15, 0, 2, 4, 6, 8, 10, 12, 13]`
- **CRITICAL:** Keep this key secure and backed up
- Changing the key requires re-pairing ALL devices

**Generating a Network Key:**
```bash
# Generate random 16-byte key
node -e "console.log(JSON.stringify(Array.from({length: 16}, () => Math.floor(Math.random() * 256))))"

# Or use OpenSSL
openssl rand -hex 16 | fold -w2 | paste -sd',' | sed 's/^/[/;s/$/]/'
```

**Important:** Do NOT use `GENERATE` in the secret file. While Zigbee2MQTT supports `GENERATE` in configuration.yaml, it doesn't work with environment variable configuration because:
- Zigbee2MQTT writes the generated key to configuration.yaml on first start
- With env var config, there's no configuration.yaml to update
- The secret file is read-only and can't be updated by the container
- A new key would be "generated" (requested) on every restart

**2. Serial Port** (`secrets/z2m_home1_serial_port`)
- Network coordinator: `tcp://192.168.1.100:6638`
- USB coordinator: `/dev/serial/by-id/usb-Texas_Instruments_TI_CC2531_USB_CDC___0X00124B0018E00D12-if00`
- **Use by-id paths** for USB devices (stable across reboots)

**3. Adapter Type** (`secrets/z2m_home1_adapter`)
- Common values: `zstack`, `deconz`, `zigate`, `ezsp`, `ember`
- Use `auto` to let Zigbee2MQTT detect automatically
- Check [supported adapters list](https://www.zigbee2mqtt.io/guide/adapters/) for your coordinator

## Data Directory Structure

The data directory (`${Z2M_HOME1_DATA_PATH}`) must be **writable** as Zigbee2MQTT updates it at runtime:

```
data/zigbee2mqtt/home1/
├── configuration.yaml      # Runtime configuration (auto-generated, minimal)
├── database.db            # Device database
├── state.json             # Network state
├── log/                   # Log files
│   └── <timestamp>/
│       └── log.txt
└── coordinator_backup.json # Coordinator backup (auto-created)
```

**Important Notes:**
- Most configuration is via environment variables, not configuration.yaml
- Zigbee2MQTT creates a minimal configuration.yaml on first run
- Device metadata is stored in database.db
- Device renaming updates the database, not files
- Never mount the data directory as read-only
- Configuration template in `config/zigbee2mqtt/home1/` is for reference only

## Device Renaming

Device renaming works through the web UI because:
1. The data directory is writable (owned by ${PUID}:${PGID})
2. Zigbee2MQTT updates database.db when renaming devices
3. Environment variables provide static configuration
4. Runtime configuration changes are persisted to the database

**How to Rename Devices:**
1. Access web UI at `http://home1.z2m.${DOMAIN}` (via VPN)
2. Navigate to device settings
3. Change the friendly name
4. Changes are automatically saved to database
5. MQTT topics and Home Assistant entities update automatically

## Home Assistant Integration

Home Assistant integration is enabled with:
```bash
ZIGBEE2MQTT_CONFIG_HOMEASSISTANT=true
```

**Auto-Discovery:**
- Devices automatically appear in Home Assistant via MQTT discovery
- Uses the standard `homeassistant` discovery topic
- Devices are created with friendly names from Zigbee2MQTT
- Renaming in Zigbee2MQTT updates Home Assistant entities

**No Conflicts with Features Service:**
The existing `features` service and `ha_discovery` service both publish to the `homeassistant` discovery topic, but:
- Each device has a unique `unique_id` field
- Zigbee2MQTT devices: `0x{ieee_address}_{endpoint}` format
- Features service devices: `homy_light_{feature}`, `homy_switch_{feature}`, etc.
- Home Assistant handles multiple discovery sources gracefully
- No topic or entity ID conflicts will occur

## Web Frontend

**Access:**
- URL: `http://home1.z2m.${DOMAIN}` (via VPN)
- Port: 8080 (internal, proxied by nginx)
- Available on ingress network through nginx reverse proxy

**Features:**
- Visual device map showing Zigbee network topology
- Device pairing and management
- Real-time device state
- Configuration editing (advanced settings)
- Log viewing
- OTA firmware updates
- Network visualization

## Pairing New Devices

**Via Web UI:**
1. Click "Permit Join" button in the web UI
2. Put device in pairing mode (refer to device manual)
3. Device appears in the UI within 30-60 seconds
4. Rename device with a descriptive name
5. Device automatically appears in Home Assistant

**Via MQTT:**
```bash
# Enable pairing for 254 seconds
mosquitto_pub -h broker -t 'z2m/house1/bridge/request/permit_join' -m '{"value": true}'

# Disable pairing
mosquitto_pub -h broker -t 'z2m/house1/bridge/request/permit_join' -m '{"value": false}'
```

**Security:**
- Permit join is disabled by default (`ZIGBEE2MQTT_CONFIG_PERMIT_JOIN=false`)
- Only enable pairing when actively adding devices
- Auto-disables after 254 seconds for security
- Network key prevents unauthorized devices from joining

## Network Access

The service is connected to three Docker networks:
- **automation**: Internal network for MQTT broker communication
- **ingress**: For web UI access through nginx reverse proxy
- **egress**: For internet access (OTA firmware updates, external services)

**Access Methods:**
- Web UI accessible via VPN at subdomain pattern: `{instance}.z2m.${DOMAIN}`
- MQTT topics available to all automation services on internal network
- No direct external access (security best practice)

## Health Check

The service includes a Docker health check using Node.js to verify the web frontend is responding:

```dockerfile
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=5 \
  CMD node -e "require('http').get('http://localhost:8080/', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
```

**Health Check Behavior:**
- Checks every 60 seconds
- 120 second startup grace period (Zigbee coordinator initialization)
- 5 retries before marking unhealthy
- 10 second timeout per check

**Why Node.js?**
- Node.js is already installed in the zigbee2mqtt container
- No additional dependencies needed (wget/curl not available)
- Properly verifies HTTP 200 response
- More reliable than simple TCP port checks
- Lightweight and fast

**Health Check Details:**
- Makes HTTP GET request to http://localhost:8080/
- Exits with code 0 if status code is 200 (healthy)
- Exits with code 1 on any error or non-200 status (unhealthy)
- Handles both connection errors and HTTP errors

**Monitoring Health:**
```bash
docker inspect --format='{{json .State.Health}}' z2m-home1 | jq .
```

## Troubleshooting

### Coordinator Not Connecting
```bash
# Check if coordinator is reachable (network coordinator)
telnet 192.168.1.100 6638

# Check logs for connection errors
docker compose logs z2m-home1 | grep -i "serial\|coordinator"

# Verify adapter type is correct
cat secrets/z2m_home1_adapter
```

### Permission Issues with Data Directory
```bash
# Check data directory ownership
ls -ld data/zigbee2mqtt/home1

# Fix ownership to match PUID:PGID
sudo chown -R ${PUID}:${PGID} data/zigbee2mqtt/home1
```

### Device Renaming Not Working
```bash
# Verify data directory is writable
docker compose exec z2m-home1 touch /app/data/test && rm /app/data/test

# Check user ID in container matches expected
docker compose exec z2m-home1 id
```

### Check Service Logs
```bash
docker compose logs -f z2m-home1
```

### Web UI Not Accessible
```bash
# Check if nginx proxy is working
docker compose logs ingress | grep z2m

# Verify VIRTUAL_HOST is set correctly
docker compose exec z2m-home1 env | grep VIRTUAL_HOST

# Test direct access (from VPN)
curl -I http://z2m-home1:8080
```

### Network Coordinator Issues
**Important:** Network coordinators over WiFi are not recommended. Use Ethernet connections only.

```bash
# Test network latency to coordinator
ping -c 10 192.168.1.100

# Check for packet loss
mtr 192.168.1.100 --report-cycles 100
```

### Reset Zigbee Network
**WARNING**: This requires re-pairing ALL devices!

```bash
# Stop service
docker compose stop z2m-home1

# Backup data
cp -r data/zigbee2mqtt/home1 data/zigbee2mqtt/home1.backup.$(date +%Y%m%d)

# Remove database and state
rm data/zigbee2mqtt/home1/database.db
rm data/zigbee2mqtt/home1/state.json

# Generate new network key
node -e "console.log(JSON.stringify(Array.from({length: 16}, () => Math.floor(Math.random() * 256))))" > secrets/z2m_home1_network_key

# Start service (new network will be created)
docker compose up -d z2m-home1
```

## Development

### Building the Service
```bash
docker compose build z2m-home1
```

### Starting the Service
```bash
docker compose up -d z2m-home1
```

### Viewing Logs
```bash
docker compose logs -f z2m-home1
```

### Accessing the Container Shell
```bash
docker compose exec z2m-home1 sh
```

## Multiple Instances

To add additional Zigbee2MQTT instances (e.g., for a second building):

**1. Generate new secrets:**
```bash
# Network key (must be different for each network!)
node -e "console.log(JSON.stringify(Array.from({length: 16}, () => Math.floor(Math.random() * 256))))" > secrets/z2m_home2_network_key

# Serial port (different coordinator)
echo "tcp://192.168.1.101:6638" > secrets/z2m_home2_serial_port

# Adapter type
echo "auto" > secrets/z2m_home2_adapter
```

**2. Add to docker-compose.yml:**
```yaml
z2m-home2:
  build: docker/zigbee2mqtt
  depends_on:
    - broker
  restart: unless-stopped
  networks:
    - automation
    - ingress
    - egress
  security_opt:
    - no-new-privileges:true
  secrets:
    - z2m_home2_network_key
    - z2m_home2_serial_port
    - z2m_home2_adapter
  environment:
    - TZ=${TZ}
    - VIRTUAL_HOST=${Z2M_HOME2_DOMAIN}
    - VIRTUAL_PORT=8080
    - ZIGBEE2MQTT_DATA=/app/data
    - ZIGBEE2MQTT_CONFIG_MQTT_BASE_TOPIC=z2m/house2
    - ZIGBEE2MQTT_CONFIG_MQTT_SERVER=mqtt://broker
    - ZIGBEE2MQTT_CONFIG_SERIAL_PORT_FILE=/run/secrets/z2m_home2_serial_port
    - ZIGBEE2MQTT_CONFIG_ADVANCED_NETWORK_KEY_FILE=/run/secrets/z2m_home2_network_key
    - ZIGBEE2MQTT_CONFIG_ADAPTER_FILE=/run/secrets/z2m_home2_adapter
    - ZIGBEE2MQTT_CONFIG_FRONTEND_PORT=8080
    - ZIGBEE2MQTT_CONFIG_FRONTEND_HOST=0.0.0.0
    - ZIGBEE2MQTT_CONFIG_HOMEASSISTANT=true
    - ZIGBEE2MQTT_CONFIG_PERMIT_JOIN=false
  volumes:
    - /etc/localtime:/etc/localtime:ro
    - ${Z2M_HOME2_DATA_PATH}:/app/data
  user: ${PUID}:${PGID}

secrets:
  z2m_home2_network_key:
    file: ${SECRETS_PATH}/z2m_home2_network_key
  z2m_home2_serial_port:
    file: ${SECRETS_PATH}/z2m_home2_serial_port
  z2m_home2_adapter:
    file: ${SECRETS_PATH}/z2m_home2_adapter
```

**3. Add to example.env:**
```bash
# Zigbee2MQTT home2 instance
Z2M_HOME2_DOMAIN=home2.z2m.${DOMAIN}
Z2M_HOME2_DATA_PATH=./data/zigbee2mqtt/home2
```

**4. Create data directory:**
```bash
mkdir -p data/zigbee2mqtt/home2
chown ${PUID}:${PGID} data/zigbee2mqtt/home2
```

## Security Considerations

1. **Network Key**: Keep the network key secret and backed up securely
2. **Permit Join**: Only enable when actively pairing devices
3. **Web UI Access**: Only accessible via VPN, not exposed to internet
4. **Network Coordinator**: Use wired Ethernet, not WiFi
5. **MQTT Security**: Uses internal Docker network (no external access)
6. **User Permissions**: Runs as non-root user for security
7. **Separate Networks**: Each instance should use a different network key

## Performance Considerations

- **Network Latency**: Network coordinators should be <5ms latency, <0.1% packet loss
- **Device Limits**: Coordinators typically support 20-40 direct children (routers/mains-powered devices)
- **Router Devices**: Mains-powered Zigbee devices act as routers, extending network capacity
- **Battery Devices**: End devices only, don't route traffic
- **Network Topology**: Aim for mesh structure with multiple router devices

## Resources

- **Official Documentation**: https://www.zigbee2mqtt.io/
- **Supported Devices**: https://www.zigbee2mqtt.io/supported-devices/
- **Configuration Guide**: https://www.zigbee2mqtt.io/guide/configuration/
- **All Settings**: https://www.zigbee2mqtt.io/guide/configuration/all-settings.html
- **Network Coordinators**: https://www.zigbee2mqtt.io/advanced/remote-adapter/connect_to_a_remote_adapter.html
- **Adapter Settings**: https://www.zigbee2mqtt.io/guide/configuration/adapter-settings.html
- **Zigbee Network Guide**: https://www.zigbee2mqtt.io/guide/configuration/zigbee-network.html
- **GitHub Repository**: https://github.com/Koenkk/zigbee2mqtt
- **Docker Installation**: https://www.zigbee2mqtt.io/guide/installation/02_docker.html

## References

This implementation is based on:
- [Zigbee2MQTT Docker Documentation](https://www.zigbee2mqtt.io/guide/installation/02_docker.html)
- [Configuration Guide](https://www.zigbee2mqtt.io/guide/configuration/)
- [Remote Adapter Connection](https://www.zigbee2mqtt.io/advanced/remote-adapter/connect_to_a_remote_adapter.html)
- [Zigbee Network Configuration](https://www.zigbee2mqtt.io/guide/configuration/zigbee-network.html)
- [Docker Healthcheck Feature Requests](https://github.com/Koenkk/zigbee2mqtt/issues/28893)
