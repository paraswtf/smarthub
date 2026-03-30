# ESP Hub — Home Automation Control Center

A full-stack home automation dashboard for connecting multiple ESP32 devices to a single account.
Built with Next.js 15, tRPC, Prisma (MongoDB), NextAuth, shadcn/ui, and Tailwind CSS.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Web Dashboard (Next.js)                 │
│  /dashboard  /auth/login  /auth/register             │
│  tRPC → Prisma → MongoDB                            │
└──────────────┬──────────────────────────────────────┘
               │  REST + WebSocket
       ┌───────┴───────┐
       │  WS Server     │  ← src/server/ws-server.ts
       │  :4001         │     (standalone Node process)
       └───────┬───────┘
               │  WebSocket (persistent)
    ┌──────────┼──────────┐
  ESP32 #1   ESP32 #2   ESP32 #3  ...
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in:

```env
DATABASE_URL="mongodb+srv://..."
AUTH_SECRET="some-secret-32-chars"
NEXTAUTH_URL="http://localhost:3000"

# Superadmin (bypasses DB)
SUPERADMIN_EMAIL="admin@example.com"
SUPERADMIN_PASSWORD="changeme"

# WebSocket server
WS_PORT=4001
WS_SECRET="internal-ws-secret"
WS_INTERNAL_URL="http://localhost:4001"
```

### 3. Push Prisma schema

```bash
npm run db:push
```

### 4. Run the dev server

```bash
npm run dev
```

### 5. Run the WebSocket server (separate terminal)

```bash
npx tsx src/server/ws-server.ts
# or add "ws": "tsx src/server/ws-server.ts" to package.json scripts
```

---

## Theme Configuration

**All theme values live in `globals.config.ts`** in the project root.

```ts
// globals.config.ts
export const appConfig = {
	name: "ESP Hub", // App name shown in sidebar + auth pages
	maxRelaysPerDevice: 8, // UI cap on relays per device
	wsReconnectInterval: 5000, // ESP32 reconnect interval hint (ms)
};

export const lightTheme = {
	primary: "161 94% 30%", // HSL → emerald green
	// ...all shadcn CSS variable tokens
};

export const darkTheme = {
	primary: "161 69% 42%", // electric emerald on dark bg
	// ...
};
```

To change the entire app's accent color (e.g. to blue):

```ts
primary: "217 91% 60%",   // HSL for #3b82f6
```

The values flow through `globals.css` into Tailwind's `hsl(var(--primary))` tokens,
which power every shadcn component automatically.

---

## ESP32 Integration

### Step 1 — Captive Portal (first boot)

When an ESP32 starts without saved config, it broadcasts a WiFi AP (`ESP-Setup`).
Connecting to it opens a captive portal where the user enters:

- Home WiFi SSID + password
- Friendly device name
- API key (from `/dashboard/api-keys`)

### Step 2 — Registration

On connect the ESP32 calls:

```
POST /api/esp/register
{
  "apiKey": "ehk_...",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "name": "Living Room Board",
  "ssid": "HomeWiFi",
  "firmwareVersion": "1.0.0"
}
```

Response includes the device ID and any pre-configured relays.

### Step 3 — WebSocket connection

```js
// ESP32 Arduino sketch (pseudocode)
ws.connect("ws://your-server.com:4001");

// Authenticate
ws.send({ type: "auth", apiKey: "ehk_...", macAddress: "AA:BB:CC:DD:EE:FF" });

// Handle auth_ok → configure GPIO pins from relay list
// Handle relay_cmd → digitalWrite(pin, state)

// Send heartbeat every 30s
ws.send({ type: "heartbeat", deviceId: "...", relayStates: [{ id, state }] });
```

### Step 4 — Heartbeat fallback (offline sync)

If WebSocket is unavailable the ESP32 can poll:

```
POST /api/esp/heartbeat
{
  "deviceId": "...",
  "apiKey": "ehk_...",
  "relayStates": [{ "id": "relay_id", "state": true }]
}
```

Response includes the authoritative state for all relays.

---

## Dashboard Pages

| Route                     | Description                                               |
| ------------------------- | --------------------------------------------------------- |
| `/auth/login`             | Sign in with email + password                             |
| `/auth/register`          | Create new account                                        |
| `/dashboard`              | Overview: stats, device grid, setup guide                 |
| `/dashboard/devices`      | All devices with online/offline status                    |
| `/dashboard/devices/[id]` | Device detail: relay toggle grid, edit, add/remove relays |
| `/dashboard/api-keys`     | Create, reveal, copy, revoke, delete API keys             |
| `/dashboard/settings`     | Change name, password, appearance                         |

---

## API Routes

| Route                            | Auth    | Purpose                           |
| -------------------------------- | ------- | --------------------------------- |
| `POST /api/auth/register`        | Public  | Create user account               |
| `POST /api/esp/register`         | API key | ESP32 first-boot registration     |
| `POST /api/esp/heartbeat`        | API key | Periodic state sync               |
| `POST /api/esp/ws-relay`         | Session | Push relay command to live device |
| `POST /api/user/update-name`     | Session | Update display name               |
| `POST /api/user/change-password` | Session | Change password                   |

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── auth/register/      ← User registration
│   │   ├── esp/
│   │   │   ├── register/       ← ESP32 first-boot
│   │   │   ├── heartbeat/      ← Polling fallback
│   │   │   └── ws-relay/       ← Push relay cmd to WS server
│   │   └── user/
│   │       ├── update-name/
│   │       └── change-password/
│   ├── auth/
│   │   ├── login/              ← Sign in page
│   │   └── register/           ← Sign up page
│   └── dashboard/
│       ├── layout.tsx          ← Auth guard + sidebar
│       ├── page.tsx            ← Overview
│       ├── devices/
│       │   ├── page.tsx        ← Device list
│       │   └── [id]/page.tsx   ← Device detail + relay controls
│       ├── api-keys/page.tsx   ← API key management
│       └── settings/page.tsx   ← Account settings
├── components/
│   ├── ui/                     ← shadcn primitives
│   ├── dashboard/
│   │   ├── DashboardSidebar.tsx
│   │   ├── DashboardOverviewClient.tsx
│   └── ThemeToggle.tsx
├── providers/
│   └── ThemeProvider.tsx       ← next-themes wrapper
├── server/
│   ├── api/routers/
│   │   ├── device.ts           ← Device + relay mutations
│   │   └── apiKey.ts           ← API key management
│   └── ws-server.ts            ← Standalone WebSocket server
└── lib/
    └── utils.ts                ← cn(), timeAgo(), maskKey()

globals.config.ts               ← ⭐ Single source of truth for theme + app config
```
