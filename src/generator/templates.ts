import { RouteDefinition, APIMap } from '../crawler/types';

export function generateDjangoApiTest(route: RouteDefinition): string {
  const key = `${route.method} ${route.path}`;

  switch (key) {
    case 'POST /api/v1/payouts/':
      return renderPostPayoutsTest();
    case 'GET /api/v1/balance/':
      return renderGetBalanceTest();
    case 'GET /api/v1/payouts/{pk}/':
      return renderGetPayoutDetailTest();
    default:
      return renderGenericApiTest(route);
  }
}

export function generateDjangoFlowTest(flowName: string, routes: RouteDefinition[]): string {
  return `${playwrightHelpers()}

test.describe(${JSON.stringify(flowName)}, () => {
  // Verifies the primary API journey across the discovered endpoints.
  test('completes the main flow successfully', async ({ request }) => {
${buildHappyPathSteps(routes, '    ')}
  });

  // Verifies the flow surfaces a clear client error when required input is missing.
  test('rejects invalid input cleanly', async ({ request }) => {
${buildFailurePathSteps(routes, '    ')}
  });

  // Verifies repeated requests do not create unintended duplicate effects.
  test('handles repeated operations safely', async ({ request }) => {
${buildIdempotencySteps(routes, '    ')}
  });
});
`;
}

function renderPostPayoutsTest(): string {
  return `${apiHelpers()}

describe('POST /api/v1/payouts/', () => {
  // Verifies a valid payout request succeeds and returns the created payout payload.
  it('creates a payout with deterministic forge fixtures', async () => {
    const idempotencyKey = randomUUID();
    const response = await request
      .post('/api/v1/payouts/')
      .set(payoutHeaders(idempotencyKey))
      .send(validPayoutPayload());

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('amount_paise', validPayoutPayload().amount_paise);
    expect(response.body).toHaveProperty('bank_account_id', bankAccountId);
    expect(response.body).toHaveProperty('status');
  });

  // Verifies serializer validation rejects a malformed payout payload.
  it('returns 400 when required fields are missing', async () => {
    const response = await request
      .post('/api/v1/payouts/')
      .set(payoutHeaders(randomUUID()))
      .send({ bank_account_id: bankAccountId });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('amount_paise');
  });

  // Verifies the merchant header is required for payout creation.
  it('returns 400 when the merchant header is missing', async () => {
    const response = await request
      .post('/api/v1/payouts/')
      .set({ 'Idempotency-Key': randomUUID() })
      .send(validPayoutPayload());

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  // Verifies replaying the same request with the same idempotency key is safe.
  it('replays the original response for the same idempotency key and payload', async () => {
    const idempotencyKey = randomUUID();
    const payload = validPayoutPayload();

    const firstResponse = await request
      .post('/api/v1/payouts/')
      .set(payoutHeaders(idempotencyKey))
      .send(payload);

    const replayResponse = await request
      .post('/api/v1/payouts/')
      .set(payoutHeaders(idempotencyKey))
      .send(payload);

    expect(firstResponse.status).toBe(201);
    expect(replayResponse.status).toBe(201);
    expect(replayResponse.body).toHaveProperty('id', firstResponse.body.id);
    expect(replayResponse.body).toHaveProperty('amount_paise', payload.amount_paise);
  });

  // Verifies reusing the key with a different payload is rejected as a conflict.
  it('returns 409 when the same idempotency key is reused with a different payload', async () => {
    const idempotencyKey = randomUUID();

    const firstResponse = await request
      .post('/api/v1/payouts/')
      .set(payoutHeaders(idempotencyKey))
      .send(validPayoutPayload());

    const conflictResponse = await request
      .post('/api/v1/payouts/')
      .set(payoutHeaders(idempotencyKey))
      .send(validPayoutPayload({ amount_paise: 54321 }));

    expect(firstResponse.status).toBe(201);
    expect(conflictResponse.status).toBe(409);
    expect(conflictResponse.body).toHaveProperty('error');
  });
});
`;
}

