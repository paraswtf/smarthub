# ESP Hub — Full Project Context

## Overview

ESP Hub is a full-stack IoT platform for controlling ESP32 relay modules via a web dashboard. Users register ESP32 devices, configure GPIO relay outputs and switch inputs, and toggle relays in real-time through WebSocket communication. The system supports cross-device switch→relay linking (a switch on one ESP32 can control a relay on another).

## Architecture

```
┌──────────────┐      WS (port 4001)      ┌──────────────────────────┐
│   ESP32      │◄────────────────────────►│   WS Server              │
│  (Arduino)   │  auth, ping, relay_cmd,   │   (standalone Node.js)   │
│              │  relay_ack, ping_ack,      │                          │
│              │  switch_trigger            │   HTTP endpoints:        │
└──────────────┘                           │   /push-relay            │
                                           │   /push-relay-update     │
┌──────────────┐      WS (/browser)       │   /push-relay-add        │
│   Browser    │◄────────────────────────►│   /push-switch-*         │
│   (React)    │  subscribe, device_update,│   /ping-device           │
│              │  relay_update             └──────────┬───────────────┘
└──────┬───────┘                                      │
       │ tRPC (HTTP)                                  │ Internal HTTP
       ▼                                              ▼
┌──────────────────────────────────────────────────────┐
│   Next.js App (port 3000)                            │
│   tRPC routers: device, switch, apiKey, user         │
│   Auth: NextAuth v5 (credentials + session)          │
│   DB: Prisma → MongoDB                               │
└──────────────────────────────────────────────────────┘
```

## Tech Stack

### Dashboard (dashboard/)

- **Framework**: Next.js 16 (App Router) with TypeScript
- **API**: tRPC v11 (React Query)
- **Auth**: NextAuth v5 beta (credentials provider, bcryptjs)
- **DB**: MongoDB via Prisma 5
- **Styling**: Tailwind CSS 3, Radix UI primitives, shadcn/ui components
- **WebSocket**: `ws` library (standalone server on port 4001)
- **Real-time**: Browser connects to WS server at `/browser`, subscribes with userId
- **Theming**: Light/dark mode via next-themes, CSS variables defined in `globals.config.ts` → `globals.css`
- **Scripts**: `npm run dev` (Next.js), `npm run ws` (WS server via tsx)

### ESP32 Firmware (firmware/)

- **Framework**: Arduino (PlatformIO, espressif32 platform)
- **Board**: esp32dev (ESP32 240MHz, 320KB RAM, 4MB Flash)
- **Libraries**: WebSockets 2.7.3 (links2004), ArduinoJson 7.4.3
- **Storage**: ESP32 NVS (Preferences library) for config, relay states, switch config
- **Architecture**: Header-only modules included from `main.cpp`

## Project Structure

### Dashboard (dashboard/)

```
prisma/schema.prisma          # MongoDB models
globals.config.ts              # Theme color values (synced with globals.css)
src/
  app/
    page.tsx                   # Landing page
    layout.tsx                 # Root layout
    auth/login/page.tsx        # Login
    auth/register/page.tsx     # Registration
    api/
      auth/[...nextauth]/      # NextAuth handler
      auth/register/           # Registration API
      esp/register/route.ts    # ESP32 initial registration (HTTP POST)
      esp/ws-relay/route.ts    # Legacy relay endpoint (may be unused)
      user/                    # Password change, name update
      trpc/[trpc]/route.ts     # tRPC HTTP handler
    dashboard/
      layout.tsx               # Sidebar layout
      page.tsx                 # Overview/home
      devices/page.tsx         # Device list (pings all devices on load)
      devices/[id]/page.tsx    # Device detail (relays, switches, config)
      api-keys/page.tsx        # API key management
      settings/page.tsx        # User settings
  components/
    dashboard/
      DashboardSidebar.tsx     # Collapsible sidebar
      DashboardOverviewClient.tsx
    ui/                        # shadcn/ui components (badge, button, card, dialog, etc.)
    sections/                  # Landing page sections
  providers/
    DeviceSocketProvider.tsx   # WS connection manager, exposes onDeviceUpdate/onRelayUpdate
    SessionProvider.tsx
    ThemeProvider.tsx
  server/
    db.ts                      # Prisma client
    auth/config.ts             # NextAuth config
    ws-server.ts               # Standalone WS + HTTP server (port 4001)
    api/
      trpc.ts                  # tRPC context/procedures
      root.ts                  # Router composition
      routers/
        device.ts              # CRUD + toggleRelay + pingDevice
        switch.ts              # CRUD for switches
        apiKey.ts              # CRUD for API keys
        user.ts                # User queries
  hooks/useRelativeTime.ts     # "2m ago" ticking hook
  trpc/                        # tRPC client setup (react.tsx, server.ts, query-client.ts)
  styles/globals.css           # CSS variables, sidebar styles
```

