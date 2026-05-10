// src/crawler/django.ts
// Extracts routes and models from a Django + DRF project.
// Reads: urls.py, views.py, serializers.py, models.py

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type { APIMap, RouteDefinition, ModelDefinition, FieldSchema, HTTPMethod } from './types';

// DRF ViewSet action → HTTP method mapping
const VIEWSET_ACTION_METHODS: Record<string, HTTPMethod> = {
  list: 'GET',
  create: 'POST',
  retrieve: 'GET',
  update: 'PUT',
  partial_update: 'PATCH',
  destroy: 'DELETE',
};

// Standard DRF serializer field type → our type mapping
const FIELD_TYPE_MAP: Record<string, string> = {
  CharField: 'string',
  EmailField: 'string',
  URLField: 'string',
  UUIDField: 'string',
  IntegerField: 'number',
  FloatField: 'number',
  DecimalField: 'number',
  BooleanField: 'boolean',
  DateField: 'string',
  DateTimeField: 'string',
  SerializerMethodField: 'object',
  PrimaryKeyRelatedField: 'number',
};

export async function extractDjango(repoPath: string, baseUrl: string): Promise<APIMap> {
  console.log(`  Crawling Django project at: ${repoPath}`);

  const routes = await extractRoutes(repoPath);
  const models = await extractModels(repoPath);

  const projectName = path.basename(repoPath);

  return {
    framework: 'django',
    baseUrl,
    projectName,
    routes,
    models,
    extractedAt: new Date().toISOString(),
  };
}

