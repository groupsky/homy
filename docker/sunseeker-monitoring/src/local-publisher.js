/**
 * Publishes the mower's rain state to the local homy broker, retained, so
 * Home Assistant can show it (homy/mower/rain). This is a second MQTT client:
 * the main client reads the vendor broker. Best effort: a failure is logged
 * and never thrown, so the InfluxDB writes do not depend on the local broker.
 */

import mqtt from 'mqtt';

export const RAIN_TOPIC = 'homy/mower/rain';

export function createLocalPublisher({ url, connect = mqtt.connect, log = console }) {
  // Anonymous, as the other services on the local broker. mqtt 5.16+ stops
  // reconnecting after a refused login unless this is set.
  const client = connect(url, { reconnectOnConnackError: true });

  // The client reconnects by itself and each failed try is an error event.
  // One line per outage is enough; an error event must not end the process.
  let errorLogged = false;
  client.on('connect', () => { errorLogged = false; });
  client.on('error', (error) => {
    if (errorLogged) return;
    errorLogged = true;
    log.error(`Local MQTT error: ${error.message}`);
  });

  // `state` is {wet, rain_status, rain_delay_left}. While the broker is away
  // the client keeps the message and sends it when the broker is back.
  function publishRain(state) {
    client.publish(RAIN_TOPIC, JSON.stringify(state), { qos: 1, retain: true }, (error) => {
      if (error) log.error(`Publishing to ${RAIN_TOPIC} failed: ${error.message}`);
    });
  }

  // Forced: with the broker gone, a normal end would wait for an answer that
  // never comes. The mower sends the rain state again about once a minute.
  return { publishRain, close: () => client.endAsync(true) };
}
