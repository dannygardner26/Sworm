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

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    const available = listFormations(baseDir);
    const suggestion = findClosestMatch(name, available);
    const hint = suggestion
      ? `\n  Did you mean: ${suggestion}?`
      : available.length > 0
        ? `\n  Available formations: ${available.join(', ')}`
        : `\n  No formations found in ${baseDir}. Create a YAML file there first.`;
    throw new Error(`Formation "${name}" not found.${hint}`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    throw new Error(
      `Failed to parse YAML for formation "${name}": ${e instanceof Error ? e.message : String(e)}\n` +
        `  Check the syntax of ${filePath}.`
    );
  }

  const interpolated = interpolateEnv(parsed);

  const result = FormationConfigSchema.safeParse(interpolated);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid formation config in "${name}.yaml":\n${issues}\n` +
        `  See the docs for the correct schema.`
    );
  }

  return result.data;
}

/**
 * Returns the closest matching formation name using Levenshtein distance,
 * or undefined if no match is close enough.
 */
function findClosestMatch(input: string, candidates: string[]): string | undefined {
  if (!candidates.length) return undefined;
  const scored = candidates.map((c) => ({ c, d: levenshtein(input, c) }));
  scored.sort((a, b) => a.d - b.d);
  return scored[0].d <= 3 ? scored[0].c : undefined;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export function listFormations(dir?: string): string[] {
  const baseDir = dir ?? getDefaultDir();
  const files = readdirSync(baseDir);
  return files
    .filter((f: string) => f.endsWith('.yaml'))
    .map((f: string) => f.replace(/\.yaml$/, ''));
}
