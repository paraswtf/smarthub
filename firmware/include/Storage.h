#pragma once
#include <Preferences.h>
#include <Arduino.h>
#include "Config.h"
#include "Debug.h"
#include "SwitchTypes.h"
#include "RegulatorTypes.h"

struct WifiNetworkEntry
{
    String ssid;
    String password;
};

struct DeviceConfig
{
    String wifiSSID;
    String wifiPassword;
    WifiNetworkEntry extraWifi[MAX_WIFI_NETWORKS]; // server-managed (wn1–wn4)
    uint8_t extraWifiCount;
    String deviceName;
    String apiKey;
    String serverHost;
    uint16_t serverPort;
    bool serverSecure;
    String deviceId;
    bool devMode;
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

        // Load server-managed extra WiFi networks (wn1–wn4)
        cfg.extraWifiCount = prefs.getUChar("wn_cnt", 0);
        for (uint8_t i = 0; i < cfg.extraWifiCount && i < MAX_WIFI_NETWORKS; i++)
        {
            String p = "wn" + String(i + 1) + "_";
            cfg.extraWifi[i].ssid = prefs.getString((p + "ssid").c_str(), "");
            cfg.extraWifi[i].password = prefs.getString((p + "pass").c_str(), "");
        }

        prefs.end();

        // In production mode, force port 443 + WSS
        if (!cfg.devMode)
        {
            cfg.serverPort = 443;
            cfg.serverSecure = true;
        }

        bool valid = cfg.wifiSSID.length() > 0 && cfg.apiKey.length() > 0 && cfg.serverHost.length() > 0;

        DBG_STORAGE("load() - ssid=%s  host=%s  port=%d  tls=%d  devMode=%d  deviceId=%s  valid=%d",
                    cfg.wifiSSID.c_str(), cfg.serverHost.c_str(), cfg.serverPort,
                    cfg.serverSecure, cfg.devMode, cfg.deviceId.c_str(), valid);

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

