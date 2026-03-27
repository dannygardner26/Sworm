import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { FormationConfigSchema, type FormationConfig } from './schema.js';

function getDefaultDir(): string {
  return join(process.cwd(), 'formations');
}

/**
 * Recursively interpolate `${ENV_VAR}` references in string values.
 */
function interpolateEnv(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
      return process.env[varName] ?? '';
    });
  }
  if (Array.isArray(value)) {
    return value.map(interpolateEnv);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolateEnv(v);
    }
    return result;
  }
  return value;
}

export function loadFormation(name: string, dir?: string): FormationConfig {
  const baseDir = dir ?? getDefaultDir();
  const filePath = join(baseDir, `${name}.yaml`);
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = parseYaml(raw) as unknown;
  const interpolated = interpolateEnv(parsed);
  return FormationConfigSchema.parse(interpolated);
}

export function listFormations(dir?: string): string[] {
  const baseDir = dir ?? getDefaultDir();
  const files = readdirSync(baseDir);
  return files
    .filter((f: string) => f.endsWith('.yaml'))
    .map((f: string) => f.replace(/\.yaml$/, ''));
}
