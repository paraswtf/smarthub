# Key Design Decisions

## ESP32 is authoritative for physical relay state

The server stores **desired** state; the ESP32 confirms **actual** state via `relay_ack` and heartbeat `relayStates`. This means:

- Dashboard toggles write desired state to DB immediately
- ESP32 executes the command and sends `relay_ack`, which then writes DB
- If a command is missed (device offline), the next heartbeat reconciles
- The **10-second local-change window** in ping sync prevents the server from reverting a relay that the ESP32 just physically changed (e.g. a wall switch)

## Heartbeat as safety net

The REST `POST /api/esp/heartbeat` runs every 60s alongside the WS ping (every 30s). Its job is state reconciliation when WS commands are missed:

- ESP32 reports physical states → server writes them to DB
- Server returns desired states → ESP32 applies any pending changes
- `lastSeenAt` throttled to 30s intervals to reduce DB write load

## Two-layer relay command path

`tRPC toggleRelay` → tries `/push-relay` on WS server → if `pushed: false` (device offline), writes desired state to DB only. No queuing. The next heartbeat or WS reconnect delivers the state.

## Room-centric organisation

Homes contain rooms, rooms contain relays. Relays physically live on devices but are logically organised into rooms. A relay can belong to a device (always) and optionally to a room. Devices can move between homes; when unassigned from a home, all their relays are also unassigned from rooms.

## Granular sharing

Three levels: home (all rooms + relays), room (all relays in room), individual relay. `getRelayAccess` checks in order: owner → RelayShare → RoomShare → HomeShare. First match wins — no additive permissions. See [sharing.md](sharing.md).

## Server-side scheduling

The WS server runs a `setInterval` (60s) to check all enabled schedules. Schedules are timezone-aware and use `lastFiredAt` to prevent double-fire within the same calendar minute. If the target device is offline, the desired state is written to DB and delivered on next heartbeat. See [scheduling.md](scheduling.md).

## Cross-device switches

A switch on Device A can control a relay on Device B (same owner). The WS server resolves routing at runtime when it receives `switch_trigger` — it looks up the target relay, validates ownership, then sends `relay_cmd` to the target device's socket. No firmware coupling required.

## Optimistic UI

Relay toggle switches in the browser update immediately (optimistic). The `relay_ack` via the `relay_update` WS broadcast confirms. If no `relay_update` arrives within 5s, the UI rolls back. Real-time updates flow through `DeviceSocketProvider`.

## Single WS port in development

`dashboard/server.ts` is a custom Node.js HTTP server that combines Next.js and the WS server on port 3000. This mirrors production (where Caddy routes both on the same domain). It intercepts `server.on("upgrade")` to route `/` and `/browser` WebSocket upgrades to the WS server while delegating HMR upgrades to Next.js.

To prevent Next.js from lazily adding upgrade listeners (post-`prepare()`) that would call `socket.destroy()` on our connections, `attachWss()` patches `server.on` to intercept future `"upgrade"` listener registrations and redirect them into the `externalUpgradeListeners` array (called by our combined router for non-WS paths).

## WS-level heartbeat

The `ws` library's `wss.clients` set is iterated every 30s with `ws.ping()`. If no `pong` arrives before the next check, the connection is `terminate()`d. This catches hard disconnects (Wi-Fi drop without TCP FIN) that the application-level JSON ping wouldn't detect for a full 90 seconds (the ESP32 watchdog timeout). Browser connections have no application-level keepalive — the WS heartbeat is their only mechanism.

## JWT sessions + DB validation

NextAuth's CredentialsProvider requires JWT session strategy (cannot use database sessions without an adapter). The session callback queries the DB on every session read to check that the user still exists. This means account deletion takes effect immediately — forged or stale JWTs won't work.

## NVS flash wear minimisation

ESP32 flash cells have a finite write endurance (~100k cycles per page). `Storage::saveRelayState(index, bool)` writes a single NVS key (`r0_st`, `r1_st`, …) on each toggle instead of rewriting the full relay array. A heavily-used relay might toggle thousands of times a day — writing one key vs. 8 is a significant improvement.

## Momentary switch ISR

`WebSocketsClient::loop()` can block for 10–50ms during WebSocket frame processing. A short button press (200–400ms) produces a narrow rising edge that polling at 50ms debounce intervals would miss. The ISR atomically captures the edge; the main loop processes it with a 150ms cooldown. Input-only pins (34–39, no internal pull) additionally require a 5/6-sample majority vote to reject floating-input noise.

## API key prefix

API keys are formatted `ehk_` + 40 hex chars. The `ehk_` prefix allows automatic detection/revocation by secret-scanning tools and makes keys identifiable in logs.

## Brevo over nodemailer SMTP

`@getbrevo/brevo` (REST API) is used for transactional email instead of SMTP. API keys are easier to rotate than SMTP credentials and Brevo's free tier (300 emails/day) covers typical self-hosted usage.
