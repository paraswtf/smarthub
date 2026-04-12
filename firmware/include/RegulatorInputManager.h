#pragma once
#include <Arduino.h>
#include "Storage.h"
#include "Debug.h"
#include "Config.h"
#include "RegulatorTypes.h"

using RegulatorInputCallback = void (*)(const String &linkedRegulatorId, uint8_t speed);

class RegulatorInputManager
{
public:
    uint8_t count = 0;
    RegulatorInputConfig inputs[MAX_REG_INPUTS];

    void begin(RegulatorInputCallback cb)
    {
        _callback = cb;
        count = Storage::loadRegulatorInputs(inputs);
        DBG_RELAY("RegInputManager: loaded %d input(s) from NVS", count);
        for (uint8_t i = 0; i < count; i++)
            _initPins(i);
    }

    void applyServerConfig(const RegulatorInputConfig newInputs[], uint8_t newCount)
    {
        for (uint8_t i = 0; i < count; i++)
            _releasePins(i);
        count = newCount;
        for (uint8_t i = 0; i < count; i++)
        {
            inputs[i] = newInputs[i];
            _lastSpeed[i] = 0xFF;
            _initPins(i);
        }
        Storage::saveRegulatorInputs(inputs, count);
    }

    void add(const RegulatorInputConfig &ri)
    {
        if (count >= MAX_REG_INPUTS) return;
        inputs[count] = ri;
        _lastSpeed[count] = 0xFF;
        _initPins(count);
        count++;
        Storage::saveRegulatorInputs(inputs, count);
    }

    void updateById(const String &id, const RegulatorInputConfig &updated)
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (inputs[i].id == id)
            {
                _releasePins(i);
                inputs[i] = updated;
                _lastSpeed[i] = 0xFF;
                _initPins(i);
                Storage::saveRegulatorInputs(inputs, count);
                return;
            }
        }
    }

    void deleteById(const String &id)
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (inputs[i].id == id)
            {
                _releasePins(i);
                for (uint8_t j = i; j < count - 1; j++)
                {
                    inputs[j] = inputs[j + 1];
                    _lastSpeed[j] = _lastSpeed[j + 1];
                }
                count--;
                Storage::saveRegulatorInputs(inputs, count);
                return;
            }
        }
    }

    void loop()
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (inputs[i].pinCount == 0) continue;

            // Log all pin states every 2s for debugging
            uint32_t now = millis();
            if (now - _lastLogTime[i] >= 2000)
            {
                _lastLogTime[i] = now;
                String pinLog = "RegInput[" + String(i) + "] pins:";
                for (uint8_t j = 0; j < inputs[i].pinCount; j++)
                {
                    uint8_t pin = inputs[i].pins[j].pin;
                    uint16_t raw = analogRead(pin);
                    float volts = (raw * 3.3f) / 4095.0f;
                    pinLog += " GPIO" + String(pin) + "(S" + String(inputs[i].pins[j].speed) +
                              " " + String(inputs[i].pins[j].minRaw) + "-" + String(inputs[i].pins[j].maxRaw) + ")=" +
                              String(raw) + "(" + String(volts, 2) + "V)";
                }
                DBG_RELAY("%s", pinLog.c_str());
            }

            // Find first pin within its configured min/max ADC window → that pin's speed.
            // analogRead returns 0-4095 for 0-3.3V (saturates above 3.3V).
            uint8_t speed = 0;
            for (uint8_t j = 0; j < inputs[i].pinCount; j++)
            {
                uint16_t raw = analogRead(inputs[i].pins[j].pin);
                if (raw >= inputs[i].pins[j].minRaw && raw <= inputs[i].pins[j].maxRaw)
                {
                    speed = inputs[i].pins[j].speed;
                    break;
                }
            }

            // Debounce: reading must stay stable for 100ms before firing.
            // Prevents crosstalk spikes during connection/disconnection.
            if (speed != _pendingSpeed[i])
            {
                _pendingSpeed[i] = speed;
                _pendingTime[i] = now;
                continue;
            }

            if ((now - _pendingTime[i]) < DEBOUNCE_MS)
                continue;

            if (speed != _lastSpeed[i])
            {
                DBG_RELAY("RegInput[%d] speed change: %d → %d", i, _lastSpeed[i], speed);
                _lastSpeed[i] = speed;
                if (_callback)
                    _callback(inputs[i].linkedRegulatorId, speed);
            }
        }
    }

    void flush()
    {
        Storage::saveRegulatorInputs(inputs, count);
    }

private:
    RegulatorInputCallback _callback = nullptr;
    uint8_t _lastSpeed[MAX_REG_INPUTS] = {};
    uint8_t _pendingSpeed[MAX_REG_INPUTS] = {};
    uint32_t _pendingTime[MAX_REG_INPUTS] = {};
    uint32_t _lastLogTime[MAX_REG_INPUTS] = {};

    // Per-pin minRaw/maxRaw ADC windows are stored on each pin (configured from dashboard).
    static constexpr uint32_t DEBOUNCE_MS = 100;

    void _initPins(uint8_t i)
    {
        for (uint8_t j = 0; j < inputs[i].pinCount; j++)
        {
            uint8_t pin = inputs[i].pins[j].pin;
            if (pin == 0) continue;
            if (pin >= 34 && pin <= 39)
                pinMode(pin, INPUT);
            else
                pinMode(pin, INPUT_PULLDOWN);
        }
    }

    void _releasePins(uint8_t i)
    {
        for (uint8_t j = 0; j < inputs[i].pinCount; j++)
        {
            uint8_t pin = inputs[i].pins[j].pin;
            if (pin == 0) continue;
            pinMode(pin, INPUT);
        }
    }
};
