# CLAUDE.md — test-forge

## What this project is

test-forge is an AI-powered test harness that reads any backend codebase, understands its API surface, and generates Supertest (API) and Playwright (E2E) test suites automatically. It then runs those tests as GitHub Actions quality gates.

You point it at a repo. It reads the routes, models, and schemas. It calls Claude to generate real test files. Those tests run on every PR.

## Project structure

```
test-forge/
├── src/
│   ├── crawler/          # Reads target repo — extracts routes, models, schemas
│   │   ├── index.ts      # Entry point — orchestrates crawl
│   │   ├── django.ts     # Django/DRF route + model extractor
│   │   ├── express.ts    # Express route extractor
│   │   ├── fastapi.ts    # FastAPI route extractor
│   │   └── types.ts      # Shared types for crawl output
│   ├── generator/        # Calls Claude API — writes test files
│   │   ├── index.ts      # Entry point — orchestrates generation
│   │   ├── prompts.ts    # All Claude prompts live here
│   │   ├── supertest.ts  # Generates API test files
│   │   ├── playwright.ts # Generates E2E test files
│   │   └── writer.ts     # Writes generated files to disk
│   └── runner/           # Runs the generated tests
│       ├── index.ts      # Entry point
│       └── report.ts     # Parses results, formats report
├── tests/                # test-forge's own tests
├── scripts/
│   └── forge.ts          # CLI entrypoint — `npx ts-node scripts/forge.ts <repo-path>`
├── .github/
│   └── workflows/
│       └── harness.yml   # GitHub Actions — runs forge on every PR
├── CLAUDE.md             # This file
├── package.json
├── tsconfig.json
└── README.md
```

## How to run

```bash
# Install
npm install

# Point at a target repo and generate tests
npx ts-node scripts/forge.ts --target /path/to/payout-engine --framework django

# Run generated tests
npm test
```

## Environment variables

```
ANTHROPIC_API_KEY=     # Required — Claude API key for test generation
TARGET_REPO=           # Path or URL to the repo being tested
TARGET_BASE_URL=       # Base URL of the running server (e.g. http://localhost:8000)
```

## Core concepts

**Crawler** — reads the target repo's source files and extracts a structured `APIMap`: a list of routes with their HTTP method, path, request body shape, response shape, and any auth requirements. Framework-specific extractors handle Django URL patterns, Express routers, and FastAPI decorators.

**Generator** — takes the `APIMap` and calls Claude. For each route, Claude generates: happy-path tests, edge case tests, auth failure tests, and validation tests. Output is written as real `.test.ts` files using Supertest for API tests and Playwright for E2E flows.

**Runner** — executes the generated tests using Jest (Supertest) and Playwright test runner. Collects results and generates a structured report.

## What Claude should never do

- Never hardcode credentials or secrets in generated test files — use environment variables
- Never generate tests that mutate production data — always target a test DB
- Never skip writing the `beforeAll` / `afterAll` setup — tests must be self-contained
- Never generate a test without at least one assertion

## Adding a new framework extractor

1. Create `src/crawler/<framework>.ts`
2. Export a function `extract(repoPath: string): Promise<APIMap>`
3. Register it in `src/crawler/index.ts`
4. Add the framework name to the `--framework` CLI flag options in `scripts/forge.ts`

## Key decisions and why

- **TypeScript throughout** — matches Playo's stack, gives us type safety on the APIMap schema
- **Supertest for API tests** — no server needed, fires directly against Express/Django via HTTP
- **Playwright for E2E** — browser automation, catches UI regressions Claude Code might introduce
- **Claude generates tests, humans review** — generated tests go into `generated/` and must be committed deliberately; nothing auto-runs without a human seeing it first
- **Framework-agnostic crawler** — pluggable extractors mean this works on Django, Express, FastAPI without changing the generator
