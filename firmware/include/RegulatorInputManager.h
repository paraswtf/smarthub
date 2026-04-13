#pragma once
#include <Arduino.h>
#include "Storage.h"
#include "Debug.h"
#include "Config.h"
#include "RegulatorTypes.h"

using RegulatorInputCallback = void (*)(const String &linkedRegulatorId, uint8_t speed);
using RegInputSampleCallback = void (*)(const String &id, uint8_t pin, uint16_t raw);

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

    void setSampleCallback(RegInputSampleCallback cb) { _sampleCallback = cb; }

    void startCalibration(const String &id)
    {
        _calibratingId = id;
        _lastCalSample = 0;
        DBG_RELAY("RegInput cal start id=%s", id.c_str());
    }

    void stopCalibration()
    {
        if (_calibratingId.length() > 0)
            DBG_RELAY("RegInput cal stop id=%s", _calibratingId.c_str());
        _calibratingId = "";
    }

    // Call when the WS link drops to avoid streaming forever after reconnect.
    void onDisconnect() { stopCalibration(); }

    void loop()
    {
        // ── Calibration mode: stream raw ADC for one input, skip normal matching ─
        if (_calibratingId.length() > 0)
        {
            uint32_t now = millis();
            if (now - _lastCalSample < CAL_INTERVAL_MS)
                return;
            _lastCalSample = now;
            for (uint8_t i = 0; i < count; i++)
            {
                if (inputs[i].id != _calibratingId) continue;
                for (uint8_t j = 0; j < inputs[i].pinCount; j++)
                {
                    uint8_t pin = inputs[i].pins[j].pin;
                    if (pin == 0) continue;
                    uint16_t raw = analogRead(pin);
                    if (_sampleCallback)
                        _sampleCallback(_calibratingId, pin, raw);
                }
                break;
            }
            return;
        }

        for (uint8_t i = 0; i < count; i++)
        {
            if (inputs[i].pinCount == 0) continue;

            // Log all pin states every 2s for debugging
            uint32_t now = millis();
            if (now - _lastLogTime[i] >= 2000)
            {
                _lastLogTime[i] = now;
                String pinLog = "RegInput[" + String(i) + "]";
                for (uint8_t j = 0; j < inputs[i].pinCount; j++)
                {
                    uint8_t pin = inputs[i].pins[j].pin;
                    float volts = (analogRead(pin) * 3.3f) / 4095.0f;
                    pinLog += (j == 0 ? " " : " | ");
                    pinLog += "GPIO" + String(pin) + " - s" + String(inputs[i].pins[j].speed) + "=" + String(volts, 2);
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

            // Asymmetric debounce: going to a specific speed requires the longer window
            // (sweep crosstalk briefly pulls multiple pins HIGH). Going to OFF only requires
            // the shorter window since "no pin in window" is hard to false-trigger.
            if (speed != _pendingSpeed[i])
            {
                _pendingSpeed[i] = speed;
                _pendingTime[i] = now;
                continue;
            }

            uint32_t needed = (speed == 0) ? DEBOUNCE_OFF_MS : DEBOUNCE_MS;
            if ((now - _pendingTime[i]) < needed)
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
    RegInputSampleCallback _sampleCallback = nullptr;
    String _calibratingId = "";
    uint32_t _lastCalSample = 0;
    static constexpr uint32_t CAL_INTERVAL_MS = 100; // 10 Hz stream
    uint8_t _lastSpeed[MAX_REG_INPUTS] = {};
    uint8_t _pendingSpeed[MAX_REG_INPUTS] = {};
    uint32_t _pendingTime[MAX_REG_INPUTS] = {};
    uint32_t _lastLogTime[MAX_REG_INPUTS] = {};

    // Per-pin minRaw/maxRaw ADC windows are stored on each pin (configured from dashboard).
    static constexpr uint32_t DEBOUNCE_MS = 100;      // for any non-zero speed
    // OFF needs a longer wait so a between-speed sweep gap (rotary leaving one pad
    // before contacting the next) doesn't briefly fire OFF before the new speed settles.
    // Real OFF stays "no pin in window" forever, so 300ms still feels responsive.
    static constexpr uint32_t DEBOUNCE_OFF_MS = 300;

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