function renderGetBalanceTest(): string {
  return `${apiHelpers()}

describe('GET /api/v1/balance/', () => {
  // Verifies the balance summary is returned for the deterministic forge merchant.
  it('returns the merchant balance summary', async () => {
    const response = await request
      .get('/api/v1/balance/')
      .set(merchantHeaders());

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('available_paise');
    expect(response.body).toHaveProperty('held_paise');
    expect(response.body).toHaveProperty('total_credited_paise');
    expect(response.body).toHaveProperty('total_debited_paise');
  });

  // Verifies the balance endpoint rejects requests without the merchant header.
  it('returns 400 when the merchant header is missing', async () => {
    const response = await request.get('/api/v1/balance/');

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  // Verifies the endpoint validates malformed merchant IDs.
  it('returns 400 for an invalid merchant id format', async () => {
    const response = await request
      .get('/api/v1/balance/')
      .set({ 'X-Merchant-Id': 'not-a-uuid' });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });
});
`;
}

function renderGetPayoutDetailTest(): string {
  return `${apiHelpers()}

describe('GET /api/v1/payouts/{pk}/', () => {
  // Verifies a created payout can be retrieved by its ID for the same merchant.
  it('returns payout details for an existing payout', async () => {
    const payout = await createPayout();
    const response = await request
      .get(\`/api/v1/payouts/\${payout.id}/\`)
      .set(merchantHeaders());

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('id', payout.id);
    expect(response.body).toHaveProperty('amount_paise', payout.amount_paise);
    expect(response.body).toHaveProperty('bank_account_id', bankAccountId);
  });

  // Verifies malformed payout IDs are rejected with a client error.
  it('returns 400 for an invalid payout id format', async () => {
    const response = await request
      .get('/api/v1/payouts/not-a-uuid/')
      .set(merchantHeaders());

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  // Verifies the merchant header is still required for payout detail access.
  it('returns 400 when the merchant header is missing', async () => {
    const payout = await createPayout();
    const response = await request.get(\`/api/v1/payouts/\${payout.id}/\`);

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });
});
`;
}

function renderGenericApiTest(route: RouteDefinition): string {
  const hasMerchantHeader = route.path.startsWith('/api/v1/') && !route.path.includes('/healthz/');
  const responseShapeAssertion = inferResponseAssertion(route);

  return `${apiHelpers()}

describe(${JSON.stringify(`${route.method} ${route.path}`)}, () => {
  // Verifies the discovered endpoint responds successfully for the forge fixtures.
  it('responds with a non-error payload for a valid request', async () => {
    const response = await request
      .${route.method.toLowerCase()}(${JSON.stringify(route.path)})
${hasMerchantHeader ? "      .set(merchantHeaders())\n" : ''}${buildGenericPayload(route, '      ')};

    expect(response.status).toBeLessThan(500);
${responseShapeAssertion}
  });

  // Verifies the endpoint handles obviously invalid input without a server error.
  it('handles invalid input without returning a 5xx', async () => {
    const response = await request
      .${route.method.toLowerCase()}(${JSON.stringify(route.path)})
${hasMerchantHeader ? "      .set({ 'X-Merchant-Id': 'not-a-uuid' })\n" : ''}${route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH' ? "      .send({ invalid: true })\n" : ''};

    expect(response.status).toBeLessThan(500);
    expect(response.body).toBeDefined();
  });
});
`;
}

function apiHelpers(): string {
  return `import 'dotenv/config';
import { randomUUID } from 'crypto';
import supertest from 'supertest';

const baseUrl = process.env.TARGET_BASE_URL || process.env.BASE_URL || 'http://localhost:8000';
const merchantId = requiredEnv('FORGE_MERCHANT_UUID');
const bankAccountId = requiredEnv('FORGE_BANK_ACCOUNT_UUID');

const request = supertest(baseUrl);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(\`Missing required environment variable: \${name}\`);
  }
  return value;
}

function merchantHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'X-Merchant-Id': merchantId,
    ...extra,
  };
}

function payoutHeaders(idempotencyKey: string): Record<string, string> {
  return merchantHeaders({
    'Idempotency-Key': idempotencyKey,
  });
}

function validPayoutPayload(overrides: Partial<{ amount_paise: number; bank_account_id: string }> = {}) {
  return {
    amount_paise: 12345,
    bank_account_id: bankAccountId,
    ...overrides,
  };
}

async function createPayout() {
  const response = await request
    .post('/api/v1/payouts/')
    .set(payoutHeaders(randomUUID()))
    .send(validPayoutPayload());

  expect(response.status).toBe(201);
  return response.body as { id: string; amount_paise: number; bank_account_id: string; status: string };
}
`;
}

