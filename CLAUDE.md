# Project Context

Read [README.md](README.md) for full project context including architecture, tech stack, WebSocket protocol, database schema, ESP32 boot flow, and design decisions.

## Quick Reference

- **Dashboard**: `dashboard/` — Next.js 16, tRPC v11, Prisma/MongoDB, NextAuth v5, WebSocket server (port 4001)
- **Firmware**: `firmware/` — ESP32 Arduino (PlatformIO), WebSocket client, NVS storage
- **Monorepo**: npm workspaces — run `npm run dev` / `npm run ws` from root
- **ESP32 is authoritative** for physical relay states; server stores desired state, ESP32 confirms via `relay_ack` or heartbeat
- **Online status**: `lastSeenAt` in DB (updated by heartbeat, throttled to 30s) + on-demand `pingDevice`
- **Formatting**: Prettier pre-commit hook via Husky + lint-staged; run `npm run format` to format all files
