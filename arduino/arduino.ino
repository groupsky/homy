/*
 MQTT Input Output

 It connects to an MQTT server then:
  - publishes change of each input gpio to the topic "/homy/ard1/input"
  - subscribes to the topic "/home/ard1/output", and updates each output gpio 
    requested.
  
 Note all communication is json.
 
*/

#include <SPI.h>
#include <Ethernet.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// **************
// CONFIGURATION
// **************

#define USE_DNS

// mac address
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x01 };
// fallback network configuration in case dhcp is not available
IPAddress ip(  192, 168,   0,  31 );
IPAddress gw(  192, 168,   0,   1 );
IPAddress sn(  255, 255, 255,   0 );
IPAddress dns(   1,   1,   1,   1 );

// mqtt broker
//IPAddress mqttBrokerServer(46,101,200,133);
char mqttBrokerServer[] = "homy-srv1.roupsky.name";
int mqttBrokerPort = 1883;
//char mqttBrokerUsername[] = "";
//char mqttBrokerPassword[] = "";
char mqttClientName[] = "homy/ard1";
char subscribeTopic[] = "/homy/ard1/output";
char logTopic[] = "/homy/ard1/log";
char publishTopic[] = "/homy/ard1/input";
char statusTopic[] = "/homy/ard1/status";
long statusInterval = 60000;
long connectedInterval = 60000;

// pin setup
int peripheralPin = 12;
int ethernetPin = 53;
int inputPins[] = { 
  22, 23, 24, 25, 26, 27, 28, 29,
  30, 31, 32, 33, 34, 35, 36, 37,
  38, 39, 40, 41, 42, 43, 44, 45
};
int outputPins[] = {
  A8, A9, A10, A11, A12, A13, A14, A15
};
int invertedOutputPins[] = {
  14, 15, 16, 17, 18, 19, 20, 21,
};

// **************
//    Constants
// **************
#define VAL_TOGGLE -1
#define VAL_ON 1
#define VAL_OFF 0

// **************
//    Variables
// **************
EthernetClient ethClient;
PubSubClient client(ethClient);
char lastInputValues[sizeof(inputPins)/sizeof(inputPins[0])];
char lastOutputValues[sizeof(outputPins)/sizeof(outputPins[0])];
char lastInvertedOutputValues[sizeof(invertedOutputPins)/sizeof(invertedOutputPins[0])];
long lastStatus = 0;
long statusCnt = 0;
boolean dhcp = false;
long lastConnected = 0;

#define STATE_INIT 0
#define STATE_LINK_UP 1
#define STATE_ETHERNET_UP 2
#define STATE_CONNECTED 3
#define STATE_SUBSCRIBED 4
#define STATE_ON 5
int state = STATE_INIT;

// **************
//    Help routines
// **************
boolean setPinValue(int pin, int value) {
  delay(10);
  Serial.print("OUTPUT CHANGE");
  Serial.print(pin);
  Serial.print(": ");

  int newValue;
  int idx = 0;
  int lo = sizeof(outputPins) / sizeof(outputPins[0]);
  int li = sizeof(invertedOutputPins) / sizeof(invertedOutputPins[0]);

  while (idx < lo+li) {
    if (idx < lo && outputPins[idx] == pin) {
      switch (value) {
        case VAL_TOGGLE:
          newValue = lastOutputValues[idx] == HIGH ? LOW : HIGH;
          break;
        case VAL_OFF:
          newValue = LOW;
          break;
        case VAL_ON:
          newValue = HIGH;
          break;
        default: 
          Serial.println("unknown value");
          return false;
      }
      lastOutputValues[idx] = newValue;
      break;
    } else if (idx >= lo && idx < lo+li && invertedOutputPins[idx-lo] == pin) {
      switch (value) {
        case VAL_TOGGLE:
          newValue = lastInvertedOutputValues[idx] == HIGH ? LOW : HIGH;
          break;
        case VAL_OFF:
          newValue = HIGH;
          break;
        case VAL_ON:
          newValue = LOW;
          break;
        default:
          Serial.println("unknown value");
          return false;
      }
      lastInvertedOutputValues[idx] = newValue;
      break;
    }
    idx++;
  }

  if (idx >= lo+li) {
    Serial.println("undefined pin");
    delay(10);
    return false;
  }

  Serial.println(newValue);
  delay(10);


  digitalWrite(pin, newValue);
  delay(10);

  StaticJsonDocument<128> doc;
  
  doc["t"] = "oc";
  doc["p"] = pin;
  doc["v"] = newValue; 
  
  char buffer[256];
  size_t len = serializeJson(doc, buffer);
  client.publish(publishTopic, buffer, len);
  delay(10);

  return true;
}

