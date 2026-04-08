# ESP Hub - ESP32 Firmware

Arduino/PlatformIO firmware for connecting ESP32 relay boards to the ESP Hub dashboard.

---

## Requirements

- [PlatformIO](https://platformio.org/) (VS Code extension or CLI)
- ESP32 dev board (any variant with at least 4MB flash)
- Relay module (1–8 channel, active-LOW is assumed)

---

## Project structure

```
esp32/
├── platformio.ini          ← PlatformIO config + library deps
├── include/
│   ├── Config.h            ← All tuneable constants (AP name, timeouts, LED pin…)
│   ├── Storage.h           ← NVS read/write (WiFi creds, API key, relay state)
│   ├── StatusLed.h         ← Non-blocking LED blink patterns
│   ├── CaptivePortal.h     ← AP mode + config web page
│   ├── RelayManager.h      ← GPIO control for relays
│   └── HubClient.h         ← REST registration + WebSocket client
└── src/
    └── main.cpp            ← State machine: PORTAL → CONNECT → REGISTER → RUN
```

---

## First-time setup

1. Open the `esp32/` folder in VS Code with PlatformIO installed.
2. Flash with `pio run --target upload`.
3. Open the serial monitor: `pio device monitor` (115200 baud).
4. The ESP32 starts in **AP mode** - connect to the `ESP-Hub-Setup` WiFi network from
   your phone or laptop.
5. Your device should automatically open the config portal. If not, navigate to
   **http://192.168.4.1** manually.
6. Fill in:
    - **WiFi SSID / Password** - your home network
    - **Device Name** - a friendly label shown in the dashboard
    - **API Key** - copy from the ESP Hub dashboard → API Keys page
    - **Server Host** - your ESP Hub server hostname (e.g. `myserver.com`)
    - **Server Port** - usually `3000` (Next.js) for HTTP and `4001` for WebSocket
    - **Secure** - enable if your server uses HTTPS/WSS
7. Click **Save & Connect**. The ESP32 reboots, connects to WiFi, registers with the
   server, and appears in your dashboard.

---

## Relay wiring

Most relay modules are **active-LOW** - the relay activates when the GPIO is pulled LOW.
`RelayManager` uses this convention by default:

```
relay ON  → digitalWrite(pin, LOW)
relay OFF → digitalWrite(pin, HIGH)
```

If your module is **active-HIGH**, flip the logic in `RelayManager.h`:

```cpp
// _applyState():
digitalWrite(relays[i].pin, relays[i].state ? HIGH : LOW);  // active-HIGH
```

---

## LED status

Uses the onboard LED (GPIO 2 by default, active-LOW). Configure in `Config.h`.

| Pattern             | Meaning                         |
| ------------------- | ------------------------------- |
| Fast blink (200 ms) | AP / captive portal mode        |
| Slow blink (1 s)    | Connecting to WiFi or WebSocket |
| Solid ON            | Connected and authenticated     |

---

## Re-entering config mode

To reset config and re-enter the captive portal, call `Storage::clear()` and reboot -
or hold a button wired to a GPIO and call it from `setup()` before `Storage::load()`.

A simple reset-on-boot example (add to `setup()` in `main.cpp`):

```cpp
// Hold GPIO 0 (BOOT button) during reset to clear config
pinMode(0, INPUT_PULLUP);
delay(100);
if (digitalRead(0) == LOW) {
    Serial.println("[Config] Factory reset!");
    Storage::clear();
}
```

---

## WebSocket protocol

See `src/server/ws-server.ts` in the ESP Hub project for the full protocol spec.

Quick reference:

| Direction      | Message                                                            |
| -------------- | ------------------------------------------------------------------ |
| ESP32 → Server | `{ type: "auth", apiKey, macAddress, deviceId? }`                  |
| ESP32 → Server | `{ type: "heartbeat", deviceId, relayStates: [{id, state}] }`      |
| ESP32 → Server | `{ type: "relay_ack", relayId, state }`                            |
| Server → ESP32 | `{ type: "auth_ok", deviceId, relays: [{id, pin, label, state}] }` |
| Server → ESP32 | `{ type: "relay_cmd", relayId, pin, state }`                       |
| Server → ESP32 | `{ type: "ping" }`                                                 |
