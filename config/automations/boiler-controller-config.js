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