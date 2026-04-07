# Project Structure

## Repository Root

```
package.json                  # npm workspaces root (workspace: dashboard/)
platformio.ini                # PlatformIO config — src_dir/include_dir point into firmware/
dashboard/                    # Next.js app (full-stack dashboard + WS server)
firmware/                     # ESP32 Arduino firmware
.github/workflows/deploy.yml  # GitHub Actions CI/CD
docker-compose.yml            # Production deployment (4 services)
deployment.md                 # Production deployment guide
```

---

## Dashboard (`dashboard/`)

```
server.ts                          # Custom dev server — Next.js + WS on :3000 combined
next.config.ts                     # Next.js config (standalone output, env validation)
globals.config.ts                  # Brand, theme, timing constants — editing this reskins the UI
prisma/schema.prisma               # MongoDB Prisma schema (all models)
Dockerfile                         # Multi-stage: deps → builder → nextjs | wsserver targets

src/
  app/
    layout.tsx                     # Root layout — fonts, ThemeProvider, TRPCProvider
    page.tsx                       # Landing page (Hero, Features, HowItWorks)

    auth/
      layout.tsx                   # Redirects authenticated users to /dashboard
      login/page.tsx               # Credentials + Google OAuth sign-in
      register/page.tsx            # New user registration
      verify/page.tsx              # Email verification pending / resend
      forgot-password/page.tsx     # Request password reset email
      reset-password/page.tsx      # Set new password (token from email)

    dashboard/
      layout.tsx                   # Redirects unauthenticated users; wraps with DeviceSocketProvider + sidebar
      page.tsx                     # Overview — all devices with relay state
      homes/
        page.tsx                   # Home list with create dialog
        [id]/page.tsx              # Home detail — rooms grid, device list, share/assign dialogs
      rooms/
        [id]/page.tsx              # Room detail — relay toggles, schedules, share/assign dialogs
      devices/
        [id]/page.tsx              # Device detail — relay CRUD, switch CRUD, online status, config
      shared/page.tsx              # Homes/rooms/relays shared with current user
      api-keys/page.tsx            # API key management (create, reveal, revoke, delete)
      settings/page.tsx            # Profile, password, theme, about

    api/
      auth/[...nextauth]/route.ts  # NextAuth v5 handler
      auth/register/route.ts       # POST — create account, send verification email
      auth/verify-email/route.ts   # GET  — validate token, mark email verified
      auth/resend-verification/route.ts  # POST — resend verification email
      auth/check-verified/route.ts       # POST — { verified: boolean } for polling
      auth/forgot-password/route.ts      # POST — generate reset token, send email
      auth/reset-password/route.ts       # POST — validate token, set new password
      esp/register/route.ts        # POST — ESP32 first registration (upsert device)
      esp/heartbeat/route.ts       # POST — ESP32 60s fallback sync (relay state reconciliation)
      trpc/[trpc]/route.ts         # tRPC fetch adapter

  components/
    dashboard/
      DashboardSidebar.tsx         # Responsive sidebar (mobile hamburger), nav, user menu
      DashboardOverviewClient.tsx  # Devices grid with real-time relay state
      LiveLastSeen.tsx             # Self-updating relative timestamp
      RelayScheduleDialog.tsx      # Schedule CRUD modal with badge
    sections/                      # Landing page sections (Hero, Features, HowItWorks, CTA)
    ui/                            # Radix-based UI primitives (shadcn/ui style)

  providers/
    DeviceSocketProvider.tsx       # Browser WS connection + fan-out to React listener sets
    SessionProvider.tsx            # NextAuth session context wrapper
    ThemeProvider.tsx              # next-themes wrapper

  server/
    auth/
      config.ts                   # NextAuth config — providers, callbacks, JWT strategy
      index.ts                    # Exports { auth, handlers, signIn, signOut }

    api/
      trpc.ts                     # Context factory, publicProcedure, protectedProcedure
      root.ts                     # appRouter — composes all 8 routers
      routers/
        device.ts                 # Device + relay CRUD, toggleRelay, pingDevice
        home.ts                   # Home CRUD + device assignment
        room.ts                   # Room CRUD + relay assignment
        sharing.ts                # Home/room/relay sharing (share by email, list, revoke)
        schedule.ts               # Relay schedule CRUD + toggle enabled
        switch.ts                 # Physical switch CRUD + listAllRelays
        apiKey.ts                 # API key CRUD (create/revoke/delete)
        user.ts                   # updateSelf (name, password)
      lib/
        permissions.ts            # getDeviceAccess, getRelayAccess (owner/shared/none)

    ws-server.ts                  # WS server — all real-time logic (590 lines)
                                  #   • ESP32 auth, ping, relay_ack, switch_trigger handlers
                                  #   • Browser subscribe / fan-out
                                  #   • Internal HTTP API (push-relay, ping-device, etc.)
                                  #   • Schedule executor (60s interval)
                                  #   • createWss() / attachWss() exports
                                  #   • WS-level heartbeat (30s ping/pong)

  trpc/
    react.tsx                     # api = createTRPCReact<AppRouter>(), TRPCReactProvider
    server.ts                     # Server-side tRPC caller
```

