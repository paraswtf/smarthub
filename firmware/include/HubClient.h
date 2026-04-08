#pragma once
#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WiFiClientSecure.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include "Storage.h"
#include "RelayManager.h"
#include "SwitchTypes.h"
#include "SwitchManager.h"
#include "RegulatorManager.h"
#include "Debug.h"
#include "Config.h"

class HubClient
{
public:
    bool connected = false;
    bool authenticated = false;

    void begin(DeviceConfig &cfg, RelayManager &relays, SwitchManager &switches, RegulatorManager &regulators)
    {
        _cfg = &cfg;
        _relays = &relays;
        _switches = &switches;
        _regulators = &regulators;
    }

    // ── REST registration ─────────────────────────────────────
    bool registerDevice()
    {
        String url = (_cfg->serverSecure ? "https://" : "http://") + _cfg->serverHost + ":" + _cfg->serverPort + "/api/esp/register";

        DBG_HUB("POST %s", url.c_str());

        HTTPClient http;
        http.begin(url);
        http.addHeader("Content-Type", "application/json");

        JsonDocument doc;
        doc["apiKey"] = _cfg->apiKey;
        doc["macAddress"] = WiFi.macAddress();
        doc["name"] = _cfg->deviceName;
        doc["ssid"] = WiFi.SSID();
        doc["firmwareVersion"] = FIRMWARE_VERSION;
        doc["factoryReset"] = Storage::consumeFactoryResetFlag();
        doc["serverHost"] = _cfg->serverHost;
        doc["serverPort"] = _cfg->serverPort;

        String body;
        serializeJson(doc, body);
        DBG_HUB("Body: %s", body.c_str());

        int code = http.POST(body);
        DBG_HUB("HTTP %d", code);

        if (code != 200)
        {
            DBG_ERR("Registration failed: HTTP %d  %s", code, http.getString().c_str());
            http.end();
            return false;
        }

        String resp = http.getString();
        http.end();

        JsonDocument res;
        if (deserializeJson(res, resp))
        {
            DBG_ERR("Registration: JSON parse failed");
            return false;
        }

        _cfg->deviceId = res["deviceId"].as<String>();
        Storage::saveDeviceId(_cfg->deviceId);

        JsonArray serverRelays = res["relays"].as<JsonArray>();
        RelayConfig rBuf[MAX_RELAYS];
        uint8_t rCount = 0;
        for (JsonObject r : serverRelays)
        {
            if (rCount >= MAX_RELAYS)
                break;
            rBuf[rCount].id = r["id"].as<String>();
            rBuf[rCount].pin = r["pin"].as<uint8_t>();
            rBuf[rCount].label = r["label"].as<String>();
            rBuf[rCount].state = r["state"].as<bool>();
            rCount++;
        }
        _relays->applyServerConfig(rBuf, rCount);
        _relays->printAll();

        DBG_HUB("Registered - deviceId: %s  relays: %d", _cfg->deviceId.c_str(), rCount);
        DBG_HEAP();
        return true;
    }

    // ── WebSocket connect ─────────────────────────────────────
    void connectWebSocket()
    {
        uint16_t port = _cfg->serverPort;
        DBG_WS("Connecting to %s:%d (devMode=%d)", _cfg->serverHost.c_str(), port, _cfg->devMode);

        _resetState();

        if (_cfg->serverSecure)
        {
            _ws.beginSSL(_cfg->serverHost.c_str(), port, "/");
        }
        else
        {
            _ws.begin(_cfg->serverHost.c_str(), port, "/");
        }

        _ws.onEvent([this](WStype_t type, uint8_t *payload, size_t length)
                    { _onEvent(type, payload, length); });

        _ws.setReconnectInterval(WS_RECONNECT_INTERVAL_MS);
        _lastActivity = millis();
    }

