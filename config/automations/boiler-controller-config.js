const featuresPrefix = process.env.FEATURES_TOPIC_PREFIX || 'homy/features'

module.exports = {
  bots: {
    boilerController: {
      type: 'boiler-controller',
      temperatureTopTopic: `${featuresPrefix}/sensor/temperature_boiler_high/status`,
      temperatureBottomTopic: `${featuresPrefix}/sensor/temperature_boiler_low/status`,
      solarTemperatureTopic: `${featuresPrefix}/sensor/temperature_solar_panel/status`,
      ambientTemperatureTopic: `${featuresPrefix}/sensor/temperature_room_service/status`,
      solarCirculationTopic: `${featuresPrefix}/relay/solar_heater_circulation/status`,
      boilerRelayTopic: `${featuresPrefix}/relay/service_boiler_contactor/set`,
      controlModeTopic: `${featuresPrefix}/control_mode/boiler_controller/set`,
      controlModeStatusTopic: `${featuresPrefix}/control_mode/boiler_controller/status`,
      automationStatusTopic: 'homy/automation/boiler_controller/status',
      manualOverrideExpiry: 24 * 60 * 60 * 1000, // 24 hours
      // Temperature thresholds based on analysis
      comfortMin: 47,
      emergencyMin: 30,
      maxSafe: 85,
      solarAdvantageMin: 5,
      solarDisadvantageMax: -100,
      hysteresis: 3,
      // EVN night tariff zone on the local wall clock. The zone hours change on
      // 1 April and 1 November, not on the clock-change days. The element does
      // not run from `holdBeforeMinutes` before the zone starts until
      // `marginMinutes` after it, unless the tank top is under `floor` °C; then
      // it heats to `floor` + `hysteresis`. The margin covers drift of the meter
      // clock and also staggers the night load: the car charger starts at the
      // zone start and the element 15 minutes later.
      // See docker/automations/docs/boiler-controller.md.
      nightTariff: {
        timeZone: 'Europe/Sofia',
        zones: [
          { months: [11, 12, 1, 2, 3], start: '22:00', end: '06:00' },
          { months: [4, 5, 6, 7, 8, 9, 10], start: '23:00', end: '07:00' }
        ],
        holdBeforeMinutes: 60,
        marginMinutes: 15,
        floor: 40
      },
      // Evening draw (#1911): a big draw soon after the hold ends emptied the
      // tank on many evenings. So the top is heated to 55 °C before the hold
      // (19:30-21:00 in winter, 20:30-22:00 in summer, at day price) and again
      // from the end of the hold to the end of the night zone. 55 °C is the
      // limit while there is no mixing valve (#1473); `hotWaterLimit` caps
      // these targets.
      hotWaterLimit: 55,
      dayTopUp: { minutesBeforeHold: 90, target: 55 },
      nightBoostTarget: 55,
      // Start the element when the bottom reading falls 3 K within 10 min,
      // without waiting for it to go under emergencyMin. From 2026-10-20 to
      // 2026-11-05 every such fall with the element off was a real draw (the
      // bottom then fell to 39 °C or lower), and on the evenings the tank
      // emptied it came 2-51 min (mostly 15-20 min) before the old start.
      drawDropK: 3,
      drawWindowMinutes: 10,
      // Load stagger: the element does not START while the dishwasher runs or
      // the main meter's recent mean power is high. A running element is never
      // stopped by these, and without the two topics the gates are off.
      dishwasherTopic: '/modbus/secondary/dishwasher/reading', // field `p` (W)
      mainPowerTopic: '/modbus/main/main/reading', // field `total_p` (W)
      dishwasherOnW: 10, // a reading above this is load
      dishwasherHoldMs: 10 * 60 * 1000, // load this recently counts as running (cycles pause)
      mainPowerCapW: 6000, // no start at or above this mean (a choice: the main breaker size is not known)
      mainPowerMeanMs: 5 * 60 * 1000, // window of the mean
      maxLoadInputAgeMs: 10 * 60 * 1000, // newer reading than this or the input is ignored
      verbose: true
    }
  },
  gates: {
    mqtt: {
      url: process.env.BROKER,
      clientId: process.env.MQTT_CLIENT_ID || 'homy-boiler-controller',
    },
    state: {
      enabled: true,
      dir: process.env.STATE_DIR || '/app/state',
    }
  }
}