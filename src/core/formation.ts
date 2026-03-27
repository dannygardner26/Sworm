import type { MonitorInfo, Rect } from '../platform/types.js';
import type {
  Position,
  FormationConfig,
  GridConfigSchema,
} from '../config/schema.js';
import { loadFormation, listFormations } from '../config/loader.js';
import { z } from 'zod';

type GridConfig = z.infer<typeof GridConfigSchema>;

export function resolveMonitor(
  ref: string,
  monitors: MonitorInfo[],
): MonitorInfo {
  if (monitors.length === 0) {
    throw new Error('No monitors available');
  }

  switch (ref) {
    case 'primary': {
      const m = monitors.find((m) => m.primary);
      if (!m) throw new Error('No primary monitor found');
      return m;
    }
    case 'left':
      return monitors.reduce((a, b) => (a.bounds.x < b.bounds.x ? a : b));
    case 'right':
      return monitors.reduce((a, b) => (a.bounds.x > b.bounds.x ? a : b));
    case 'top':
      return monitors.reduce((a, b) => (a.bounds.y < b.bounds.y ? a : b));
    case 'bottom':
      return monitors.reduce((a, b) => (a.bounds.y > b.bounds.y ? a : b));
    default: {
      if (ref.startsWith('index:')) {
        const idx = parseInt(ref.slice(6), 10);
        if (isNaN(idx) || idx < 0 || idx >= monitors.length) {
          throw new Error(
            `Monitor index ${idx} out of range (0-${monitors.length - 1})`,
          );
        }
        return monitors[idx];
      }
      throw new Error(`Unknown monitor reference: ${ref}`);
    }
  }
}

function parseDimension(
  value: number | string,
  reference: number,
): number {
  if (typeof value === 'number') return value;
  if (value.endsWith('%')) {
    const pct = parseFloat(value.slice(0, -1));
    return Math.round((pct / 100) * reference);
  }
  return parseFloat(value);
}

export function resolvePosition(
  position: Position,
  monitor: MonitorInfo,
  gridConfig?: GridConfig,
): Rect {
  const wa = monitor.workArea;

  // Zone mode
  if ('zone' in position) {
    const zone = position.zone;
    const halfW = Math.round(wa.width / 2);
    const halfH = Math.round(wa.height / 2);
    const thirdW = Math.round(wa.width / 3);

    const zones: Record<string, Rect> = {
      full: { x: wa.x, y: wa.y, width: wa.width, height: wa.height },
      'left-half': { x: wa.x, y: wa.y, width: halfW, height: wa.height },
      'right-half': {
        x: wa.x + halfW,
        y: wa.y,
        width: halfW,
        height: wa.height,
      },
      'top-half': { x: wa.x, y: wa.y, width: wa.width, height: halfH },
      'bottom-half': {
        x: wa.x,
        y: wa.y + halfH,
        width: wa.width,
        height: halfH,
      },
      'top-left': { x: wa.x, y: wa.y, width: halfW, height: halfH },
      'top-right': {
        x: wa.x + halfW,
        y: wa.y,
        width: halfW,
        height: halfH,
      },
      'bottom-left': {
        x: wa.x,
        y: wa.y + halfH,
        width: halfW,
        height: halfH,
      },
      'bottom-right': {
        x: wa.x + halfW,
        y: wa.y + halfH,
        width: halfW,
        height: halfH,
      },
      'left-third': { x: wa.x, y: wa.y, width: thirdW, height: wa.height },
      'center-third': {
        x: wa.x + thirdW,
        y: wa.y,
        width: thirdW,
        height: wa.height,
      },
      'right-third': {
        x: wa.x + 2 * thirdW,
        y: wa.y,
        width: thirdW,
        height: wa.height,
      },
    };

    const rect = zones[zone];
    if (!rect) throw new Error(`Unknown zone: ${zone}`);
    return rect;
  }

  // Grid mode
  if ('grid' in position) {
    const grid = gridConfig ?? { columns: 12, rows: 6, gap: 4 };
    const { col, row, colSpan, rowSpan } = position.grid;
    const cols = grid.columns;
    const rows = grid.rows;
    const gap = grid.gap;

    const cellW = (wa.width - gap * (cols + 1)) / cols;
    const cellH = (wa.height - gap * (rows + 1)) / rows;

    return {
      x: Math.round(wa.x + gap + col * (cellW + gap)),
      y: Math.round(wa.y + gap + row * (cellH + gap)),
      width: Math.round(cellW * colSpan + gap * (colSpan - 1)),
      height: Math.round(cellH * rowSpan + gap * (rowSpan - 1)),
    };
  }

  // Absolute mode
  if ('absolute' in position) {
    const abs = position.absolute;
    return {
      x: wa.x + parseDimension(abs.x, wa.width),
      y: wa.y + parseDimension(abs.y, wa.height),
      width: parseDimension(abs.width, wa.width),
      height: parseDimension(abs.height, wa.height),
    };
  }

  throw new Error('Invalid position configuration');
}

export class FormationLoader {
  private formationsDir?: string;

  constructor(formationsDir?: string) {
    this.formationsDir = formationsDir;
  }

  load(name: string): FormationConfig {
    return loadFormation(name, this.formationsDir);
  }

  list(): string[] {
    return listFormations(this.formationsDir);
  }

  resolveMonitor(ref: string, monitors: MonitorInfo[]): MonitorInfo {
    return resolveMonitor(ref, monitors);
  }

  resolvePosition(
    position: Position,
    monitor: MonitorInfo,
    gridConfig?: GridConfig,
  ): Rect {
    return resolvePosition(position, monitor, gridConfig);
  }
}