---

## ESP32 Firmware (`firmware/`)

```
src/
  main.cpp                    # State machine: PORTAL → CONNECT → REGISTER → RUN
                              #   • Factory reset detection (BOOT button hold 3s)
                              #   • WiFi connect + retry logic
                              #   • HTTP registration on first connect
                              #   • WS loop + switch polling

include/
  Config.h                   # All compile-time constants
                              #   • DEBUG_MODE, AP_SSID_PREFIX ("SmartHUB-")
                              #   • Timeouts, MAX_RELAYS, STATUS_LED_PIN
  Storage.h                  # NVS (Preferences) read/write
                              #   • DeviceConfig struct (WiFi, apiKey, server, devMode)
                              #   • RelayConfig / SwitchConfig persistence
                              #   • saveRelayState(index, bool) — single-key write to reduce flash wear
                              #   • consumeFactoryResetFlag() — one-shot flag for server
  CaptivePortal.h            # WiFi AP + DNS server + embedded HTTP config form
                              #   • SSID: "SmartHUB-" + last 3 MAC bytes (unique per device)
                              #   • DNS redirects all domains to 192.168.4.1 (captive portal popup)
                              #   • /save POST: write NVS, reboot
                              #   • 5-minute timeout → auto-reboot
  HubClient.h                # Core connectivity class
                              #   • registerDevice() — POST /api/esp/register
                              #   • connectWebSocket() — WebSocketsClient with SSL support
                              #   • loop() — WS loop + 90s watchdog + 10s auth timeout
                              #   • _handleMessage() — auth_ok/fail, ping, relay_cmd, switch messages
  RelayManager.h             # GPIO output management (max 8 relays)
                              #   • Active-LOW: relay ON = GPIO LOW
                              #   • applyServerConfig() — overwrites relay table + saves to NVS
                              #   • setById(id, state) — sets GPIO, records millis() of change
                              #   • Rejects pins 34–39 (input-only on all ESP32 variants)
  SwitchManager.h            # Input pin monitoring (max 8 switches)
                              #   • Two-way/three-way: polling + 50ms debounce
                              #   • Momentary: ISR on RISING edge + 150ms cooldown
                              #   • Input-only pins (34–39): 5/6-sample majority vote vs. floating noise
  SwitchTypes.h              # SwitchType enum + SwitchConfig struct
  StatusLed.h                # Non-blocking LED blink driver (FAST/SLOW/SOLID/OFF)
  Debug.h                    # Conditional color-coded serial logging with timestamps
                              #   • DEBUG_MODE=0 → all macros = do{}while(0) (zero overhead)
```
