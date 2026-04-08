# Deployment Guide

Self-hosted deployment using Docker Compose. Runs the Next.js dashboard, WebSocket server, MongoDB, and Redis on a single machine.

## Prerequisites

- Docker and Docker Compose (v2)
- Git

## Quick Start

### 1. Clone and configure

```bash
git clone <your-repo-url> smarthub
cd smarthub
cp .env.example .env
```

Edit `.env` and fill in:

| Variable              | Description                                                                          |
| --------------------- | ------------------------------------------------------------------------------------ |
| `AUTH_SECRET`         | Session secret. Generate with `openssl rand -base64 32`                              |
| `WS_SECRET`           | Shared secret between Next.js and WS server. Generate with `openssl rand -base64 32` |
| `NEXT_PUBLIC_API_URL` | `http://<YOUR_SERVER_IP>:3000` - the LAN IP of your server                           |
| `NEXT_PUBLIC_WS_PORT` | `4001` (default)                                                                     |
| `WEBHOOK_SECRET`      | Secret for GitHub webhook (see auto-deploy section)                                  |
| `BREVO_API_KEY`       | Optional - for email notifications                                                   |
| `BREVO_SENDER_EMAIL`  | Optional - verified sender in Brevo                                                  |

### 2. Start services

```bash
docker compose up -d
```

This starts 5 services:

- **mongodb** - MongoDB 7 with replica set (required by Prisma)
- **redis** - Redis 7 for rate limiting
- **nextjs** - Dashboard on port 3000
- **wsserver** - WebSocket server on port 4001
- **webhook** - Auto-deploy listener on port 9000

### 3. Initialize the database

On first deploy, push the Prisma schema to MongoDB:

```bash
docker compose exec nextjs npx prisma db push
```

### 4. Create your account

Open `http://<YOUR_SERVER_IP>:3000` in a browser and register.

## ESP32 Firmware Configuration

In the firmware, set the server IP so devices connect to your deployment:

```
API_URL = http://<YOUR_SERVER_IP>:3000
WS_URL  = ws://<YOUR_SERVER_IP>:4001
```

Flash the ESP32 via PlatformIO from the `firmware/` directory.

## Auto-Deploy on Git Push

The `webhook` container listens for GitHub push events and automatically rebuilds the app.

### Setup

1. Go to your GitHub repo **Settings > Webhooks > Add webhook**
2. Set:
    - **Payload URL**: `http://<YOUR_SERVER_IP>:9000/hooks/redeploy`
    - **Content type**: `application/json`
    - **Secret**: same value as `WEBHOOK_SECRET` in your `.env`
    - **Events**: Just the push event
3. Save

On every push to `main`, the webhook triggers:

```
git pull origin main
docker compose up --build -d nextjs wsserver
```

Only the app containers are rebuilt - MongoDB and Redis data persist.

## Useful Commands

```bash
# View logs
docker compose logs -f nextjs wsserver

# Restart a specific service
docker compose restart wsserver

# Rebuild after config changes
docker compose up --build -d

# Open Prisma Studio (DB browser)
docker compose exec nextjs npx prisma studio

# MongoDB shell
docker compose exec mongodb mongosh esphub

# Backup MongoDB
docker compose exec mongodb mongodump --db esphub --archive > backup.archive

# Restore MongoDB
docker compose exec -T mongodb mongorestore --archive < backup.archive

# Stop everything (data persists)
docker compose down

# Stop and delete all data
docker compose down -v
```

## Rebuilding After IP Change

`NEXT_PUBLIC_API_URL` is baked into the Next.js build. If your server IP changes:

```bash
# Update .env with new IP, then rebuild
docker compose up --build -d nextjs
```

## Architecture

```
                    ┌─────────────┐
                    │   Browser   │
                    └──┬──────┬───┘
                       │      │
                  :3000│      │:4001 (WebSocket)
                       │      │
              ┌────────▼──┐ ┌─▼──────────┐
              │  Next.js   │ │  WS Server │
              │ (dashboard)│ │            │
              └────┬───────┘ └────┬───────┘
                   │              │
                   │  ┌───────┐   │
                   └──► Mongo ◄───┘
                      └───────┘

         ┌─────────┐         ┌──────────┐
         │  Redis  │         │  ESP32   │
         │ (cache) │         │ devices  │──:4001──►WS Server
         └─────────┘         └──────────┘
```
