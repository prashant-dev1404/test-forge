export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface FieldSchema {
  name: string;
  type: string;
  required: boolean;
  example?: string | number | boolean;
}

export interface RouteDefinition {
  method: HTTPMethod;
  path: string;
  name: string;
  description?: string;
  requestBody?: FieldSchema[];
  responseBody?: FieldSchema[];
  requiresAuth: boolean;
  tags?: string[];
  sourceFile?: string;
}

export interface ModelDefinition {
  name: string;
  fields: FieldSchema[];
  sourceFile?: string;
}

export interface APIMap {
  framework: 'django' | 'express' | 'fastapi' | 'unknown';
  baseUrl: string;
  projectName: string;
  routes: RouteDefinition[];
  models: ModelDefinition[];
  extractedAt: string;
}

export interface CrawlOptions {
  repoPath: string;
  framework: 'django' | 'express' | 'fastapi' | 'auto';
  baseUrl: string;
}
