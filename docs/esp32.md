# ESP32 Firmware

## Boot Flow

```mermaid
stateDiagram-v2
    [*] --> CheckConfig: setup()
    CheckConfig --> S_PORTAL: No config
    CheckConfig --> S_CONNECT: Has config

    S_PORTAL --> Reboot: Save config from web form
    Reboot --> CheckConfig

    S_CONNECT --> S_REGISTER: WiFi connected
    S_CONNECT --> S_PORTAL: 3 failures

    S_REGISTER --> S_RUN: WS connected + auth_ok

    S_RUN --> S_RUN: loop (WS, switches, watchdog)
    S_RUN --> S_CONNECT: WiFi lost / WS timeout (90s)

    note right of S_PORTAL: AP mode + captive portal
    note right of S_RUN: Ping/sync every 30s
```

## Heartbeat

`POST /api/esp/heartbeat` — called every 60s by ESP32 as a fallback sync mechanism.

- ESP32 reports its physical relay states (authoritative)
- Server returns desired relay states (includes any pending scheduled changes)
- `lastSeenAt` updates are rate-limited (30s throttle)

If a relay command is missed over WebSocket (e.g. device was briefly offline), the next heartbeat delivers the desired state.

## Switch Types

| Type      | Wiring              | Detection                 | GPIO Mode       |
| --------- | ------------------- | ------------------------- | --------------- |
| Two-way   | SPST (VCC/floating) | Poll + 50ms debounce      | INPUT_PULLDOWN  |
| Three-way | SPDT (VCC/GND)      | Poll + 50ms debounce      | INPUT (no pull) |
| Momentary | Push button         | ISR RISING + release gate | INPUT_PULLDOWN  |

Cross-device switching: A switch on Device A can control a relay on Device B (same owner). The WS server resolves routing via the `switch_trigger` message.

## NVS Persistence

ESP32 stores relay states in flash (NVS). On boot, cached states are loaded so relays don't flicker. Server config overrides on WebSocket connect.
