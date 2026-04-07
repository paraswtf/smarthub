# Tech Stack

## Dashboard (`dashboard/`)

| Category   | Technology                                     | Notes                                                 |
| ---------- | ---------------------------------------------- | ----------------------------------------------------- |
| Framework  | Next.js 16 (App Router), TypeScript            | `output: "standalone"` for Docker                     |
| API        | tRPC v11 + React Query v5                      | SuperJSON transformer, batch streaming                |
| Auth       | NextAuth v5 (beta)                             | Credentials + Google OAuth, JWT strategy              |
| Database   | MongoDB 7 via Prisma 5                         | Replica set required (even locally)                   |
| Styling    | Tailwind CSS 3, Radix UI primitives, shadcn/ui | Themed via CSS variables in `globals.config.ts`       |
| WebSocket  | `ws` library                                   | Standalone on :4001 (prod) or combined on :3000 (dev) |
| Theming    | `next-themes`                                  | Dark default, CSS variable theming                    |
| Email      | `@getbrevo/brevo` (REST API)                   | Verification + password reset                         |
| Validation | `zod`                                          | tRPC input schemas                                    |
| Dev server | `tsx`                                          | Runs `server.ts` without compilation                  |
| Formatting | Prettier + Husky + lint-staged                 | Pre-commit hook                                       |

## ESP32 Firmware (`firmware/`)

| Category         | Technology                        | Notes                                       |
| ---------------- | --------------------------------- | ------------------------------------------- |
| Framework        | Arduino (PlatformIO, espressif32) | `min_spiffs` partition for more app space   |
| Board            | esp32dev                          | 240MHz dual-core, 320KB RAM, 4MB Flash      |
| WebSocket client | links2004/WebSockets 2.4.1+       | Handles WS + WSS, PING/PONG, reconnect      |
| JSON             | bblanchon/ArduinoJson 7.x         | Zero-copy parsing, `JsonDocument`           |
| Storage          | Arduino `Preferences` (NVS)       | Key/value flash storage per namespace       |
| HTTP             | `HTTPClient` (built-in)           | Used for registration + heartbeat endpoints |

## Infrastructure

| Component         | Technology                       | Notes                                                   |
| ----------------- | -------------------------------- | ------------------------------------------------------- |
| Container runtime | Docker + Docker Compose          | 4 services: mongodb, redis, nextjs, wsserver            |
| Image registry    | GitHub Container Registry (GHCR) | Free, private, tied to repo                             |
| Reverse proxy     | Caddy                            | Auto TLS, routes `HOST:443` → Next.js, `HOST:4001` → WS |
| CI/CD             | GitHub Actions                   | Build → push GHCR → SSH deploy                          |
| Database          | MongoDB 7                        | Replica set `rs0` (required by Prisma)                  |
| Cache             | Redis 7                          | Reserved for future rate limiting; currently unused     |
