# ── Stage 1: Install dependencies ──
FROM node:20-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY dashboard/package.json ./dashboard/
COPY dashboard/prisma ./dashboard/prisma/
RUN npm ci --workspace=dashboard --ignore-scripts
RUN cd dashboard && npx prisma generate

# ── Stage 2: Build Next.js ──
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dashboard/node_modules ./dashboard/node_modules
COPY package.json package-lock.json ./
COPY dashboard/ ./dashboard/

# NEXT_PUBLIC_ vars are inlined at build time
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app/dashboard
RUN npm run build

# ── Stage 3a: Next.js production image ──
FROM node:20-alpine AS nextjs
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/dashboard/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/dashboard/.next/static ./dashboard/.next/static

USER nextjs
EXPOSE 3000

ENV HOSTNAME=0.0.0.0
ENV PORT=3000
CMD ["node", "dashboard/server.js"]

# ── Stage 3b: WebSocket server production image ──
FROM node:20-alpine AS wsserver
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# WS server needs full node_modules (tsx, ws, @prisma/client)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dashboard/node_modules ./dashboard/node_modules
COPY --from=deps /app/dashboard/prisma ./prisma
COPY --from=builder /app/dashboard/src/server/ws-server.ts ./src/server/ws-server.ts
COPY --from=builder /app/dashboard/package.json ./package.json
COPY --from=builder /app/dashboard/tsconfig.json ./tsconfig.json

USER nextjs
EXPOSE 4001

CMD ["npx", "tsx", "src/server/ws-server.ts"]
