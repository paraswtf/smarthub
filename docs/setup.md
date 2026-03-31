# Setup & Running Locally

## Environment Variables

Create `dashboard/.env`:

```env
DATABASE_URL=mongodb+srv://...
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=...
AUTH_GOOGLE_CLIENT_ID=...
AUTH_GOOGLE_CLIENT_SECRET=...
WS_PORT=4001
WS_SECRET=...
WS_INTERNAL_URL=http://localhost:4001
```

## Running the Dashboard

```bash
# From repo root
npm install
npm run dev          # Next.js on :3000
npm run ws           # WS server on :4001
npm run db:push      # Push Prisma schema to MongoDB
```

## Running the ESP32 Firmware

```bash
cd firmware
pio run --target upload
pio device monitor
```

## Production / Self-Hosted

See [deployment.md](../deployment.md) for Docker Compose setup with auto-deploy.
