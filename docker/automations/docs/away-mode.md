# Away mode

The bot `awayMode` (type `away-mode`, #1756) sets the house back for a trip. You press one switch in the Home Assistant app. You can also give a return date.

Home Assistant shows two entities:

- The switch `switch.away_mode`, name "Отсъствие". On means away. Off means back.
- The text `text.away_return_date`, name "Дата на връщане". It holds a date as `YYYY-MM-DD`, or nothing.

## What one press does

Press the switch on:

- Each room thermostat in **heating** mode goes **3 K** lower. The old set point is saved first.
- The living-room set point goes 3 K lower too, but never under 16 °C.
- The boiler heater goes off (see the timeline below).
- You get one Telegram message with what was changed, and what was skipped.

The bot never changes a thermostat mode. A room in **cooling** mode is not touched.

A room needs a fresh reading. A reading up to 10 minutes old counts as current. A room without one is skipped. The Telegram message says so.

Irrigation is not touched. This is the owner's choice.

## The return date

The return date is a local date (time zone `Europe/Sofia`). The return is at 00:00 of that day.

Timeline for a return on date D:

| When | What happens |
|---|---|
| D minus 6 hours (the evening before) | The boiler goes back to automatic by itself. Hot water is ready for the return. |
| D minus 3 days | The rooms and the living room go back to the saved set points. A room warms up slowly, about 0.045 K an hour, so it needs about 3 days. |
| D, 00:00 | The switch turns itself off. Anything not yet put back is put back. The date is cleared. |

Other rules:

- If the return is less than 3 days away when you press, the rooms are not set back at all. Only the boiler is.
- With no return date, the boiler uses `vacation_14d`. The rooms stay set back until you press "back".
- You can change the date while away. Only the times move. The saved values are not saved again.
- If you move the date later after the rooms were put back, they are not set back again.
- A date that is not in the future, or more than 60 days ahead, is refused. The field shows the old value again.

## Back

Press the switch off. At once:

- The rooms and the living room go back to the saved set points.
- The boiler goes to automatic, if it is still in the mode the bot set.
- You get a Telegram message.

## Changes by hand are kept

A value is put back only while it still shows the setback value. If someone changed a room by hand while away, that value stays. The Telegram message says so. The same is true for the boiler: a mode set by hand is not changed. One exception: a vacation mode picked by hand while away looks like the bot's own, so the bot may end it on return.

## If a write does not arrive

After a write, the bot waits up to 3 minutes for the new value in the readings. If it does not show, the bot writes again. It writes at most 3 times for one room and one step. Then it sends a message and stops. It does not keep forcing a value.

## Power loss and restarts

- The bot checks the clock every minute. All its state is saved. A restart of the bot does not move the times.
- A thermostat that restarts loads the old value from its panel. `bac002-restore-state` (#1796) writes back the last value it saw. That value is the setback value while away, and the home value after the return. Both bots work together; there is a test for it (`bots/away-mode-restore-state.test.js`).
- The bot works without internet. Only the Telegram messages need it, and they are best effort.

## Other bots

- The season guard (#1739) checks only thermostats in cooling mode. The away bot never changes a mode, so the guard does not warn about the setback.
- The boiler controller has a new mode `vacation_until` for this. See [boiler-controller.md](boiler-controller.md).

## Who may press it

Only the two parents press the switch, from the Home Assistant app. That is the rule they agreed on.

Showing the card only to them is a step in the Home Assistant UI, not in this repo. On the card, open the Visibility tab and add the condition "User".

## Settings

In `config/automations/config.js`, entry `awayMode`:

- `setbackK`: 3 K lower.
- `livingMin`: 16 °C, the same as the living-room thermostat minimum.
- Topics: the thermostat list is the one the season guard uses. The other topics are the features topics of the switch, the text and the boiler, and the living-room thermostat topics.

Other values have defaults in `bots/away-mode.js`: reading age 10 minutes, write check 3 minutes, 3 writes, schedule check every minute, rooms back 3 days before, boiler 6 hours before.

State (in the persistent cache): away on or off, the return date, the saved values, what the bot set on the boiler, and the writes not yet confirmed.

## Test on the real house

First weekday after the deploy, 10:00 to 10:30 Sofia time:

1. Switch on with a return date a few days ahead.
2. Check the set points and the boiler mode.
3. Switch off.
4. Check that everything is back.
