# SmartHUB — AI Context Reference

Full documentation is in [README.md](README.md) and [docs/](docs/). This file is the dense quick-reference for AI assistants.

---

## Project Overview

Full-stack IoT home automation. ESP32 devices connect over WebSocket; users control them from a Next.js dashboard. Three parts:

| Part      | Location                            | Role                                                                     |
| --------- | ----------------------------------- | ------------------------------------------------------------------------ |
| Dashboard | `dashboard/`                        | Next.js 16 app — UI, tRPC API, auth, DB                                  |
| WS Server | `dashboard/src/server/ws-server.ts` | Real-time engine — ESP32 connections, browser fan-out, schedule executor |
| Firmware  | `firmware/`                         | ESP32 Arduino — captive portal, WS client, GPIO relay/switch management  |

---

## Key Files

### Dashboard

| File                                               | Purpose                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `dashboard/server.ts`                              | Custom dev server — combines Next.js + WS on port 3000                   |
| `dashboard/src/server/ws-server.ts`                | WS server (590 lines) — all real-time logic                              |
| `dashboard/src/server/auth/config.ts`              | NextAuth v5 config — Google + Credentials providers                      |
| `dashboard/src/server/api/root.ts`                 | tRPC router composition                                                  |
| `dashboard/src/server/api/routers/device.ts`       | Device + relay CRUD, toggleRelay, pingDevice                             |
| `dashboard/src/server/api/routers/sharing.ts`      | Home/room/relay access grants                                            |
| `dashboard/src/server/api/lib/permissions.ts`      | `getDeviceAccess`, `getRelayAccess`                                      |
| `dashboard/src/app/api/esp/register/route.ts`      | ESP32 registration endpoint                                              |
| `dashboard/src/app/api/esp/heartbeat/route.ts`     | ESP32 60s fallback sync                                                  |
| `dashboard/src/providers/DeviceSocketProvider.tsx` | Browser WS client, fan-out to React listeners                            |
| `dashboard/prisma/schema.prisma`                   | Full MongoDB schema                                                      |
| `dashboard/globals.config.ts`                      | Brand colors, typography, timing constants — editing this reskins the UI |
| `dashboard/next.config.ts`                         | `output: "standalone"`, env validation                                   |

### Firmware

| File                               | Purpose                                          |
| ---------------------------------- | ------------------------------------------------ |
| `firmware/src/main.cpp`            | State machine: PORTAL → CONNECT → REGISTER → RUN |
| `firmware/include/HubClient.h`     | WS client — auth, ping, relay commands, watchdog |
| `firmware/include/RelayManager.h`  | GPIO output management, NVS persistence          |
| `firmware/include/SwitchManager.h` | Input monitoring — latching + ISR momentary      |
| `firmware/include/CaptivePortal.h` | WiFi AP + DNS + embedded config form             |
| `firmware/include/Storage.h`       | NVS read/write for all config                    |
| `firmware/include/Config.h`        | All compile-time constants                       |
| `firmware/include/Debug.h`         | Conditional color-coded serial logging           |

---

## Commands

```bash
# Dev (from repo root)
npm install
npm run dev          # Next.js + WS server on :3000 (combined via server.ts)
npm run db:push      # Prisma schema → MongoDB
npm run db:studio    # Prisma Studio
npm run format       # Prettier all files

# Firmware (from repo root)
pio run -t upload    # Build + flash ESP32
pio device monitor   # Serial monitor at 115200
```

---

## Environment Variables

All in `dashboard/.env`. See `dashboard/.env.example` for full template.

| Variable                       | Required        | Purpose                                                                         |
| ------------------------------ | --------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Yes             | MongoDB URI with `?replicaSet=rs0`                                              |
| `AUTH_SECRET`                  | Yes             | NextAuth JWT signing key                                                        |
| `WS_SECRET`                    | Yes             | Internal API auth between Next.js → WS server                                   |
| `WS_INTERNAL_URL`              | Yes             | URL Next.js uses to reach WS server internally (`http://localhost:3000` in dev) |
| `WS_PORT`                      | Standalone only | WS server port when run standalone (default `4001`)                             |
| `NEXTAUTH_URL`                 | Yes             | Public URL for auth redirects                                                   |
| `NEXT_PUBLIC_API_URL`          | Yes             | Baked into browser bundle — base URL                                            |
| `NEXT_PUBLIC_WS_PORT`          | Prod only       | If set, browser WS connects to this port; unset = same port as API              |
| `AUTH_GOOGLE_CLIENT_ID/SECRET` | Optional        | Google OAuth                                                                    |
| `FIRMWARE_DIR`                 | Optional        | Directory for OTA firmware uploads (default `/data/firmware`)                   |
| `BREVO_API_KEY/SENDER_EMAIL`   | Optional        | Transactional email (verification, password reset)                              |

