# Exar XR17V35X PCIe Serial Card Configuration

## Hardware Overview

**Card Information:**
- **Model:** Exar XR17V35X 8-port PCIe serial controller
- **PCI Device ID:** 13a8:0358 (located at PCI address 03:00.0)
- **Serial Ports:** 8 ports mapped to `/dev/ttyS4` through `/dev/ttyS11`
- **Kernel Driver:** `8250_exar` (module: `8250_exar.ko`)
- **Base Baud Rate:** 7,812,500 bps
- **Memory Mapped I/O:** 0xf7d00000 - 0xf7d03fff

## GPIO-Based Mode Control

The XR17V35X uses GPIO pins to switch each serial port between RS-232, RS-422, and RS-485 modes. The card exposes a GPIO chip (`gpiochip496`) with 16 GPIOs - 2 per port.

### GPIO Architecture

**GPIO Chip Details:**
- **Device:** `gpiochip496`
- **Label:** `exar_gpio0`
- **Base GPIO:** 496
- **Number of GPIOs:** 16 (2 per port)
- **Sysfs Path:** `/sys/class/gpio/gpiochip496`

**Per-Port GPIO Mapping:**

Each port uses 2 consecutive GPIOs:
- **GPIO N+0:** Mode select (0=RS-232, 1=RS-422/RS-485)
- **GPIO N+1:** Duplex select (0=Full duplex/RS-422, 1=Half duplex/RS-485)

| Port   | Device       | GPIO Mode | GPIO Duplex | Mode Select Pin | Duplex Select Pin |
|--------|--------------|-----------|-------------|-----------------|-------------------|
| Port 0 | `/dev/ttyS4` | 496       | 497         | Mode            | Duplex            |
| Port 1 | `/dev/ttyS5` | 498       | 499         | Mode            | Duplex            |
| Port 2 | `/dev/ttyS6` | 500       | 501         | Mode            | Duplex            |
| Port 3 | `/dev/ttyS7` | 502       | 503         | Mode            | Duplex            |
| Port 4 | `/dev/ttyS8` | 504       | 505         | Mode            | Duplex            |
| Port 5 | `/dev/ttyS9` | 506       | 507         | Mode            | Duplex            |
| Port 6 | `/dev/ttyS10`| 508       | 509         | Mode            | Duplex            |
| Port 7 | `/dev/ttyS11`| 510       | 511         | Mode            | Duplex            |

### Serial Mode Configuration

**RS-232 Mode (Default):**
- Mode GPIO = 0
- Duplex GPIO = 0
- Use case: Standard PC serial communication

**RS-422 Mode (Full Duplex):**
- Mode GPIO = 1
- Duplex GPIO = 0
- Use case: Long-distance, noise-immune, multi-drop networks with separate TX/RX pairs

**RS-485 Mode (Half Duplex):**
- Mode GPIO = 1
- Duplex GPIO = 1
- Use case: Multi-drop networks with shared 2-wire bus (most common for Modbus RTU)

## Configuration Methods

### Method 1: Manual GPIO Configuration

```bash
# Example: Configure ttyS4 (port 0) for RS-485

# 1. Export GPIOs if not already exported
echo 496 > /sys/class/gpio/export 2>/dev/null || true
echo 497 > /sys/class/gpio/export 2>/dev/null || true

# 2. Set GPIO direction to output
echo "out" > /sys/class/gpio/gpio496/direction
echo "out" > /sys/class/gpio/gpio497/direction

# 3. Set RS-485 mode (both GPIOs high)
echo 1 > /sys/class/gpio/gpio496/value  # Enable RS-422/485 mode
echo 1 > /sys/class/gpio/gpio497/value  # Enable half-duplex (RS-485)

# 4. Verify configuration
cat /sys/class/gpio/gpio496/value  # Should output: 1
cat /sys/class/gpio/gpio497/value  # Should output: 1
```

### Method 2: Using Configuration Script

A configuration script is available on the routy server at `/tmp/test_rs485.sh`:

```bash
# Configure port N for RS-485
sudo /tmp/test_rs485.sh <port_number> 485

# Examples:
sudo /tmp/test_rs485.sh 0 485   # Configure ttyS4 for RS-485
sudo /tmp/test_rs485.sh 1 422   # Configure ttyS5 for RS-422
sudo /tmp/test_rs485.sh 2 232   # Configure ttyS6 for RS-232
```

