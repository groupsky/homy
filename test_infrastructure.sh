#!/bin/bash

set -eux

source example.env

TIMEOUT=3

export DOMAIN=

dc="docker-compose --env-file example.env"
dct="$dc --file docker-compose.yml --file docker-compose.test.yml"
vpn="$dct run test-vpn"
ext="$dct run test-external"

$dct up --build --force-recreate --no-start

echo start regular containers
$dc up --detach

echo wait for ingress to boot
timeout ${TIMEOUT}s bash -c "while ! docker inspect $INGRESS_NAME | grep '\"Status\": \"running\"' > /dev/null; do true; done"

echo ingress works across vpn
$vpn bash -c "sleep ${TIMEOUT}; curl -m ${TIMEOUT} -H 'Host: whoami.$DOMAIN' ${INGRESS_ADDRESS}"

echo ingress not accessible outside vpn
$ext sh -c "sleep ${TIMEOUT}; ! curl -m ${TIMEOUT} -H 'Host: whoami.$DOMAIN' ${INGRESS_ADDRESS}"

## TODO
#echo vpn allows access between clients
#$dct up --detach test-vpn2
#timeout ${TIMEOUT}s bash -c "while ! docker inspect homy_test-vpn2_1 | grep '\"Status\": \"running\"' > /dev/null; do true; done"
#$vpn bash -c "sleep ${TIMEOUT}; ping -c 1 -W ${TIMEOUT} ${VPN_SUBNET/%.0/.3}"