**Dev note**: `NEXT_PUBLIC_WS_PORT` is intentionally **unset** locally — the browser connects to the same port as `NEXT_PUBLIC_API_URL` (port 3000) since `server.ts` handles both.

---

## Architecture

```
Browser ──tRPC──────────────────────────────────────┐
         ──ws://HOST/browser──────────┐              │
                                      ↓              ↓
ESP32  ──ws://HOST/──────────── WS Server ←──HTTP── Next.js
         ──HTTP /api/esp/──────────────────────────→ Next.js
                                      ↓              ↓
                                 MongoDB (Prisma)
```

**In dev**: Both Next.js and WS server share port 3000 via `dashboard/server.ts`. HTTP requests route to Next.js; WebSocket upgrades to `/` or `/browser` route to WS server; HMR upgrades route to Next.js.

**In prod**: Caddy proxies `smarthub.paraswtf.com` → Next.js container (:3002→:3000) and `:4001` → WS container (:4002→:4001).

---

## Database Schema Summary

See `dashboard/prisma/schema.prisma` for full definitions.

| Model               | Key fields                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `User`              | `email` (unique), `passwordHash?`, `emailVerified?`                                                                               |
| `ApiKey`            | `key` (`ehk_` prefix), `active`, `userId`                                                                                         |
| `Device`            | `macAddress` (unique), `lastSeenAt`, `apiKeyId`, `homeId?`, `wifiNetworks[]`, `cfgServerHost?`, `cfgServerPort?`, `cfgServerTLS?` |
| `Relay`             | `pin`, `state`, `order`, `icon`, `deviceId`, `roomId?`                                                                            |
| `Switch`            | `pin`, `switchType` (two_way/three_way/momentary), `linkedRelayId`, `deviceId`                                                    |
| `Home`              | `name`, `ownerId`                                                                                                                 |
| `Room`              | `name`, `order`, `homeId`                                                                                                         |
| `HomeShare`         | `homeId`, `userId` — unique together                                                                                              |
| `RoomShare`         | `roomId`, `userId` — unique together                                                                                              |
| `RelayShare`        | `relayId`, `userId` — unique together                                                                                             |
| `RelaySchedule`     | `hour`, `minute`, `daysOfWeek[]`, `action` (bool), `timezone`, `lastFiredAt`                                                      |
| `VerificationToken` | `identifier` (email), `token`, `expires` — used for email verify + password reset                                                 |

---

## tRPC Routers

All routers require auth except where noted. Access via `api.*` in client components.

