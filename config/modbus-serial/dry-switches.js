function getFile(filePath) {
  if (filePath) {
    const fs = require('fs');

    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
    } catch (err) {
      console.error('Failed to read file', filePath, err);
    }
  }
  return null;
}

function getFileEnv(envVariable) {
  const origVar = process.env[envVariable];
  const fileVar = process.env[envVariable + '_FILE'];
  if (fileVar) {
    const file = getFile(fileVar);
    if (file) {
      return file.toString().split(/\r?\n/)[0].trim();
    }
  }
  return origVar;
}

module.exports = {
  modbus: {
    port: '/dev/serial/by-path/pci-0000:00:1a.0-usb-0:1.5:1.0-port0',
    portConfig: {
      baudRate: 115200,
      parity: 'even',
    },
    msDelayBetweenDevices: 5,
    msTimeout: 50,
    // A read retry holds the bus up to ~200 ms; the default (10 x msTimeout)
    // could time out a relay write queued behind a few of those.
    msCommunicationTimeout: 1000,
  },
  // The input modules restart in a mains dip (their 12 V supply is not on the
  // UPS) and first send a reading with many inputs dropped. The guard holds
  // each change for one poll pass and drops the readings of a dip (#2007,
  // docker/modbus-serial/power-dip-guard.js).
  powerDipGuard: {
    devices: ['mbsl32di1', 'mbsl32di2'],
    // a reading with this many inputs changed starts a dip
    minChangedBits: 3,
    // a dip ends when a non-zero reading has not changed for this long
    stableMs: 1000,
  },
  devices: [
    {
      name: 'relays00-15',
      address: 1,
      type: 'aspar-mod-16ro',
      options: {
        maxMsBetweenReports: 7 * 60 * 1000, // 7 minutes
        // The relay boards restart in a mains dip and come back with their
        // outputs in the power-up state (#2008, see aspar-mod-16ro.js). After
        // a restart each listed output gets back its last wanted value if the
        // board was gone no longer than restoreWithinMs, else defaultState.
        // defaultState is also the board's own power-up state (def* coils).
        // An output that is not listed is never written. {} = the board-wide
        // values; an output can override them, e.g. {defaultState: true}.
        restore: {
          restoreWithinMs: 15 * 60 * 1000, // 15 minutes
          defaultState: false,
          outputs: {
            out8: {}, // lights
            out9: {},
            out10: {},
            out11: {},
            out13: {},
            out14: {}, // boiler contactor
            out15: {}, // outside lights
          },
        },
      }
    },
    {
      name: 'relays16-31',
      address: 2,
      type: 'aspar-mod-16ro',
      options: {
        maxMsBetweenReports: 11 * 60 * 1000, // 11 minutes
        restore: {
          restoreWithinMs: 15 * 60 * 1000, // 15 minutes
          defaultState: false,
          outputs: {
            out8: {}, // lights
            out9: {},
            out10: {},
            out11: {},
            out12: {},
            out13: {},
            out14: {},
            out15: {},
          },
        },
      }
    },
    {
      name: 'mbsl32di1',
      address: 31,
      type: 'mbsl32di',
      options: {
        maxMsBetweenReports: 5 * 60 * 1000, // 5 minutes
      }
    },
    {
      name: 'mbsl32di2',
      address: 32,
      type: 'mbsl32di',
      options: {
        maxMsBetweenReports: 5 * 60 * 1000, // 5 minutes
      }
    },
  ],
  integrations: {
    console: {},
    mqtt: {
      url: process.env.BROKER,
      publishTopic: process.env.TOPIC,
      subscribeTopic: process.env.SUBSCRIBE_TOPIC,
    },
    mongodb: {
      collection: process.env.COLLECTION,
      url: process.env.MONGODB_URL,
      options: {
        auth: {
          username: getFileEnv('MONGODB_USERNAME'),
          password: getFileEnv('MONGODB_PASSWORD'),
        },
      },
    },
    ndjson: {
      root: process.env.RAW_DIR,
      stream: process.env.COLLECTION,
      service: process.env.SERVICE_NAME,
    },
    influxdb: {
      url: process.env.INFLUXDB_URL,
      username: getFileEnv('INFLUXDB_USERNAME'),
      password: getFileEnv('INFLUXDB_PASSWORD'),
      database: process.env.INFLUXDB_DATABASE,
      tags: process.env.INFLUXDB_TAGS ? JSON.parse(process.env.INFLUXDB_TAGS) : [],
      measurement: process.env.INFLUXDB_MEASUREMENT
    },
  },
}
