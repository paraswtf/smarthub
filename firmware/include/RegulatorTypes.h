#pragma once
#include <Arduino.h>

#define MAX_REGULATORS  4
#define MAX_REG_OUTPUTS 8
#define MAX_REG_SPEEDS  7
#define MAX_REG_INPUTS  7

struct RegSpeedCombo
{
    uint8_t speed;                     // 1-7
    uint8_t onPins[MAX_REG_OUTPUTS];   // pins that should be ON at this speed
    uint8_t onPinCount;
};

struct RegInputPin
{
    uint8_t speed; // which speed this input activates (1-7)
    uint8_t pin;   // GPIO pin number
};

struct RegulatorConfig
{
    String id;
    String label;
    uint8_t outputPins[MAX_REG_OUTPUTS];
    uint8_t outputPinCount;
    RegSpeedCombo speeds[MAX_REG_SPEEDS];
    uint8_t speedCount;
    RegInputPin inputPins[MAX_REG_INPUTS];
    uint8_t inputPinCount;
    uint8_t currentSpeed; // 0 = OFF
};
