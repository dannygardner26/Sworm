import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';

const ProviderEntrySchema = z.object({
  type: z.enum([
    'anthropic',
    'openai',
    'azure-openai',
    'gemini',
    'bedrock',
    'ollama',
    'claude-code',
  ]),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  region: z.string().optional(),
  deployment: z.string().optional(),
  defaultModel: z.string().optional(),
});

const ProvidersFileSchema = z.object({
  providers: z.record(z.string(), ProviderEntrySchema),
  defaults: z
    .object({
      provider: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
});

export type ProvidersFile = z.infer<typeof ProvidersFileSchema>;

// Interpolate ${ENV_VAR} patterns in strings
function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
}

// Deep interpolate all string values in an object
function deepInterpolate(obj: unknown): unknown {
  if (typeof obj === 'string') return interpolateEnv(obj);
  if (Array.isArray(obj)) return obj.map(deepInterpolate);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepInterpolate(v);
    }
    return result;
  }
  return obj;
}

export function loadProvidersConfig(configPath?: string): ProvidersFile {
  const path = configPath ?? join(homedir(), '.sworm', 'providers.yaml');

  if (!existsSync(path)) {
    return { providers: {} };
  }

  const raw = readFileSync(path, 'utf-8');
  const parsed = parseYaml(raw);
  const interpolated = deepInterpolate(parsed);
  return ProvidersFileSchema.parse(interpolated);
}
