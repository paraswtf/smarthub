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
static RegulatorManager regulators;
static RegulatorInputManager regInputs;
static HubClient hub;
static CaptivePortal portal;

// ─── Serial config receiver ──────────────────────────────────
// Processes PING and CONFIG:{json} lines from the USB-connected dashboard.
// Non-blocking: reads whatever bytes are available and returns immediately.
// Called from the top of loop() AND injected into CaptivePortal's blocking
// while-loop via tickCb so USB config works in any device state.
static String _serialBuf;

void handleSerial()
{
    while (Serial.available())
    {
        char c = (char)Serial.read();
        if (c == '\r') continue;
        if (c == '\n')
        {
            _serialBuf.trim();

            if (_serialBuf == "PING")
            {
                Serial.println("SMARTHUB_PONG");
            }
            else if (_serialBuf.startsWith("CONFIG:"))
            {
                String json = _serialBuf.substring(7);
                JsonDocument doc;
                DeserializationError err = deserializeJson(doc, json);
                if (err)
                {
                    Serial.print("SMARTHUB_ERR:invalid json: ");
                    Serial.println(err.c_str());
                }
                else
                {
                    const char *apiKey   = doc["apiKey"]     | "";
                    const char *ssid     = doc["ssid"]       | "";
                    const char *password = doc["password"]   | "";
                    const char *name     = doc["name"]       | "ESP32 Device";
                    const char *host     = doc["serverHost"] | "";
                    uint16_t    port     = doc["serverPort"] | (uint16_t)3000;
                    bool        devMode  = doc["devMode"]    | false;

                    if (strlen(apiKey) < 4 || strlen(ssid) == 0 || strlen(host) == 0)
                    {
                        Serial.println("SMARTHUB_ERR:missing required fields (apiKey, ssid, serverHost)");
                    }
                    else
                    {
                        DeviceConfig newCfg;
                        newCfg.apiKey         = apiKey;
                        newCfg.wifiSSID       = ssid;
                        newCfg.wifiPassword   = password;
                        newCfg.deviceName     = strlen(name) > 0 ? name : "ESP32 Device";
                        newCfg.serverHost     = host;
                        newCfg.serverPort     = port;
                        newCfg.serverSecure   = !devMode;
                        newCfg.devMode        = devMode;
                        newCfg.extraWifiCount = 0;
                        Storage::save(newCfg);
                        DBG_MAIN("USB config applied — rebooting");
                        Serial.println("SMARTHUB_OK");
                        Serial.flush(); // wait for TX buffer to drain before reboot
                        delay(800);
                        ESP.restart();
                    }
                }
            }

            _serialBuf = "";
        }
        else if (_serialBuf.length() < 1024)
        {
            _serialBuf += c;
        }
    }
}

// ─── Switch callback ─────────────────────────────────────────
// Called by SwitchManager when an input pin changes state.
// Sends switch_trigger to the server - which finds the linked relay
// (potentially on a different device) and issues relay_cmd to it.
void onSwitchTriggered(const String &relayId, const String &regulatorId, bool newState, bool isToggle)
{
    DBG_RELAY("Switch triggered: relay=%s reg=%s → %s (%s)",
              relayId.c_str(), regulatorId.c_str(),
              newState ? "ON" : "OFF", isToggle ? "toggle" : "follow");
    hub.sendSwitchTrigger(relayId, regulatorId, newState, isToggle);
}

// Regulator input callback - physical rotary switch changed speed
// Sends regulator_input_trigger to server with linkedRegulatorId
void onRegulatorInputTriggered(const String &linkedRegulatorId, uint8_t speed)
{
    DBG_RELAY("Regulator input triggered: linked=%s → speed %d", linkedRegulatorId.c_str(), speed);
    hub.sendRegulatorInputTrigger(linkedRegulatorId, speed);
}

// Reg input calibration sample callback - forward raw ADC reading to server
void onRegInputCalibrationSample(const String &id, uint8_t pin, uint16_t raw)
{
    hub.sendRegInputCalibrationSample(id, pin, raw);
}