    // ── Main loop - call every loop() ────────────────────────
    void loop()
    {
        _ws.loop();

        uint32_t now = millis();

        if (authenticated)
        {
            // Watchdog: if no ping from server within 90s (3× the 30s interval), force reconnect
            if (now - _lastActivity > 90000)
            {
                DBG_WARN("Watchdog: no activity for %lums - forcing reconnect", now - _lastActivity);
                _forceReconnect();
            }
        }
        else if (connected)
        {
            // Connected but not yet authenticated - watchdog for stuck auth
            if (now - _lastActivity > AUTH_TIMEOUT_MS)
            {
                DBG_WARN("Auth timeout (%dms) - forcing reconnect", AUTH_TIMEOUT_MS);
                _forceReconnect();
            }
        }
        else
        {
            // Not connected - log retry status every 10s
            static uint32_t lastLog = 0;
            if (now - lastLog >= 10000)
            {
                DBG_WS("Not connected - retrying every %dms", WS_RECONNECT_INTERVAL_MS);
                lastLog = now;
            }
        }
    }

    // Reset flags only - called from main when WiFi drops
    void disconnect()
    {
        _relays->flush();
        _regulators->flush();
        _resetState();
    }

    // Public so main.cpp switch callback can send acks directly
    void sendRelayAck(const String &relayId, bool state) { _sendRelayAck(relayId, state); }

    // Send regulator speed ack (after server command applied)
    void sendRegulatorAck(const String &regulatorId, uint8_t speed)
    {
        if (!authenticated) return;
        JsonDocument doc;
        doc["type"] = "regulator_ack";
        doc["regulatorId"] = regulatorId;
        doc["speed"] = speed;
        DBG_WS("→ regulator_ack id=%s speed=%d", regulatorId.c_str(), speed);
        _send(doc);
    }

    // Send regulator input notification (physical rotary switch changed speed)
    void sendRegulatorInput(const String &regulatorId, uint8_t speed)
    {
        if (!authenticated) return;
        JsonDocument doc;
        doc["type"] = "regulator_input";
        doc["regulatorId"] = regulatorId;
        doc["speed"] = speed;
        DBG_WS("→ regulator_input id=%s speed=%d", regulatorId.c_str(), speed);
        _send(doc);
    }

    // Send switch trigger to server - server resolves cross-device relay
    void sendSwitchTrigger(const String &linkedRelayId, bool desiredState, bool isToggle)
    {
        if (!authenticated)
        {
            DBG_WARN("switch_trigger: not authenticated - ignored");
            return;
        }
        JsonDocument doc;
        doc["type"] = "switch_trigger";
        doc["linkedRelayId"] = linkedRelayId;
        doc["desiredState"] = desiredState;
        doc["isToggle"] = isToggle;
        DBG_WS("→ switch_trigger relay=%s toggle=%d", linkedRelayId.c_str(), isToggle);
        _send(doc);
    }

private:
    static constexpr const char *FIRMWARE_VERSION = "1.5.0";
    static constexpr uint32_t AUTH_TIMEOUT_MS = 10000; // 10s to get auth_ok after connect

    WebSocketsClient _ws;
    DeviceConfig *_cfg = nullptr;
    RelayManager *_relays = nullptr;
    SwitchManager *_switches = nullptr;
    RegulatorManager *_regulators = nullptr;
    uint32_t _lastActivity = 0;

    void _resetState()
    {
        connected = false;
        authenticated = false;
    }

    void _forceReconnect()
    {
        DBG_WS("Force reconnect triggered");
        _relays->flush();
        _regulators->flush();
        _resetState();
        _ws.disconnect(); // triggers auto-reconnect via setReconnectInterval
    }

