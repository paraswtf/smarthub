#pragma once
#include <Arduino.h>
#include "Storage.h"
#include "Debug.h"
#include "Config.h"
#include "RegulatorTypes.h"

class RegulatorManager
{
public:
    uint8_t count = 0;
    RegulatorConfig regulators[MAX_REGULATORS];

    void begin()
    {
        count = Storage::loadRegulators(regulators);
        DBG_RELAY("RegulatorManager: loaded %d regulator(s) from NVS", count);
        for (uint8_t i = 0; i < count; i++)
        {
            _initOutputPins(i);
            _applySpeed(i);
        }
    }

    // Apply regulator list received from server - always persist (source of truth)
    void applyServerConfig(const RegulatorConfig newRegs[], uint8_t newCount)
    {
        // Release old pins
        for (uint8_t i = 0; i < count; i++)
            _releaseOutputPins(i);

        count = newCount;
        DBG_RELAY("RegulatorManager: applying %d regulator(s) from server", count);
        for (uint8_t i = 0; i < count; i++)
        {
            regulators[i] = newRegs[i];
            _lastChanged[i] = 0;
            _initOutputPins(i);
            _applySpeed(i);
        }
        Storage::saveRegulators(regulators, count);
    }

    void add(const RegulatorConfig &reg)
    {
        if (count >= MAX_REGULATORS)
            return;
        regulators[count] = reg;
        _lastChanged[count] = 0;
        _initOutputPins(count);
        _applySpeed(count);
        count++;
        Storage::saveRegulators(regulators, count);
        DBG_RELAY("RegulatorManager: added '%s' (now %d)", reg.label.c_str(), count);
    }

    void updateById(const String &id, const RegulatorConfig &updated)
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (regulators[i].id == id)
            {
                _releaseOutputPins(i);
                regulators[i] = updated;
                _initOutputPins(i);
                _applySpeed(i);
                Storage::saveRegulators(regulators, count);
                DBG_RELAY("RegulatorManager: updated '%s'", id.c_str());
                return;
            }
        }
        DBG_WARN("RegulatorManager: updateById id=%s not found", id.c_str());
    }

    void deleteById(const String &id)
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (regulators[i].id == id)
            {
                _releaseOutputPins(i);
                // Shift remaining regulators down
                for (uint8_t j = i; j < count - 1; j++)
                {
                    regulators[j] = regulators[j + 1];
                    _lastChanged[j] = _lastChanged[j + 1];
                }
                count--;
                Storage::saveRegulators(regulators, count);
                DBG_RELAY("RegulatorManager: deleted '%s' (now %d)", id.c_str(), count);
                return;
            }
        }
        DBG_WARN("RegulatorManager: deleteById id=%s not found", id.c_str());
    }

    bool setSpeedById(const String &id, uint8_t speed)
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (regulators[i].id == id)
            {
                if (regulators[i].currentSpeed == speed)
                    return true; // already at this speed
                DBG_RELAY("RegulatorManager: setSpeedById id=%s  %d → %d",
                          id.c_str(), regulators[i].currentSpeed, speed);
                regulators[i].currentSpeed = speed;
                _lastChanged[i] = millis();
                _applySpeed(i);
                Storage::saveRegulatorSpeed(i, speed);
                return true;
            }
        }
        DBG_WARN("RegulatorManager: setSpeedById id=%s not found", id.c_str());
        return false;
    }

    void flush()
    {
        Storage::saveRegulators(regulators, count);
        DBG_RELAY("RegulatorManager: flushed %d regulator(s) to NVS", count);
    }

    uint8_t getSpeed(const String &id) const
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (regulators[i].id == id)
                return regulators[i].currentSpeed;
        }
        return 0;
    }

    uint32_t getLastChanged(const String &id) const
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (regulators[i].id == id)
                return _lastChanged[i];
        }
        return 0;
    }

    void printAll() const
    {
        DBG_RELAY("── Regulator table (%d) ──────────────────", count);
        for (uint8_t i = 0; i < count; i++)
        {
            DBG_RELAY("  [%d] speed=%d  outputs=%d  label=%s  id=%s",
                      i, regulators[i].currentSpeed,
                      regulators[i].outputPinCount,
                      regulators[i].label.c_str(), regulators[i].id.c_str());
        }
    }

private:
    uint32_t _lastChanged[MAX_REGULATORS] = {};

    // GPIO 34–39 are input-only on all ESP32 variants
    static bool _isOutputCapable(uint8_t pin)
    {
        if (pin >= 34 && pin <= 39)
        {
            DBG_ERR("GPIO%d is input-only on ESP32 - cannot use as regulator output", pin);
            return false;
        }
        return true;
    }

    void _initOutputPins(uint8_t i)
    {
        for (uint8_t j = 0; j < regulators[i].outputPinCount; j++)
        {
            uint8_t pin = regulators[i].outputPins[j];
            if (pin == 0 || !_isOutputCapable(pin))
                continue;
            pinMode(pin, OUTPUT);
            digitalWrite(pin, HIGH); // active-LOW: OFF = HIGH
        }
    }

    void _applySpeed(uint8_t i)
    {
        uint8_t speed = regulators[i].currentSpeed;

        if (speed == 0)
        {
            // OFF: all output pins go HIGH (active-LOW = OFF)
            for (uint8_t j = 0; j < regulators[i].outputPinCount; j++)
            {
                uint8_t pin = regulators[i].outputPins[j];
                if (pin == 0 || !_isOutputCapable(pin))
                    continue;
                digitalWrite(pin, HIGH);
            }
            DBG_RELAY("RegulatorManager: [%d] speed=OFF (all outputs HIGH)", i);
            return;
        }

        // Find the speed combo for this speed level
        const RegSpeedCombo *combo = nullptr;
        for (uint8_t j = 0; j < regulators[i].speedCount; j++)
        {
            if (regulators[i].speeds[j].speed == speed)
            {
                combo = &regulators[i].speeds[j];
                break;
            }
        }

        if (!combo)
        {
            DBG_WARN("RegulatorManager: [%d] speed %d has no combo defined", i, speed);
            return;
        }

        // Set all output pins: ON (LOW) if in combo.onPins, OFF (HIGH) otherwise
        for (uint8_t j = 0; j < regulators[i].outputPinCount; j++)
        {
            uint8_t pin = regulators[i].outputPins[j];
            if (pin == 0 || !_isOutputCapable(pin))
                continue;

            bool shouldBeOn = false;
            for (uint8_t k = 0; k < combo->onPinCount; k++)
            {
                if (combo->onPins[k] == pin)
                {
                    shouldBeOn = true;
                    break;
                }
            }
            // Active-LOW: ON = LOW, OFF = HIGH
            digitalWrite(pin, shouldBeOn ? LOW : HIGH);
        }

        DBG_RELAY("RegulatorManager: [%d] speed=%d  (%d pins ON)", i, speed, combo->onPinCount);
    }

    void _releaseOutputPins(uint8_t i)
    {
        for (uint8_t j = 0; j < regulators[i].outputPinCount; j++)
        {
            uint8_t pin = regulators[i].outputPins[j];
            if (pin == 0 || !_isOutputCapable(pin))
                continue;
            digitalWrite(pin, HIGH); // active-LOW: OFF
            pinMode(pin, INPUT);
        }
    }
};
