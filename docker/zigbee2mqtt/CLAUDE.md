# Zigbee2MQTT Service

This directory contains the Zigbee2MQTT service configuration for managing Zigbee devices in the home automation system.

## Overview

Zigbee2MQTT is a Zigbee to MQTT bridge that allows you to use Zigbee devices without the vendor's bridge or gateway. It connects to your Zigbee network through a USB coordinator (like CC2531, ConBee II, etc.) and exposes devices through MQTT messages.

**Key Features:**
- MQTT integration with the automation system
- Home Assistant auto-discovery
- Web-based frontend for device management
- Over-The-Air (OTA) firmware updates
- Support for 5000+ Zigbee devices
- Device renaming and configuration through the UI

## Service Configuration

### Instance Name
This service is named `z2m-home1` to support multiple Zigbee2MQTT instances in the future. Each instance can manage a separate Zigbee network with its own coordinator.

### MQTT Topic Prefix
The service uses `z2m/house1` as the MQTT base topic. This allows multiple Zigbee networks to coexist without topic conflicts.

### Environment Variables

**Core Configuration (via environment variables):**
```bash
Z2M_HOME1_DOMAIN=z2m.${DOMAIN}          # Web UI domain (accessed via VPN)
Z2M_HOME1_DATA_PATH=./data/zigbee2mqtt/home1  # Data directory path
```

**Zigbee2MQTT Configuration:**
All configuration is done via environment variables following the pattern:
`ZIGBEE2MQTT_CONFIG_<PATH>` where PATH is the uppercase configuration path with underscores.

Examples:
- `ZIGBEE2MQTT_CONFIG_MQTT_BASE_TOPIC=z2m/house1`
- `ZIGBEE2MQTT_CONFIG_MQTT_SERVER=mqtt://broker`
- `ZIGBEE2MQTT_CONFIG_HOMEASSISTANT=true`

### Secrets Management

**Required Secrets:**
1. **Network Key** (`secrets/z2m_home1_network_key`)
   - Zigbee network encryption key
   - Use `GENERATE` for first-time setup to auto-generate
   - Keep this key secure - changing it requires re-pairing all devices

2. **Serial Port** (`secrets/z2m_home1_serial_port`)
   - Path to Zigbee coordinator device
   - Example: `/dev/serial/by-id/usb-Texas_Instruments_TI_CC2531_USB_CDC___0X00124B0018E00D12-if00`
   - Use `by-id` paths for stability across reboots

3. **Adapter Type** (`secrets/z2m_home1_adapter`)
   - Zigbee coordinator adapter type
   - Common values: `zstack`, `deconz`, `zigate`, `ezsp`
   - Use `auto` to let Zigbee2MQTT detect automatically

## Data Directory Structure

The data directory (`${Z2M_HOME1_DATA_PATH}`) must be **writable** as Zigbee2MQTT updates it at runtime:

```
data/zigbee2mqtt/home1/
├── configuration.yaml      # Runtime configuration (auto-updated)
├── database.db            # Device database
├── state.json             # Network state
├── devices.yaml           # Device configurations (updated when renaming)
└── groups.yaml            # Group configurations
```

**Important Notes:**
- The `configuration.yaml` file is updated when changing settings in the frontend
- Device renaming updates `devices.yaml` automatically
- Never mount the data directory as read-only
- Configuration in `config/zigbee2mqtt/home1/` is for reference only

## Device Renaming

Device renaming works through the web UI because:
1. The data directory is writable
2. Zigbee2MQTT updates `devices.yaml` when renaming
3. Environment variables provide static configuration
4. Runtime configuration changes are persisted to disk

**How to Rename Devices:**
1. Access web UI at `http://z2m.${DOMAIN}` (via VPN)
2. Navigate to device settings
3. Change the friendly name
4. Changes are automatically saved to `devices.yaml`

## Home Assistant Integration

Home Assistant integration is enabled with:
```bash
ZIGBEE2MQTT_CONFIG_HOMEASSISTANT=true
```

**Auto-Discovery:**
- Devices automatically appear in Home Assistant
- Uses MQTT discovery topic: `homeassistant`
- Devices are created with friendly names from Zigbee2MQTT
- Renaming in Zigbee2MQTT updates Home Assistant entities

## Web Frontend

**Access:**
- URL: `http://z2m.${DOMAIN}` (via VPN)
- Port: 8080
- Available on ingress network through nginx reverse proxy

