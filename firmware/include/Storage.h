#pragma once
#include <Preferences.h>
#include <Arduino.h>
#include "Config.h"
#include "Debug.h"
#include "SwitchTypes.h"

struct DeviceConfig
{
    String wifiSSID;
    String wifiPassword;
    String deviceName;
    String apiKey;
    String serverHost;
    uint16_t serverPort;
    bool serverSecure;
    String deviceId;
    bool devMode;
    uint16_t wsPort; // separate WS port (dev mode only)
};

struct RelayConfig
{
    String id;
    uint8_t pin;
    String label;
    bool state;
};

class Storage
{
public:
    static bool load(DeviceConfig &cfg)
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, true);

        cfg.wifiSSID = prefs.getString("wifi_ssid", "");
        cfg.wifiPassword = prefs.getString("wifi_pass", "");
        cfg.deviceName = prefs.getString("dev_name", "ESP32 Device");
        cfg.apiKey = prefs.getString("api_key", "");
        cfg.serverHost = prefs.getString("srv_host", "");
        cfg.serverPort = prefs.getUShort("srv_port", 3000);
        cfg.serverSecure = prefs.getBool("srv_tls", false);
        cfg.deviceId = prefs.getString("dev_id", "");
        cfg.devMode = prefs.getBool("dev_mode", false);
        cfg.wsPort = prefs.getUShort("ws_port", 4001);

        prefs.end();

        // In production mode, force port 443 + WSS
        if (!cfg.devMode)
        {
            cfg.serverPort = 443;
            cfg.serverSecure = true;
        }

        bool valid = cfg.wifiSSID.length() > 0 && cfg.apiKey.length() > 0 && cfg.serverHost.length() > 0;

        DBG_STORAGE("load() — ssid=%s  host=%s  port=%d  tls=%d  devMode=%d  wsPort=%d  deviceId=%s  valid=%d",
                    cfg.wifiSSID.c_str(), cfg.serverHost.c_str(), cfg.serverPort,
                    cfg.serverSecure, cfg.devMode, cfg.wsPort, cfg.deviceId.c_str(), valid);

        return valid;
    }

    static void save(const DeviceConfig &cfg)
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);

        prefs.putString("wifi_ssid", cfg.wifiSSID);
        prefs.putString("wifi_pass", cfg.wifiPassword);
        prefs.putString("dev_name", cfg.deviceName);
        prefs.putString("api_key", cfg.apiKey);
        prefs.putString("srv_host", cfg.serverHost);
        prefs.putUShort("srv_port", cfg.serverPort);
        prefs.putBool("srv_tls", cfg.serverSecure);
        prefs.putBool("dev_mode", cfg.devMode);
        prefs.putUShort("ws_port", cfg.wsPort);

        prefs.end();
        DBG_STORAGE("save() — ssid=%s  host=%s:%d  tls=%d  devMode=%d  wsPort=%d",
                    cfg.wifiSSID.c_str(), cfg.serverHost.c_str(), cfg.serverPort,
                    cfg.serverSecure, cfg.devMode, cfg.wsPort);
    }

    static void saveDeviceId(const String &id)
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        prefs.putString("dev_id", id);
        prefs.end();
        DBG_STORAGE("saveDeviceId() — %s", id.c_str());
    }

    static void saveRelays(const RelayConfig relays[], uint8_t count)
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        prefs.putUChar("relay_cnt", count);
        for (uint8_t i = 0; i < count && i < MAX_RELAYS; i++)
        {
            String p = "r" + String(i) + "_";
            prefs.putString((p + "id").c_str(), relays[i].id);
            prefs.putUChar((p + "pin").c_str(), relays[i].pin);
            prefs.putString((p + "lbl").c_str(), relays[i].label);
            prefs.putBool((p + "st").c_str(), relays[i].state);
        }
        prefs.end();
        DBG_STORAGE("saveRelays() — %d relay(s)", count);
    }

    // Write only the state of a single relay by index — much lower flash wear
    // than saveRelays() since only one bool is written instead of the full array.
    static void saveRelayState(uint8_t index, bool state)
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        String key = "r" + String(index) + "_st";
        prefs.putBool(key.c_str(), state);
        prefs.end();
        DBG_STORAGE("saveRelayState(%d) → %d", index, state);
    }

    static uint8_t loadRelays(RelayConfig relays[])
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, true);
        uint8_t count = prefs.getUChar("relay_cnt", 0);
        for (uint8_t i = 0; i < count && i < MAX_RELAYS; i++)
        {
            String p = "r" + String(i) + "_";
            relays[i].id = prefs.getString((p + "id").c_str(), "");
            relays[i].pin = prefs.getUChar((p + "pin").c_str(), 0);
            relays[i].label = prefs.getString((p + "lbl").c_str(), "Relay");
            relays[i].state = prefs.getBool((p + "st").c_str(), false);
            DBG_STORAGE("  relay[%d] pin=%-2d state=%d label=%s",
                        i, relays[i].pin, relays[i].state, relays[i].label.c_str());
        }
        prefs.end();
        return count;
    }

    static void clear()
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        prefs.clear();                      // wipes everything
        prefs.putBool("factory_rst", true); // write flag AFTER clear so it survives
        prefs.end();
        DBG_STORAGE("clear() — NVS wiped, factory reset flag set");
    }

    // Returns true once after a factory reset, then clears the flag
    static bool consumeFactoryResetFlag()
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        bool flag = prefs.getBool("factory_rst", false);
        if (flag)
            prefs.remove("factory_rst");
        prefs.end();
        return flag;
    }

    // ── Switch storage ───────────────────────────────────────
    // Forward-declare SwitchConfig (defined in SwitchTypes.h)

    static void saveSwitches(const struct SwitchConfig sw[], uint8_t count)
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        prefs.putUChar("det_cnt", count);
        for (uint8_t i = 0; i < count && i < 8; i++)
        {
            String p = "d" + String(i) + "_";
            prefs.putString((p + "id").c_str(), sw[i].id);
            prefs.putUChar((p + "pin").c_str(), sw[i].pin);
            prefs.putString((p + "lbl").c_str(), sw[i].label);
            prefs.putUChar((p + "swt").c_str(), (uint8_t)sw[i].switchType);
            prefs.putString((p + "rid").c_str(), sw[i].linkedRelayId);
        }
        prefs.end();
        DBG_STORAGE("saveSwitches() — %d switch(es)", count);
    }

    static uint8_t loadSwitches(struct SwitchConfig sw[])
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, true);
        uint8_t count = prefs.getUChar("det_cnt", 0);
        for (uint8_t i = 0; i < count && i < 8; i++)
        {
            String p = "d" + String(i) + "_";
            sw[i].id = prefs.getString((p + "id").c_str(), "");
            sw[i].pin = prefs.getUChar((p + "pin").c_str(), 0);
            sw[i].label = prefs.getString((p + "lbl").c_str(), "Switch");
            sw[i].switchType = (SwitchType)prefs.getUChar((p + "swt").c_str(), 0);
            sw[i].linkedRelayId = prefs.getString((p + "rid").c_str(), "");
            DBG_STORAGE("  sw[%d] pin=%d type=%d label=%s", i, sw[i].pin, sw[i].switchType, sw[i].label.c_str());
        }
        prefs.end();
        return count;
    }
};