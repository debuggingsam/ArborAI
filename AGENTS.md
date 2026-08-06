# ArborAI contributor guide

## Repository structure

This repository is the starting scaffold for ArborAI. The intended layout is:

- `apps/web/`: Next.js and React Flow frontend.
- `apps/api/`: NestJS backend.
- `packages/shared/`: shared DTOs, event names, enums, and schemas.
- `docs/`: architecture and development documentation.
- `docker-compose.yml`: local infrastructure orchestration.

The current implementation uses a Vite/React frontend, React Flow, a TypeScript HTTP API, Prisma/PostgreSQL, and shared TypeScript contracts. Read `docs/product-model.md`, `docs/context-rules.md`, `docs/api-contracts.md`, `docs/project-status.md`, and `docs/architecture.md` before changing code.

## Package manager and commands

The repository uses npm. Run commands from the repository root:

```bash
npm install
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
```

The root scripts currently provide a dependency-free baseline and report that there are no workspace applications to run. As applications are added, their package scripts should be invoked through the root scripts rather than duplicated with unrelated tooling.

## Naming and dependency conventions

- Use TypeScript for application and shared-package code.
- Use `camelCase` for variables and functions, `PascalCase` for React components, classes, DTOs, and types, and `kebab-case` for route and file names where the framework convention permits.
- Keep API contracts, event names, enums, and validation schemas in `packages/shared/` when they are used by both applications.
- `apps/web` may depend on `packages/shared`; `apps/api` may depend on `packages/shared`.
- Shared packages must not depend on either application. The web and API applications must not import each other's implementation details.
- Do not silently change public API contracts or WebSocket event payloads.
- Keep topics and message nodes as distinct relationships; never flatten topics into message nodes.
- Preserve mock-provider support and keep every ticket independently reviewable.

## Testing expectations

Every behavior change should include or update the nearest relevant unit/integration test. Run the narrowest relevant test while developing, then run the root lint, typecheck, test, and build commands before handoff. Tests and local development must continue to work without a paid AI API key; use mock/offline providers where applicable.

## Change boundaries

Work only on the requested ticket. Preserve established infrastructure and avoid unrelated refactors, dependency replacements, formatting-only churn, and speculative product features. Update documentation when architecture, setup, environment variables, or API contracts change.
