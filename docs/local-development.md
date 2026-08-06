# Local development

ArborAI currently has a database-free, offline development baseline. Node.js 20 or newer and npm are required.

1. Copy `.env.example` to `.env` at the repository root and ensure PostgreSQL is available at `DATABASE_URL`.
2. Run `npm install`.
3. Run `npm run db:migrate --workspace @arborai/api` and, optionally, `npm run db:seed --workspace @arborai/api`.
4. Run `npm run dev` from the repository root. The API is available at `http://localhost:3001/health` and the web status page at `http://localhost:3000`.

The web application shell loads conversations from the API and supports creating, selecting (via `?conversation=<id>`), renaming, and deleting them. It displays understandable loading/empty/error states and a backend connection indicator; the graph, node details, and prompt composer are placeholders for later tickets. Override `NEXT_PUBLIC_API_URL` for the browser API URL; the local default is used when omitted. The API only accepts `WEB_ORIGIN` as its configured CORS origin and requires `API_PORT`, `WEB_ORIGIN`, and `AI_PROVIDER`. Keep `AI_PROVIDER=mock` for offline development.

`npm run db:reset --workspace @arborai/api` is a local-only reset-and-seed command. Validation commands are `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
