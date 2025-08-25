/**
 * MQTT to InfluxDB bridge service for Sunseeker lawn mower
 */

import mqtt from 'mqtt';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { SunseekerMessageParser } from './message-parser.js';
import { MQTT, HEALTH_CHECK } from './constants.js';
import { validateConfig, generateClientId, isTimestampRecent, createError } from './utils.js';
import { logger } from './logger.js';

export class SunseekerMqttInfluxService {
  constructor(config) {
    this.config = this._validateConfig(config);
    this.parser = new SunseekerMessageParser();
    this.mqttClient = null;
    this.influxDB = null;
    this.writeApi = null;
    
    // Health and metrics tracking
    this.isConnected = false;
    this.metrics = {
      messagesProcessed: 0,
      pointsWritten: 0,
      lastMessageTime: null,
      uptime: Date.now()
    };
  }

  /**
   * Start the service
   */
  async start() {
    logger.start('Starting Sunseeker MQTT-InfluxDB service...');
    
    try {
      await this._connectMqtt();
      await this._connectInfluxDB();
      logger.success('Service started successfully');
    } catch (error) {
      logger.error('Failed to start service', error);
      throw error;
    }
  }

  /**
   * Stop the service gracefully
   */
  async stop() {
    logger.stop('Stopping Sunseeker MQTT-InfluxDB service...');
    
    try {
      if (this.mqttClient) {
        this.mqttClient.end(true);
      }
      
      if (this.writeApi) {
        await this.writeApi.close();
      }
      
      if (this.influxDB) {
        this.influxDB.close();
      }
      
      logger.success('Service stopped successfully');
    } catch (error) {
      logger.error('Error during service shutdown', error);
    }
  }

  /**
   * Check if service is healthy
   */
  isHealthy() {
    const hasRecentActivity = isTimestampRecent(
      this.metrics.lastMessageTime, 
      HEALTH_CHECK.RECENT_ACTIVITY_TIMEOUT_MS
    );
    
    return this.isConnected && hasRecentActivity;
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.uptime
    };
  }

  /**
   * Connect to MQTT broker
   * @private
   */
  async _connectMqtt() {
    const { url, username, password } = this.config.mqtt;
    
    const options = {
      username,
      password,
      clientId: generateClientId(MQTT.CLIENT_ID_PREFIX),
      clean: true,
      reconnectPeriod: MQTT.RECONNECT_PERIOD_MS,
      connectTimeout: MQTT.CONNECT_TIMEOUT_MS
    };

    logger.connection(`Connecting to MQTT broker: ${url}`);
    
    return new Promise((resolve, reject) => {
      this.mqttClient = mqtt.connect(url, options);

      this.mqttClient.on('connect', () => {
        logger.connection('Connected to MQTT broker');
        this.isConnected = true;
        this._subscribeToTopics();
        resolve();
      });

      this.mqttClient.on('error', (error) => {
        logger.error('MQTT connection error', error);
        this.isConnected = false;
        reject(createError('MQTT connection failed', 'MQTT_CONNECTION', error));
      });

      this.mqttClient.on('close', () => {
        logger.connection('MQTT connection closed');
        this.isConnected = false;
      });

      this.mqttClient.on('message', (topic, message) => {
        this._handleMessage(topic, message);
      });
    });
  }

  /**
   * Subscribe to MQTT topics
   * @private
   */
  _subscribeToTopics() {
    const { deviceId, appId } = this.config.mqtt;
    
    const topics = [
      `/device/${deviceId}/+`,
      `/app/${appId}/+`
    ];

    topics.forEach(topic => {
      this.mqttClient.subscribe(topic, (error) => {
        if (error) {
          logger.error(`Failed to subscribe to ${topic}`, error);
        } else {
          logger.connection(`Subscribed to: ${topic}`);
        }
      });
    });
  }

  /**
   * Handle incoming MQTT message
   * @private
   */
  async _handleMessage(topic, messageBuffer) {
    try {
      const payload = messageBuffer.toString();
      logger.message(`Received message on ${topic}`);
      
      this.metrics.messagesProcessed++;
      this.metrics.lastMessageTime = Date.now();

      const dataPoints = this.parser.parseMessage(topic, payload);
      
      if (dataPoints && dataPoints.length > 0) {
        await this._writeToInfluxDB(dataPoints);
        logger.write(`Wrote ${dataPoints.length} points to InfluxDB`);
      }
    } catch (error) {
      logger.error('Error processing message', error);
    }
  }

  /**
   * Connect to InfluxDB
   * @private
   */
  async _connectInfluxDB() {
    const { url, token, org, bucket } = this.config.influx;
    
    logger.database(`Connecting to InfluxDB: ${url}`);
    
    this.influxDB = new InfluxDB({ url, token });
    this.writeApi = this.influxDB.getWriteApi(org, bucket);
    
    // Configure write API
    this.writeApi.useDefaultTags({ service: 'sunseeker-mqtt-influx' });
  }

  /**
   * Write data points to InfluxDB
   * @private
   */
  async _writeToInfluxDB(dataPoints) {
    try {
      const points = dataPoints.map(dataPoint => this._createInfluxPoint(dataPoint));
      
      this.writeApi.writePoints(points);
      await this.writeApi.flush();
      
      this.metrics.pointsWritten += points.length;
    } catch (error) {
      logger.error('Failed to write to InfluxDB', error);
      throw createError('InfluxDB write failed', 'INFLUXDB_WRITE', error);
    }
  }

  /**
   * Create InfluxDB Point from data point
   * @private
   */
  _createInfluxPoint(dataPoint) {
    const point = new Point(dataPoint.measurement);
    
    // Add tags
    point.tag('device_id', dataPoint.device_id);
    Object.entries(dataPoint.tags).forEach(([key, value]) => {
      point.tag(key, value);
    });
    
    // Add fields
    Object.entries(dataPoint.fields).forEach(([key, value]) => {
      if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          point.intField(key, value);
        } else {
          point.floatField(key, value);
        }
      } else if (typeof value === 'boolean') {
        point.booleanField(key, value);
      } else {
        point.stringField(key, String(value));
      }
    });
    
    // Set timestamp
    point.timestamp(dataPoint.timestamp);
    
    return point;
  }

  /**
   * Validate configuration
   * @private
   */
  _validateConfig(config) {
    const schema = {
      'mqtt.url': 'MQTT URL',
      'mqtt.username': 'MQTT username', 
      'mqtt.password': 'MQTT password',
      'mqtt.deviceId': 'MQTT device ID',
      'mqtt.appId': 'MQTT app ID',
      'influx.url': 'InfluxDB URL',
      'influx.token': 'InfluxDB token',
      'influx.org': 'InfluxDB organization', 
      'influx.bucket': 'InfluxDB bucket'
    };
    
    validateConfig(config, schema);
    return config;
  }
}

/**
 * Factory function to create service instance
 */
export async function createService(config) {
  return new SunseekerMqttInfluxService(config);
}