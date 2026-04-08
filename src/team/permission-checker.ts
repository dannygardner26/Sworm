import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { z } from 'zod';

const PERM_PATH = join(homedir(), '.sworm', 'team-permissions.yaml');

export type PermissionResult = 'allow' | 'deny' | 'ask';

export const TeamActionSchema = z.enum([
  'remote_spawn',
  'remote_note',
  'remote_formation_status',
  'remote_agent_message',
]);
export type TeamAction = z.infer<typeof TeamActionSchema>;

const ActionPermissionSchema = z.enum(['allow', 'deny', 'ask']);

const OverrideSchema = z.object({
  peer: z.string(),
  remote_spawn: ActionPermissionSchema.optional(),
  remote_note: ActionPermissionSchema.optional(),
  remote_formation_status: ActionPermissionSchema.optional(),
  remote_agent_message: ActionPermissionSchema.optional(),
});
export type PeerOverride = z.infer<typeof OverrideSchema>;

const DefaultsSchema = z.object({
  remote_spawn: ActionPermissionSchema.default('ask'),
  remote_note: ActionPermissionSchema.default('allow'),
  remote_formation_status: ActionPermissionSchema.default('allow'),
  remote_agent_message: ActionPermissionSchema.default('ask'),
});

export const PermissionsConfigSchema = z.object({
  defaults: DefaultsSchema.default({
    remote_spawn: 'ask',
    remote_note: 'allow',
    remote_formation_status: 'allow',
    remote_agent_message: 'ask',
  }),
  overrides: z.array(OverrideSchema).default([]),
});
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;

export function loadPermissions(): PermissionsConfig {
  if (!existsSync(PERM_PATH)) {
    return PermissionsConfigSchema.parse({});
  }
  try {
    const raw = readFileSync(PERM_PATH, 'utf-8');
    const parsed = parseYaml(raw);
    return PermissionsConfigSchema.parse(parsed ?? {});
  } catch {
    return PermissionsConfigSchema.parse({});
  }
}

export function savePermissions(config: PermissionsConfig): void {
  mkdirSync(dirname(PERM_PATH), { recursive: true });
  writeFileSync(PERM_PATH, toYaml(config, { indent: 2 }), 'utf-8');
}

export function checkPermission(peerId: string, action: TeamAction): PermissionResult {
  const config = loadPermissions();
  const override = config.overrides.find((o) => o.peer === peerId);
  if (override?.[action] !== undefined) {
    return override[action] as PermissionResult;
  }
  return config.defaults[action];
}

export function setPeerPermission(
  peerId: string,
  action: TeamAction,
  value: PermissionResult,
): void {
  const config = loadPermissions();
  const idx = config.overrides.findIndex((o) => o.peer === peerId);
  if (idx === -1) {
    config.overrides.push({ peer: peerId, [action]: value });
  } else {
    config.overrides[idx] = { ...config.overrides[idx], [action]: value };
  }
  savePermissions(config);
}

export function getPermissionsPath(): string {
  return PERM_PATH;
}
