# homy
Home actuation, monitoring and automation

## Installation

Start the containers

```
docker-compose up -d
```

Node-red is available at http://localhost:1880
Home-assistant is available at http://localhost:8123
MQTT broker uses standard port mqtt://localhost:1883 with websocker ws://localhost:9001

**Important security** if using ufw to limit the access to docker exposed ports, be aware of an issue that allows unrestricted access to docker. A good solution is available at [ufw-docker](https://github.com/chaifeng/ufw-docker)
