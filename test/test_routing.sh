#!/bin/bash

set -eux

TIMEOUT=3
EXTERNAL_SUBNET=203.0.113.0/24
prefix=tr

source ../example.env

export DOMAIN=

dc="docker-compose --env-file ../example.env -f ../docker-compose.yml"

sudo iptables-save > /tmp/iptables.backup

clean_up () {
    ARG=$?
    set +e
    echo "> cleaning"

    $dc stop

    sudo ip link delete ${prefix}-veth0
    sudo ip netns del ${prefix}-internal

    sudo ip link delete ${prefix}-veth1
    sudo ip netns del ${prefix}-external

    sudo iptables-restore < /tmp/iptables.backup

    exit $ARG
}
trap clean_up EXIT

sudo ip netns > /dev/null

$dc up --build --force-recreate --no-start

echo start regular containers
$dc up --detach

echo "> configuring internal"
sudo ip netns add ${prefix}-internal
sudo ip link add ${prefix}-veth0 type veth peer netns ${prefix}-internal name ${prefix}-veth0p
sudo ip address add ${LOCAL_SUBNET/.0\//.1\/} dev ${prefix}-veth0
sudo ip link set ${prefix}-veth0 up
sudo ip -n ${prefix}-internal address add ${LOCAL_SUBNET/.0\//.2\/} dev ${prefix}-veth0p
sudo ip -n ${prefix}-internal link set ${prefix}-veth0p up
sudo ip -n ${prefix}-internal route add default via ${LOCAL_SUBNET/.0\/*/.1}

echo "> configuring external"
sudo ip netns add ${prefix}-external
sudo ip link add ${prefix}-veth1 type veth peer netns ${prefix}-external name ${prefix}-veth1p
sudo ip address add ${EXTERNAL_SUBNET/.0\//.1\/} dev ${prefix}-veth1
sudo ip link set ${prefix}-veth1 up
sudo ip -n ${prefix}-external address add ${EXTERNAL_SUBNET/.0\//.2\/} dev ${prefix}-veth1p
sudo ip -n ${prefix}-external link set ${prefix}-veth1p up
sudo ip -n ${prefix}-external route add default via ${EXTERNAL_SUBNET/.0\/*/.1}

echo "> enabling routing from internal"
sudo iptables -I DOCKER-USER -i ${prefix}-veth0 -s ${LOCAL_SUBNET} -d ${INGRESS_ADDRESS}/32 -j ACCEPT

echo "> wait for ingress to boot"
timeout ${TIMEOUT}s bash -c "while ! docker inspect $INGRESS_NAME | grep '\"Status\": \"running\"' > /dev/null; do true; done" || $dc start ingress
timeout ${TIMEOUT}s bash -c "while ! docker inspect $INGRESS_NAME | grep '\"Status\": \"running\"' > /dev/null; do true; done" || $dc start ingress
timeout ${TIMEOUT}s bash -c "while ! docker inspect $INGRESS_NAME | grep '\"Status\": \"running\"' > /dev/null; do true; done"

echo "> running tests"
ping -c 1 -W ${TIMEOUT} ${INGRESS_ADDRESS}
sudo ip netns exec ${prefix}-internal ping -c 1 -W ${TIMEOUT} ${INGRESS_ADDRESS}
! sudo ip netns exec ${prefix}-external ping -c 1 -W ${TIMEOUT} ${INGRESS_ADDRESS}
