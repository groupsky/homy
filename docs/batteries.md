# Batteries

One Grafana table shows every battery in the house, and one alert says when a
battery must be changed (#1750).

## Where

- **Dashboard**: Grafana → General → **Batteries** (`/d/batteries`). Source:
  `config/grafana/dashboards/batteries.json`.
- **Alert**: the rule **Battery under 25 %** in the Infrastructure folder.
  Source: `config/grafana/provisioning/alerting/battery-alerts.yaml`.

## What the table shows

| Row | Data (InfluxDB, database `homy`) | Columns |
|---|---|---|
| Zigbee sensor with a level | `zigbee.battery` (%) per `device` | level, change per day, days to 25 % |
| Zigbee sensor with only a flag | `zigbee.battery_low` per `device` | low flag (*ok* or *LOW*) |
| Mower | `sunseeker_battery_info.charge_times` | charge cycles, cycles per day |
| UPS | `fleet_ups.battery_charge`, `battery_runtime` | level now, runtime now |

How the numbers are made:

- **Level** is the median of the last UTC day. The median drops single odd
  readings. Some sensors report 93 % once in a while during a slow fall.
- **Change per day** is (median of today − median of the day 14 days ago) / 14.
- **Days to 25 %** is (level − 25) / −(change per day). It is a straight line,
  and real batteries fall faster at the end, so change the battery before the
  date it gives. It shows *no estimate* when the level did not fall in the last
  14 days, or when the level is already under 25 %.
- The sensors report whole percents, so one step more or less in 14 days moves
  the estimate a lot. Read it as "months" or "weeks", not as a date.

What the table cannot say:

- **Sensors with only a flag** give no level and no trend. Change the battery
  when the flag says *LOW*.
- **Mower**: no document gives the cycle life of its battery, so the table
  shows only how fast the counter grows, not how much life is left.
- **UPS**: the charge falls in every power cut and comes back after it. It
  tells nothing about wear. The UPS service on the host (it writes `fleet_ups`)
  already sends messages for a low battery and for "replace battery".

## What the alert means

**Battery under 25 %** checks once an hour. It fires when the daily median of a
Zigbee sensor's `battery` is under 25 % for one hour. There is one alert for
each such sensor, with the sensor's name in the message. The message says
"🔋 Battery under 25 % on `<sensor>`" and gives the level.

- The first message comes within an hour or two. After that, a reminder comes
  once a week (route on `rule_uid = battery-under-25` in
  `notification-policies.yaml`) until the battery is changed. Then a "resolved"
  message comes.
- It is not a safety alert, so at night the message arrives without sound
  (quiet hours, `docker/telegram-bridge/CLAUDE.md`).
- The mower, the UPS and flag-only sensors are not in this alert. The mower
  has its own battery alerts (`sunseeker-battery-alerts.yaml`), and the UPS has
  the host's UPS service.
- If no sensor has sent a battery level in the last day, the rule stays OK. A
  sensor that stops sending drops off the table.