### ESP32 (firmware/)

```
platformio.ini                 # PlatformIO config
src/main.cpp                   # State machine: S_PORTAL → S_CONNECT → S_REGISTER → S_RUN
include/
  Config.h                     # Constants (timeouts, max relays, LED pin, NVS namespace)
  Debug.h                      # DBG_* macros (compile to nothing when DEBUG_MODE=0)
  Storage.h                    # NVS read/write: DeviceConfig, RelayConfig, SwitchConfig
  StatusLed.h                  # LED blink patterns (fast=AP, slow=connecting, solid=running)
  CaptivePortal.h              # WiFi AP + DNS + web form for initial config
  HubClient.h                  # WebSocket client: auth, ping/sync, relay commands, switch triggers
  RelayManager.h               # GPIO output management, NVS persistence, applyServerConfig
  SwitchManager.h              # Input pin monitoring: two-way/three-way (poll) + momentary (ISR)
  SwitchTypes.h                # Enums: SwitchType; SwitchConfig struct
```

## Database Schema (Prisma/MongoDB)

```prisma
model User       { id, name, email, passwordHash, accounts[], sessions[], apiKeys[] }
model ApiKey     { id, key (unique), label, active, lastUsedAt, userId → User, devices[] }
model Device     { id, name, macAddress (unique), firmwareVersion?, ssid?, notes?, apiKeyId → ApiKey, relays[], switches[] }
model Relay      { id, pin, label, state, order, icon, deviceId → Device }
model Switch     { id, pin, label, switchType ("two_way"|"three_way"|"momentary"), linkedRelayId, deviceId → Device }
```

**Note**: `lastSeenAt` was removed from Device. Online status is determined on-demand via `pingDevice`.

## WebSocket Protocol

### ESP32 ↔ WS Server

**ESP32 → Server:** | Message | Fields | Purpose | |---------|--------|---------| | `auth` | apiKey, macAddress | Authenticate on connect | | `ping_ack` | (none) | Response to server ping | | `relay_ack` | relayId, state | Confirm GPIO was set | | `switch_trigger` | linkedRelayId, desiredState, isToggle | Physical switch event |

**Server → ESP32:** | Message | Fields | Purpose | |---------|--------|---------| | `auth_ok` | deviceId, relays[], switches[] | Full config on auth | | `auth_fail` | reason | Bad API key | | `ping` | relays: [{id, pin, state}] | Keepalive + authoritative state sync (every 30s) | | `relay_cmd` | relayId, pin, state | Toggle a relay | | `relay_add` | relay: {id, pin, label, state, icon} | New relay added from dashboard | | `relay_update_config` | relay: {id, pin, label, state, icon} | Relay config edited | | `switch_add` | switch: {id, pin, label, switchType, linkedRelayId} | New switch | | `switch_update_config` | switch: {...} | Switch config edited | | `switch_delete` | switchId | Switch removed |

### Browser ↔ WS Server

**Browser → Server:** `{ type: "subscribe", userId }` **Server → Browser:**

- `device_update` — { deviceId, relays: [{id, state}] } — sent on auth + ping
- `relay_update` — { deviceId, relayId, state } — sent on relay_ack + switch_trigger

### Internal HTTP (tRPC → WS Server, port 4001)

- `POST /push-relay` — toggle relay command
- `POST /push-relay-add` — new relay notification
- `POST /push-relay-update` — relay config change notification
- `POST /push-switch-add|update|delete` — switch lifecycle
- `POST /ping-device` — on-demand ping, returns { online: true/false }

All endpoints require `x-internal-secret` header matching `WS_SECRET` env var.

## tRPC API Routes

### device router

- `list` — all devices for user (via apiKeys)
- `get` — single device with relays
- `update` — name/notes
- `delete`
- `toggleRelay` — tries WS push first, falls back to DB write
- `pingDevice` — on-demand ping via WS server, returns { online: boolean }
- `updateRelay` — label/icon/pin, pushes to ESP32
- `addRelay` — creates relay + pushes to ESP32
- `deleteRelay`

### switch router

- `list` — all switches for a device
- `listAllRelays` — all relays across all user devices (for cross-device linking)
- `add` — create + push to ESP32 (includes switchType)
- `update` — edit + push to ESP32 (includes switchType)
- `delete` — remove + push to ESP32

### apiKey router

- `list`, `create`, `revoke`

### user router

- `me` — current user info

## ESP32 Boot Flow

