# Tech Stack

## Dashboard (`dashboard/`)

| Category  | Technology                                        |
| --------- | ------------------------------------------------- |
| Framework | Next.js 16 (App Router), TypeScript               |
| API       | tRPC v11 (React Query)                            |
| Auth      | NextAuth v5 (credentials + Google OAuth, JWT)     |
| Database  | MongoDB via Prisma 5                              |
| Styling   | Tailwind CSS 3, Radix UI, shadcn/ui               |
| WebSocket | `ws` library — standalone server on port 4001     |
| Theming   | next-themes, CSS variables in `globals.config.ts` |

## ESP32 Firmware (`firmware/`)

| Category  | Technology                                                |
| --------- | --------------------------------------------------------- |
| Framework | Arduino (PlatformIO, espressif32)                         |
| Board     | esp32dev — 240MHz, 320KB RAM, 4MB Flash                   |
| Libraries | WebSockets 2.7.3, ArduinoJson 7.4.3                       |
| Storage   | NVS (Preferences) for config, relay states, switch config |
