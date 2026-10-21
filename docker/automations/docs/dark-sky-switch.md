# Dark sky tonight (night lights switch)

The Home Assistant switch *Тъмно небе тази нощ* ("dark sky tonight", `switch.dark_sky_tonight`) keeps
the outside night lights off for one night, for a clear night sky.

## What it does

- Press it before or during the evening. The lights stay off from sunset until
  the next sunrise. If they are on when you press it, they go off at once.
- It turns itself off at the next sunrise. The next evening the lights come on
  as always.
- Turn it off by hand at night and the lights come on at once.
- It counts only for the night after you turned it on. A switch that is still
  on from before the last sunrise (for example after a restart that missed the
  sunrise) is ignored, and the bot turns it off.

## When data is missing

The lights follow the sun as before when the switch has no state, or the state
is not a clear on or off. A missing switch never blocks the lights.

## How it works

- The switch is a feature in the features service:
  `homy/features/switch/dark_sky_tonight/set` (`{"state": true}` or
  `{"state": false}`) and `.../status` (retained). The `darkSkyTonightState`
  bot in `config/automations/features.js` copies each set command to the status.
  The status time (`_tz`) is when the switch was turned on.
- Both bots `nightExternalLights` and `nightExternalLightsZ2M`
  (`bots/solar-emitter.js`) read the status with `holdOffStatusTopic`. They send
  `{"state": false}` to `holdOffSetTopic` at sunrise, or when the switch is
  expired. Without these two keys a solar-emitter works as before.
- If a status has no time, the bot remembers when it first saw the switch turn
  on (`persistedCache`).
- It works without internet: the sun times come from the local `suncalc`
  library, and MQTT and the features service are local.

## Log lines

A bot with the hold-off switch configured writes these lines to the container
log (`<name>` is the bot name), each once per event. A check can read them to see a night.

- `[<name>] hold-off switch on (since <ISO time>)`
- `[<name>] hold-off switch off` (after it was on)
- `[<name>] wanted: on`, `wanted: off` or `wanted: off (hold-off)`, when the
  wanted state of the lights changes
- `[<name>] sunrise: turning the hold-off switch off`
- `[<name>] hold-off switch is from before the last sunrise: turning it off`

## Note

On a night with the switch on, there is less security light outside.
