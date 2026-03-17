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

struct DetectorConfig
{
    String id;
    uint8_t pin;
    String label;
    DetectorMode mode;
    DetectorPull pullMode;
    String linkedRelayId;
};