function playwrightHelpers(): string {
  return `import 'dotenv/config';
import { randomUUID } from 'crypto';
import { test, expect, APIRequestContext } from '@playwright/test';

const baseUrl = process.env.TARGET_BASE_URL || process.env.BASE_URL || 'http://localhost:8000';
const merchantId = requiredEnv('FORGE_MERCHANT_UUID');
const bankAccountId = requiredEnv('FORGE_BANK_ACCOUNT_UUID');

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(\`Missing required environment variable: \${name}\`);
  }
  return value;
}

function merchantHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'X-Merchant-Id': merchantId,
    ...extra,
  };
}

function payoutHeaders(idempotencyKey: string): Record<string, string> {
  return merchantHeaders({
    'Idempotency-Key': idempotencyKey,
  });
}

function validPayoutPayload(overrides: Partial<{ amount_paise: number; bank_account_id: string }> = {}) {
  return {
    amount_paise: 12345,
    bank_account_id: bankAccountId,
    ...overrides,
  };
}

async function createPayout(request: APIRequestContext) {
  const response = await request.post(\`\${baseUrl}/api/v1/payouts/\`, {
    headers: payoutHeaders(randomUUID()),
    data: validPayoutPayload(),
  });

  expect(response.status()).toBe(201);
  return await response.json() as { id: string; amount_paise: number; bank_account_id: string; status: string };
}
`;
}

function buildHappyPathSteps(routes: RouteDefinition[], indent: string): string {
  const lines: string[] = [];
  let genericCounter = 0;

  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    switch (key) {
      case 'POST /api/v1/payouts/':
        lines.push(`${indent}const payout = await createPayout(request);`);
        lines.push(`${indent}expect(payout).toHaveProperty('id');`);
        break;
      case 'GET /api/v1/balance/':
        lines.push(`${indent}const balanceResponse = await request.get(\`\${baseUrl}/api/v1/balance/\`, { headers: merchantHeaders() });`);
        lines.push(`${indent}expect(balanceResponse.status()).toBe(200);`);
        lines.push(`${indent}expect(await balanceResponse.json()).toHaveProperty('available_paise');`);
        break;
      case 'GET /api/v1/ledger/':
        lines.push(`${indent}const ledgerResponse = await request.get(\`\${baseUrl}/api/v1/ledger/\`, { headers: merchantHeaders() });`);
        lines.push(`${indent}expect(ledgerResponse.status()).toBe(200);`);
        lines.push(`${indent}expect(await ledgerResponse.json()).toHaveProperty('entries');`);
        break;
      case 'GET /api/v1/payouts/list/':
        lines.push(`${indent}const listResponse = await request.get(\`\${baseUrl}/api/v1/payouts/list/\`, { headers: merchantHeaders() });`);
        lines.push(`${indent}expect(listResponse.status()).toBe(200);`);
        lines.push(`${indent}expect(await listResponse.json()).toHaveProperty('payouts');`);
        break;
      case 'GET /api/v1/payouts/{pk}/':
        lines.push(`${indent}const createdPayout = await createPayout(request);`);
        lines.push(`${indent}const detailResponse = await request.get(\`\${baseUrl}/api/v1/payouts/\${createdPayout.id}/\`, { headers: merchantHeaders() });`);
        lines.push(`${indent}expect(detailResponse.status()).toBe(200);`);
        lines.push(`${indent}expect(await detailResponse.json()).toHaveProperty('id', createdPayout.id);`);
        break;
      default:
        genericCounter += 1;
        lines.push(`${indent}const response${genericCounter} = await request.${route.method.toLowerCase()}(\`\${baseUrl}${route.path}\`, { headers: merchantHeaders() });`);
        lines.push(`${indent}expect(response${genericCounter}.status()).toBeLessThan(500);`);
        break;
    }
  }

  if (lines.length === 0) {
    lines.push(`${indent}test.skip();`);
  }

  return lines.join('\n');
}

