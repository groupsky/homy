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

// mac address
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };
// fallback network configuration in case dhcp is not available
IPAddress ip(  192, 168,   0,  31 );
IPAddress gw(  192, 168,   0,   1 );
IPAddress sn(  255, 255, 255,   0 );
IPAddress dns(   1,   1,   1,   1 );

// mqtt broker
IPAddress mqttBrokerServer(192, 168, 0, 106);
//char mqttBrokerServer[] = "broker.roupsky.name";
int mqttBrokerPort = 1883;
//char mqttBrokerUsername[] = "";
//char mqttBrokerPassword[] = "";
char mqttClientName[] = "homy/ard1";
char subscribeTopic[] = "/homy/ard1/output";
char logTopic[] = "/homy/ard1/log";
char publishTopic[] = "/homy/ard1/input";
char statusTopic[] = "/homy/ard1/status";
long statusInterval = 1500;

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
//    Variables
// **************
EthernetClient ethClient;
PubSubClient client(ethClient);
char lastInputValues[sizeof(inputPins)/sizeof(inputPins[0])];
long lastStatus = 0;
long statusCnt = 0;

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
  Serial.print("OUTPUT CHANGE");
  Serial.print(pin);
  Serial.print(": ");
  Serial.println(value ? "HIGH" : "LOW");
  int lo = sizeof(outputPins) / sizeof(outputPins[0]);
  for (int i=0; i<lo; i++) {
    if (outputPins[i] == pin) {
      digitalWrite(pin, value ? HIGH : LOW);
      return true;
    }
  }
  int li = sizeof(invertedOutputPins) / sizeof(invertedOutputPins[0]);
  for (int i=0; i<li; i++) {
    if (invertedOutputPins[i] == pin) {
      digitalWrite(pin, value ? LOW : HIGH);
      return true;
    }
  }
  return false;
}

char* ip2CharArray(IPAddress ip) {
  char a[16];
  sprintf(a, "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
  return a;
}

// **************
//    Command processing
// **************
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.print("processing command ");
  Serial.write(payload, length);
  Serial.print("...");
  StaticJsonDocument<128> docCommand;
  DeserializationError error = deserializeJson(docCommand, payload, length);

  if (error) {
    client.publish(logTopic, error.c_str());
    Serial.print(" failed");
    Serial.print(error.c_str());
    Serial.println("");
    return;
  }
  Serial.println(" parsed");

  int pin = docCommand["pin"];
  int value = docCommand["value"];
  if (!setPinValue(pin, value)) {
    client.publish(logTopic, "invalid pin for output");
    Serial.println("invalid pin for output");
    return;
  }

  StaticJsonDocument<128> doc;
  
  doc["t"] = "oc";
  doc["p"] = pin;
  doc["v"] = value; 
  
  char buffer[256];
  size_t len = serializeJson(doc, buffer);
  client.publish(publishTopic, buffer, len);
}

boolean pubStatus() {
  Serial.print("publishing status...");
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
    Serial.print(" done: ");
    Serial.write(buffer, len);
    Serial.println("");
  } else {
    Serial.println(" failed");
  }

  return res;
}

void pubInputChange(int idx, int pin, int lastValue, int value) {
  Serial.print("INPUT CHANGE");
  Serial.print(pin);
  Serial.print(": ");
  Serial.println(value ? "HIGH" : "LOW");

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
    delay(250);
  }
  for (int i=0; i<li; i++) {
    digitalWrite(invertedOutputPins[i], LOW);
    delay(250);
  }
  
  // deactivate all output
  for (int i=0; i<lo; i++) {
    digitalWrite(outputPins[i], LOW);
    delay(250);
  }
  for (int i=0; i<li; i++) {
    digitalWrite(invertedOutputPins[i], HIGH);
    delay(250);
  }
}

void setup()
{
  Serial.begin(57600);
  Serial.println("initializing...");
  delay(100);

  int li = sizeof(inputPins) / sizeof(inputPins[0]);
  for (int i=0; i<li; i++) {
    pinMode(inputPins[i], INPUT_PULLUP);
  }
  int lo = sizeof(outputPins) / sizeof(outputPins[0]);
  for (int i=0; i<lo; i++) {
    pinMode(outputPins[i], OUTPUT);
    digitalWrite(outputPins[i], LOW);
  }
  int lio = sizeof(invertedOutputPins) / sizeof(invertedOutputPins[0]);
  for (int i=0; i<lio; i++) {
    pinMode(invertedOutputPins[i], OUTPUT);
    digitalWrite(invertedOutputPins[i], HIGH);
  }

  if (peripheralPin != 0) {
    Serial.print(" activating peripherials...");
    pinMode(peripheralPin, OUTPUT);
    digitalWrite(peripheralPin, HIGH);
    Serial.println(" done");
    delay(10);
  }

  Serial.print(" initializing ethernet...");
  Ethernet.init(ethernetPin);
  Serial.println(" done");
  delay(100);

  testPeripherials();
  delay(100);

  client.setServer(mqttBrokerServer, mqttBrokerPort);
  client.setCallback(mqttCallback);

  state = STATE_INIT;
}

void loop() {
  if (Ethernet.linkStatus() != LinkON) {
    Serial.print(" waiting for link...");
    while (Ethernet.linkStatus() != LinkON) {
      Serial.print(".");
      delay(1000);
    }
    Serial.println(" up");
    state = STATE_LINK_UP;
    delay(100);
    return;
  }

  // maintain dhcp lease if needed
  switch (Ethernet.maintain()) {
    case 0: // nothing done
//      if (!client.connected() && state > STATE_ETHERNET_UP) {
//        state = STATE_ETHERNET_UP;
//        return;
//      }
      break;
    case 1: // renew failed
      Serial.println("dhcp renew failed");
      state = STATE_LINK_UP;
      return;
    case 2: // renew success
      Serial.print("dhcp renew success: ");
      Serial.print(Ethernet.localIP());
      Serial.println();
      state = STATE_ETHERNET_UP;
      return;
    case 3: // rebind failed
      Serial.println("dhcp rebind failed");
      state = STATE_LINK_UP;
      return;
    case 4: // rebind success
      Serial.print("dhcp rebind success: ");
      Serial.print(Ethernet.localIP());
      Serial.println();
      state = STATE_ETHERNET_UP;
      return;
  }

  switch (state) {
    case STATE_INIT:
      state = STATE_LINK_UP;
      return;
    case STATE_LINK_UP:
      Serial.print(" dhcp...");
      if (Ethernet.begin(mac) == 0) {
        Serial.print(" failed, using static ip");
        Ethernet.begin(mac, ip, dns, gw, sn);
        delay(500);
        return;
      }
      Serial.println(" done");
      state = STATE_ETHERNET_UP;
      delay(1000);
      return;
    case STATE_ETHERNET_UP:
      Serial.print(" broker...");
      if (client.connect(mqttClientName/*, mqttBrokerUsername, mqttBrokerPassword*/)) {
        Serial.println("connected");
        state = STATE_CONNECTED;
        delay(100);
      } else {
        Serial.print("failed, rc=");
        Serial.print(client.state());
        Serial.println(" try again in 5 seconds");
        delay(5000);
      }
      return;
    case STATE_CONNECTED:
      Serial.print(" subscribing...");
      if (client.subscribe(subscribeTopic)) {
        Serial.println(" done");
        state = STATE_SUBSCRIBED;
        delay(100);
        return;
      }
      Serial.println(" failed");
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
      if (now - lastStatus > statusInterval) {
        pubStatus();
      }
      client.loop();
      readInputs();
      return;
  }
}
