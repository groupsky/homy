# Routy USB-to-Serial Configuration

This document describes the USB-to-serial adapter configuration on the `routy` system (ASUS P8H77-M LE motherboard).

## Hardware Configuration

### Motherboard
- **Model**: ASUS P8H77-M LE
- **Chipset**: Intel 7 Series / H77 Express
- **USB Controllers**:
  - EHCI #1 at PCI address `00:1d.0`
  - EHCI #2 at PCI address `00:1a.0`
  - XHCI at PCI address `00:14.0`

### USB Topology

The USB-to-serial adapters are connected via:
1. **EHCI Controller #2** (PCI address `00:1a.0`)
2. **Intel Integrated Rate Matching Hub** (VID:PID `8087:0024`) - 6-port hub built into the chipset
3. Internal **USB56 header** on the motherboard
4. **PCI bracket** mounted on the back of the case (where PCI expansion cards reside)

## Device Mapping

| Hub Port | Device Path | Device | Adapter Model |
|----------|-------------|--------|---------------|
| Port 3   | `/dev/ttyUSB3` | `pci-0000:00:1a.0-usb-0:1.3:1.0-port0` | CH341 USB-Serial |
| Port 4   | `/dev/ttyUSB4` | `pci-0000:00:1a.0-usb-0:1.4:1.0-port0` | CH341 USB-Serial |
| Port 5   | `/dev/ttyUSB5` | `pci-0000:00:1a.0-usb-0:1.5:1.0-port0` | CH341 USB-Serial |
| Port 6   | `/dev/ttyUSB6` | `pci-0000:00:1a.0-usb-0:1.6:1.0-port0` | CH341 USB-Serial |

## Physical Location

All four USB-to-serial adapters are:
- Connected to the **USB56 internal header** on the motherboard
- Exposed via **USB ports on a PCI bracket** mounted at the back of the case
- Located in the area where PCI expansion cards are typically installed

This allows for convenient access to serial ports from the rear of the system without occupying PCIe slots.

## CH341 USB-to-Serial Adapter

### Specifications
- **Vendor ID**: `1a86` (QinHeng Electronics)
- **Product ID**: `7523` (HL-340 USB-Serial adapter)
- **Driver**: `ch341` (kernel module)
- **Speed**: USB 2.0 Full Speed (12 Mbps)
- **Protocol**: USB CDC (Communication Device Class)

### Firmware Versions
Different adapters may have different firmware revisions (observed: `02.62`, `02.63`, `02.64`).

## Usage in Home Automation System

These USB-to-serial ports are used for:
- Modbus RTU communication with various devices
- Connection to RS-485 networks
- Integration with legacy serial devices
- Multiple simultaneous serial connections without requiring PCIe serial cards

## Troubleshooting

### List All USB Serial Devices
```bash
ssh routy "ls -la /dev/serial/by-path/ | grep 1a.0"
```

### Check USB Topology
```bash
ssh routy "lsusb -t"
```

### Verify Device Presence
```bash
ssh routy "lsusb | grep 1a86"
```

### Check Driver Status
```bash
ssh routy "lsmod | grep ch341"
ssh routy "dmesg | grep -i ch341"
```

### Identify Physical Port
To identify which physical USB port corresponds to which device:
1. Note the current device list: `lsusb -t`
2. Unplug a specific USB serial adapter
3. Run `lsusb -t` again and note which device disappeared
4. The missing port number corresponds to that physical connector

### Persistent Device Naming
Always use the by-path symlinks for reliable device identification:
```bash
/dev/serial/by-path/pci-0000:00:1a.0-usb-0:1.6:1.0-port0
```

This ensures the same physical port always gets the same device path, regardless of enumeration order.

## Integration with Services

These USB serial ports integrate with:
- **[modbus-serial](../../docker/modbus-serial/CLAUDE.md)** - Modbus RTU device communication
- Custom serial device drivers in the automation system

## See Also

- [Serial Hardware Documentation](README.md) - Overview of all serial hardware
- [Exar XR17V35X](exar-xr17v35x.md) - PCIe serial controller documentation
