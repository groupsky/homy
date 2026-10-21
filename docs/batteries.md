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
| Mower | `sunseeker_battery_info.charge_times` | charge cycles, cycles per day (90 days) |
| UPS | `fleet_ups.battery_charge`, `battery_runtime` | level now, runtime now |

How the numbers are made:

- **Level** is the median of the current UTC day (since 00:00 UTC). The median
  drops single odd readings. Some sensors report 93 % once in a while during a
  slow fall. Just after midnight UTC a slow sensor has only a few readings, so
  the median filters less then.
- **Change per day** is (median of today − median of the day 14 days ago) / 14.
- **Days to 25 %** is (level − 25) / −(change per day). It is a straight line,
  and real batteries fall faster at the end, so change the battery before the
  date it gives. It shows *no estimate* when the level did not fall in the last
  14 days, or when a falling level is already under 25 %.
- The sensors report whole percents, so one step more or less in 14 days moves
  the estimate a lot. For `living-temp-humid` in October 2026 it moved between
  229 and 350 days from one day to the next. A least-squares line through all
  15 daily medians moved even more (189 to 392 days), because the level stayed
  at 75 % for 9 days. Read it as "months" or "weeks", not as a date.

What the table cannot say:

- **Sensors with only a flag** give no level and no trend. Change the battery
  when the flag says *LOW*.
- **Mower**: no document gives the cycle life of its battery, so the table
  shows only how fast the counter grows, not how much life is left. The window
  is 90 days because the mower sends nothing for weeks in winter.
- **UPS**: the charge falls in every power cut and comes back after it. It
  tells nothing about wear. The UPS service on the host (it writes `fleet_ups`)
  already sends messages for a low battery and for "replace battery".

## What the alert means

**Battery under 25 %** checks once an hour. It fires when the daily median of a
Zigbee sensor's `battery` is under 25 % for one hour. There is one alert for
each such sensor, with the sensor's name in the message. The message says
"🔋 Battery under 25 % on `<sensor>`" and gives the level.

- The first message comes within an hour or two. After that, a reminder comes
  every 5 days (route on `rule_uid = battery-under-25` in
  `notification-policies.yaml`; not 7 days, because Grafana 9.5 forgets a sent
  message after 5 days) until the battery is changed. Then a "resolved" message
  comes.
- A "resolved" message also comes when a low sensor stops sending, for example
  because its battery is now empty. Check the table: a sensor that is gone from
  it has stopped sending.
- It is not a safety alert, so at night the message arrives without sound
  (quiet hours, `docker/telegram-bridge/CLAUDE.md`).
- The mower, the UPS and flag-only sensors are not in this alert. The mower
  has its own battery alerts (`sunseeker-battery-alerts.yaml`), and the UPS has
  the host's UPS service.
- If no sensor has sent a battery level in the last day, the rule stays OK. A
  sensor that stops sending drops off the table. A broken query also leaves the
  rule OK (`execErrState: OK`), so look at the table now and then.
