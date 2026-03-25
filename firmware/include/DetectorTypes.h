#pragma once
#include <Arduino.h>

#define MAX_DETECTORS 8

enum DetectorMode : uint8_t
{
    DETECTOR_TOGGLE = 0,
    DETECTOR_FOLLOW = 1,
};

enum DetectorPull : uint8_t
{
    DETECTOR_PULLUP = 0,
    DETECTOR_PULLDOWN = 1,
};

enum DetectorSwitch : uint8_t
{
    SWITCH_LATCHING = 0,  // always between VCC and GND — toggle on any stable change
    SWITCH_MOMENTARY = 1, // floats when released, VCC when pressed — toggle on rising edge only
};

struct DetectorConfig
{
    String id;
    uint8_t pin;
    String label;
    DetectorMode mode;
    DetectorPull pullMode;
    DetectorSwitch switchType;
    String linkedRelayId;
};