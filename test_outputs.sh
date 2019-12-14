#!/bin/bash

function pub() {
    mosquitto_pub -t /homy/ard1/output -m "{\"pin\":$1,\"value\":$2}"
    sleep 15
}

state=1

while true; do

    pub 14 $state
    sleep 0.25
    pub 15 $state
    sleep 0.25
    pub 16 $state
    sleep 0.25
    pub 17 $state
    sleep 0.25
    pub 18 $state
    sleep 0.25
    pub 19 $state
    sleep 0.25
    pub 20 $state
    sleep 0.25
    pub 21 $state
    sleep 0.25

    pub 62 $state
    sleep 0.25
    pub 63 $state
    sleep 0.25
    pub 64 $state
    sleep 0.25
    pub 65 $state
    sleep 0.25
    pub 66 $state
    sleep 0.25
    pub 67 $state
    sleep 0.25
    pub 68 $state
    sleep 0.25
    pub 69 $state
    sleep 0.25

    if [ $state == 1 ]; then state=0; else state=1; fi

done