    // ── WebSocket events ──────────────────────────────────────
    void _onEvent(WStype_t type, uint8_t *payload, size_t length)
    {
        switch (type)
        {
        case WStype_DISCONNECTED:
            // Ignore stale DISCONNECTED events that fire before we've ever connected
            if (!connected && !authenticated)
                break;
            DBG_WS("Disconnected");
            _relays->flush();
            _resetState();
            break;

        case WStype_CONNECTED:
            DBG_WS("TCP connected - sending auth");
            connected = true;
            _lastActivity = millis();
            _relays->count = 0; // wipe stale IDs before auth_ok arrives
            _sendAuth();
            break;

        case WStype_TEXT:
            DBG_WS("← %.*s", (int)length, (char *)payload);
            _lastActivity = millis(); // any message = server is alive
            _handleMessage((char *)payload, length);
            break;

        case WStype_PING:
            DBG_WS("← PING");
            _lastActivity = millis();
            break;

        case WStype_PONG:
            DBG_WS("← PONG");
            _lastActivity = millis();
            break;

        case WStype_ERROR:
            DBG_ERR("WS error - will reconnect");
            _relays->flush();
            _resetState();
            break;

        default:
            break;
        }
    }

    // ── Outgoing messages ─────────────────────────────────────
    void _sendAuth()
    {
        JsonDocument doc;
        doc["type"] = "auth";
        doc["apiKey"] = _cfg->apiKey;
        doc["macAddress"] = WiFi.macAddress();
        if (_cfg->deviceId.length() > 0)
            doc["deviceId"] = _cfg->deviceId;
        DBG_WS("→ auth");
        _send(doc);
    }

    void _sendRelayAck(const String &relayId, bool state)
    {
        JsonDocument doc;
        doc["type"] = "relay_ack";
        doc["relayId"] = relayId;
        doc["state"] = state;
        DBG_WS("→ relay_ack %s → %s", relayId.c_str(), state ? "ON" : "OFF");
        _send(doc);
    }

    void _sendPingAck()
    {
        JsonDocument doc;
        doc["type"] = "ping_ack";
        DBG_WS("→ ping_ack");
        _send(doc);
    }

    void _send(JsonDocument &doc)
    {
        String out;
        serializeJson(doc, out);
        _ws.sendTXT(out);
    }

