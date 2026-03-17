#pragma once
#include <Arduino.h>
#include "Config.h"
#include "Debug.h"
#include "Storage.h"
#include "DetectorTypes.h"

// Callback type — called when a detector triggers with (relayId, newState)
using DetectorCallback = void (*)(const String &relayId, bool newState, bool isToggle);

class DetectorManager
{
public:
    uint8_t count = 0;
    DetectorConfig detectors[MAX_DETECTORS];

    void begin(DetectorCallback cb)
    {
        _callback = cb;
        // Sentinel -1 means "not yet sampled" — prevents false trigger on boot
        for (uint8_t i = 0; i < MAX_DETECTORS; i++)
        {
            _lastState[i] = -1;
            _pendingState[i] = -1;
            _lastChange[i] = 0;
        }
        count = Storage::loadDetectors(detectors);
        DBG_RELAY("Loaded %d detector(s) from NVS", count);
        for (uint8_t i = 0; i < count; i++)
            _initPin(i);
    }

    void applyServerConfig(const DetectorConfig newDetectors[], uint8_t newCount)
    {
        count = newCount;
        DBG_RELAY("Applying %d detector(s) from server", count);
        for (uint8_t i = 0; i < count; i++)
        {
            detectors[i] = newDetectors[i];
            _lastState[i] = -1;
            _pendingState[i] = -1;
            _lastChange[i] = 0;
            _initPin(i);
        }
        Storage::saveDetectors(detectors, count);
    }

    // Add a single detector without rebuilding everything
    void add(const DetectorConfig &d)
    {
        if (count >= MAX_DETECTORS)
            return;
        detectors[count] = d;
        _lastState[count] = -1;
        _pendingState[count] = -1;
        _lastChange[count] = 0;
        _lastState[count] = -1;
        _initPin(count);
        count++;
        Storage::saveDetectors(detectors, count);
        DBG_RELAY("Detector added: id=%s pin=%d mode=%s", d.id.c_str(), d.pin, d.mode == DETECTOR_TOGGLE ? "toggle" : "follow");
    }

    // Update an existing detector by id
    void updateById(const String &id, const DetectorConfig &updated)
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (detectors[i].id == id)
            {
                if (detectors[i].pin != updated.pin)
                {
                    pinMode(detectors[i].pin, INPUT); // release old pin
                }
                detectors[i] = updated;
                _lastState[i] = -1;
                _initPin(i);
                Storage::saveDetectors(detectors, count);
                DBG_RELAY("Detector updated: id=%s pin=%d", id.c_str(), updated.pin);
                return;
            }
        }
    }

    // Remove a detector by id
    void deleteById(const String &id)
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (detectors[i].id == id)
            {
                pinMode(detectors[i].pin, INPUT); // release pin
                // Shift array left
                for (uint8_t j = i; j < count - 1; j++)
                {
                    detectors[j] = detectors[j + 1];
                    _lastState[j] = _lastState[j + 1];
                }
                count--;
                Storage::saveDetectors(detectors, count);
                DBG_RELAY("Detector deleted: id=%s", id.c_str());
                return;
            }
        }
    }

    // Call every loop() — polls all input pins, fires callback on stable change.
    void loop(const bool relayStates[], const String relayIds[], uint8_t relayCount,
              uint32_t debounceMs = 50)
    {
        uint32_t now = millis();
        for (uint8_t i = 0; i < count; i++)
        {
            if (detectors[i].pin == 0)
                continue;

            int raw = digitalRead(detectors[i].pin);
            int logical = (detectors[i].pullMode == DETECTOR_PULLUP) ? !raw : raw;

            if (_lastState[i] == -1)
            {
                _lastState[i] = logical;
                _pendingState[i] = logical;
                _lastChange[i] = now;
                continue;
            }

            if (logical != _pendingState[i])
            {
                _pendingState[i] = logical;
                _lastChange[i] = now;
                continue;
            }

            if (logical == _lastState[i])
                continue;
            if (now - _lastChange[i] < debounceMs)
                continue;

            _lastState[i] = logical;
            DBG_RELAY("Detector[%d] pin=%d → %s", i, detectors[i].pin, logical ? "HIGH" : "LOW");

            if (!_callback)
                continue;

            if (detectors[i].mode == DETECTOR_FOLLOW)
            {
                _callback(detectors[i].linkedRelayId, (bool)logical, false);
            }
            else
            {
                bool currentState = false;
                for (uint8_t j = 0; j < relayCount; j++)
                {
                    if (relayIds[j] == detectors[i].linkedRelayId)
                    {
                        currentState = relayStates[j];
                        break;
                    }
                }
                _callback(detectors[i].linkedRelayId, !currentState, true);
            }
        }
    }

private:
    DetectorCallback _callback = nullptr;
    int _lastState[MAX_DETECTORS];
    int _pendingState[MAX_DETECTORS];
    uint32_t _lastChange[MAX_DETECTORS];

    void _initPin(uint8_t i)
    {
        if (detectors[i].pin == 0)
            return;
        uint8_t mode = INPUT;
        if (detectors[i].pullMode == DETECTOR_PULLUP)
            mode = INPUT_PULLUP;
        if (detectors[i].pullMode == DETECTOR_PULLDOWN)
            mode = INPUT_PULLDOWN;
        pinMode(detectors[i].pin, mode);
        DBG_RELAY("Detector init GPIO%-2d mode=%s label=%s",
                  detectors[i].pin,
                  detectors[i].pullMode == DETECTOR_PULLUP ? "PULLUP" : detectors[i].pullMode == DETECTOR_PULLDOWN ? "PULLDOWN"
                                                                                                                   : "FLOAT",
                  detectors[i].label.c_str());
    }
};