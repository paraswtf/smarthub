# Blockphrase — T3 Stack

Built with the [T3 Stack](https://create.t3.gg/) — Next.js App Router, TypeScript, Tailwind CSS, tRPC, Prisma, and NextAuth.

## Stack

| Technology                  | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| **Next.js 14** (App Router) | Framework & routing                            |
| **TypeScript**              | Type safety                                    |
| **Tailwind CSS**            | Styling (preserves original design tokens)     |
| **tRPC**                    | End-to-end type-safe API                       |
| **Prisma**                  | Database ORM (SQLite in dev, Postgres in prod) |
| **NextAuth v5**             | Admin authentication                           |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your values

# 3. Push database schema
npm run db:push

# 4. Start dev server
npm run dev
```

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── page.tsx            # Home page
│   ├── about/              # About page
│   ├── services/           # Services page
│   ├── blog/               # Blog page + client component
│   ├── case-studies/       # Case studies page + client component
│   ├── contact/            # Contact page (with tRPC form)
│   ├── admin/              # Admin dashboard + login
│   └── api/
│       ├── auth/           # NextAuth route handler
│       └── trpc/           # tRPC route handler
├── components/
│   ├── Nav.tsx             # Sticky nav with mobile hamburger
│   ├── Footer.tsx          # Site footer
│   └── sections/           # Page section components
│       ├── Hero.tsx
│       ├── ServicesGrid.tsx
│       ├── AboutSnippet.tsx
│       ├── Partners.tsx    # Partners CMS (admin-gated)
│       └── CtaBanner.tsx
├── server/
│   ├── auth/               # NextAuth config
│   ├── db.ts               # Prisma client singleton
│   └── api/
│       ├── trpc.ts         # tRPC initialisation + middleware
│       ├── root.ts         # Root router
│       └── routers/
│           ├── partner.ts
│           ├── contact.ts
│           ├── blog.ts
│           └── caseStudy.ts
├── trpc/
│   ├── react.tsx           # Client-side tRPC provider
│   ├── server.ts           # Server-side caller
│   └── query-client.ts
└── styles/
    └── globals.css         # Tailwind + design tokens
```

## Admin Access

Navigate to `/admin/login` and sign in with:

- **Email**: `admin@blockphrase.com` (or value of `ADMIN_EMAIL` env var)
- **Password**: `blockphrase2026` (or value of `ADMIN_PASSWORD` env var)

> ⚠️ Change the admin credentials in production and use a hashed password!

## Features Converted from HTML

| Original HTML                 | T3 Stack equivalent                       |
| ----------------------------- | ----------------------------------------- |
| `window.storage` for partners | Prisma `Partner` model + tRPC CRUD        |
| Hardcoded password modal      | NextAuth credentials provider             |
| Inline JavaScript routing     | Next.js App Router pages                  |
| Contact form (no backend)     | tRPC `contact.submit` mutation → DB       |
| Blog posts (static)           | Prisma `Post` model + tRPC queries        |
| Case studies + email gate     | Prisma `CaseStudy` + tRPC `requestAccess` |
| Inline CSS variables          | Tailwind config + globals.css tokens      |
| Single HTML file              | ~25 TypeScript files, fully typed         |

## Deployment

### Vercel (recommended)

```bash
# Set these env vars in Vercel dashboard:
# DATABASE_URL (Postgres)
# AUTH_SECRET
# ADMIN_EMAIL
# ADMIN_PASSWORD
```

For production, swap the `datasource` in `prisma/schema.prisma` to:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```
