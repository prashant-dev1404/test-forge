// src/generator/prompts.ts
// All Claude prompts live here. One place to tune them.

import type { APIMap, RouteDefinition } from '../crawler/types';

export function buildSupertestPrompt(apiMap: APIMap, route: RouteDefinition): string {
  return `You are a senior backend engineer writing production-quality API tests using Supertest and Jest.

You will write tests for ONE API endpoint. Be thorough and cover all meaningful cases.

## Target endpoint
- Method: ${route.method}
- Path: ${route.path}
- Name: ${route.name}
- Description: ${route.description || 'No description available'}
- Requires auth: ${route.requiresAuth}
- Tags: ${route.tags?.join(', ') || 'none'}

## Request body fields
${route.requestBody && route.requestBody.length > 0
  ? route.requestBody.map(f => `- ${f.name} (${f.type}, ${f.required ? 'required' : 'optional'})`).join('\n')
  : 'No request body (GET or no body)'}

## Project context
- Framework: ${apiMap.framework}
- Base URL: ${apiMap.baseUrl}
- Project: ${apiMap.projectName}

## Available models in this project
${apiMap.models.map(m => `- ${m.name}: ${m.fields.map(f => f.name).join(', ')}`).join('\n')}

## Instructions

Write a complete Jest + Supertest test file. Requirements:
1. Import supertest and the app (use \`const app = require('../../testApp')\` — we provide a test app wrapper)
2. Write a \`describe\` block named after the endpoint
3. Include these test categories (as nested \`describe\` blocks):
   - Happy path: valid request, assert 200/201 and correct response shape
   - Validation errors: missing required fields, wrong types, assert 400
   - Auth: ${route.requiresAuth ? 'missing token → 401, invalid token → 401' : 'no auth required, skip this'}
   - Edge cases: empty strings, boundary values, duplicate requests if relevant
4. Every test must have at least one \`expect\` assertion on BOTH status code AND response body
5. Use \`beforeAll\` / \`afterAll\` for any setup/teardown
6. Use environment variables for base URL and test credentials — never hardcode
7. Add a comment above each test explaining what behaviour it is asserting

Output ONLY the TypeScript code. No markdown fences. No explanation. Start with the imports.`;
}

export function buildPlaywrightPrompt(apiMap: APIMap, flowName: string, routes: RouteDefinition[]): string {
  return `You are a senior QA engineer writing production-quality Playwright E2E tests.

You will write a Playwright test file covering a USER FLOW that spans multiple API endpoints.

## Flow: ${flowName}
## Endpoints involved in this flow
${routes.map(r => `- ${r.method} ${r.path} (${r.name})`).join('\n')}

## Project context
- Framework: ${apiMap.framework}
- Base URL: ${apiMap.baseUrl}
- Project: ${apiMap.projectName}

## Instructions

Write a complete Playwright test file. Requirements:
1. Use \`@playwright/test\` — import \`test\` and \`expect\` from it
2. Write a \`test.describe\` block for the flow
3. Include:
   - A happy path test: user completes the full flow successfully
   - A failure path test: one step fails (e.g. invalid input), assert error state
   - An idempotency test if relevant: repeat an action, assert no duplicate side effects
4. Use \`page.request\` for API calls within the flow — no raw fetch
5. Use \`test.beforeEach\` for auth setup if the flow requires auth
6. Assert both the API response AND any UI state changes
7. Use \`process.env.BASE_URL\` — never hardcode URLs
8. Add a comment above each \`test\` block explaining the user journey being tested

Output ONLY the TypeScript code. No markdown fences. No explanation. Start with the imports.`;
}

export function buildSummaryPrompt(apiMap: APIMap): string {
  return `You are a senior engineer reviewing an API surface and planning a test strategy.

Given this API map, identify:
1. The 3 most critical flows to test end-to-end (e.g. "create payout → check balance → refund")
2. The 3 highest-risk individual endpoints (most likely to have regressions)
3. Any obvious security concerns (missing auth, sensitive endpoints exposed)

## API Map
Project: ${apiMap.projectName}
Framework: ${apiMap.framework}
Total routes: ${apiMap.routes.length}

Routes:
${apiMap.routes.map(r => `- ${r.method} ${r.path} (auth: ${r.requiresAuth})`).join('\n')}

Respond in JSON only. Schema:
{
  "criticalFlows": [{"name": string, "routes": string[], "reason": string}],
  "highRiskEndpoints": [{"path": string, "method": string, "reason": string}],
  "securityConcerns": [{"endpoint": string, "concern": string}]
}`;
}
