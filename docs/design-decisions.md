# Key Design Decisions

- **ESP32 is authoritative** for physical relay states. Server stores desired state; ESP32 confirms via `relay_ack` or heartbeat reconciliation.

- **Heartbeat as safety net**: REST endpoint syncs any missed WS updates. Runs every 60s alongside the WS ping (every 30s).

- **Room-centric organization**: Homes contain rooms, rooms contain relays. Relays physically belong to devices but are logically organized into rooms.

- **Granular sharing**: Share at home (all rooms/relays), room, or individual relay level. See [sharing.md](sharing.md).

- **Server-side scheduling**: WS server checks schedules every 60s, pushes changes via existing relay command infrastructure. See [scheduling.md](scheduling.md).

- **Cross-device switches**: WS server resolves switch-relay links across devices so a switch on one ESP32 can control a relay on another.

- **Optimistic UI**: Relay toggles update the UI immediately. `relay_ack` confirms. 5s timeout rolls back if no ack received.

- **NVS persistence**: ESP32 stores relay states in flash. On boot, cached states are loaded so relays don't flicker. Server config overrides on WS connect.