    // ── Incoming messages ─────────────────────────────────────
    void _handleMessage(const char *payload, size_t length)
    {
        JsonDocument doc;
        if (deserializeJson(doc, payload, length))
        {
            DBG_ERR("JSON parse failed");
            return;
        }

        const char *type = doc["type"];
        if (!type)
            return;

        if (strcmp(type, "auth_ok") == 0)
        {
            authenticated = true;
            _cfg->deviceId = doc["deviceId"].as<String>();
            Storage::saveDeviceId(_cfg->deviceId);

            // Apply relays
            JsonArray arr = doc["relays"].as<JsonArray>();
            RelayConfig rBuf[MAX_RELAYS];
            uint8_t rCount = 0;
            for (JsonObject r : arr)
            {
                if (rCount >= MAX_RELAYS)
                    break;
                rBuf[rCount].id = r["id"].as<String>();
                rBuf[rCount].pin = r["pin"].as<uint8_t>();
                rBuf[rCount].label = r["label"].as<String>();
                rBuf[rCount].state = r["state"].as<bool>();
                rCount++;
            }
            _relays->applyServerConfig(rBuf, rCount);
            _relays->printAll();

            // Apply switches
            JsonArray darr = doc["switches"].as<JsonArray>();
            SwitchConfig swBuf[MAX_SWITCHES];
            uint8_t swCount = 0;
            for (JsonObject d : darr)
            {
                if (swCount >= MAX_SWITCHES)
                    break;
                swBuf[swCount].id = d["id"].as<String>();
                swBuf[swCount].pin = d["pin"].as<uint8_t>();
                swBuf[swCount].label = d["label"].as<String>();
                swBuf[swCount].switchType = [&]()
                {
                    String st = d["switchType"] | "two_way";
                    if (st == "momentary")
                        return SWITCH_MOMENTARY;
                    if (st == "three_way")
                        return SWITCH_THREE_WAY;
                    return SWITCH_TWO_WAY;
                }();
                swBuf[swCount].linkedRelayId = d["linkedRelayId"].as<String>();
                swCount++;
            }
            _switches->applyServerConfig(swBuf, swCount);

            // ── Parse regulators ─────────────────────────────────
            JsonArray regArr = doc["regulators"].as<JsonArray>();
            RegulatorConfig regBuf[MAX_REGULATORS];
            uint8_t regCount = 0;
            if (!regArr.isNull())
            {
                for (JsonObject g : regArr)
                {
                    if (regCount >= MAX_REGULATORS) break;
                    auto &reg = regBuf[regCount];
                    reg.id = g["id"].as<String>();
                    reg.label = g["label"].as<String>();
                    // Output pins
                    JsonArray opArr = g["outputPins"].as<JsonArray>();
                    reg.outputPinCount = 0;
                    for (JsonVariant p : opArr)
                    {
                        if (reg.outputPinCount >= MAX_REG_OUTPUTS) break;
                        reg.outputPins[reg.outputPinCount++] = p.as<uint8_t>();
                    }
                    // Speed combos
                    JsonArray spArr = g["speeds"].as<JsonArray>();
                    reg.speedCount = 0;
                    for (JsonObject sp : spArr)
                    {
                        if (reg.speedCount >= MAX_REG_SPEEDS) break;
                        auto &combo = reg.speeds[reg.speedCount];
                        combo.speed = sp["speed"].as<uint8_t>();
                        combo.onPinCount = 0;
                        JsonArray pArr = sp["onPins"].as<JsonArray>();
                        for (JsonVariant pp : pArr)
                        {
                            if (combo.onPinCount >= MAX_REG_OUTPUTS) break;
                            combo.onPins[combo.onPinCount++] = pp.as<uint8_t>();
                        }
                        reg.speedCount++;
                    }
                    // Input pins
                    JsonArray ipArr = g["inputPins"].as<JsonArray>();
                    reg.inputPinCount = 0;
                    for (JsonObject ip : ipArr)
                    {
                        if (reg.inputPinCount >= MAX_REG_INPUTS) break;
                        reg.inputPins[reg.inputPinCount].speed = ip["speed"].as<uint8_t>();
                        reg.inputPins[reg.inputPinCount].pin = ip["pin"].as<uint8_t>();
                        reg.inputPinCount++;
                    }
                    reg.currentSpeed = g["speed"].as<uint8_t>();
                    DBG_HUB("  reg[%d] id=%s label=%s outputs=%d speeds=%d inputs=%d speed=%d",
                            regCount, reg.id.c_str(), reg.label.c_str(),
                            reg.outputPinCount, reg.speedCount, reg.inputPinCount, reg.currentSpeed);
                    regCount++;
                }
            }
            _regulators->applyServerConfig(regBuf, regCount);

            // Apply server-managed WiFi networks (wn1–wn4) if provided
            JsonArray wnArr = doc["wifiNetworks"].as<JsonArray>();
            if (!wnArr.isNull())
            {
                WifiNetworkEntry wnBuf[MAX_WIFI_NETWORKS];
                uint8_t wnCount = 0;
                for (JsonObject wn : wnArr)
                {
                    if (wnCount >= MAX_WIFI_NETWORKS)
                        break;
                    wnBuf[wnCount].ssid = wn["ssid"].as<String>();
                    wnBuf[wnCount].password = wn["password"].as<String>();
                    wnCount++;
                }
                Storage::saveExtraWifi(wnBuf, wnCount);
                _cfg->extraWifiCount = wnCount;
                for (uint8_t i = 0; i < wnCount; i++)
                    _cfg->extraWifi[i] = wnBuf[i];
                DBG_WS("auth_ok - %d extra WiFi network(s) saved", wnCount);
            }

            // Apply server config override if provided
            JsonObject scObj = doc["serverConfig"].as<JsonObject>();
            if (!scObj.isNull() && scObj["host"].as<String>().length() > 0)
            {
                String host = scObj["host"].as<String>();
                uint16_t port = scObj["port"] | _cfg->serverPort;
                bool tls = scObj["tls"] | _cfg->serverSecure;
                Storage::saveServerConfig(host, port, tls);
                DBG_WS("auth_ok - server config saved: %s:%d tls=%d", host.c_str(), port, tls);
            }

            DBG_WS("auth_ok - %d relay(s)  %d switch(es)", rCount, swCount);
        }

        else if (strcmp(type, "auth_fail") == 0)
        {
            DBG_ERR("auth_fail: %s", doc["reason"].as<const char *>());
            _forceReconnect();
        }

        else if (strcmp(type, "relay_cmd") == 0)
        {
            if (!authenticated)
            {
                DBG_WARN("relay_cmd before auth - ignored");
                return;
            }
            String id = doc["relayId"].as<String>();
            bool state = doc["state"].as<bool>();
            uint8_t pin = doc["pin"].as<uint8_t>();
            DBG_WS("relay_cmd: id=%s pin=%d → %s", id.c_str(), pin, state ? "ON" : "OFF");
            if (_relays->setById(id, state))
            {
                _sendRelayAck(id, state);
            }
            else
            {
                DBG_WARN("relay_cmd: id=%s not found", id.c_str());
            }
        }

        else if (strcmp(type, "ping") == 0)
        {
            // Server ping carries authoritative relay states - sync and ack
            JsonArray arr = doc["relays"].as<JsonArray>();
            if (!arr.isNull())
            {
                uint32_t now = millis();
                uint8_t synced = 0;
                for (JsonObject r : arr)
                {
                    String id = r["id"].as<String>();
                    bool state = r["state"].as<bool>();
                    if (_relays->getState(id) != state)
                    {
                        // Skip relays changed locally within the last 10s
                        if (now - _relays->getLastChanged(id) < 10000)
                        {
                            DBG_WS("ping sync: skip %s - changed %lums ago",
                                   id.c_str(), now - _relays->getLastChanged(id));
                            continue;
                        }
                        _relays->setById(id, state);
                        synced++;
                        DBG_WS("ping sync: %s → %s", id.c_str(), state ? "ON" : "OFF");
                    }
                }
                if (!synced)
                    DBG_WS("ping: in sync");
            }
            // Sync regulator speeds from ping
            JsonArray regPingArr = doc["regulators"].as<JsonArray>();
            if (!regPingArr.isNull())
            {
                uint32_t now2 = millis();
                for (JsonObject g : regPingArr)
                {
                    String regId = g["id"].as<String>();
                    uint8_t speed = g["speed"].as<uint8_t>();
                    if (_regulators->getSpeed(regId) != speed)
                    {
                        if (now2 - _regulators->getLastChanged(regId) < 10000)
                        {
                            DBG_WS("ping sync reg: skip %s - changed %lums ago",
                                   regId.c_str(), now2 - _regulators->getLastChanged(regId));
                            continue;
                        }
                        _regulators->setSpeedById(regId, speed);
                        DBG_WS("ping sync reg: %s → speed %d", regId.c_str(), speed);
                    }
                }
            }
            _sendPingAck();
            DBG_HEAP();
        }

        else if (strcmp(type, "relay_add") == 0)
        {
            if (!authenticated)
            {
                DBG_WARN("relay_add before auth - ignored");
                return;
            }
            if (_relays->count >= MAX_RELAYS)
            {
                DBG_WARN("relay_add: at max");
                return;
            }
            JsonObject r = doc["relay"].as<JsonObject>();
            RelayConfig nr;
            nr.id = r["id"].as<String>();
            nr.pin = r["pin"].as<uint8_t>();
            nr.label = r["label"].as<String>();
            nr.state = r["state"].as<bool>();
            _relays->relays[_relays->count] = nr;
            _relays->count++;
            _relays->applyServerConfig(_relays->relays, _relays->count);
            DBG_WS("relay_add: id=%s pin=%d", nr.id.c_str(), nr.pin);
        }

        else if (strcmp(type, "relay_update_config") == 0)
        {
            if (!authenticated)
            {
                DBG_WARN("relay_update_config before auth - ignored");
                return;
            }
            JsonObject r = doc["relay"].as<JsonObject>();
            String id = r["id"].as<String>();
            uint8_t newPin = r["pin"].as<uint8_t>();
            String newLabel = r["label"].as<String>();
            bool newState = r["state"].as<bool>();
            for (uint8_t i = 0; i < _relays->count; i++)
            {
                if (_relays->relays[i].id == id)
                {
                    uint8_t oldPin = _relays->relays[i].pin;
                    _relays->releasePinAt(i);
                    DBG_RELAY("relay_update_config: released GPIO%d", oldPin);
                    _relays->relays[i].pin = newPin;
                    _relays->relays[i].label = newLabel;
                    _relays->relays[i].state = newState;
                    _relays->reinitPin(i);
                    Storage::saveRelays(_relays->relays, _relays->count);
                    DBG_WS("relay_update_config: id=%s pin=%d→%d label=%s",
                           id.c_str(), oldPin, newPin, newLabel.c_str());
                    return;
                }
            }
            DBG_WARN("relay_update_config: id=%s not found", id.c_str());
        }

        else if (strcmp(type, "switch_add") == 0)
        {
            if (!authenticated)
            {
                DBG_WARN("switch_add before auth - ignored");
                return;
            }
            JsonObject d = doc["switch"].as<JsonObject>();
            SwitchConfig nd;
            nd.id = d["id"].as<String>();
            nd.pin = d["pin"].as<uint8_t>();
            nd.label = d["label"].as<String>();
            nd.switchType = [&]()
            {
                String st = d["switchType"] | "two_way";
                if (st == "momentary")
                    return SWITCH_MOMENTARY;
                if (st == "three_way")
                    return SWITCH_THREE_WAY;
                return SWITCH_TWO_WAY;
            }();
            nd.linkedRelayId = d["linkedRelayId"].as<String>();
            _switches->add(nd);
            DBG_WS("switch_add: id=%s pin=%d", nd.id.c_str(), nd.pin);
        }

        else if (strcmp(type, "switch_update_config") == 0)
        {
            if (!authenticated)
            {
                DBG_WARN("switch_update_config before auth - ignored");
                return;
            }
            JsonObject d = doc["switch"].as<JsonObject>();
            SwitchConfig updated;
            updated.id = d["id"].as<String>();
            updated.pin = d["pin"].as<uint8_t>();
            updated.label = d["label"].as<String>();
            updated.switchType = [&]()
            {
                String st = d["switchType"] | "two_way";
                if (st == "momentary")
                    return SWITCH_MOMENTARY;
                if (st == "three_way")
                    return SWITCH_THREE_WAY;
                return SWITCH_TWO_WAY;
            }();
            updated.linkedRelayId = d["linkedRelayId"].as<String>();
            _switches->updateById(updated.id, updated);
            DBG_WS("switch_update_config: id=%s pin=%d", updated.id.c_str(), updated.pin);
        }

        else if (strcmp(type, "switch_delete") == 0)
        {
            if (!authenticated)
            {
                DBG_WARN("switch_delete before auth - ignored");
                return;
            }
            String switchId = doc["switchId"].as<String>();
            _switches->deleteById(switchId);
            DBG_WS("switch_delete: id=%s", switchId.c_str());
        }

        // ── Regulator messages ────────────────────────────────
        else if (strcmp(type, "regulator_cmd") == 0)
        {
            if (!authenticated) { DBG_WARN("regulator_cmd before auth - ignored"); return; }
            String regulatorId = doc["regulatorId"].as<String>();
            uint8_t speed = doc["speed"].as<uint8_t>();
            DBG_WS("regulator_cmd: id=%s speed=%d", regulatorId.c_str(), speed);
            if (_regulators->setSpeedById(regulatorId, speed))
                sendRegulatorAck(regulatorId, speed);
        }

        else if (strcmp(type, "regulator_add") == 0)
        {
            if (!authenticated) { DBG_WARN("regulator_add before auth - ignored"); return; }
            JsonObject g = doc["regulator"].as<JsonObject>();
            RegulatorConfig nd;
            nd.id = g["id"].as<String>();
            nd.label = g["label"].as<String>();
            nd.outputPinCount = 0;
            for (JsonVariant p : g["outputPins"].as<JsonArray>())
            {
                if (nd.outputPinCount >= MAX_REG_OUTPUTS) break;
                nd.outputPins[nd.outputPinCount++] = p.as<uint8_t>();
            }
            nd.speedCount = 0;
            for (JsonObject sp : g["speeds"].as<JsonArray>())
            {
                if (nd.speedCount >= MAX_REG_SPEEDS) break;
                auto &combo = nd.speeds[nd.speedCount];
                combo.speed = sp["speed"].as<uint8_t>();
                combo.onPinCount = 0;
                for (JsonVariant pp : sp["onPins"].as<JsonArray>())
                {
                    if (combo.onPinCount >= MAX_REG_OUTPUTS) break;
                    combo.onPins[combo.onPinCount++] = pp.as<uint8_t>();
                }
                nd.speedCount++;
            }
            nd.inputPinCount = 0;
            for (JsonObject ip : g["inputPins"].as<JsonArray>())
            {
                if (nd.inputPinCount >= MAX_REG_INPUTS) break;
                nd.inputPins[nd.inputPinCount].speed = ip["speed"].as<uint8_t>();
                nd.inputPins[nd.inputPinCount].pin = ip["pin"].as<uint8_t>();
                nd.inputPinCount++;
            }
            nd.currentSpeed = g["speed"].as<uint8_t>();
            _regulators->add(nd);
            DBG_WS("regulator_add: id=%s label=%s", nd.id.c_str(), nd.label.c_str());
        }

        else if (strcmp(type, "regulator_update_config") == 0)
        {
            if (!authenticated) { DBG_WARN("regulator_update_config before auth - ignored"); return; }
            JsonObject g = doc["regulator"].as<JsonObject>();
            RegulatorConfig nd;
            nd.id = g["id"].as<String>();
            nd.label = g["label"].as<String>();
            nd.outputPinCount = 0;
            for (JsonVariant p : g["outputPins"].as<JsonArray>())
            {
                if (nd.outputPinCount >= MAX_REG_OUTPUTS) break;
                nd.outputPins[nd.outputPinCount++] = p.as<uint8_t>();
            }
            nd.speedCount = 0;
            for (JsonObject sp : g["speeds"].as<JsonArray>())
            {
                if (nd.speedCount >= MAX_REG_SPEEDS) break;
                auto &combo = nd.speeds[nd.speedCount];
                combo.speed = sp["speed"].as<uint8_t>();
                combo.onPinCount = 0;
                for (JsonVariant pp : sp["onPins"].as<JsonArray>())
                {
                    if (combo.onPinCount >= MAX_REG_OUTPUTS) break;
                    combo.onPins[combo.onPinCount++] = pp.as<uint8_t>();
                }
                nd.speedCount++;
            }
            nd.inputPinCount = 0;
            for (JsonObject ip : g["inputPins"].as<JsonArray>())
            {
                if (nd.inputPinCount >= MAX_REG_INPUTS) break;
                nd.inputPins[nd.inputPinCount].speed = ip["speed"].as<uint8_t>();
                nd.inputPins[nd.inputPinCount].pin = ip["pin"].as<uint8_t>();
                nd.inputPinCount++;
            }
            nd.currentSpeed = g["speed"].as<uint8_t>();
            _regulators->updateById(nd.id, nd);
            DBG_WS("regulator_update_config: id=%s", nd.id.c_str());
        }

        else if (strcmp(type, "regulator_delete") == 0)
        {
            if (!authenticated) { DBG_WARN("regulator_delete before auth - ignored"); return; }
            String regulatorId = doc["regulatorId"].as<String>();
            _regulators->deleteById(regulatorId);
            DBG_WS("regulator_delete: id=%s", regulatorId.c_str());
        }

        else if (strcmp(type, "wifi_config") == 0)
        {
            // Server pushed updated extra WiFi list - save to NVS
            JsonArray arr = doc["networks"].as<JsonArray>();
            WifiNetworkEntry wnBuf[MAX_WIFI_NETWORKS];
            uint8_t wnCount = 0;
            for (JsonObject wn : arr)
            {
                if (wnCount >= MAX_WIFI_NETWORKS)
                    break;
                wnBuf[wnCount].ssid = wn["ssid"].as<String>();
                wnBuf[wnCount].password = wn["password"].as<String>();
                wnCount++;
            }
            Storage::saveExtraWifi(wnBuf, wnCount);
            _cfg->extraWifiCount = wnCount;
            for (uint8_t i = 0; i < wnCount; i++)
                _cfg->extraWifi[i] = wnBuf[i];
            DBG_WS("wifi_config: %d network(s) saved", wnCount);
        }

        else if (strcmp(type, "server_config") == 0)
        {
            // Server pushed new host/port/TLS - save to NVS, applied on next reboot
            String host = doc["host"] | "";
            uint16_t port = doc["port"] | _cfg->serverPort;
            bool tls = doc["tls"] | _cfg->serverSecure;
            if (host.length() > 0)
            {
                Storage::saveServerConfig(host, port, tls);
                DBG_WS("server_config: %s:%d tls=%d saved - takes effect on reconnect", host.c_str(), port, tls);
            }
        }

        else if (strcmp(type, "ota_update") == 0)
        {
            // Server triggered OTA - download and flash firmware from given URL
            String url = doc["url"] | "";
            if (url.length() == 0)
            {
                DBG_ERR("ota_update: missing url");
                return;
            }
            DBG_WS("ota_update: url=%s", url.c_str());
            _performOta(url);
        }

        else
        {
            DBG_WARN("Unknown type: %s", type);
        }
    }

