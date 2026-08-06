# Local development

## Current runnable scaffold

ArborAI currently runs a Vite/React web app and TypeScript HTTP API, with
Prisma configured for PostgreSQL. It is not yet the target Next.js/NestJS or
WebSocket implementation. Use Node.js 20+ and npm.

```bash
npm install
npm run dev
```

The API defaults to `http://localhost:3001` and the Vite app defaults to
`http://localhost:5173`. API configuration is read from `apps/api/.env`; the
web app uses `VITE_API_URL` and defaults to the API URL above. Keep
`AI_PROVIDER=mock` for credential-free local development and tests.

For PostgreSQL work, configure `DATABASE_URL` in `apps/api/.env`, then run:

```bash
npm run db:migrate --prefix apps/api
npm run db:seed --prefix apps/api
```

`npm run db:reset --prefix apps/api` is destructive local-only reset-and-seed
work; do not run it against shared data. The database is required for migration
and seed commands and is not supplied by the repository yet.

## Verification

Run from the repository root:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

There is currently no formatter command, dedicated integration/browser suite,
Docker Compose configuration, or root database helper. Do not claim these
target capabilities exist until their tickets implement them. Real-provider
activation, when implemented, will use backend-only provider credentials and
model environment variables; mock mode must remain the default offline path.
