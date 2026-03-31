# Project Structure

## Dashboard (`dashboard/`)

```
prisma/schema.prisma              # MongoDB models
globals.config.ts                  # Theme color values
src/
  app/
    dashboard/
      page.tsx                     # Overview (homes, stats)
      homes/page.tsx               # Home list
      homes/[id]/page.tsx          # Home detail (rooms, devices)
      rooms/[id]/page.tsx          # Room detail (relays, schedules)
      devices/[id]/page.tsx        # Device detail (relays, switches, config)
      shared/page.tsx              # Shared homes/rooms/relays
      api-keys/page.tsx            # API key management
      settings/page.tsx            # User settings
    api/
      esp/register/route.ts        # ESP32 registration (HTTP POST)
      esp/heartbeat/route.ts       # ESP32 heartbeat sync
  components/
    dashboard/
      DashboardSidebar.tsx         # Collapsible sidebar
      DashboardOverviewClient.tsx  # Overview stats + home grid
      RelayScheduleDialog.tsx      # Schedule alarm UI
    ui/                            # shadcn/ui components
  providers/
    DeviceSocketProvider.tsx       # WS connection manager
  server/
    ws-server.ts                   # WS + HTTP server + schedule executor
    api/routers/
      device.ts                    # CRUD + toggleRelay + pingDevice
      home.ts                      # CRUD + device assignment
      room.ts                      # CRUD + relay assignment
      schedule.ts                  # Relay schedule CRUD
      sharing.ts                   # Home/room/relay sharing
      switch.ts                    # Physical switch CRUD
      apiKey.ts                    # API key CRUD
      user.ts                      # User queries
    api/lib/permissions.ts         # getDeviceAccess, getRelayAccess
```

## ESP32 Firmware (`firmware/`)

```
platformio.ini                     # PlatformIO config
src/main.cpp                       # State machine: PORTAL → CONNECT → REGISTER → RUN
include/
  Config.h                         # Constants (timeouts, max relays, LED pin)
  Storage.h                        # NVS read/write
  CaptivePortal.h                  # WiFi AP + config web form
  HubClient.h                      # WebSocket client: auth, ping, relay commands
  RelayManager.h                   # GPIO output management
  SwitchManager.h                  # Input pin monitoring (two-way/three-way/momentary)
```
