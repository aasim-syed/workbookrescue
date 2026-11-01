# WorkbookRescue

Recovers how a business output is built across linked Excel/CSV files, records the human steps between them, and tests that the outputs don't silently change. Spec: [`docs/spec.md`](docs/spec.md).

```
apps/web/            Vite + React + shadcn/ui frontend, and the API
  src/               UI (landing, auth, projects, project workspace)
  server/            Hono API: auth, import, lineage, steps, baselines, export
    _lib/core/       xlsx/csv parsing, reference tokenizer, graph, regression compare
    _lib/db/         Drizzle schema + migrations (Neon Postgres)
  api/index.ts       Vercel Function entry (serves ../server)
  tests/             vitest (core engine)
fixtures/            synthetic manufacturing-quote workbooks (generated)
docs/                spec
```

Deviation from the spec: the backend is TypeScript (Hono + Drizzle) rather than FastAPI, so the whole app deploys as one Vercel project with a Neon database. The spec's extraction rules still hold: files are read-only, macros never run, and nothing is called `Verified` unless it was extracted or confirmed.

## Run locally

```
npm install
npm run dev          # API on :8787, web on :5173
```

With no `DATABASE_URL`, the API uses an in-process Postgres (PGlite, stored in `apps/web/.data`). Set `PGLITE_DIR=memory` for a throwaway database.

Try real files: `npm run fixtures -w apps/web` writes `.xlsx` files to `fixtures/manufacturing_quote/`.

## Deploy (Vercel + Neon)

1. Create a Neon project, copy its connection string.
2. `DATABASE_URL=<string> npm run db:migrate -w apps/web`
3. Vercel project: root directory `apps/web`, framework Vite. Environment variables:
   - `DATABASE_URL`: the Neon string
   - `SESSION_SECRET`: a long random string (`openssl rand -hex 32`)
4. Deploy. `vercel.json` already routes `/api/*` to the function and everything else to the SPA.

## Limits

- Uploads are capped at 4 MB (Vercel Functions' request-body limit), 100k cells per file.
- Mode A regression only: compares saved values, never recalculates. A formula with no saved result is `INCONCLUSIVE`, never `PASS`.
- Guest sandboxes are open to anyone and have no rate limiting yet.