// **************
//    Command processing
// **************
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  delay(10);
  Serial.print("processing command ");
  Serial.write(payload, length);
  Serial.print("...");
  delay(10);
  StaticJsonDocument<128> docCommand;
  DeserializationError error = deserializeJson(docCommand, payload, length);

  if (error) {
    client.publish(logTopic, error.c_str());
    delay(10);
    Serial.print(" failed");
    Serial.print(error.c_str());
    Serial.println("");
    delay(10);
    return;
  }
  Serial.println(" parsed");
  delay(10);

  int pin = docCommand["pin"];
  int value = docCommand["value"];
  if (!setPinValue(pin, value)) {
    delay(10);
    client.publish(logTopic, "invalid pin for output");
    Serial.println("invalid pin for output");
    delay(10);
    return;
  }
}

boolean pubStatus() {
  Serial.print("publishing status...");
  delay(10);
  StaticJsonDocument<128> doc;

  char a[16];
  IPAddress localIP = Ethernet.localIP();
  sprintf(a, "%d.%d.%d.%d", localIP[0], localIP[1], localIP[2], localIP[3]);
  doc["ip"] = a;
  doc["cnt"] = statusCnt++;
  
  char buffer[256];
  size_t len = serializeJson(doc, buffer);
  boolean res = client.publish(statusTopic, buffer, len);
  if (res) {
    lastStatus = millis();
    delay(10);
    Serial.print(" done: ");
    Serial.write(buffer, len);
    Serial.println("");
  } else {
    Serial.println(" failed");
  }
  delay(10);

  return res;
}

void pubInputChange(int idx, int pin, int lastValue, int value) {
  delay(10);
  Serial.print("INPUT CHANGE");
  Serial.print(pin);
  Serial.print(": ");
  Serial.println(value ? "HIGH" : "LOW");
  delay(10);

  StaticJsonDocument<128> doc;
  
  doc["t"] = "ic";
  doc["i"] = idx;
  doc["p"] = pin;
  doc["l"] = lastValue;
  doc["v"] = value; 
  
  char buffer[256];
  size_t len = serializeJson(doc, buffer);
  client.publish(publishTopic, buffer, len);
}

void readInputs() {
  int l = sizeof(inputPins) / sizeof(inputPins[0]);
  for (int i=0; i<l; i++) {
    int value = HIGH-digitalRead(inputPins[i]);
    if (value != lastInputValues[i]) {
      pubInputChange(i, inputPins[i], lastInputValues[i], value);
      lastInputValues[i] = value;
    }
  }
}

void testPeripherials() {
  int lo = sizeof(outputPins) / sizeof(outputPins[0]);
  int li = sizeof(invertedOutputPins) / sizeof(invertedOutputPins[0]);
  // activate all output
  for (int i=0; i<lo; i++) {
    digitalWrite(outputPins[i], HIGH);
    lastOutputValues[i] = HIGH;
    delay(100);
  }
  for (int i=0; i<li; i++) {
    digitalWrite(invertedOutputPins[i], LOW);
    lastInvertedOutputValues[i] = LOW;
    delay(100);
  }
  
  // deactivate all output
  for (int i=0; i<lo; i++) {
    digitalWrite(outputPins[i], LOW);
    lastOutputValues[i] = LOW;
    delay(100);
  }
  for (int i=0; i<li; i++) {
    digitalWrite(invertedOutputPins[i], HIGH);
    lastInvertedOutputValues[i] = HIGH;
    delay(100);
  }
}

void setup()
{
  Serial.begin(57600);
  delay(10);
  Serial.println("initializing...");
  delay(100);

  pinMode(ethernetPin, OUTPUT);
  digitalWrite(ethernetPin, HIGH);
  delay(10);

  int li = sizeof(inputPins) / sizeof(inputPins[0]);
  for (int i=0; i<li; i++) {
    pinMode(inputPins[i], INPUT_PULLUP);
  }
  int lo = sizeof(outputPins) / sizeof(outputPins[0]);
  for (int i=0; i<lo; i++) {
    pinMode(outputPins[i], OUTPUT);
    digitalWrite(outputPins[i], LOW);
    lastOutputValues[i] = LOW;
  }
  int lio = sizeof(invertedOutputPins) / sizeof(invertedOutputPins[0]);
  for (int i=0; i<lio; i++) {
    pinMode(invertedOutputPins[i], OUTPUT);
    digitalWrite(invertedOutputPins[i], HIGH);
    lastInvertedOutputValues[i] = HIGH;
  }

  if (peripheralPin != 0) {
    delay(10);
    Serial.print(" activating peripherials...");
    delay(10);
    pinMode(peripheralPin, OUTPUT);
    digitalWrite(peripheralPin, HIGH);
    delay(10);
    Serial.println(" done");
    delay(10);
  }

  delay(10);
  Serial.print(" initializing ethernet...");
  delay(10);
  Ethernet.init(ethernetPin);
  delay(10);
  Serial.println(" done");
  delay(100);

  testPeripherials();
  delay(100);

  client.setServer(mqttBrokerServer, mqttBrokerPort);
  client.setCallback(mqttCallback);

  state = STATE_INIT;
}