**Features:**
- Visual device map showing Zigbee network topology
- Device pairing and management
- Real-time device state
- Configuration editing
- Log viewing
- OTA firmware updates

## Pairing New Devices

**Via Web UI:**
1. Click "Permit Join" button in the web UI
2. Put device in pairing mode (refer to device manual)
3. Device appears in the UI within 30 seconds
4. Rename device with a descriptive name
5. Device automatically appears in Home Assistant

**Security:**
- Permit join is disabled by default (`ZIGBEE2MQTT_CONFIG_PERMIT_JOIN=false`)
- Only enable pairing when actively adding devices
- Auto-disables after 254 seconds

## Network Access

The service is connected to three networks:
- **automation**: Internal network for MQTT broker communication
- **ingress**: For web UI access through nginx reverse proxy
- **egress**: For internet access (OTA firmware updates, external services)

**Access Methods:**
- Web UI accessible via VPN at `z2m.${DOMAIN}`
- MQTT topics available to all automation services
- No direct external access (security best practice)

## USB Device Access

The service requires privileged mode and USB access:
```yaml
privileged: true
volumes:
  - /dev/bus/usb:/dev/bus/usb
  - /run/udev:/run/udev:ro
```

**Why Privileged:**
- Required for USB device access
- Needed for some Zigbee coordinators
- Allows proper device permission management

## Troubleshooting

### Device Not Found
```bash
# List USB devices
docker compose exec z2m-home1 ls -la /dev/serial/by-id/

# Check if coordinator is detected
docker compose logs z2m-home1 | grep -i "serial"
```

### Permission Issues
```bash
# Verify user is in dialout group (on host)
groups
# Add user to dialout group if missing
sudo usermod -a -G dialout $USER
```

### Check Service Logs
```bash
docker compose logs -f z2m-home1
```

### Reset Zigbee Network
**WARNING**: This requires re-pairing ALL devices!
```bash
# Stop service
docker compose stop z2m-home1

# Backup data
cp -r data/zigbee2mqtt/home1 data/zigbee2mqtt/home1.backup

# Remove database
rm data/zigbee2mqtt/home1/database.db
rm data/zigbee2mqtt/home1/state.json

# Update network key to GENERATE in secrets
echo "GENERATE" > secrets/z2m_home1_network_key

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

### Health Check
The service includes a health check that verifies the web UI is responding:
```bash
docker inspect --format='{{json .State.Health}}' z2m-home1 | jq .
```

## Multiple Instances

To add additional Zigbee2MQTT instances (e.g., for a second building):

1. **Copy secrets:**
   ```bash
   cp secrets/z2m_home1_network_key secrets/z2m_home2_network_key
   cp secrets/z2m_home1_serial_port secrets/z2m_home2_serial_port
   cp secrets/z2m_home1_adapter secrets/z2m_home2_adapter
   ```

2. **Add to docker-compose.yml:**
   ```yaml
   z2m-home2:
     build: docker/zigbee2mqtt
     # ... (copy z2m-home1 config, update names and topics)
     environment:
       - ZIGBEE2MQTT_CONFIG_MQTT_BASE_TOPIC=z2m/house2
       # ... (update all home1 references to home2)
   ```

3. **Add to example.env:**
   ```bash
   Z2M_HOME2_DOMAIN=z2m2.${DOMAIN}
   Z2M_HOME2_DATA_PATH=./data/zigbee2mqtt/home2
   ```

## Security Considerations

1. **Network Key**: Keep the network key secret and backed up
2. **Permit Join**: Only enable when actively pairing devices
3. **Web UI Access**: Only accessible via VPN, not exposed to internet
4. **USB Security**: Coordinator has physical access to Zigbee network
5. **MQTT Security**: Uses internal Docker network (no external access)

## Resources

- **Official Documentation**: https://www.zigbee2mqtt.io/
- **Supported Devices**: https://www.zigbee2mqtt.io/supported-devices/
- **Configuration Guide**: https://www.zigbee2mqtt.io/guide/configuration/
- **GitHub Repository**: https://github.com/Koenkk/zigbee2mqtt
- **Device Database**: https://www.zigbee2mqtt.io/supported-devices/

## References

This implementation is based on:
- [Zigbee2MQTT Docker Documentation](https://www.zigbee2mqtt.io/guide/installation/02_docker.html)
- [Configuration Documentation](https://www.zigbee2mqtt.io/guide/configuration/)
- [Configuration Update Guide](https://www.zigbee2mqtt.io/guide/configuration/configuration-update.html)
