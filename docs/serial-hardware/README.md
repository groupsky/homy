# Serial Hardware Documentation

This directory contains documentation for serial communication hardware used in the home automation system.

## Available Hardware

### PCIe Serial Controllers

- **[Exar XR17V35X](exar-xr17v35x.md)** - 8-port PCIe serial controller with RS-232/RS-422/RS-485 mode switching
  - GPIO-based mode control
  - Supports up to 7.8 Mbps baud rate
  - Ideal for Modbus RTU communication
  - Ports: `/dev/ttyS4` through `/dev/ttyS11`

### USB-to-Serial Adapters

- **[Routy USB Serial Configuration](routy-usb-serial.md)** - CH341 USB-to-serial adapters on routy system
  - 4x CH341 adapters connected via motherboard USB header
  - Exposed via PCI bracket on rear of case
  - Connected to Intel EHCI #2 controller
  - Ports: `/dev/ttyUSB3` through `/dev/ttyUSB6`
  - Uses persistent by-path naming

## Use Cases

Serial hardware in this system is primarily used for:

1. **Modbus RTU Communication**
   - Energy meters
   - HVAC controllers
   - Temperature sensors
   - Industrial I/O modules

2. **Legacy Device Integration**
   - RS-232 devices (sensors, controllers)
   - RS-485 multi-drop networks
   - Building automation systems

## Configuration Quick Reference

### RS-485 Mode (Most Common)
Used for Modbus RTU and multi-drop networks:
```bash
# Configure port 0 (ttyS4) for RS-485
sudo /tmp/test_rs485.sh 0 485
```

### RS-422 Mode
Used for long-distance, noise-immune communication:
```bash
# Configure port 1 (ttyS5) for RS-422
sudo /tmp/test_rs485.sh 1 422
```

### RS-232 Mode
Used for standard PC serial communication:
```bash
# Configure port 2 (ttyS6) for RS-232
sudo /tmp/test_rs485.sh 2 232
```

## Integration with Services

Serial hardware integrates with:

- **[modbus-serial](../../docker/modbus-serial/CLAUDE.md)** - Modbus RTU device communication
- **[Arduino Mega](../../docker/mega/CLAUDE.md)** - Custom I/O control (if applicable)

## Troubleshooting

For hardware-specific troubleshooting, see the individual device documentation.

### General Serial Port Issues

**Check port availability:**
```bash
ls -la /dev/ttyS*
```

**Test port with loopback:**
```bash
# Connect TX to RX (pins 2-3 on DB-9)
echo "test" > /dev/ttyS4 &
cat /dev/ttyS4
```

**Monitor port activity:**
```bash
# Install if needed: sudo apt-get install lsof
lsof /dev/ttyS4
```

## Adding New Serial Hardware

When adding new serial hardware:

1. Create a new markdown file in this directory (e.g., `device-name.md`)
2. Document hardware specifications, configuration methods, and troubleshooting
3. Update this README with a link and brief description
4. Update the main documentation index in `../CLAUDE.md`
5. Add integration examples for relevant services
