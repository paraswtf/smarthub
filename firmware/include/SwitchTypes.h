#pragma once
#include <Arduino.h>

#define MAX_SWITCHES 8

enum SwitchType : uint8_t
{
    SWITCH_TWO_WAY = 0,   // SPST: VCC ↔ floating (INPUT_PULLDOWN)
    SWITCH_THREE_WAY = 1, // SPDT: VCC ↔ GND (INPUT, no pull needed)
    SWITCH_MOMENTARY = 2, // push button: VCC on press (INPUT_PULLDOWN + ISR RISING)
};

struct SwitchConfig
{
    String id;
    uint8_t pin;
    String label;
    SwitchType switchType;
    String linkedRelayId;
};
