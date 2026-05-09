// src/generator/index.ts
// Calls Claude API with the APIMap and generates test files.

import Anthropic from '@anthropic-ai/sdk';
import type { APIMap, RouteDefinition } from '../crawler/types';
import { buildSupertestPrompt, buildPlaywrightPrompt, buildSummaryPrompt } from './prompts';
import { writeTestFile } from './writer';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface GenerationResult {
  supertestFiles: string[];
  playwrightFiles: string[];
  summary: TestStrategySummary;
}

export interface TestStrategySummary {
  criticalFlows: Array<{ name: string; routes: string[]; reason: string }>;
  highRiskEndpoints: Array<{ path: string; method: string; reason: string }>;
  securityConcerns: Array<{ endpoint: string; concern: string }>;
}

export async function generate(apiMap: APIMap, outputDir: string): Promise<GenerationResult> {
  console.log('\n🤖 Calling Claude to plan test strategy...');
  const summary = await planTestStrategy(apiMap);

  console.log(`\n📋 Test strategy:`);
  console.log(`  Critical flows: ${summary.criticalFlows.map(f => f.name).join(', ')}`);
  console.log(`  High-risk endpoints: ${summary.highRiskEndpoints.map(e => e.path).join(', ')}`);
  if (summary.securityConcerns.length > 0) {
    console.log(`  ⚠️  Security concerns: ${summary.securityConcerns.length} found`);
  }

  // Generate Supertest files for high-risk endpoints
  console.log('\n🧪 Generating Supertest API tests...');
  const supertestFiles: string[] = [];

  for (const endpoint of summary.highRiskEndpoints) {
    const route = apiMap.routes.find(
      r => r.path === endpoint.path && r.method === endpoint.method
    );
    if (!route) continue;

    console.log(`  Generating tests for ${route.method} ${route.path}...`);
    const testCode = await generateSupertestFile(apiMap, route);
    const fileName = routeToFileName(route);
    const filePath = await writeTestFile(outputDir, 'api', fileName, testCode);
    supertestFiles.push(filePath);
  }

  // Generate Playwright files for critical flows
  console.log('\n🎭 Generating Playwright E2E tests...');
  const playwrightFiles: string[] = [];

  for (const flow of summary.criticalFlows) {
    const routes = flow.routes
      .map(routePath => apiMap.routes.find(r => r.path === routePath))
      .filter((r): r is RouteDefinition => r !== undefined);

    if (routes.length === 0) continue;

    console.log(`  Generating E2E test for flow: ${flow.name}...`);
    const testCode = await generatePlaywrightFile(apiMap, flow.name, routes);
    const fileName = flow.name.toLowerCase().replace(/\s+/g, '-');
    const filePath = await writeTestFile(outputDir, 'e2e', fileName, testCode);
    playwrightFiles.push(filePath);
  }

  return { supertestFiles, playwrightFiles, summary };
}

async function planTestStrategy(apiMap: APIMap): Promise<TestStrategySummary> {
  const prompt = buildSummaryPrompt(apiMap);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => (block as { type: 'text'; text: string }).text)
    .join('');

  try {
    return JSON.parse(text) as TestStrategySummary;
  } catch {
    // If Claude returns something that's not clean JSON, extract it
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as TestStrategySummary;
    throw new Error('Claude returned invalid JSON for test strategy');
  }
}

async function generateSupertestFile(apiMap: APIMap, route: RouteDefinition): Promise<string> {
  const prompt = buildSupertestPrompt(apiMap, route);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content
    .filter(block => block.type === 'text')
    .map(block => (block as { type: 'text'; text: string }).text)
    .join('');
}

async function generatePlaywrightFile(
  apiMap: APIMap,
  flowName: string,
  routes: RouteDefinition[]
): Promise<string> {
  const prompt = buildPlaywrightPrompt(apiMap, flowName, routes);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content
    .filter(block => block.type === 'text')
    .map(block => (block as { type: 'text'; text: string }).text)
    .join('');
}

function routeToFileName(route: RouteDefinition): string {
  // POST /api/payouts/ → post-payouts
  const pathSlug = route.path
    .replace(/^\/api\//, '')
    .replace(/\//g, '-')
    .replace(/[{}]/g, '')
    .replace(/-+$/, '');
  return `${route.method.toLowerCase()}-${pathSlug}`;
}
