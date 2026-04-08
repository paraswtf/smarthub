#pragma once
#include <Arduino.h>
#include "Storage.h"
#include "Debug.h"
#include "Config.h"
#include "RegulatorTypes.h"

// Callback: (linkedRegulatorId, speed)
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
        DBG_RELAY("RegInputManager: applying %d input(s) from server", count);
        for (uint8_t i = 0; i < count; i++)
        {
            inputs[i] = newInputs[i];
            _lastTriggered[i] = 0;
            _initPins(i);
        }
        Storage::saveRegulatorInputs(inputs, count);
    }

    void add(const RegulatorInputConfig &ri)
    {
        if (count >= MAX_REG_INPUTS)
            return;
        inputs[count] = ri;
        _lastTriggered[count] = 0;
        _initPins(count);
        count++;
        Storage::saveRegulatorInputs(inputs, count);
        DBG_RELAY("RegInputManager: added '%s' (now %d)", ri.label.c_str(), count);
    }

    void updateById(const String &id, const RegulatorInputConfig &updated)
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (inputs[i].id == id)
            {
                _releasePins(i);
                inputs[i] = updated;
                _initPins(i);
                Storage::saveRegulatorInputs(inputs, count);
                DBG_RELAY("RegInputManager: updated '%s'", id.c_str());
                return;
            }
        }
        DBG_WARN("RegInputManager: updateById id=%s not found", id.c_str());
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
                    _lastTriggered[j] = _lastTriggered[j + 1];
                    _pendingSpeed[j] = _pendingSpeed[j + 1];
                    _pendingTime[j] = _pendingTime[j + 1];
                }
                count--;
                Storage::saveRegulatorInputs(inputs, count);
                DBG_RELAY("RegInputManager: deleted '%s' (now %d)", id.c_str(), count);
                return;
            }
        }
        DBG_WARN("RegInputManager: deleteById id=%s not found", id.c_str());
    }

    // Poll input pins and fire callback on speed change
    void loop(uint32_t debounceMs = 80)
    {
        uint32_t now = millis();
        for (uint8_t i = 0; i < count; i++)
        {
            if (inputs[i].pinCount == 0)
                continue;

            // Skip input polling if recently triggered (10s cooldown to avoid
            // thrashing between physical input and server-applied speed)
            if (_lastTriggered[i] != 0 && (now - _lastTriggered[i]) < 10000)
                continue;

            // Check which input pin is HIGH (one-pin-per-speed rotary)
            uint8_t detectedSpeed = 0; // no pin HIGH = OFF
            for (uint8_t j = 0; j < inputs[i].pinCount; j++)
            {
                uint8_t pin = inputs[i].pins[j].pin;
                if (digitalRead(pin) == HIGH)
                {
                    detectedSpeed = inputs[i].pins[j].speed;
                    break; // only one pin HIGH at a time
                }
            }

            // Debounce: require stable reading
            if (detectedSpeed != _pendingSpeed[i])
            {
                _pendingSpeed[i] = detectedSpeed;
                _pendingTime[i] = now;
                continue;
            }

            if ((now - _pendingTime[i]) < debounceMs)
                continue;

            // Stable reading - send trigger if different from last known
            if (detectedSpeed != _lastSpeed[i])
            {
                DBG_RELAY("RegInputManager: input[%d] detected speed %d → %d  linked=%s",
                          i, _lastSpeed[i], detectedSpeed, inputs[i].linkedRegulatorId.c_str());
                _lastSpeed[i] = detectedSpeed;
                _lastTriggered[i] = now;
                if (_callback)
                    _callback(inputs[i].linkedRegulatorId, detectedSpeed);
            }
        }
    }

    void flush()
    {
        Storage::saveRegulatorInputs(inputs, count);
        DBG_RELAY("RegInputManager: flushed %d input(s) to NVS", count);
    }

private:
    RegulatorInputCallback _callback = nullptr;
    uint32_t _lastTriggered[MAX_REG_INPUTS] = {};
    uint8_t _pendingSpeed[MAX_REG_INPUTS] = {};
    uint32_t _pendingTime[MAX_REG_INPUTS] = {};
    uint8_t _lastSpeed[MAX_REG_INPUTS] = {};

    void _initPins(uint8_t i)
    {
        for (uint8_t j = 0; j < inputs[i].pinCount; j++)
        {
            uint8_t pin = inputs[i].pins[j].pin;
            if (pin == 0)
                continue;
            // Input-only pins (34-39) don't support internal pull-down;
            // user must add external pull-down resistor
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
            if (pin == 0)
                continue;
            pinMode(pin, INPUT);
        }
    }
};
