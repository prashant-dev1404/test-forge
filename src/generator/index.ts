// src/generator/index.ts
// Calls the configured LLM (Anthropic or Groq) with the APIMap and generates test files.

import type { APIMap, RouteDefinition } from '../crawler/types';
import { buildSupertestPrompt, buildPlaywrightPrompt, buildSummaryPrompt } from './prompts';
import { prepareGeneratedOutput, writeTestFile } from './writer';
import { complete, getProviderInfo } from './llm';
import { generateDjangoApiTest, generateDjangoFlowTest } from './templates';

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
  prepareGeneratedOutput(outputDir);

  const { provider, model } = getProviderInfo();
  console.log(`\n🤖 LLM: ${provider} (${model})`);
  console.log('   Calling model to plan test strategy...');
  const summary = await planTestStrategy(apiMap);

  console.log(`\n📋 Test strategy:`);
  console.log(`  Critical flows: ${summary.criticalFlows.map(f => f.name).join(', ')}`);
  console.log(`  High-risk endpoints: ${summary.highRiskEndpoints.map(e => e.path).join(', ')}`);
  if (summary.securityConcerns.length > 0) {
    console.log(`  ⚠️  Security concerns: ${summary.securityConcerns.length} found`);
  }

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
  const text = await complete(prompt, 1024);

  try {
    return JSON.parse(text) as TestStrategySummary;
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as TestStrategySummary;
    throw new Error('LLM returned invalid JSON for test strategy');
  }
}

async function generateSupertestFile(apiMap: APIMap, route: RouteDefinition): Promise<string> {
  if (apiMap.framework === 'django') {
    return generateDjangoApiTest(route);
  }

  const prompt = buildSupertestPrompt(apiMap, route);
  const raw = await complete(prompt, 2048);
  return sanitizeGeneratedCode(raw);
}

async function generatePlaywrightFile(
  apiMap: APIMap,
  flowName: string,
  routes: RouteDefinition[]
): Promise<string> {
  if (apiMap.framework === 'django') {
    return generateDjangoFlowTest(flowName, routes);
  }

  const prompt = buildPlaywrightPrompt(apiMap, flowName, routes);
  const raw = await complete(prompt, 2048);
  return sanitizeGeneratedCode(raw);
}

function routeToFileName(route: RouteDefinition): string {
  const pathSlug = route.path
    .replace(/^\/api\//, '')
    .replace(/\//g, '-')
    .replace(/[{}]/g, '')
    .replace(/-+$/, '');
  return `${route.method.toLowerCase()}-${pathSlug}`;
}

function sanitizeGeneratedCode(raw: string): string {
  let code = raw.trim();

  code = code.replace(/^```(?:typescript|ts|javascript|js)?\s*/i, '');
  code = code.replace(/\s*```$/, '');

  const firstImportIndex = code.search(/^(import|const |let |var |describe\(|test\.describe\()/m);
  if (firstImportIndex > 0) {
    code = code.slice(firstImportIndex);
  }

  return code.trim() + '\n';
}