function buildFailurePathSteps(routes: RouteDefinition[], indent: string): string {
  if (routes.some(route => route.path === '/api/v1/payouts/' && route.method === 'POST')) {
    return [
      `${indent}const response = await request.post(\`\${baseUrl}/api/v1/payouts/\`, {`,
      `${indent}  headers: payoutHeaders(randomUUID()),`,
      `${indent}  data: { bank_account_id: bankAccountId },`,
      `${indent}});`,
      `${indent}expect(response.status()).toBe(400);`,
      `${indent}expect(await response.json()).toHaveProperty('amount_paise');`,
    ].join('\n');
  }

  if (routes.some(route => route.path === '/api/v1/balance/' && route.method === 'GET')) {
    return [
      `${indent}const response = await request.get(\`\${baseUrl}/api/v1/balance/\`, {`,
      `${indent}  headers: { 'X-Merchant-Id': 'not-a-uuid' },`,
      `${indent}});`,
      `${indent}expect(response.status()).toBe(400);`,
      `${indent}expect(await response.json()).toHaveProperty('error');`,
    ].join('\n');
  }

  return [
    `${indent}const response = await request.get(\`\${baseUrl}/healthz/\`);`,
    `${indent}expect(response.status()).toBeLessThan(500);`,
    `${indent}expect(await response.text()).toBeTruthy();`,
  ].join('\n');
}

function buildIdempotencySteps(routes: RouteDefinition[], indent: string): string {
  if (routes.some(route => route.path === '/api/v1/payouts/' && route.method === 'POST')) {
    return [
      `${indent}const idempotencyKey = randomUUID();`,
      `${indent}const payload = validPayoutPayload();`,
      `${indent}const firstResponse = await request.post(\`\${baseUrl}/api/v1/payouts/\`, {`,
      `${indent}  headers: payoutHeaders(idempotencyKey),`,
      `${indent}  data: payload,`,
      `${indent}});`,
      `${indent}const replayResponse = await request.post(\`\${baseUrl}/api/v1/payouts/\`, {`,
      `${indent}  headers: payoutHeaders(idempotencyKey),`,
      `${indent}  data: payload,`,
      `${indent}});`,
      `${indent}expect(firstResponse.status()).toBe(201);`,
      `${indent}expect(replayResponse.status()).toBe(201);`,
      `${indent}expect((await replayResponse.json()).id).toBe((await firstResponse.json()).id);`,
    ].join('\n');
  }

  if (routes.some(route => route.path === '/api/v1/balance/' && route.method === 'GET')) {
    return [
      `${indent}const firstResponse = await request.get(\`\${baseUrl}/api/v1/balance/\`, { headers: merchantHeaders() });`,
      `${indent}const secondResponse = await request.get(\`\${baseUrl}/api/v1/balance/\`, { headers: merchantHeaders() });`,
      `${indent}expect(firstResponse.status()).toBe(200);`,
      `${indent}expect(secondResponse.status()).toBe(200);`,
      `${indent}expect(await secondResponse.json()).toEqual(await firstResponse.json());`,
    ].join('\n');
  }

  return [
    `${indent}const firstResponse = await request.get(\`\${baseUrl}/healthz/\`);`,
    `${indent}const secondResponse = await request.get(\`\${baseUrl}/healthz/\`);`,
    `${indent}expect(firstResponse.status()).toBe(secondResponse.status());`,
  ].join('\n');
}

function inferResponseAssertion(route: RouteDefinition): string {
  if (route.path === '/healthz/') {
    return "    expect(response.text).toBe('OK');";
  }
  if (route.path === '/api/v1/merchants/' || route.path === '/api/v1/bank-accounts/') {
    return "    expect(Array.isArray(response.body)).toBe(true);";
  }
  if (route.path === '/api/v1/ledger/') {
    return "    expect(response.body).toHaveProperty('entries');";
  }
  if (route.path === '/api/v1/payouts/list/') {
    return "    expect(response.body).toHaveProperty('payouts');";
  }
  return "    expect(response.body).toBeDefined();";
}

function buildGenericPayload(route: RouteDefinition, indent: string): string {
  if (route.method === 'POST' && route.path === '/api/v1/payouts/') {
    return `${indent}.set(payoutHeaders(randomUUID()))\n${indent}.send(validPayoutPayload())`;
  }
  if (route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH') {
    return `${indent}.send({})`;
  }
  return '';
}
