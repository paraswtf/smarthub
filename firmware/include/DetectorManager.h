#pragma once
#include <Arduino.h>
#include "Config.h"
#include "Debug.h"
#include "Storage.h"
#include "DetectorTypes.h"

// Callback type — called when a detector triggers with (relayId, newState)
using DetectorCallback = void (*)(const String &relayId, bool newState, bool isToggle);

// ── ISR state (file-scope, not inside a class) ────────────────────
// Xtensa IRAM literal-pool relocations fail for C++ static class
// methods. Plain free functions link correctly.
static DRAM_ATTR volatile uint8_t _det_isrFlags = 0;
static DRAM_ATTR volatile uint32_t _det_isrTimestamp[MAX_DETECTORS] = {0};
static constexpr uint32_t DET_ISR_DEBOUNCE_MS = 80;

static void IRAM_ATTR _detMomentaryISR(void *arg)
{
    uint8_t idx = (uint8_t)(uintptr_t)arg;
    uint32_t now = millis();
    if (now - _det_isrTimestamp[idx] < DET_ISR_DEBOUNCE_MS)
        return;
    _det_isrTimestamp[idx] = now;
    _det_isrFlags |= (1 << idx);
}

/**
 * DetectorManager — input-pin monitoring for physical switches.
 *
 * Two strategies depending on switch type:
 *
 *   LATCHING  — polling + software debounce (stable state detection).
 *   MOMENTARY — hardware interrupt on RISING edge + cooldown.
 *               A 200-400ms VCC pulse is too short for reliable polling
 *               when hub.loop() can block for tens of ms. The ISR catches
 *               the edge instantly; loop() processes the flag with a
 *               cooldown to reject EMI / contact-bounce noise.
 */
class DetectorManager
{
public:
    uint8_t count = 0;
    DetectorConfig detectors[MAX_DETECTORS];

    void begin(DetectorCallback cb)
    {
        _callback = cb;
        for (uint8_t i = 0; i < MAX_DETECTORS; i++)
        {
            _lastState[i] = -1;
            _pendingState[i] = -1;
            _lastChange[i] = 0;
            _lastMomentaryFire[i] = 0;
            _confirmHigh[i] = 0;
            _confirmTotal[i] = 0;
            _waitRelease[i] = false;
            _det_isrFlags &= ~(1 << i);
        }
        count = Storage::loadDetectors(detectors);
        DBG_RELAY("Loaded %d detector(s) from NVS", count);
        for (uint8_t i = 0; i < count; i++)
            _initPin(i);
    }

