# Relay Scheduling

Schedules are alarm-like: select days, time, and on/off action per relay. The WS server checks all enabled schedules every 60 seconds.

## Flow

```mermaid
sequenceDiagram
    participant SCHED as Schedule Executor (60s interval)
    participant DB as MongoDB
    participant WS as WS Server
    participant ESP as ESP32
    participant BR as Browser

    SCHED->>DB: Query enabled schedules
    SCHED->>SCHED: Match current time + day (in schedule timezone)
    SCHED->>DB: Update relay state
    SCHED->>WS: pushRelayCommand (if device online)
    WS->>ESP: relay_cmd
    SCHED->>BR: broadcastToDeviceSubscribers (relay_update)
    ESP->>WS: relay_ack (confirms physical state)
```

## Offline Handling

If the device is offline when a schedule fires, the desired state is persisted in the DB. The next heartbeat or WS ping will deliver the pending state once the device comes back online.

ESP32 is authoritative for physical relay state - `relay_ack` is the confirmation.
