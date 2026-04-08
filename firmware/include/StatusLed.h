#pragma once
#include <Arduino.h>
#include "Config.h"

enum LedMode
{
    LED_OFF,
    LED_SOLID,
    LED_BLINK_FAST, // 200 ms - AP / captive portal
    LED_BLINK_SLOW, // 1000 ms - connecting
};

class StatusLed
{
public:
    static void begin()
    {
        if (STATUS_LED_PIN < 0)
            return;
        pinMode(STATUS_LED_PIN, OUTPUT);
        set(LED_OFF);
    }

    static void set(LedMode mode)
    {
        _mode = mode;
        _lastToggle = 0;
        if (mode == LED_SOLID)
        {
            _write(true);
        }
        else if (mode == LED_OFF)
        {
            _write(false);
        }
    }

    // Call in loop() - handles non-blocking blink
    static void tick()
    {
        if (STATUS_LED_PIN < 0)
            return;
        if (_mode != LED_BLINK_FAST && _mode != LED_BLINK_SLOW)
            return;

        uint32_t interval = (_mode == LED_BLINK_FAST) ? 200 : 1000;
        uint32_t now = millis();
        if (now - _lastToggle >= interval)
        {
            _state = !_state;
            _write(_state);
            _lastToggle = now;
        }
    }

private:
    static LedMode _mode;
    static bool _state;
    static uint32_t _lastToggle;

    static void _write(bool on)
    {
        if (STATUS_LED_PIN < 0)
            return;
        digitalWrite(STATUS_LED_PIN, STATUS_LED_ACTIVE_LOW ? !on : on);
    }
};

// Static member definitions (place in a single .cpp, but header-only is fine for small projects)
LedMode StatusLed::_mode = LED_OFF;
bool StatusLed::_state = false;
uint32_t StatusLed::_lastToggle = 0;
