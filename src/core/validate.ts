import type { FormationConfig } from '../config/schema.js';
import type { MonitorInfo } from '../platform/types.js';
import type { WormTypeRegistry } from './registry.js';
import { resolveMonitor } from './formation.js';

export interface ValidationIssue {
  wormId?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export function validateFormation(
  config: FormationConfig,
  monitors: MonitorInfo[],
  registry: WormTypeRegistry,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Duplicate worm IDs
  const seenIds = new Set<string>();
  for (const worm of config.worms) {
    if (seenIds.has(worm.id)) {
      issues.push({ wormId: worm.id, message: `Duplicate worm ID: "${worm.id}"` });
    }
    seenIds.add(worm.id);
  }

  for (const worm of config.worms) {
    // Unregistered worm type
    if (!registry.has(worm.type)) {
      const known = registry.getTypes().join(', ') || 'none';
      issues.push({
        wormId: worm.id,
        message: `Unknown worm type "${worm.type}". Registered: ${known}`,
      });
    }

    // Unresolvable monitor ref
    const monitorRef = config.monitors?.[worm.monitor] ?? worm.monitor;
    let monitorOk = false;
    try {
      resolveMonitor(monitorRef, monitors);
      monitorOk = true;
    } catch {
      const alias =
        worm.monitor !== monitorRef ? `"${worm.monitor}" (→ "${monitorRef}")` : `"${monitorRef}"`;
      issues.push({
        wormId: worm.id,
        message: `Monitor ${alias} not found. Available: ${describeMonitors(monitors)}`,
      });
    }

    // Grid bounds overflow
    if (monitorOk && 'grid' in worm.position) {
      const grid = config.grid ?? { columns: 12, rows: 6, gap: 4 };
      const { col, row, colSpan, rowSpan } = worm.position.grid;
      if (col + colSpan > grid.columns) {
        issues.push({
          wormId: worm.id,
          message: `Grid column overflow: col ${col} + span ${colSpan} exceeds ${grid.columns} columns`,
        });
      }
      if (row + rowSpan > grid.rows) {
        issues.push({
          wormId: worm.id,
          message: `Grid row overflow: row ${row} + span ${rowSpan} exceeds ${grid.rows} rows`,
        });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

function describeMonitors(monitors: MonitorInfo[]): string {
  if (monitors.length === 0) return 'none detected';
  const positional = ['primary', 'left', 'right', 'top', 'bottom'];
  const indexed = monitors.map((_, i) => `index:${i}`);
  return [...positional, ...indexed].join(', ');
}
