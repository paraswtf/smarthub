#include <Arduino.h>
#include <WiFi.h>
#include "Config.h"
#include "Debug.h"
#include "Storage.h"
#include "StatusLed.h"
#include "CaptivePortal.h"
#include "RelayManager.h"
#include "SwitchManager.h"
#include "HubClient.h"

enum State
{
    S_PORTAL,
    S_CONNECT,
    S_REGISTER,
    S_RUN
};

static State state = S_PORTAL;
static DeviceConfig cfg;
static RelayManager relays;
static SwitchManager switches;
static HubClient hub;
static CaptivePortal portal;

// ─── Switch callback ─────────────────────────────────────────
// Called by SwitchManager when an input pin changes state.
// Sends switch_trigger to the server — which finds the linked relay
// (potentially on a different device) and issues relay_cmd to it.
void onSwitchTriggered(const String &relayId, bool newState, bool isToggle)
{
    DBG_RELAY("Switch triggered: relay=%s → %s (%s)",
              relayId.c_str(), newState ? "ON" : "OFF", isToggle ? "toggle" : "follow");
    hub.sendSwitchTrigger(relayId, newState, isToggle);
}

// ─── WiFi connection ──────────────────────────────────────────
bool connectWiFi()
{
    DBG_WIFI("Connecting to \"%s\"…", cfg.wifiSSID.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.begin(cfg.wifiSSID.c_str(), cfg.wifiPassword.c_str());
    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED)
    {
        StatusLed::tick();
        delay(100);
        if (millis() - start > WIFI_CONNECT_TIMEOUT_MS)
        {
            DBG_ERR("WiFi connect timeout");
            return false;
        }
    }
    DBG_WIFI_STATUS();
    return true;
}

// ─── Setup ───────────────────────────────────────────────────
void setup()
{
    Serial.begin(115200);
    delay(200);

    DBG_BANNER("ESP Hub — Booting");
    DBG_MAIN("Chip: %s  Rev: %d  Cores: %d  Freq: %d MHz",
             ESP.getChipModel(), ESP.getChipRevision(),
             ESP.getChipCores(), getCpuFrequencyMhz());
    DBG_MAIN("Flash: %lu KB  SDK: %s", ESP.getFlashChipSize() / 1024, ESP.getSdkVersion());
    DBG_HEAP();

    StatusLed::begin();

    // Hold BOOT button (GPIO 0) during power-on for 3s to factory reset
    pinMode(0, INPUT_PULLUP);
    if (digitalRead(0) == LOW)
    {
        DBG_MAIN("BOOT button held — waiting 3s to confirm factory reset…");
        StatusLed::set(LED_BLINK_FAST);
        uint32_t held = millis();
        while (digitalRead(0) == LOW)
        {
            StatusLed::tick();
            delay(10);
            if (millis() - held > 3000)
            {
                DBG_MAIN("Factory reset confirmed — clearing NVS");
                StatusLed::set(LED_SOLID);
                Storage::clear();
                delay(500);
                ESP.restart();
            }
        }
        DBG_MAIN("BOOT released early — continuing normal boot");
    }

    bool hasConfig = Storage::load(cfg);

    if (hasConfig)
    {
        DBG_MAIN("Stored config — device: \"%s\"  server: %s:%d",
                 cfg.deviceName.c_str(), cfg.serverHost.c_str(), cfg.serverPort);
        state = S_CONNECT;
    }
    else
    {
        DBG_MAIN("No config — starting captive portal");
        state = S_PORTAL;
    }

    relays.begin();
    switches.begin(onSwitchTriggered);
    DBG_HEAP();
}

// ─── Factory reset (BOOT button) ─────────────────────────────
// Works in any state — hold GPIO 0 for 3s to wipe NVS and restart.
void checkFactoryReset()
{
    if (digitalRead(0) != LOW) return;

    DBG_MAIN("BOOT held — hold 3s for factory reset");
    StatusLed::set(LED_BLINK_FAST);
    uint32_t held = millis();
    while (digitalRead(0) == LOW)
    {
        StatusLed::tick();
        delay(10);
        if (millis() - held > 3000)
        {
            DBG_MAIN("Factory reset!");
            hub.disconnect();
            Storage::clear();
            delay(500);
            ESP.restart();
        }
    }
    DBG_MAIN("BOOT released early — ignoring");
}

// ─── Loop ────────────────────────────────────────────────────
void loop()
{
    StatusLed::tick();
    checkFactoryReset();

    switch (state)
    {

    case S_PORTAL:
        DBG_BANNER("State: CAPTIVE PORTAL");
        StatusLed::set(LED_BLINK_FAST);
        portal.run(cfg);
        break;

    case S_CONNECT:
        DBG_BANNER("State: WIFI CONNECT");
        StatusLed::set(LED_BLINK_SLOW);
        if (connectWiFi())
        {
            state = S_REGISTER;
        }
        else
        {
            static uint8_t wifiRetries = 0;
            wifiRetries++;
            DBG_WARN("WiFi failed (attempt %d/3)", wifiRetries);
            if (wifiRetries >= 3)
            {
                DBG_ERR("WiFi failed 3 times — falling back to portal");
                wifiRetries = 0;
                state = S_PORTAL;
            }
            delay(3000);
        }
        break;

    case S_REGISTER:
        DBG_BANNER("State: REGISTER");
        StatusLed::set(LED_BLINK_SLOW);
        hub.begin(cfg, relays, switches);
        if (hub.registerDevice())
        {
            hub.connectWebSocket();
            state = S_RUN;
            StatusLed::set(LED_SOLID);
            DBG_BANNER("State: RUN");
            DBG_HEAP();
        }
        else
        {
            DBG_WARN("Registration failed — retrying in 5s");
            delay(5000);
            if (WiFi.status() != WL_CONNECTED)
            {
                DBG_WARN("WiFi dropped during registration");
                state = S_CONNECT;
            }
        }
        break;

    case S_RUN:
        hub.loop();
        StatusLed::set(hub.authenticated ? LED_SOLID : LED_BLINK_SLOW);

        // Poll switches (input pins) — fires callback on state change
        if (hub.authenticated)
        {
            // Build relay state arrays for SwitchManager::loop()
            static bool relayStates[MAX_RELAYS];
            static String relayIds[MAX_RELAYS];
            for (uint8_t i = 0; i < relays.count; i++)
            {
                relayStates[i] = relays.relays[i].state;
                relayIds[i] = relays.relays[i].id;
            }
            switches.loop(relayStates, relayIds, relays.count);
        }

        if (WiFi.status() != WL_CONNECTED)
        {
            DBG_WARN("WiFi connection lost — reconnecting");
            StatusLed::set(LED_BLINK_SLOW);
            hub.disconnect();
            if (connectWiFi())
            {
                hub.connectWebSocket();
            }
            else
            {
                state = S_CONNECT;
            }
        }
        break;
    }
}