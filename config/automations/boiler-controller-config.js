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
      // these targets. A draw in the hold also starts the element (#1976).
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
      // Contactor feedback (#1912): the real state of the element. An ON the
      // controller did not send is kept until the top reaches the stop target
      // in force (50 °C, 55 °C in the top-up and boost windows), for at most
      // 2 h; only maxSafe, hotWaterLimit and old readings stop it earlier. After
      // an OFF it did not send, the controller waits 30 min before it starts
      // the element again.
      contactorStatusTopic: `${featuresPrefix}/relay/service_boiler_contactor/status`,
      externalOnMaxMs: 2 * 60 * 60 * 1000,
      externalOffHoldMs: 30 * 60 * 1000,
      // The `boost` mode (the Home Assistant button "Загрей целия бойлер") and
      // `manual_on` heat the whole tank (#1976): they heat until the bottom
      // reaches `boostBottomTarget` and stop when the top reaches
      // `boostTopLimit`. The top may get hotter than the 55 °C of the
      // automatic rules, so only a person starts it; 60 °C is the hard cap at
      // the top. Boost runs at most 2 h, then goes back to automatic. The
      // bottom sensor sits in the solar coil: while the solar pump runs it
      // reads the coil, so a boost may end early then.
      boostBottomTarget: 50,
      boostTopLimit: 60,
      boostDurationMs: 2 * 60 * 60 * 1000,
      // Baths ready (#1984): the status says how many baths the tank holds
      // now and the minutes to one more. Only computed and published; no
      // heating rule uses it. A bath is one shower: 65 L of 40 °C water at
      // the tap (single draws: middle half 45-95 L).
      bathLitres: 65,
      bathTempC: 40,
      // Cold water °C by month, January first: the lowest bottom reading in
      // that month over three years (2023-11 to 2026-11). The real cold water
      // may be a little colder.
      coldWaterByMonth: [11.6, 9.8, 13.3, 12.9, 17.2, 19.9, 23.0, 23.9, 19.1, 17.1, 14.6, 13.1],
      // The element's mean power while the controller asks for heat, by the
      // water temperature at the element (it cuts out and cycles by itself
      // as the water warms). The first row with the temperature under
      // `belowC` counts; the last row has no limit.
      elementPowerByTempKw: [
        { belowC: 30, kw: 2.6 },
        { belowC: 35, kw: 2.1 },
        { belowC: 40, kw: 1.55 },
        { belowC: 45, kw: 1.05 },
        { kw: 0.75 }
      ],
      // The tank model: 184 L in 16 layers of 11.5 L over 1157 mm of water.
      // Outlet in layer 14, element in layer 1 (layer 0 is the bottom),
      // sensors 371 mm and 915 mm above the inside bottom. The cold inlet
      // water mixes into the lowest layers (share of layer j:
      // exp(-j / inletMixLayers)). maxTopC ends the heating simulation.
      tankModel: {
        litres: 184,
        layers: 16,
        heightMm: 1157,
        outletLayer: 14,
        elementLayer: 1,
        bottomSensorMm: 371,
        topSensorMm: 915,
        inletMixLayers: 1.07,
        maxTopC: 75
      },
      timeZone: 'Europe/Sofia', // the month of coldWaterByMonth
      boostButtonName: 'Загрей целия бойлер', // the button below, in the sentence
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