        prefs.end();
        DBG_STORAGE("save() - ssid=%s  host=%s:%d  tls=%d  devMode=%d",
                    cfg.wifiSSID.c_str(), cfg.serverHost.c_str(), cfg.serverPort,
                    cfg.serverSecure, cfg.devMode);
    }

    static void saveDeviceId(const String &id)
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        prefs.putString("dev_id", id);
        prefs.end();
        DBG_STORAGE("saveDeviceId() - %s", id.c_str());
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
        DBG_STORAGE("saveRelays() - %d relay(s)", count);
    }

    // Write only the state of a single relay by index - much lower flash wear
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
        DBG_STORAGE("clear() - NVS wiped, factory reset flag set");
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
            prefs.putString((p + "gid").c_str(), sw[i].linkedRegulatorId);
        }
        prefs.end();
        DBG_STORAGE("saveSwitches() - %d switch(es)", count);
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
            sw[i].linkedRegulatorId = prefs.getString((p + "gid").c_str(), "");
            DBG_STORAGE("  sw[%d] pin=%d type=%d label=%s", i, sw[i].pin, sw[i].switchType, sw[i].label.c_str());
        }
        prefs.end();
        return count;
    }

    // ── Server-managed WiFi networks (wn1–wn4) ──────────────
    static void saveExtraWifi(const WifiNetworkEntry networks[], uint8_t count)
    {
        if (count > MAX_WIFI_NETWORKS)
            count = MAX_WIFI_NETWORKS;
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        prefs.putUChar("wn_cnt", count);
        for (uint8_t i = 0; i < count; i++)
        {
            String p = "wn" + String(i + 1) + "_";
            prefs.putString((p + "ssid").c_str(), networks[i].ssid);
            prefs.putString((p + "pass").c_str(), networks[i].password);
        }
        prefs.end();
        DBG_STORAGE("saveExtraWifi() - %d network(s)", count);
    }

    // ── Regulator storage ─────────────────────────────────────

    static void saveRegulators(const RegulatorConfig regs[], uint8_t count)
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        prefs.putUChar("reg_cnt", count);
        for (uint8_t i = 0; i < count && i < MAX_REGULATORS; i++)
        {
            String p = "g" + String(i) + "_";
            prefs.putString((p + "id").c_str(), regs[i].id);
            prefs.putString((p + "lbl").c_str(), regs[i].label);
            prefs.putUChar((p + "opc").c_str(), regs[i].outputPinCount);
            for (uint8_t j = 0; j < regs[i].outputPinCount && j < MAX_REG_OUTPUTS; j++)
                prefs.putUChar((p + "op" + String(j)).c_str(), regs[i].outputPins[j]);
            prefs.putUChar((p + "spc").c_str(), regs[i].speedCount);
            for (uint8_t j = 0; j < regs[i].speedCount && j < MAX_REG_SPEEDS; j++)
            {
                String sp = p + "s" + String(j) + "_";
                prefs.putUChar((sp + "spd").c_str(), regs[i].speeds[j].speed);
                prefs.putUChar((sp + "cnt").c_str(), regs[i].speeds[j].onPinCount);
                for (uint8_t k = 0; k < regs[i].speeds[j].onPinCount && k < MAX_REG_OUTPUTS; k++)
                    prefs.putUChar((sp + "p" + String(k)).c_str(), regs[i].speeds[j].onPins[k]);
            }
            prefs.putUChar((p + "spd").c_str(), regs[i].currentSpeed);
        }
        prefs.end();
        DBG_STORAGE("saveRegulators() - %d regulator(s)", count);
    }

    static void saveRegulatorSpeed(uint8_t index, uint8_t speed)
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        String key = "g" + String(index) + "_spd";
        prefs.putUChar(key.c_str(), speed);
        prefs.end();
        DBG_STORAGE("saveRegulatorSpeed(%d) → %d", index, speed);
    }

    static uint8_t loadRegulators(RegulatorConfig regs[])
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, true);
        uint8_t count = prefs.getUChar("reg_cnt", 0);
        for (uint8_t i = 0; i < count && i < MAX_REGULATORS; i++)
        {
            String p = "g" + String(i) + "_";
            regs[i].id = prefs.getString((p + "id").c_str(), "");
            regs[i].label = prefs.getString((p + "lbl").c_str(), "Regulator");
            regs[i].outputPinCount = prefs.getUChar((p + "opc").c_str(), 0);
            for (uint8_t j = 0; j < regs[i].outputPinCount && j < MAX_REG_OUTPUTS; j++)
                regs[i].outputPins[j] = prefs.getUChar((p + "op" + String(j)).c_str(), 0);
            regs[i].speedCount = prefs.getUChar((p + "spc").c_str(), 0);
            for (uint8_t j = 0; j < regs[i].speedCount && j < MAX_REG_SPEEDS; j++)
            {
                String sp = p + "s" + String(j) + "_";
                regs[i].speeds[j].speed = prefs.getUChar((sp + "spd").c_str(), 0);
                regs[i].speeds[j].onPinCount = prefs.getUChar((sp + "cnt").c_str(), 0);
                for (uint8_t k = 0; k < regs[i].speeds[j].onPinCount && k < MAX_REG_OUTPUTS; k++)
                    regs[i].speeds[j].onPins[k] = prefs.getUChar((sp + "p" + String(k)).c_str(), 0);
            }
            regs[i].currentSpeed = prefs.getUChar((p + "spd").c_str(), 0);
            DBG_STORAGE("  reg[%d] outputs=%d speeds=%d currentSpeed=%d label=%s",
                        i, regs[i].outputPinCount, regs[i].speedCount,
                        regs[i].currentSpeed, regs[i].label.c_str());
        }
        prefs.end();
        return count;
    }

    // ── Regulator input storage ──────────────────────────────────
    // NVS keys: ri_cnt, ri<i>_id, ri<i>_lbl, ri<i>_pc, ri<i>_p<j>_spd, ri<i>_p<j>_pin, ri<i>_lrid

    static void saveRegulatorInputs(const RegulatorInputConfig ris[], uint8_t count)
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        prefs.putUChar("ri_cnt", count);
        for (uint8_t i = 0; i < count && i < MAX_REG_INPUTS; i++)
        {
            String p = "ri" + String(i) + "_";
            prefs.putString((p + "id").c_str(), ris[i].id);
            prefs.putString((p + "lbl").c_str(), ris[i].label);
            prefs.putString((p + "lrid").c_str(), ris[i].linkedRegulatorId);
            prefs.putUChar((p + "pc").c_str(), ris[i].pinCount);
            for (uint8_t j = 0; j < ris[i].pinCount && j < MAX_REG_INPUT_PINS; j++)
            {
                String pp = p + "p" + String(j) + "_";
                prefs.putUChar((pp + "spd").c_str(), ris[i].pins[j].speed);
                prefs.putUChar((pp + "pin").c_str(), ris[i].pins[j].pin);
                prefs.putUShort((pp + "min").c_str(), ris[i].pins[j].minRaw);
                prefs.putUShort((pp + "max").c_str(), ris[i].pins[j].maxRaw);
            }
        }
        prefs.end();
        DBG_STORAGE("saveRegulatorInputs() - %d input(s)", count);
    }

    static uint8_t loadRegulatorInputs(RegulatorInputConfig ris[])
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, true);
        uint8_t count = prefs.getUChar("ri_cnt", 0);
        for (uint8_t i = 0; i < count && i < MAX_REG_INPUTS; i++)
        {
            String p = "ri" + String(i) + "_";
            ris[i].id = prefs.getString((p + "id").c_str(), "");
            ris[i].label = prefs.getString((p + "lbl").c_str(), "Reg Input");
            ris[i].linkedRegulatorId = prefs.getString((p + "lrid").c_str(), "");
            ris[i].pinCount = prefs.getUChar((p + "pc").c_str(), 0);
            for (uint8_t j = 0; j < ris[i].pinCount && j < MAX_REG_INPUT_PINS; j++)
            {
                String pp = p + "p" + String(j) + "_";
                ris[i].pins[j].speed = prefs.getUChar((pp + "spd").c_str(), 0);
                ris[i].pins[j].pin = prefs.getUChar((pp + "pin").c_str(), 0);
                ris[i].pins[j].minRaw = prefs.getUShort((pp + "min").c_str(), 3970);
                ris[i].pins[j].maxRaw = prefs.getUShort((pp + "max").c_str(), 4095);
            }
            DBG_STORAGE("  regInput[%d] pins=%d linked=%s label=%s",
                        i, ris[i].pinCount, ris[i].linkedRegulatorId.c_str(), ris[i].label.c_str());
        }
        prefs.end();
        return count;
    }

    // ── Server config override ────────────────────────────────
    // Saves host/port/TLS - applied on next boot (or immediately if devMode permits).
    static void saveServerConfig(const String &host, uint16_t port, bool tls)
    {
        Preferences prefs;
        prefs.begin(NVS_NAMESPACE, false);
        prefs.putString("srv_host", host);
        prefs.putUShort("srv_port", port);
        prefs.putBool("srv_tls", tls);
        prefs.end();
        DBG_STORAGE("saveServerConfig() - host=%s port=%d tls=%d", host.c_str(), port, tls);
    }
};