| Router     | Key procedures                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device`   | `list`, `get`, `update`, `delete`, `pingDevice`, `toggleRelay`, `updateRelay`, `addRelay`, `deleteRelay`, `addWifi`, `removeWifi`, `updateServerConfig`, `triggerOta` |
| `home`     | `list`, `get`, `create`, `update`, `delete`, `assignDevice`, `unassignedDevices`                                                                                      |
| `room`     | `list`, `get`, `create`, `update`, `delete`, `assignRelay`, `unassignRelay`, `unassignedRelays`                                                                       |
| `sharing`  | `shareHome`, `unshareHome`, `listHomeShares`, `shareRoom`, `unshareRoom`, `shareRelay`, `unshareRelay`, `listSharedWithMe`                                            |
| `schedule` | `list`, `create`, `update`, `delete`, `toggle`                                                                                                                        |
| `switch`   | `list`, `listAllRelays`, `add`, `update`, `delete`                                                                                                                    |
| `apiKey`   | `list`, `create`, `revoke`, `delete`                                                                                                                                  |
| `user`     | `updateSelf`                                                                                                                                                          |

`toggleRelay` flow: check `getRelayAccess` → call `/push-relay` on WS server → if device offline, write DB only (next heartbeat will deliver).

---

## WebSocket Protocol

### ESP32 → Server

| Message          | Fields                                      | Action                                                   |
| ---------------- | ------------------------------------------- | -------------------------------------------------------- |
| `auth`           | `apiKey`, `macAddress`                      | Upsert device, send `auth_ok`, broadcast `device_update` |
| `ping_ack`       | —                                           | Resolve pending on-demand ping, update `lastSeenAt`      |
| `relay_ack`      | `relayId`, `state`                          | Update DB state, broadcast `relay_update`                |
| `switch_trigger` | `linkedRelayId`, `desiredState`, `isToggle` | Resolve cross-device relay, send `relay_cmd`, broadcast  |
| `ota_progress`   | `percent`                                   | Relay to browser as `ota_progress` broadcast             |
| `ota_result`     | `success`, `error?`                         | Relay to browser as `ota_result` broadcast               |

### Server → ESP32

| Message                           | Fields                                                                  | Trigger                                                 |
| --------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `auth_ok`                         | `deviceId`, `relays[]`, `switches[]`, `wifiNetworks[]`, `serverConfig?` | After auth                                              |
| `auth_fail`                       | `reason`                                                                | Bad API key                                             |
| `ping`                            | `relays: [{id, pin, state}]`                                            | Every 30s — keepalive + state sync                      |
| `relay_cmd`                       | `relayId`, `pin`, `state`                                               | User toggle or schedule                                 |
| `relay_add`                       | `relay`                                                                 | Relay created in dashboard                              |
| `relay_update_config`             | `relay`                                                                 | Relay pin/label/icon changed                            |
| `switch_add/update_config/delete` | switch object                                                           | Switch CRUD                                             |
| `wifi_config`                     | `networks: [{ssid, password}]`                                          | WiFi list updated in dashboard                          |
| `server_config`                   | `host`, `port`, `tls`                                                   | Server address updated in dashboard                     |
| `ota_update`                      | `url`                                                                   | OTA triggered — one-time download URL with 10-min token |

### Browser ↔ Server

| Direction      | Message         | Fields                               |
| -------------- | --------------- | ------------------------------------ |
| Browser→Server | `subscribe`     | `userId`                             |
| Server→Browser | `device_update` | `deviceId`, `lastSeenAt`, `relays[]` |
| Server→Browser | `relay_update`  | `deviceId`, `relayId`, `state`       |
| Server→Browser | `ota_progress`  | `deviceId`, `percent`                |
| Server→Browser | `ota_result`    | `deviceId`, `success`, `error?`      |

### Internal HTTP (Next.js → WS Server)

URL base from `WS_INTERNAL_URL`. All `POST`, all require `x-internal-secret: WS_SECRET`.

`/push-relay`, `/push-relay-update`, `/push-relay-add`, `/push-switch-add`, `/push-switch-update`, `/push-switch-delete`, `/ping-device`, `/refresh-device-subscribers`, `/push-wifi-config`, `/push-server-config`, `/push-ota`, `/validate-ota-token`

---

## Permissions Model

`getRelayAccess(db, relayId, userId)` checks in order:

1. Device owner (via `apiKey.userId`)
2. Direct `RelayShare`
3. `RoomShare` on the relay's room
4. `HomeShare` on the device's home (via relay→room→home or relay→device→home)

First match wins. `shareHome` grants access to all rooms + relays in the home.

---

## Firmware State Machine

```
PORTAL ──(config saved)──→ CONNECT ──(WiFi OK)──→ REGISTER ──(HTTP POST + WS auth)──→ RUN
          ←─(3 WiFi failures)──┘                                        │
                                                                         └──(WiFi lost / 90s watchdog)──→ CONNECT
