# WebSocket Protocol

## ESP32 ↔ WS Server

```mermaid
sequenceDiagram
    participant ESP as ESP32
    participant WS as WS Server
    participant DB as MongoDB
    participant BR as Browser

    ESP->>WS: auth (apiKey, macAddress)
    WS->>DB: upsert device
    WS->>ESP: auth_ok (deviceId, relays[], switches[])
    WS->>BR: device_update

    loop Every 30s
        WS->>ESP: ping (relays: [{id, pin, state}])
        ESP->>WS: ping_ack
    end

    Note over BR,WS: User toggles relay
    BR->>WS: POST /push-relay
    WS->>ESP: relay_cmd (relayId, pin, state)
    ESP->>WS: relay_ack (relayId, state)
    WS->>DB: update relay state
    WS->>BR: relay_update

    Note over ESP,WS: Physical switch pressed
    ESP->>WS: switch_trigger (linkedRelayId, desiredState)
    WS->>DB: update relay state
    WS->>ESP: relay_cmd (to target device)
    WS->>BR: relay_update
```

## Browser ↔ WS Server

| Direction    | Message         | Payload                      |
| ------------ | --------------- | ---------------------------- |
| Browser → WS | `subscribe`     | `deviceId`                   |
| WS → Browser | `device_update` | Device online/offline status |
| WS → Browser | `relay_update`  | `relayId`, `state`           |

## Internal HTTP (tRPC → WS Server, port 4001)

All endpoints require `x-internal-secret` header matching `WS_SECRET`.

| Endpoint                                | Purpose                |
| --------------------------------------- | ---------------------- |
| `POST /push-relay`                      | Toggle relay command   |
| `POST /push-relay-add`                  | New relay notification |
| `POST /push-relay-update`               | Relay config change    |
| `POST /push-switch-add\|update\|delete` | Switch lifecycle       |
| `POST /ping-device`                     | On-demand ping         |
| `POST /refresh-device-subscribers`      | Rebuild subscriber set |