**Script Parameters:**
- **Argument 1:** Port number (0-7)
- **Argument 2:** Mode (232, 422, or 485)

### Method 3: Check Current Configuration

Status check script available at `/tmp/show_all_ports_status.sh`:

```bash
sudo /tmp/show_all_ports_status.sh
```

**Example Output:**
```
Exar XR17V35X RS-485 Port Status
=================================

Port 0 (/dev/ttyS4): RS-485 (GPIO 496=1, 497=1)
Port 1 (/dev/ttyS5): RS-232 (GPIO 498=0, 499=0)
Port 2 (/dev/ttyS6): Not configured (GPIOs not exported)
...
```

## Driver Capabilities and Limitations

### Working Features
- ✅ **GPIO mode switching:** Fully functional via sysfs
- ✅ **Standard serial communication:** Full UART functionality
- ✅ **High baud rates:** Up to 7.8 Mbps base baud
- ✅ **Hardware flow control:** RTS/CTS available in RS-232 mode

### Known Limitations
- ❌ **RS-485 ioctl support:** The `8250_exar` driver does not support `TIOCSRS485` ioctl
  - `TIOCGRS485`: Can read configuration (always returns disabled)
  - `TIOCSRS485`: Returns error "Inappropriate ioctl for device"

**Implications:**
- Cannot configure RTS timing delays via software
- Cannot control transmit enable behavior programmatically
- The XR17V35X hardware handles transmit enable automatically in RS-485 mode
- This is sufficient for most RS-485 applications including Modbus RTU

## Persistent Configuration

### Using systemd Service

Create `/etc/systemd/system/exar-rs485-config.service`:

```ini
[Unit]
Description=Configure Exar XR17V35X ports for RS-485
After=multi-user.target
Before=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/configure-exar-rs485.sh

[Install]
WantedBy=multi-user.target
```

Create `/usr/local/bin/configure-exar-rs485.sh`:

```bash
#!/bin/bash
# Configure all Exar ports for RS-485 on boot

GPIO_BASE=496

for port in {0..7}; do
    gpio_mode=$((GPIO_BASE + port * 2))
    gpio_duplex=$((GPIO_BASE + port * 2 + 1))

    # Export and configure
    echo $gpio_mode > /sys/class/gpio/export 2>/dev/null || true
    echo $gpio_duplex > /sys/class/gpio/export 2>/dev/null || true
    echo "out" > /sys/class/gpio/gpio$gpio_mode/direction
    echo "out" > /sys/class/gpio/gpio$gpio_duplex/direction

    # Set to RS-485 mode
    echo 1 > /sys/class/gpio/gpio$gpio_mode/value
    echo 1 > /sys/class/gpio/gpio$gpio_duplex/value
done

echo "Exar XR17V35X ports configured for RS-485"
```

Enable the service:
```bash
sudo chmod +x /usr/local/bin/configure-exar-rs485.sh
sudo systemctl daemon-reload
sudo systemctl enable exar-rs485-config.service
sudo systemctl start exar-rs485-config.service
```

### Using udev Rules

Create `/etc/udev/rules.d/99-exar-rs485.rules`:

```udev
# Configure Exar XR17V35X ports for RS-485 on device detection
SUBSYSTEM=="tty", KERNEL=="ttyS[4-9]", ACTION=="add", RUN+="/usr/local/bin/configure-exar-rs485.sh"
SUBSYSTEM=="tty", KERNEL=="ttyS1[0-1]", ACTION=="add", RUN+="/usr/local/bin/configure-exar-rs485.sh"
```

Reload udev rules:
```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

## Testing RS-485 Communication

### Basic Port Test

```bash
# Configure port for 9600 baud, 8 data bits, no parity, 1 stop bit
stty -F /dev/ttyS4 9600 cs8 -parenb -cstopb

# Send test message
echo "TEST" > /dev/ttyS4

