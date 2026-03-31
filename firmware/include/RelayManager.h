#pragma once
#include <Arduino.h>
#include "Storage.h"
#include "Debug.h"
#include "Config.h"

class RelayManager
{
public:
    uint8_t count = 0;
    RelayConfig relays[MAX_RELAYS];

    void begin()
    {
        count = Storage::loadRelays(relays);
        DBG_RELAY("Loaded %d relay(s) from NVS", count);
        for (uint8_t i = 0; i < count; i++)
            _initPin(i);
    }

    // Apply relay list received from server — always persist (source of truth)
    void applyServerConfig(const RelayConfig newRelays[], uint8_t newCount)
    {
        count = newCount;
        DBG_RELAY("Applying %d relay(s) from server", count);
        for (uint8_t i = 0; i < count; i++)
        {
            relays[i] = newRelays[i];
            _lastChanged[i] = 0;
            _initPin(i);
            _applyState(i);
        }
        Storage::saveRelays(relays, count);
    }

    bool setById(const String &id, bool state)
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (relays[i].id == id)
            {
                DBG_RELAY("setById: id=%s  pin=%-2d  %s → %s",
                          id.c_str(), relays[i].pin,
                          relays[i].state ? "ON" : "OFF", state ? "ON" : "OFF");
                relays[i].state = state;
                _lastChanged[i] = millis();
                _applyState(i);
                Storage::saveRelayState(i, state);
                return true;
            }
        }
        DBG_WARN("setById: relay id=%s not found", id.c_str());
        return false;
    }

    bool setByPin(uint8_t pin, bool state)
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (relays[i].pin == pin)
            {
                DBG_RELAY("setByPin: pin=%-2d  %s → %s",
                          pin, relays[i].state ? "ON" : "OFF", state ? "ON" : "OFF");
                relays[i].state = state;
                _lastChanged[i] = millis();
                _applyState(i);
                Storage::saveRelayState(i, state);
                return true;
            }
        }
        DBG_WARN("setByPin: pin %d not found", pin);
        return false;
    }

    // Re-initialise a single relay's GPIO — call after changing pin/state
    void reinitPin(uint8_t i)
    {
        if (i >= count)
            return;
        _initPin(i);
        _applyState(i);
        DBG_RELAY("reinitPin[%d] GPIO%d → %s", i, relays[i].pin, relays[i].state ? "ON" : "OFF");
    }

    // Release a relay's GPIO — call with OLD config BEFORE updating fields
    void releasePinAt(uint8_t i)
    {
        if (i >= count || relays[i].pin == 0)
            return;
        if (_isOutputCapable(relays[i].pin))
            digitalWrite(relays[i].pin, HIGH); // active-LOW → OFF
        pinMode(relays[i].pin, INPUT);
    }

    // Explicitly flush current states to NVS — call before reboot or on disconnect
    void flush()
    {
        Storage::saveRelays(relays, count);
        DBG_RELAY("Flushed %d relay(s) to NVS", count);
    }

    bool getState(const String &id) const
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (relays[i].id == id)
                return relays[i].state;
        }
        return false;
    }

    // Returns millis() timestamp of last local state change (relay_cmd or setByPin)
    uint32_t getLastChanged(const String &id) const
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (relays[i].id == id)
                return _lastChanged[i];
        }
        return 0;
    }

    void printAll() const
    {
        DBG_RELAY("── Relay table (%d) ──────────────────", count);
        for (uint8_t i = 0; i < count; i++)
        {
            DBG_RELAY("  [%d] pin=%-2d  state=%s  label=%s  id=%s",
                      i, relays[i].pin,
                      relays[i].state ? "ON " : "OFF",
                      relays[i].label.c_str(),
                      relays[i].id.c_str());
        }
    }

private:
    uint32_t _lastChanged[MAX_RELAYS] = {};

    // GPIO 34–39 are input-only on all ESP32 variants — reject them as relay pins
    static bool _isOutputCapable(uint8_t pin)
    {
        if (pin >= 34 && pin <= 39)
        {
            DBG_ERR("GPIO%d is input-only on ESP32 — cannot use as relay output", pin);
            return false;
        }
        if (pin == 0)
        {
            DBG_WARN("GPIO0 is the BOOT button — using it as a relay may prevent flashing");
        }
        return true;
    }

    void _initPin(uint8_t i)
    {
        if (relays[i].pin == 0)
            return;
        if (!_isOutputCapable(relays[i].pin))
            return;
        pinMode(relays[i].pin, OUTPUT);
        _applyState(i);
        DBG_RELAY("Init GPIO%-2d → %s  (\"%s\")",
                  relays[i].pin, relays[i].state ? "ON " : "OFF", relays[i].label.c_str());
    }

    void _applyState(uint8_t i)
    {
        if (relays[i].pin == 0)
            return;
        if (!_isOutputCapable(relays[i].pin))
            return;
        // Active-LOW: relay ON = GPIO LOW, relay OFF = GPIO HIGH
        digitalWrite(relays[i].pin, relays[i].state ? LOW : HIGH);
    }
};