```

- **PORTAL**: AP SSID = `SmartHUB-AABBCC` (last 3 MAC bytes). DNS catches all domains → 302 to `192.168.4.1` for captive portal auto-popup. 5-minute timeout → reboot.
- **REGISTER**: `POST /api/esp/register`. Factory reset flag (`Storage::consumeFactoryResetFlag()`) triggers relay wipe on server.
- **RUN**: WS keepalive ping every 30s; heartbeat `POST /api/esp/heartbeat` every 60s. ESP32 watchdog disconnects if no server activity for 90s.

---

## Key Design Decisions

- **ESP32 is authoritative**: `relay_ack` and heartbeat relay states overwrite DB. DB stores desired state. The server never tells the ESP32 what state _is_ — only what state _should be_.
- **10s local-change window**: In `ping` sync, relays changed by the ESP32 within the last 10s are skipped. Prevents server from reverting a local physical toggle.
- **WS-level heartbeat**: `ws.ping()` every 30s via `wss.clients`. Detects dead connections that skip TCP FIN (Wi-Fi drops). Browser connections have no other keepalive.
- **Combined dev server**: `server.ts` intercepts `server.on("upgrade")` — patches it to also capture future lazily-registered Next.js listeners, so Next.js's HMR handler can't destroy WS connections. See `attachWss()`.
- **Subscriber model**: `deviceSubscribers` map caches who receives updates for each device (owner + all share levels). Rebuilt on auth and on sharing changes.
- **JWT sessions + DB validation**: CredentialsProvider requires JWT. Session callback queries DB on every request to invalidate deleted accounts.
- **NVS flash wear**: `Storage::saveRelayState(index, bool)` writes one key per toggle instead of the full array.
- **Momentary switch ISR**: WS `loop()` can block 10–50ms, missing short button presses. ISR on RISING edge is atomic; main loop processes with 150ms cooldown. Input-only pins (34–39) also run 5/6-sample majority vote to reject floating-input noise.

---

## Common Patterns

### Internal WS HTTP call from tRPC

```ts
await fetch(`${env.WS_INTERNAL_URL}/push-relay`, {
	method: "POST",
	headers: { "Content-Type": "application/json", "x-internal-secret": env.WS_SECRET },
	body: JSON.stringify({ deviceId, relayId, pin, state }),
});
```

### React real-time relay updates

```tsx
const { onRelayUpdate } = useDeviceSocket();
useEffect(
	() =>
		onRelayUpdate((msg) => {
			if (msg.deviceId === id) setRelayState(msg.relayId, msg.state);
		}),
	[onRelayUpdate],
);
```

### Relay access check in tRPC

```ts
const access = await getRelayAccess(ctx.db, relayId, ctx.session.user.id);
if (access === "none") throw new TRPCError({ code: "FORBIDDEN" });
```

---

## Documentation Maintenance

When making changes that affect any of the following, update the relevant file(s) in `docs/` and this file:

| Change type                                                  | Files to update                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| New/changed REST endpoint or tRPC procedure                  | `docs/api.md`                                                          |
| New/changed WebSocket message type or internal HTTP route    | `docs/websocket-protocol.md`, `CLAUDE.md` (WS Protocol section)        |
| New env variable or changed behaviour of existing one        | `docs/setup.md`, `CLAUDE.md` (Environment Variables section)           |
| New/changed firmware state, NVS key, GPIO rule, or boot flow | `docs/esp32.md`, `CLAUDE.md` (Firmware State Machine section)          |
| New/changed design decision or architectural trade-off       | `docs/design-decisions.md`, `CLAUDE.md` (Key Design Decisions section) |
| New/changed file, directory, or key dependency               | `docs/project-structure.md`, `CLAUDE.md` (Key Files section)           |
| New/changed tech, library, or infrastructure component       | `docs/tech-stack.md`                                                   |

Only update docs sections that are directly affected — don't rewrite unrelated content.

---

## Conventions & Rules

- **Formatting**: Prettier on pre-commit via Husky/lint-staged. Run `npm run format` manually.
- **Relay pins**: 0–33 and 32–39 valid GPIO. Pins 34–39 are **input-only** — rejected for relay output by `device.ts` `updateRelay`/`addRelay`.
- **Switch pins**: Pins 34–39 are ideal (input-only, no accidental output).
- **Max relays per device**: 8 (`appConfig.maxRelaysPerDevice`).
- **Max API keys per user**: 10.
- **Max schedules per relay**: 10.
- **API key format**: `ehk_` + 40 hex chars.
- **Error handling in WS handlers**: All `ws.on("message")` async callbacks must have try/catch — unhandled rejections in Node.js 18+ kill the process.
- **Prisma singleton in ws-server**: `globalThis.wsDb` prevents new connection pools on HMR reload.
- **Schedule double-fire guard**: `lastFiredAt` compared in the schedule's local timezone — prevents re-firing within the same calendar minute.