# Monitor incoming data (in another terminal)
cat /dev/ttyS4
```

### Modbus RTU Test

The card is ideal for Modbus RTU communication. See the modbus-serial service documentation for integration examples.

**Example Modbus Configuration:**
```yaml
devices:
  - name: "energy_meter"
    type: "modbus"
    connection:
      type: "serial"
      path: "/dev/ttyS4"
      baudRate: 9600
      dataBits: 8
      stopBits: 1
      parity: "none"
    slaveId: 1
```

## Troubleshooting

### Check Card Detection

```bash
# Verify PCI device is detected
lspci | grep -i serial
# Expected: 03:00.0 Serial controller: Exar Corp. Device 0358 (rev 03)

# Get detailed device info
lspci -vvv -s 03:00.0

# Check kernel driver binding
ls -la /sys/bus/pci/devices/0000:03:00.0/driver
# Expected: link to ../../../../bus/pci/drivers/exar_serial
```

### Verify Serial Ports

```bash
# List serial ports
ls -la /dev/ttyS{4..11}

# Check kernel messages for port initialization
dmesg | grep -i 'ttyS\|XR17V35X\|exar'

# Verify port parameters
stty -F /dev/ttyS4 -a
```

### GPIO Troubleshooting

```bash
# Check GPIO chip exists
ls -la /sys/class/gpio/gpiochip496

# List exported GPIOs
ls -la /sys/class/gpio/ | grep gpio[0-9]

# Check specific GPIO status
cat /sys/class/gpio/gpio496/direction
cat /sys/class/gpio/gpio496/value

# Re-export GPIO if needed
echo 496 > /sys/class/gpio/unexport
echo 496 > /sys/class/gpio/export
```

### Common Issues

**Problem:** "Permission denied" when accessing GPIO files
```bash
# Solution: Add user to dialout group
sudo usermod -a -G dialout $USER
# Log out and back in for changes to take effect
```

**Problem:** GPIO already exported
```bash
# This is normal and safe - the error can be ignored
# Or unexport first:
echo 496 > /sys/class/gpio/unexport
echo 496 > /sys/class/gpio/export
```

**Problem:** No data received on RS-485 bus
- Verify correct termination resistors (120Ω at each end of bus)
- Check A/B wire polarity
- Confirm all devices use same baud rate and parameters
- Verify GPIO configuration shows RS-485 mode (both GPIOs = 1)
- Test with loopback (connect A to A, B to B between two ports)

## Hardware Specifications

### Electrical Characteristics

**RS-232 Mode:**
- Voltage levels: ±5V to ±15V
- Maximum cable length: ~15 meters
- Point-to-point only

**RS-422 Mode:**
- Differential voltage: 2V to 6V
- Maximum cable length: ~1200 meters at low baud rates
- Supports multi-drop (1 driver, up to 10 receivers)
- Separate TX/RX pairs (full duplex)

**RS-485 Mode:**
- Differential voltage: 1.5V to 5V
- Maximum cable length: ~1200 meters at low baud rates
- Supports multi-drop (up to 32 devices without repeaters)
- Shared bus (half duplex)
- Requires termination resistors (120Ω at each end)

### Connector Pinout

The card likely uses standard DB-9 or terminal block connectors. Typical pinout for RS-485:

| Pin | Signal    | Description                      |
|-----|-----------|----------------------------------|
| 1   | A (TXD+)  | Non-inverting data line          |
| 2   | B (TXD-)  | Inverting data line              |
| 3   | GND       | Signal ground (reference)        |
| 4-9 | N/C       | Not connected in RS-485 mode     |

**Note:** Verify actual pinout with card documentation or multimeter testing.

## References

### Kernel Documentation
- Driver source: `/lib/modules/$(uname -r)/kernel/drivers/tty/serial/8250/8250_exar.ko`
- Device tree: `/sys/bus/pci/devices/0000:03:00.0/`
- GPIO interface: `/sys/class/gpio/gpiochip496`

### Related Documentation
- [Modbus Serial Configuration](../../docker/modbus-serial/CLAUDE.md)
- [System Architecture](../../ARCHITECTURE.md)

### External Resources
- [Exar XR17V35X Datasheet](https://www.maxlinear.com/product/interface/uarts/pcie-uarts)
- [Linux Serial HOWTO](https://tldp.org/HOWTO/Serial-HOWTO.html)
- [RS-485 Standard (TIA-485-A)](https://en.wikipedia.org/wiki/RS-485)