    void applyServerConfig(const DetectorConfig newDetectors[], uint8_t newCount)
    {
        // Detach all existing interrupts before reconfiguring
        for (uint8_t i = 0; i < count; i++)
            _releasePin(i);

        count = newCount;
        DBG_RELAY("Applying %d detector(s) from server", count);
        for (uint8_t i = 0; i < count; i++)
        {
            detectors[i] = newDetectors[i];
            _lastState[i] = -1;
            _pendingState[i] = -1;
            _lastChange[i] = 0;
            _lastMomentaryFire[i] = 0;
            _confirmHigh[i] = 0;
            _confirmTotal[i] = 0;
            _waitRelease[i] = false;
            _det_isrFlags &= ~(1 << i);
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
        _lastMomentaryFire[count] = 0;
        _confirmHigh[count] = 0;
        _confirmTotal[count] = 0;
        _waitRelease[count] = false;
        _det_isrFlags &= ~(1 << count);
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
                _releasePin(i);
                detectors[i] = updated;
                _lastState[i] = -1;
                _pendingState[i] = -1;
                _lastMomentaryFire[i] = 0;
                _confirmHigh[i] = 0;
                _confirmTotal[i] = 0;
                _waitRelease[i] = false;
                _det_isrFlags &= ~(1 << i);
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
                _releasePin(i);
                // Shift array left
                for (uint8_t j = i; j < count - 1; j++)
                {
                    detectors[j] = detectors[j + 1];
                    _lastState[j] = _lastState[j + 1];
                    _pendingState[j] = _pendingState[j + 1];
                    _lastChange[j] = _lastChange[j + 1];
                    _lastMomentaryFire[j] = _lastMomentaryFire[j + 1];
                    _confirmHigh[j] = _confirmHigh[j + 1];
                    _confirmTotal[j] = _confirmTotal[j + 1];
                    _waitRelease[j] = _waitRelease[j + 1];
                    // Re-attach interrupt with updated index for momentary
                    if (detectors[j].switchType == SWITCH_MOMENTARY && detectors[j].pin != 0)
                    {
                        detachInterrupt(digitalPinToInterrupt(detectors[j].pin));
                        attachInterruptArg(
                            digitalPinToInterrupt(detectors[j].pin),
                            _detMomentaryISR, (void *)(uintptr_t)j, RISING);
                    }
                }
                count--;
                Storage::saveDetectors(detectors, count);
                DBG_RELAY("Detector deleted: id=%s", id.c_str());
                return;
            }
        }
    }

    /**
     * Call every loop() — handles both switch types:
     *   LATCHING:  polls pin, software debounce, fires on stable change.
     *   MOMENTARY: checks ISR flag, verifies cooldown, fires toggle.
     */
    void loop(const bool relayStates[], const String relayIds[], uint8_t relayCount,
              uint32_t debounceMs = 50)
    {
        uint32_t now = millis();
        uint8_t flags = _det_isrFlags; // snapshot volatile once

        for (uint8_t i = 0; i < count; i++)
        {
            if (detectors[i].pin == 0)
                continue;

            // ── MOMENTARY: interrupt-driven ────────────────────────
            if (detectors[i].switchType == SWITCH_MOMENTARY)
            {
                bool needsConfirm = _isInputOnly(detectors[i].pin);

                // ── Release gate: pin must return to LOW before next trigger ─
                // Prevents release-bounce from firing a second trigger.
                if (_waitRelease[i])
                {
                    if (digitalRead(detectors[i].pin) == LOW)
                        _waitRelease[i] = false;
                    // Drain any ISR flags that fired during the press/release
                    _det_isrFlags &= ~(1 << i);
                    continue;
                }

                // ── Already confirming? (input-only pins only) ──────
                if (_confirmTotal[i] > 0)
                {
                    _confirmHigh[i] += (digitalRead(detectors[i].pin) == HIGH) ? 1 : 0;
                    _confirmTotal[i]++;

                    if (_confirmTotal[i] < CONFIRM_SAMPLES)
                        continue; // need more samples

                    bool pass = (_confirmHigh[i] >= CONFIRM_THRESHOLD);
                    _confirmTotal[i] = 0;
                    _confirmHigh[i] = 0;

                    if (!pass)
                        continue; // noise — not a real press

                    _fireMomentary(i, now, relayStates, relayIds, relayCount);
                    continue;
                }

                // ── New ISR flag? ───────────────────────────────────
                if (!(flags & (1 << i)))
                    continue;

                _det_isrFlags &= ~(1 << i);

                // Cooldown — reject triggers too close together
                if (now - _lastMomentaryFire[i] < MOMENTARY_COOLDOWN_MS)
                    continue;

                if (needsConfirm)
                {
                    // Input-only pin (34-39): no internal pull, need confirmation
                    _confirmHigh[i] = (digitalRead(detectors[i].pin) == HIGH) ? 1 : 0;
                    _confirmTotal[i] = 1;
                }
                else
                {
                    // Pin 0-33: internal pulldown works — verify pin is still
                    // HIGH (filters crosstalk spikes from adjacent wires)
                    if (digitalRead(detectors[i].pin) == HIGH)
                        _fireMomentary(i, now, relayStates, relayIds, relayCount);
                }
                continue;
            }

            // ── LATCHING: poll + debounce ──────────────────────────
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
            DBG_RELAY("Latching[%d] pin=%d → %s", i, detectors[i].pin, logical ? "HIGH" : "LOW");

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

    // Latching state
    int _lastState[MAX_DETECTORS];
    int _pendingState[MAX_DETECTORS];
    uint32_t _lastChange[MAX_DETECTORS];

    // Momentary interrupt state
    uint32_t _lastMomentaryFire[MAX_DETECTORS]; // last time callback actually fired
    bool _waitRelease[MAX_DETECTORS];           // true = pin must go LOW before next trigger

    // Non-blocking confirmation: samples accumulated across loop() iterations.
    // A real 200-400ms VCC press reads HIGH on every sample.
    // A floating pin (GPIO 34-39 without pull resistor) reads ~50% HIGH —
    // fails the threshold.  Zero blocking, one digitalRead per loop pass.
    uint8_t _confirmHigh[MAX_DETECTORS];  // HIGH reads during confirmation
    uint8_t _confirmTotal[MAX_DETECTORS]; // total reads (0 = not confirming)

    static constexpr uint32_t MOMENTARY_COOLDOWN_MS = 150; // min gap between accepted triggers
    static constexpr uint8_t CONFIRM_SAMPLES = 6;          // total reads before evaluating (input-only pins)
    static constexpr uint8_t CONFIRM_THRESHOLD = 5;        // min HIGH reads required (83%)

    // GPIO 34-39 on ESP32 are input-only and have NO internal pull resistors.
    // INPUT_PULLDOWN / INPUT_PULLUP silently does nothing on these pins.
    static bool _isInputOnly(uint8_t pin) { return pin >= 34 && pin <= 39; }

    // Fire a momentary trigger — shared by fast path and confirmation path
    void _fireMomentary(uint8_t i, uint32_t now,
                        const bool relayStates[], const String relayIds[], uint8_t relayCount)
    {
        _lastMomentaryFire[i] = now;
        _waitRelease[i] = true; // must see LOW before next trigger
        DBG_RELAY("Momentary[%d] pin=%d TRIGGERED", i, detectors[i].pin);

        if (!_callback)
            return;

        if (detectors[i].mode == DETECTOR_FOLLOW)
        {
            _callback(detectors[i].linkedRelayId, true, false);
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

    void _initPin(uint8_t i)
    {
        if (detectors[i].pin == 0)
            return;

        if (detectors[i].switchType == SWITCH_MOMENTARY)
        {
            // Momentary: float=LOW, press=VCC=HIGH
            // Use interrupt to catch short pulses reliably
            if (_isInputOnly(detectors[i].pin))
            {
                pinMode(detectors[i].pin, INPUT); // pulldown has no effect on 34-39
                DBG_WARN("GPIO%d is input-only — NO internal pull. "
                         "Add external 10k pull-down resistor!",
                         detectors[i].pin);
            }
            else
            {
                pinMode(detectors[i].pin, INPUT_PULLDOWN);
            }
            _det_isrTimestamp[i] = 0;
            _det_isrFlags &= ~(1 << i);
            attachInterruptArg(
                digitalPinToInterrupt(detectors[i].pin),
                _detMomentaryISR, (void *)(uintptr_t)i, RISING);
            DBG_RELAY("Detector init GPIO%-2d MOMENTARY (ISR RISING) label=%s",
                      detectors[i].pin, detectors[i].label.c_str());
        }
        else
        {
            // Latching: poll-based
            uint8_t mode = (detectors[i].pullMode == DETECTOR_PULLUP) ? INPUT_PULLUP : INPUT_PULLDOWN;
            pinMode(detectors[i].pin, mode);
            DBG_RELAY("Detector init GPIO%-2d LATCHING pull=%s label=%s",
                      detectors[i].pin,
                      detectors[i].pullMode == DETECTOR_PULLUP ? "UP" : "DOWN",
                      detectors[i].label.c_str());
        }
    }

    void _releasePin(uint8_t i)
    {
        if (detectors[i].pin == 0)
            return;
        if (detectors[i].switchType == SWITCH_MOMENTARY)
            detachInterrupt(digitalPinToInterrupt(detectors[i].pin));
        pinMode(detectors[i].pin, INPUT);
    }
};