async function extractRoutes(repoPath: string): Promise<RouteDefinition[]> {
  // Find all urls.py files
  const urlFiles = await glob('**/urls.py', {
    cwd: repoPath,
    ignore: ['**/node_modules/**', '**/.venv/**', '**/venv/**'],
    absolute: true,
  });

  const moduleToFile = new Map<string, string>();
  const includedModules = new Set<string>();

  for (const urlFile of urlFiles) {
    moduleToFile.set(toPythonModule(repoPath, urlFile), urlFile);

    const content = fs.readFileSync(urlFile, 'utf-8');
    for (const includeMatch of content.matchAll(/include\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      includedModules.add(includeMatch[1]);
    }
  }

  const rootUrlFiles = urlFiles.filter(urlFile => !includedModules.has(toPythonModule(repoPath, urlFile)));
  const entryFiles = rootUrlFiles.length > 0 ? rootUrlFiles : urlFiles;

  const routes: RouteDefinition[] = [];
  const visited = new Set<string>();
  for (const urlFile of entryFiles) {
    routes.push(...parseUrlFile(urlFile, repoPath, '', moduleToFile, visited));
  }

  // Enrich with docstrings from views
  const viewFiles = await glob('**/views.py', {
    cwd: repoPath,
    ignore: ['**/node_modules/**', '**/.venv/**', '**/venv/**'],
    absolute: true,
  });

  for (const viewFile of viewFiles) {
    const content = fs.readFileSync(viewFile, 'utf-8');
    enrichWithViewInfo(routes, content, viewFile);
  }

  return dedupeRoutes(routes);
}

function parseUrlFile(
  filePath: string,
  repoPath: string,
  prefix: string,
  moduleToFile: Map<string, string>,
  visited: Set<string>
): RouteDefinition[] {
  const visitKey = `${filePath}::${prefix}`;
  if (visited.has(visitKey)) return [];
  visited.add(visitKey);

  const content = fs.readFileSync(filePath, 'utf-8');
  const routes: RouteDefinition[] = [];
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const pathMatch = line.match(/^(?:path|re_path)\(\s*['"]([^'"]+)['"]\s*,\s*(.+)$/);
    if (!pathMatch) continue;

    const urlPath = joinUrlPaths(prefix, pathFragmentToRoute(pathMatch[1]));
    const target = pathMatch[2];

    const includeMatch = target.match(/include\(\s*['"]([^'"]+)['"]\s*\)/);
    if (includeMatch) {
      const includedFile = moduleToFile.get(includeMatch[1]);
      if (includedFile) {
        routes.push(...parseUrlFile(includedFile, repoPath, urlPath, moduleToFile, visited));
      }
      continue;
    }

    // Detect ViewSet with as_view method map
    const asViewMatch = target.match(/(\w+)\.as_view\(\{([^}]+)\}\)/);
    if (asViewMatch) {
      const actionMap = asViewMatch[2];
      // e.g. 'post': 'create', 'get': 'list'
      const actionPattern = /'(\w+)'\s*:\s*'(\w+)'/g;
      let actionMatch: RegExpExecArray | null;
      while ((actionMatch = actionPattern.exec(actionMap)) !== null) {
        const httpMethod = actionMatch[1].toUpperCase() as HTTPMethod;
        const action = actionMatch[2];
        routes.push({
          method: httpMethod,
          path: urlPath,
          name: action,
          requiresAuth: true, // assume auth by default; enriched later
          sourceFile: path.relative(repoPath, filePath),
          tags: inferTags(urlPath),
        });
      }
      continue;
    }

    // Detect APIView / generic view
    const viewNameMatch = target.match(/(\w+)\.as_view\(\)/);
    if (viewNameMatch) {
      // We'll infer method from view name
      const viewName = viewNameMatch[1].toLowerCase();
      const method = inferMethodFromViewName(viewName);
      routes.push({
        method,
        path: urlPath,
        name: viewNameMatch[1],
        requiresAuth: true,
        sourceFile: path.relative(repoPath, filePath),
        tags: inferTags(urlPath),
      });
      continue;
    }

    // Detect function-based views such as path("healthz/", health_view)
    const functionViewMatch = target.match(/^(\w+)\s*[,)]/);
    if (functionViewMatch) {
      routes.push({
        method: 'GET',
        path: urlPath,
        name: functionViewMatch[1],
        requiresAuth: !urlPath.includes('health'),
        sourceFile: path.relative(repoPath, filePath),
        tags: inferTags(urlPath),
      });
    }
  }

  // Also detect DRF router registrations
  // e.g. router.register(r'payouts', PayoutViewSet, basename='payout')
  const routerPattern = /router\.register\(\s*r?['"]([^'"]+)['"]\s*,\s*(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = routerPattern.exec(content)) !== null) {
    const basePath = joinUrlPaths(prefix, pathFragmentToRoute(match[1]));
    // Router generates standard CRUD routes
    const crudRoutes: Array<{ method: HTTPMethod; suffix: string; action: string }> = [
      { method: 'GET', suffix: '', action: 'list' },
      { method: 'POST', suffix: '', action: 'create' },
      { method: 'GET', suffix: '{id}/', action: 'retrieve' },
      { method: 'PUT', suffix: '{id}/', action: 'update' },
      { method: 'PATCH', suffix: '{id}/', action: 'partial_update' },
      { method: 'DELETE', suffix: '{id}/', action: 'destroy' },
    ];
    for (const crud of crudRoutes) {
      routes.push({
        method: crud.method,
        path: basePath + crud.suffix,
        name: crud.action,
        requiresAuth: true,
        sourceFile: path.relative(repoPath, filePath),
        tags: inferTags(basePath),
      });
    }
  }

  return routes;
}

