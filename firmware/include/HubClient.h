#pragma once
#include <WiFi.h>
#include <HTTPClient.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include "Storage.h"
#include "RelayManager.h"
#include "SwitchTypes.h"
#include "SwitchManager.h"
#include "Debug.h"
#include "Config.h"

class HubClient
{
public:
    bool connected = false;
    bool authenticated = false;

    void begin(DeviceConfig &cfg, RelayManager &relays, SwitchManager &switches)
    {
        _cfg = &cfg;
        _relays = &relays;
        _switches = &switches;
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
            rBuf[rCount++] = {r["id"], r["pin"], r["label"], r["state"]};
        }
        _relays->applyServerConfig(rBuf, rCount);
        _relays->printAll();

        DBG_HUB("Registered — deviceId: %s  relays: %d", _cfg->deviceId.c_str(), rCount);
        DBG_HEAP();
        return true;
    }

    // ── WebSocket connect ─────────────────────────────────────
    void connectWebSocket()
    {
        uint16_t wsPort = WS_PORT_OVERRIDE > 0 ? WS_PORT_OVERRIDE : _cfg->serverPort;
        DBG_WS("Connecting to %s:%d", _cfg->serverHost.c_str(), wsPort);

        _resetState();

        if (_cfg->serverSecure)
        {
            _ws.beginSSL(_cfg->serverHost.c_str(), wsPort, "/");
        }
        else
        {
            _ws.begin(_cfg->serverHost.c_str(), wsPort, "/");
        }

        _ws.onEvent([this](WStype_t type, uint8_t *payload, size_t length)
                    { _onEvent(type, payload, length); });

        _ws.setReconnectInterval(WS_RECONNECT_INTERVAL_MS);
        _lastActivity = millis();
    }

    // ── Main loop — call every loop() ────────────────────────
    void loop()
    {
        _ws.loop();

        uint32_t now = millis();

        if (authenticated)
        {
            // Watchdog: if no ping from server within 90s (3× the 30s interval), force reconnect
            if (now - _lastActivity > 90000)
            {
                DBG_WARN("Watchdog: no activity for %lums — forcing reconnect", now - _lastActivity);
                _forceReconnect();
            }
        }
        else if (connected)
        {
            // Connected but not yet authenticated — watchdog for stuck auth
            if (now - _lastActivity > AUTH_TIMEOUT_MS)
            {
                DBG_WARN("Auth timeout (%dms) — forcing reconnect", AUTH_TIMEOUT_MS);
                _forceReconnect();
            }
        }
        else
        {
            // Not connected — log retry status every 10s
            static uint32_t lastLog = 0;
            if (now - lastLog >= 10000)
            {
                DBG_WS("Not connected — retrying every %dms", WS_RECONNECT_INTERVAL_MS);
                lastLog = now;
            }
        }
    }

    // Reset flags only — called from main when WiFi drops
    void disconnect()
    {
        _relays->flush();
        _resetState();
    }

    // Public so main.cpp switch callback can send acks directly
    void sendRelayAck(const String &relayId, bool state)
    {
        _sendRelayAck(relayId, state);
    }

    // Send switch trigger to server — server resolves cross-device relay
    void sendSwitchTrigger(const String &linkedRelayId, bool desiredState, bool isToggle)
    {
        if (!authenticated)
        {
            DBG_WARN("switch_trigger: not authenticated — ignored");
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
    static constexpr uint16_t WS_PORT_OVERRIDE = 4001;
    static constexpr const char *FIRMWARE_VERSION = "1.2.0";
    static constexpr uint32_t AUTH_TIMEOUT_MS = 10000; // 10s to get auth_ok after connect

    WebSocketsClient _ws;
    DeviceConfig *_cfg = nullptr;
    RelayManager *_relays = nullptr;
    SwitchManager *_switches = nullptr;
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
            DBG_WS("TCP connected — sending auth");
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
            DBG_ERR("WS error — will reconnect");
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
                rBuf[rCount++] = {r["id"], r["pin"], r["label"], r["state"]};
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
                swBuf[swCount].switchType = [&]() { String st = d["switchType"] | "two_way"; return st == "momentary" ? SWITCH_MOMENTARY : st == "three_way" ? SWITCH_THREE_WAY : SWITCH_TWO_WAY; }();
                swBuf[swCount].linkedRelayId = d["linkedRelayId"].as<String>();
                swCount++;
            }
            _switches->applyServerConfig(swBuf, swCount);
            DBG_WS("auth_ok — %d relay(s)  %d switch(es)", rCount, swCount);
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
                DBG_WARN("relay_cmd before auth — ignored");
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
            // Server ping carries authoritative relay states — sync and ack
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
                            DBG_WS("ping sync: skip %s — changed %lums ago",
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
            _sendPingAck();
            DBG_HEAP();
        }

        else if (strcmp(type, "relay_add") == 0)
        {
            if (!authenticated)
            {
                DBG_WARN("relay_add before auth — ignored");
                return;
            }
            if (_relays->count >= MAX_RELAYS)
            {
                DBG_WARN("relay_add: at max");
                return;
            }
            JsonObject r = doc["relay"].as<JsonObject>();
            RelayConfig nr = {r["id"], r["pin"], r["label"], r["state"]};
            _relays->relays[_relays->count] = nr;
            _relays->count++;
            _relays->applyServerConfig(_relays->relays, _relays->count);
            DBG_WS("relay_add: id=%s pin=%d", nr.id.c_str(), nr.pin);
        }

        else if (strcmp(type, "relay_update_config") == 0)
        {
            if (!authenticated)
            {
                DBG_WARN("relay_update_config before auth — ignored");
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
                    // If pin changed: set old pin HIGH (off) before reassigning
                    if (oldPin != newPin && oldPin != 0)
                    {
                        pinMode(oldPin, INPUT); // release old pin
                        DBG_RELAY("relay_update_config: released GPIO%d", oldPin);
                    }
                    _relays->relays[i].pin = newPin;
                    _relays->relays[i].label = newLabel;
                    _relays->relays[i].state = newState;
                    // Re-init with new pin
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
                DBG_WARN("switch_add before auth — ignored");
                return;
            }
            JsonObject d = doc["switch"].as<JsonObject>();
            SwitchConfig nd;
            nd.id = d["id"].as<String>();
            nd.pin = d["pin"].as<uint8_t>();
            nd.label = d["label"].as<String>();
            nd.switchType = [&]() { String st = d["switchType"] | "two_way"; return st == "momentary" ? SWITCH_MOMENTARY : st == "three_way" ? SWITCH_THREE_WAY : SWITCH_TWO_WAY; }();
            nd.linkedRelayId = d["linkedRelayId"].as<String>();
            _switches->add(nd);
            DBG_WS("switch_add: id=%s pin=%d", nd.id.c_str(), nd.pin);
        }

        else if (strcmp(type, "switch_update_config") == 0)
        {
            if (!authenticated)
            {
                DBG_WARN("switch_update_config before auth — ignored");
                return;
            }
            JsonObject d = doc["switch"].as<JsonObject>();
            SwitchConfig updated;
            updated.id = d["id"].as<String>();
            updated.pin = d["pin"].as<uint8_t>();
            updated.label = d["label"].as<String>();
            updated.switchType = [&]() { String st = d["switchType"] | "two_way"; return st == "momentary" ? SWITCH_MOMENTARY : st == "three_way" ? SWITCH_THREE_WAY : SWITCH_TWO_WAY; }();
            updated.linkedRelayId = d["linkedRelayId"].as<String>();
            _switches->updateById(updated.id, updated);
            DBG_WS("switch_update_config: id=%s pin=%d", updated.id.c_str(), updated.pin);
        }

        else if (strcmp(type, "switch_delete") == 0)
        {
            if (!authenticated)
            {
                DBG_WARN("switch_delete before auth — ignored");
                return;
            }
            String switchId = doc["switchId"].as<String>();
            _switches->deleteById(switchId);
            DBG_WS("switch_delete: id=%s", switchId.c_str());
        }

        else
        {
            DBG_WARN("Unknown type: %s", type);
        }
    }
};