// ─── WiFi connection ──────────────────────────────────────────
// Tries the captive-portal primary network (wn0), then server-managed extras (wn1–wn4).
bool connectWiFi()
{
    WiFi.mode(WIFI_STA);

    // Build ordered list: wn0 first, then extra networks
    const uint8_t total = 1 + cfg.extraWifiCount;
    for (uint8_t attempt = 0; attempt < total; attempt++)
    {
        const char *ssid = (attempt == 0) ? cfg.wifiSSID.c_str() : cfg.extraWifi[attempt - 1].ssid.c_str();
        const char *pass = (attempt == 0) ? cfg.wifiPassword.c_str() : cfg.extraWifi[attempt - 1].password.c_str();

        DBG_WIFI("Trying network %d/%d: \"%s\"…", attempt + 1, total, ssid);
        WiFi.begin(ssid, pass);

        uint32_t start = millis();
        while (WiFi.status() != WL_CONNECTED)
        {
            StatusLed::tick();
            delay(100);
            if (millis() - start > WIFI_CONNECT_TIMEOUT_MS)
            {
                DBG_WARN("Network \"%s\" timed out", ssid);
                WiFi.disconnect(true);
                delay(200);
                break;
            }
        }

        if (WiFi.status() == WL_CONNECTED)
        {
            DBG_WIFI_STATUS();
            return true;
        }
    }

    DBG_ERR("All %d WiFi network(s) failed", total);
    return false;
}

// ─── Setup ───────────────────────────────────────────────────
void setup()
{
    Serial.begin(115200);
    delay(200);

    DBG_BANNER("SmartHUB - Booting");
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
        DBG_MAIN("BOOT button held - waiting 3s to confirm factory reset…");
        StatusLed::set(LED_BLINK_FAST);
        uint32_t held = millis();
        while (digitalRead(0) == LOW)
        {
            StatusLed::tick();
            delay(10);
            if (millis() - held > 3000)
            {
                DBG_MAIN("Factory reset confirmed - clearing NVS");
                StatusLed::set(LED_SOLID);
                Storage::clear();
                delay(500);
                ESP.restart();
            }
        }
        DBG_MAIN("BOOT released early - continuing normal boot");
    }

    bool hasConfig = Storage::load(cfg);

    if (hasConfig)
    {
        DBG_MAIN("Stored config - device: \"%s\"  server: %s:%d",
                 cfg.deviceName.c_str(), cfg.serverHost.c_str(), cfg.serverPort);
        state = S_CONNECT;
    }
    else
    {
        DBG_MAIN("No config - starting captive portal");
        state = S_PORTAL;
    }

    relays.begin();
    switches.begin(onSwitchTriggered);
    regulators.begin();
    regInputs.begin(onRegulatorInputTriggered);
    regInputs.setSampleCallback(onRegInputCalibrationSample);
    DBG_HEAP();
}

// ─── Factory reset (BOOT button) ─────────────────────────────
// Works in any state - hold GPIO 0 for 3s to wipe NVS and restart.
void checkFactoryReset()
{
    if (digitalRead(0) != LOW)
        return;

    DBG_MAIN("BOOT held - hold 3s for factory reset");
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
    DBG_MAIN("BOOT released early - ignoring");
}

// ─── Loop ────────────────────────────────────────────────────
void loop()
{
    handleSerial();
    StatusLed::tick();
    checkFactoryReset();

    switch (state)
    {

    case S_PORTAL:
        DBG_BANNER("State: CAPTIVE PORTAL");
        StatusLed::set(LED_BLINK_FAST);
        portal.run(cfg, handleSerial);
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
            // Exponential backoff: 3s, 6s, 12s, capped at 30s
            uint32_t backoff = min(3000UL << min(wifiRetries, (uint8_t)4), 30000UL);
            DBG_WARN("WiFi failed (attempt %d) - retrying in %lums", wifiRetries, backoff);
            uint32_t wait = millis();
            while (millis() - wait < backoff)
            {
                checkFactoryReset();
                StatusLed::tick();
                delay(10);
            }
        }
        break;

    case S_REGISTER:
        DBG_BANNER("State: REGISTER");
        StatusLed::set(LED_BLINK_SLOW);
        hub.begin(cfg, relays, switches, regulators, regInputs);
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
            DBG_WARN("Registration failed - retrying in 5s");
            uint32_t wait = millis();
            while (millis() - wait < 5000)
            {
                checkFactoryReset();
                StatusLed::tick();
                delay(10);
            }
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

        // Poll switches (input pins) - fires callback on state change
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
            regInputs.loop();
        }

        if (WiFi.status() != WL_CONNECTED)
        {
            DBG_WARN("WiFi connection lost - reconnecting");
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