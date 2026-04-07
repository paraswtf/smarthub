# Setup & Running Locally

## Prerequisites

- Node.js 20+
- MongoDB 7 with a replica set (required by Prisma — even locally)
- PlatformIO CLI (firmware flashing only)

### Quick MongoDB replica set (Docker)

```bash
docker run -d --name mongo \
  -p 27017:27017 \
  mongo:7 --replSet rs0 --bind_ip_all

# One-time initialisation (run once after starting the container)
docker exec mongo mongosh --eval \
  'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'
```

---

## Environment Variables

Create `dashboard/.env` (copy from `dashboard/.env.example`):

```env
# ─── Database ─────────────────────────────────────────────────
DATABASE_URL="mongodb://localhost:27017/esphub?replicaSet=rs0&directConnection=true"

# ─── Auth ─────────────────────────────────────────────────────
AUTH_SECRET="<random 32-byte hex>"
NEXTAUTH_URL="http://localhost:3000"

# ─── WebSocket ────────────────────────────────────────────────
WS_SECRET="<random secret>"

# URL Next.js uses to reach the WS server internally.
# In dev both run on the same port (combined server), so this is :3000.
WS_INTERNAL_URL="http://localhost:3000"

# Only used when running the WS server standalone (npm run ws / Docker wsserver target).
WS_PORT=4001

# ─── Browser ──────────────────────────────────────────────────
NEXT_PUBLIC_API_URL="http://localhost:3000"

# NEXT_PUBLIC_WS_PORT — intentionally UNSET in dev.
# When unset the browser connects to the same host:port as the API (port 3000).
# Set to 4001 in production where Caddy exposes WS on :4001 separately.
# NEXT_PUBLIC_WS_PORT=4001

# ─── Google OAuth (optional) ──────────────────────────────────
AUTH_GOOGLE_CLIENT_ID=""
AUTH_GOOGLE_CLIENT_SECRET=""

# ─── Email — needed for registration + password reset ─────────
BREVO_API_KEY=""
BREVO_SENDER_EMAIL=""
```

### Variable reference

| Variable              | Dev                                                                     | Prod                           | Notes                                   |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------ | --------------------------------------- |
| `DATABASE_URL`        | `mongodb://localhost:27017/esphub?replicaSet=rs0&directConnection=true` | Atlas URI                      | Must include `replicaSet`               |
| `AUTH_SECRET`         | Any string                                                              | Strong random                  | Signs JWT session tokens                |
| `WS_SECRET`           | Any string                                                              | Strong random                  | Next.js → WS server internal auth       |
| `WS_INTERNAL_URL`     | `http://localhost:3000`                                                 | `http://wsserver:4001`         | **Port 3000 in dev** — combined server  |
| `WS_PORT`             | `4001`                                                                  | `4001`                         | Standalone WS container only            |
| `NEXT_PUBLIC_WS_PORT` | **unset**                                                               | `4001`                         | Unset = same port as API                |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000`                                                 | `https://smarthub.example.com` | Baked into browser bundle at build time |

---

## Running the Dashboard

```bash
# From repo root
npm install          # installs deps for all workspaces + generates Prisma client
npm run db:push      # push Prisma schema to MongoDB (once, and after schema changes)
npm run dev          # starts Next.js + WS server together on :3000
```

In development, **both Next.js and the WebSocket server run on port 3000**. The custom `dashboard/server.ts` routes:

- HTTP requests → Next.js request handler
- WebSocket upgrade to `/` or `/browser` → WS server
- WebSocket upgrade to `/_next/*` → Next.js HMR

You do **not** need to run `npm run ws` separately in development. That script is for running the WS server as a standalone process (used by the Docker `wsserver` container).

### Other commands

```bash
npm run db:studio    # Prisma Studio — visual browser for MongoDB data
npm run format       # Prettier-format all files (also runs automatically on commit)
npm run build        # Production Next.js build (standalone output)
```

---

## Running the ESP32 Firmware

Run from the **repo root** (not `firmware/`):

```bash
pio run -e esp32dev -t upload    # compile and flash
pio device monitor               # serial output at 115200 baud
```

The `platformio.ini` at the repo root sets `src_dir = firmware/src` and `include_dir = firmware/include`, so PlatformIO can be invoked from the root.

### Debug output

`firmware/include/Config.h` has `#define DEBUG_MODE 1` by default. This enables color-coded serial logging with timestamps and heap stats. Set to `0` for production — all debug macros compile away to nothing.

### First-boot setup (captive portal)

1. On first boot (or after factory reset), the ESP32 starts a WiFi AP named **`SmartHUB-AABBCC`** (last 3 bytes of its MAC address).
2. Connect from your phone or laptop. iOS and Android will automatically open the captive portal.
3. Fill in: WiFi SSID + password, API key (create one at **Dashboard → API Keys**), server hostname + port.
4. Save — the device reboots, connects to WiFi, registers via HTTP, then opens a WebSocket.

**Factory reset**: hold GPIO 0 (the BOOT button) for 3 seconds at any time. This wipes NVS config and restarts into the captive portal. A factory reset flag is sent to the server on the next registration, which wipes all relay assignments for that device.

---

## Production / Self-Hosted

See [deployment.md](../deployment.md) for Docker Compose + GitHub Actions auto-deploy.
