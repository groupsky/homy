# homy
Home actuation, monitoring and automation

## Installation

* Clone the repo

```bash
git clone https://github.com/groupsky/homy
cd homy
```

* Initialize the OPNVPN configuration files and certificates

```bash
docker-compose run --rm openvpn ovpn_genconfig -Ddbu udp://VPN.SERVERNAME.COM
docker-compose run --rm openvpn ovpn_initpki
```

* Start the containers

```bash
docker-compose up -d
```

* All is up and running
Node-red is available at http://localhost:1880
Home-assistant is available at http://localhost:8123
MQTT broker uses standard port mqtt://localhost:1883 with websocker ws://localhost:9001
OpenVPN listens on udp://localhost:1194

### Important security note

If using ufw to limit the access to docker exposed ports, be aware of an issue that allows unrestricted access to docker.
A good solution is available at [ufw-docker](https://github.com/chaifeng/ufw-docker)

### OpenVPN client certificates

* Generate a client certificate

```bash
export CLIENTNAME="your_client_name"
# with a passphrase (recommended)
docker-compose run --rm openvpn easyrsa build-client-full $CLIENTNAME
# without a passphrase (not recommended)
docker-compose run --rm openvpn easyrsa build-client-full $CLIENTNAME nopass
```

* Retrieve the client configuration with embedded certificates

```bash
docker-compose run --rm openvpn ovpn_getclient $CLIENTNAME > $CLIENTNAME.ovpn
```

* Revoke a client certificate

```bash
# Keep the corresponding crt, key and req files.
docker-compose run --rm openvpn ovpn_revokeclient $CLIENTNAME
# Remove the corresponding crt, key and req files.
docker-compose run --rm openvpn ovpn_revokeclient $CLIENTNAME remove
```