    // ── OTA firmware update ───────────────────────────────────
    void _sendOtaProgress(uint8_t percent)
    {
        JsonDocument doc;
        doc["type"] = "ota_progress";
        doc["percent"] = percent;
        _send(doc);
        _ws.loop(); // flush immediately
    }

    void _sendOtaResult(bool success, const String &error = "")
    {
        JsonDocument doc;
        doc["type"] = "ota_result";
        doc["success"] = success;
        if (!success && error.length() > 0)
            doc["error"] = error;
        _send(doc);
        _ws.loop();
    }

    void _performOta(const String &url)
    {
        _sendOtaProgress(0);

        // Use secure client (skip cert validation - acceptable for self-hosted IoT)
        WiFiClientSecure secureClient;
        secureClient.setInsecure();

        // Use plain client for http URLs
        WiFiClient plainClient;
        bool isHttps = url.startsWith("https://");

        httpUpdate.rebootOnUpdate(false); // send result before rebooting

        httpUpdate.onProgress([this](int cur, int total)
                              {
            if (total > 0)
            {
                uint8_t pct = (uint8_t)(100 * cur / total);
                static uint8_t lastPct = 0;
                if (pct != lastPct) // only send on change
                {
                    lastPct = pct;
                    _sendOtaProgress(pct);
                }
            } });

        t_httpUpdate_return ret;
        if (isHttps)
            ret = httpUpdate.update(secureClient, url);
        else
            ret = httpUpdate.update(plainClient, url);

        switch (ret)
        {
        case HTTP_UPDATE_FAILED:
            DBG_ERR("OTA failed: %s", httpUpdate.getLastErrorString().c_str());
            _sendOtaResult(false, httpUpdate.getLastErrorString());
            break;
        case HTTP_UPDATE_NO_UPDATES:
            DBG_WS("OTA: no update available");
            _sendOtaResult(false, "No update");
            break;
        case HTTP_UPDATE_OK:
            DBG_WS("OTA: flash complete - rebooting");
            _sendOtaProgress(100);
            _sendOtaResult(true);
            delay(500);
            ESP.restart();
            break;
        }
    }
};