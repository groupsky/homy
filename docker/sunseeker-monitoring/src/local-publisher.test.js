/**
 * Tests for the publisher to the local homy broker (homy/mower/rain).
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';
import { createLocalPublisher, RAIN_TOPIC } from './local-publisher.js';

function fakeClient({ publishError = null } = {}) {
  const client = new EventEmitter();
  client.published = [];
  client.publish = jest.fn((topic, payload, options, callback) => {
    client.published.push({ topic, payload, options });
    callback(publishError);
  });
  client.endAsync = jest.fn(async () => {});
  return client;
}

function setup(options) {
  const client = fakeClient(options);
  const connect = jest.fn(() => client);
  const log = { error: jest.fn() };
  const publisher = createLocalPublisher({ url: 'mqtt://broker', connect, log });
  return { client, connect, log, publisher };
}

describe('createLocalPublisher', () => {
  it('connects to the broker url without a login', () => {
    const { connect } = setup();
    expect(connect).toHaveBeenCalledWith('mqtt://broker', { reconnectOnConnackError: true });
  });

  it('publishes the rain state retained, qos 1, on homy/mower/rain', () => {
    const { client, publisher } = setup();
    publisher.publishRain({ wet: true, rain_status: 2, rain_delay_left: 720 });
    expect(RAIN_TOPIC).toBe('homy/mower/rain');
    expect(client.published).toEqual([{
      topic: 'homy/mower/rain',
      payload: '{"wet":true,"rain_status":2,"rain_delay_left":720}',
      options: { qos: 1, retain: true }
    }]);
  });

  it('logs a failed publish and does not throw', () => {
    const { log, publisher } = setup({ publishError: new Error('socket closed') });
    expect(() => publisher.publishRain({ wet: false, rain_status: 1, rain_delay_left: null })).not.toThrow();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('socket closed'));
  });

  it('logs one error per outage, not one per reconnect', () => {
    const { client, log } = setup();
    expect(() => client.emit('error', new Error('connect ECONNREFUSED'))).not.toThrow();
    client.emit('error', new Error('connect ECONNREFUSED'));
    expect(log.error).toHaveBeenCalledTimes(1);

    client.emit('connect');
    client.emit('error', new Error('connect ECONNREFUSED'));
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it('close ends the connection without waiting for the broker', async () => {
    const { client, publisher } = setup();
    await publisher.close();
    expect(client.endAsync).toHaveBeenCalledWith(true);
  });
});