void loop() {
  delay(10);

  // restart ethernet if couldn't connect in some time
  if (millis() - lastConnected > connectedInterval) {
    Serial.print(" restarting periferials...");
    delay(10);
    digitalWrite(ethernetPin, LOW);
    delay(1000);
    digitalWrite(ethernetPin, HIGH);
    delay(500);
    Serial.println(" done");
    delay(10);
    state = STATE_INIT;
    return;
  }
  
  if (Ethernet.linkStatus() != LinkON) {
    delay(10);
    Serial.print(" waiting for link...");
    delay(10);
    while (Ethernet.linkStatus() != LinkON) {
      delay(10);
      Serial.print(".");
      delay(1000);
    }
    delay(10);
    Serial.println(" up");
    state = STATE_LINK_UP;
    dhcp = false;
    delay(100);
    return;
  }

  // maintain dhcp lease if needed
  if (dhcp) {
    delay(10);
    switch (Ethernet.maintain()) {
      case 0: // nothing done
  //      if (!client.connected() && state > STATE_ETHERNET_UP) {
  //        state = STATE_ETHERNET_UP;
  //        return;
  //      }
        break;
      case 1: // renew failed
        delay(10);
        Serial.println("dhcp renew failed");
        delay(10);
        state = STATE_LINK_UP;
        dhcp = false;
        return;
      case 2: // renew success
        delay(10);
        Serial.print("dhcp renew success: ");
        Serial.print(Ethernet.localIP());
        Serial.println();
        delay(10);
       state = STATE_ETHERNET_UP;
        return;
      case 3: // rebind failed
        delay(10);
        Serial.println("dhcp rebind failed");
        delay(10);
        state = STATE_LINK_UP;
        dhcp = false;
        return;
      case 4: // rebind success
        delay(10);
        Serial.print("dhcp rebind success: ");
        Serial.print(Ethernet.localIP());
        Serial.println();
        delay(10);
        state = STATE_ETHERNET_UP;
        return;
    }
  }

  switch (state) {
    case STATE_INIT:
      state = STATE_LINK_UP;
      dhcp = false;
      return;
    case STATE_LINK_UP:
      delay(10);
#ifdef USE_DNS
      Serial.print(" dhcp...");
      delay(10);
      if (Ethernet.begin(mac) == 0) {
        delay(10);
        Serial.print(" failed, using static ip");
#else
      Serial.print(" static ip ");
      Serial.println(ip);
      delay(10);
      {
#endif
        dhcp = false;
        Ethernet.begin(mac, ip, dns, gw, sn);
        state = STATE_ETHERNET_UP;
        delay(100);
        return;
      }
      dhcp = true;
      delay(10);
      Serial.println(" done");
      state = STATE_ETHERNET_UP;
      delay(1000);
      return;
    case STATE_ETHERNET_UP:
      delay(10);
      Serial.print(" broker ");
      Serial.print(mqttBrokerServer);
      Serial.print(":");
      Serial.print(mqttBrokerPort);
      Serial.print("...");
      delay(10);
      if (client.connect(mqttClientName/*, mqttBrokerUsername, mqttBrokerPassword*/)) {
        delay(10);
        Serial.println("connected");
        state = STATE_CONNECTED;
        delay(100);
      } else {
        delay(10);
        Serial.print("failed, rc=");
        Serial.print(client.state());
        Serial.println(" trying in 5 seconds");
        delay(5000);
      }
      return;
    case STATE_CONNECTED:
      delay(10);
      Serial.print(" subscribing...");
      delay(10);
      if (client.subscribe(subscribeTopic)) {
      delay(10);
        Serial.println(" done");
        state = STATE_SUBSCRIBED;
        delay(100);
        return;
      }
      delay(10);
      Serial.print(" failed, rc=");
      Serial.println(client.state());
      delay(500);
      return;
    case STATE_SUBSCRIBED:
      if (pubStatus()) {
        state = STATE_ON;
        delay(100);
        return;
      };
    case STATE_ON:
      long now = millis();
      lastConnected = millis();
      if (now - lastStatus > statusInterval) {
        pubStatus();
      }
      client.loop();
      delay(25);
      readInputs();
      delay(25);
  }
}