function toPythonModule(repoPath: string, filePath: string): string {
  return path
    .relative(repoPath, filePath)
    .replace(/\\/g, '/')
    .replace(/\.py$/, '')
    .replace(/\//g, '.');
}

function pathFragmentToRoute(fragment: string): string {
  const hasTrailingSlash = /\/$/.test(fragment);
  const normalized = fragment
    .replace(/<[^:>]+:([^>]+)>/g, '{$1}')
    .replace(/<([^>]+)>/g, '{$1}')
    .replace(/^\/+|\/+$/g, '');

  if (!normalized) return '/';
  return hasTrailingSlash ? `/${normalized}/` : `/${normalized}`;
}

function joinUrlPaths(prefix: string, route: string): string {
  if (prefix === '/' || !prefix) return route;
  if (route === '/') return prefix;

  const prefixPart = prefix.replace(/\/$/, '');
  const routePart = route.replace(/^\//, '');
  return `${prefixPart}/${routePart}`.replace(/\/+/g, '/');
}

function dedupeRoutes(routes: RouteDefinition[]): RouteDefinition[] {
  const seen = new Set<string>();
  return routes.filter(route => {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function enrichWithViewInfo(routes: RouteDefinition[], viewContent: string, filePath: string): void {
  // Extract docstrings from view classes and methods
  // Pattern: class PayoutView... then """docstring"""
  const classPattern = /class\s+(\w+)[^:]*:[\s\n]*(?:"""([\s\S]*?)""")?/g;
  let match;
  while ((match = classPattern.exec(viewContent)) !== null) {
    const className = match[1];
    const docstring = match[2]?.trim();

    // Find routes that match this view name
    for (const route of routes) {
      if (route.name?.toLowerCase().includes(className.toLowerCase().replace('view', '').replace('viewset', ''))) {
        if (docstring) route.description = docstring.split('\n')[0];
      }
    }
  }

  // Detect authentication_classes = [] (no auth)
  if (viewContent.includes('authentication_classes = []') || viewContent.includes('permission_classes = [AllowAny]')) {
    // These views likely have some public endpoints
    for (const route of routes) {
      if (route.path.includes('login') || route.path.includes('register') || route.path.includes('health')) {
        route.requiresAuth = false;
      }
    }
  }
}

async function extractModels(repoPath: string): Promise<ModelDefinition[]> {
  const models: ModelDefinition[] = [];

  const modelFiles = await glob('**/models.py', {
    cwd: repoPath,
    ignore: ['**/node_modules/**', '**/.venv/**', '**/venv/**'],
    absolute: true,
  });

  for (const modelFile of modelFiles) {
    const content = fs.readFileSync(modelFile, 'utf-8');
    const extracted = parseModelFile(content, modelFile, repoPath);
    models.push(...extracted);
  }

  return models;
}

function parseModelFile(content: string, filePath: string, repoPath: string): ModelDefinition[] {
  const models: ModelDefinition[] = [];

  // Match class definitions that extend models.Model
  const classPattern = /class\s+(\w+)\s*\([^)]*Model[^)]*\):([\s\S]*?)(?=\nclass|\Z)/g;
  let match;

  while ((match = classPattern.exec(content)) !== null) {
    const modelName = match[1];
    const classBody = match[2];
    const fields = extractFields(classBody);

    if (fields.length > 0) {
      models.push({
        name: modelName,
        fields,
        sourceFile: path.relative(repoPath, filePath),
      });
    }
  }

  return models;
}

function extractFields(classBody: string): FieldSchema[] {
  const fields: FieldSchema[] = [];

  // Match field declarations like: amount = models.DecimalField(...)
  const fieldPattern = /^\s{4}(\w+)\s*=\s*models\.(\w+)\(([^)]*)\)/gm;
  let match;

  while ((match = fieldPattern.exec(classBody)) !== null) {
    const fieldName = match[1];
    const fieldType = match[2];
    const fieldArgs = match[3];

    // Skip meta fields
    if (['Meta', 'id', 'created_at', 'updated_at'].includes(fieldName)) continue;
    if (fieldName.startsWith('__')) continue;

    const required = !fieldArgs.includes('blank=True') && !fieldArgs.includes('null=True') && !fieldArgs.includes('default=');

    fields.push({
      name: fieldName,
      type: FIELD_TYPE_MAP[fieldType] || 'string',
      required,
    });
  }

  return fields;
}

function inferMethodFromViewName(name: string): HTTPMethod {
  if (name.includes('create') || name.includes('post')) return 'POST';
  if (name.includes('update') || name.includes('put')) return 'PUT';
  if (name.includes('partial') || name.includes('patch')) return 'PATCH';
  if (name.includes('delete') || name.includes('destroy')) return 'DELETE';
  return 'GET';
}

function inferTags(urlPath: string): string[] {
  const segments = urlPath.split('/').filter(Boolean);
  return segments.filter(s => !s.includes('{') && s !== 'api');
}
