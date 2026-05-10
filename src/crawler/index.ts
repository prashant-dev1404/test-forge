import * as fs from 'fs';
import * as path from 'path';
import type { APIMap, CrawlOptions } from './types';
import { extractDjango } from './django';

export async function crawl(options: CrawlOptions): Promise<APIMap> {
  const { repoPath, framework, baseUrl } = options;

  if (!fs.existsSync(repoPath)) {
    throw new Error(`Target repo not found: ${repoPath}`);
  }

  const detectedFramework = framework === 'auto' ? detectFramework(repoPath) : framework;
  console.log(`  Detected framework: ${detectedFramework}`);

  switch (detectedFramework) {
    case 'django':
      return extractDjango(repoPath, baseUrl);
    case 'express':
      throw new Error('Express extractor not yet implemented');
    case 'fastapi':
      throw new Error('FastAPI extractor not yet implemented');
    default:
      throw new Error(`Unknown framework: ${detectedFramework}`);
  }
}

function detectFramework(repoPath: string): 'django' | 'express' | 'fastapi' | 'unknown' {
  if (fs.existsSync(path.join(repoPath, 'manage.py')) || fs.existsSync(path.join(repoPath, 'settings.py'))) {
    return 'django';
  }

  const requirementsPath = path.join(repoPath, 'requirements.txt');
  if (fs.existsSync(requirementsPath)) {
    const requirements = fs.readFileSync(requirementsPath, 'utf-8');
    if (requirements.toLowerCase().includes('fastapi')) return 'fastapi';
    if (requirements.toLowerCase().includes('django')) return 'django';
  }

  const packageJsonPath = path.join(repoPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['express']) return 'express';
  }

  return 'unknown';
}

export type { APIMap, CrawlOptions } from './types';