```
setup()
  ├─ Serial.begin(115200)
  ├─ StatusLed::begin()
  ├─ Check BOOT button (GPIO 0) held 3s → factory reset
  ├─ Storage::load(cfg) → has config?
  │   ├─ Yes → state = S_CONNECT
  │   └─ No  → state = S_PORTAL
  ├─ relays.begin()
  └─ switches.begin(onSwitchTriggered)

loop() state machine:
  S_PORTAL  → CaptivePortal (AP mode, DNS, web form) → saves config → reboot
  S_CONNECT → connectWiFi() → success → S_REGISTER, fail 3x → S_PORTAL
  S_REGISTER → hub.begin() + hub.registerDevice() (HTTP POST /api/esp/register)
              → hub.connectWebSocket() → S_RUN
  S_RUN     → hub.loop() + switches.loop() + WiFi watchdog + BOOT button check
```

## ESP32 Runtime (S_RUN)

### HubClient.loop()

1. `_ws.loop()` — WebSocket library tick
2. Watchdog: if no activity (no ping from server) for 90s → force reconnect

### Ping/Sync Cycle (replaces old heartbeat)

- Server sends `ping` every 30s with authoritative relay states
- ESP32 syncs any relay state differences (skips relays changed locally <10s ago)
- ESP32 replies `ping_ack`
- On-demand: browser calls `pingDevice` tRPC → WS server sends ping → waits for `ping_ack` (3s timeout)

### Relay Toggle Flow

1. Dashboard toggle → tRPC `toggleRelay` → POST `/push-relay` to WS server
2. WS server sends `relay_cmd` to ESP32
3. ESP32 sets GPIO → sends `relay_ack`
4. WS server writes DB + broadcasts `relay_update` to browsers
5. Browser shows "confirmed" only if that client initiated the toggle

### Switch Trigger Flow

1. Physical switch → ISR (momentary) or poll (two-way/three-way) → `onSwitchTriggered` callback
2. ESP32 sends `switch_trigger` with linkedRelayId + isToggle
3. WS server looks up relay (possibly on different device), writes DB, pushes `relay_cmd` to target device
4. Broadcasts `relay_update` to browsers

## Switch Manager Details

Three switch types with different strategies:

**Two-way (SWITCH_TWO_WAY):** SPST switch (VCC ↔ floating). `INPUT_PULLDOWN`. Poll-based with 50ms software debounce. Toggles on any stable state change.

**Three-way (SWITCH_THREE_WAY):** SPDT switch (VCC ↔ GND). `INPUT` (no pull — pin always driven). Same poll+debounce logic as two-way. Toggles on any stable state change.

**Momentary (SWITCH_MOMENTARY):** Push button. `INPUT_PULLDOWN` + ISR on RISING edge. Key features:

- ISR-level debounce (80ms) filters contact bounce
- **Release gate**: after firing, pin must return to LOW before accepting next trigger (prevents release bounce double-triggers)
- **Cooldown**: 150ms minimum between accepted triggers
- **Fast path** (pins 0-33): ISR → one `digitalRead` confirmation (filters crosstalk) → fire immediately
- **Confirmation path** (pins 34-39, no internal pull): ISR → 6 non-blocking samples across loop iterations → ≥5/6 HIGH required → fire
- File-scope ISR with `DRAM_ATTR` statics (Xtensa IRAM literal pool fix)

## Key GPIO Notes

**Best pins for relays and switches**: 4, 5, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33

**Avoid**: GPIO 0 (boot), 1/3 (UART), 6-11 (SPI flash)

**Caution**: GPIO 2 (LED), 12 (flash voltage), 15 (boot PWM), 34-39 (input-only, no internal pulls)

## Environment Variables

```env
# Dashboard (.env)
DATABASE_URL=mongodb+srv://...
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=...
WS_PORT=4001
WS_SECRET=...           # shared secret for internal HTTP endpoints
WS_INTERNAL_URL=http://localhost:4001  # optional override
```

## Running Locally

```bash
# Dashboard (from root)
npm install
npm run dev          # Next.js on :3000
npm run ws           # WS server on :4001
npm run db:push      # Prisma push

# ESP32
cd firmware
pio run --target upload
pio device monitor
```

## Known Design Decisions

- **Server is authoritative** for relay states. ESP32 syncs FROM server, not the other way around. The only time ESP32 state matters is `relay_ack` confirming a command was applied.
- **No `lastSeenAt` in DB**. Online status is purely on-demand via `pingDevice` tRPC mutation → WS server `/ping-device` → `ping_ack` from ESP32.
- **No periodic heartbeat from ESP32**. Server pings every 30s carrying authoritative state. ESP32 just responds.
- **Ping serves dual purpose**: TCP keepalive (prevents NAT timeout) + relay state sync.
- **Cross-device switches**: A switch on Device A can link to a relay on Device B (same user). The WS server resolves the cross-device routing.
- **Optimistic UI**: Relay toggles update UI immediately. `relay_ack` confirms. Timeout after 5s rolls back.
- **NVS persistence**: ESP32 stores relay states in NVS flash. On boot, loads cached states immediately so relays don't flicker. Server config overrides on connect.
