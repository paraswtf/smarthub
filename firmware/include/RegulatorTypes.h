#pragma once
#include <Arduino.h>

#define MAX_REGULATORS     4
#define MAX_REG_OUTPUTS    8
#define MAX_REG_SPEEDS     7
#define MAX_REG_INPUTS     4
#define MAX_REG_INPUT_PINS 7

struct RegSpeedCombo
{
    uint8_t speed;                     // 1-7
    uint8_t onPins[MAX_REG_OUTPUTS];   // pins that should be ON at this speed
    uint8_t onPinCount;
};

// Regulator output config — controls GPIO output pin combos per speed level
struct RegulatorConfig
{
    String id;
    String label;
    uint8_t outputPins[MAX_REG_OUTPUTS];
    uint8_t outputPinCount;
    RegSpeedCombo speeds[MAX_REG_SPEEDS];
    uint8_t speedCount;
    uint8_t currentSpeed; // 0 = OFF
};

// Regulator input pin mapping — one GPIO per speed level
struct RegInputSpeedPin
{
    uint8_t speed; // which speed this input activates (1-7)
    uint8_t pin;   // GPIO pin number
};

// Regulator input config — monitors physical rotary switch, controls a linked regulator
struct RegulatorInputConfig
{
    String id;
    String label;
    RegInputSpeedPin pins[MAX_REG_INPUT_PINS];
    uint8_t pinCount;
    String linkedRegulatorId;
};
