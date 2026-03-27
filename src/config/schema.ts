import { z } from 'zod';

export const ZonePositionSchema = z.enum([
  'full',
  'left-half',
  'right-half',
  'top-half',
  'bottom-half',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'center-third',
  'left-third',
  'right-third',
]);
export type ZonePosition = z.infer<typeof ZonePositionSchema>;

export const GridPositionSchema = z.object({
  col: z.number().int().min(0),
  row: z.number().int().min(0),
  colSpan: z.number().int().min(1).default(1),
  rowSpan: z.number().int().min(1).default(1),
});

export const AbsolutePositionSchema = z.object({
  x: z.union([z.number(), z.string()]),
  y: z.union([z.number(), z.string()]),
  width: z.union([z.number(), z.string()]),
  height: z.union([z.number(), z.string()]),
});

export const PositionSchema = z.union([
  z.object({ zone: ZonePositionSchema }),
  z.object({ grid: GridPositionSchema }),
  z.object({ absolute: AbsolutePositionSchema }),
]);
export type Position = z.infer<typeof PositionSchema>;

export const WormConfigSchema = z.object({
  id: z.string(),
  type: z.enum(['claude', 'ide', 'generic', 'app', 'ai-agent']),
  monitor: z.string().default('primary'),
  position: PositionSchema,
  wallpaper: z.boolean().optional(),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type WormConfig = z.infer<typeof WormConfigSchema>;

export const GridConfigSchema = z.object({
  columns: z.number().int().min(1).default(12),
  rows: z.number().int().min(1).default(6),
  gap: z.number().min(0).default(4),
});

export const FormationConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  mode: z.enum(['normal', 'wallpaper']).default('normal').optional(),
  monitors: z.record(z.string(), z.string()).optional(),
  grid: GridConfigSchema.optional(),
  worms: z.array(WormConfigSchema).min(1),
  hooks: z.object({
    pre: z.array(z.string()).optional(),
    post: z.array(z.string()).optional(),
  }).optional(),
});
export type FormationConfig = z.infer<typeof FormationConfigSchema>;
