# test-forge ⚡

AI-powered test harness. Points at any backend codebase, reads the routes, calls Claude, writes real Playwright + Supertest tests. Runs them as GitHub Actions quality gates.

## How it works

```
your repo → crawler → APIMap → Claude → test files → GitHub Actions
```

1. **Crawl** — reads your `urls.py`, `views.py`, `models.py` (Django) or route files (Express/FastAPI). Builds an `APIMap`: every route, method, body shape, auth requirement.
2. **Generate** — sends the APIMap to Claude. Claude plans a test strategy (critical flows, high-risk endpoints, security concerns) then writes real test files.
3. **Run** — Jest + Supertest runs API tests. Playwright runs E2E flow tests. Both wired into GitHub Actions.

## Quickstart

```bash
# Install
npm install

# Set your Anthropic API key
cp .env.example .env
# edit .env and add ANTHROPIC_API_KEY

# Point at a repo and generate tests
npx ts-node scripts/forge.ts --target /path/to/payout-engine --base-url http://localhost:8000

# Run generated tests
npm test          # API tests (Supertest + Jest)
npm run test:e2e  # E2E tests (Playwright)
```

## CLI options

```
forge --target <path>         Path to the repo to test (required)
      --framework <name>      django | express | fastapi | auto (default: auto)
      --base-url <url>        Base URL of the running server (default: http://localhost:8000)
      --output <path>         Where to write generated tests (default: .)
```

## Output structure

```
generated/
├── api/
│   ├── post-payouts.test.ts      # Supertest tests for POST /api/payouts/
│   ├── post-refunds.test.ts
│   └── get-ledger.test.ts
└── e2e/
    ├── create-payout-flow.test.ts   # Playwright: full payout creation flow
    └── refund-flow.test.ts
reports/
└── forge-report-<timestamp>.json    # Full strategy + metadata
```

## Framework support

| Framework | Status |
|-----------|--------|
| Django + DRF | ✅ Supported |
| Express | 🔜 Coming soon |
| FastAPI | 🔜 Coming soon |

## CI/CD

The included GitHub Actions workflow (`.github/workflows/harness.yml`) runs forge on every PR:
- Spins up Postgres
- Starts the target server
- Runs forge to generate fresh tests
- Runs API tests (fails PR if they fail)
- Runs Playwright E2E tests

Add these secrets to your repo: `ANTHROPIC_API_KEY`, `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`.

## Built with

- [Anthropic Claude](https://anthropic.com) — test generation
- [Playwright](https://playwright.dev) — E2E testing
- [Supertest](https://github.com/ladjs/supertest) — API testing
- [Jest](https://jestjs.io) — test runner
- [TypeScript](https://typescriptlang.org)
