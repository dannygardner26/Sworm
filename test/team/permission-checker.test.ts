import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkPermission,
  loadPermissions,
  savePermissions,
  setPeerPermission,
  type PermissionsConfig,
} from '../../src/team/permission-checker.js';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PERM_PATH = join(homedir(), '.sworm', 'team-permissions.yaml');

function cleanup() {
  if (existsSync(PERM_PATH)) unlinkSync(PERM_PATH);
}

describe('checkPermission — defaults', () => {
  beforeEach(cleanup);

  it('defaults remote_spawn to ask', () => {
    expect(checkPermission('any-peer', 'remote_spawn')).toBe('ask');
  });

  it('defaults remote_note to allow', () => {
    expect(checkPermission('any-peer', 'remote_note')).toBe('allow');
  });

  it('defaults remote_formation_status to allow', () => {
    expect(checkPermission('any-peer', 'remote_formation_status')).toBe('allow');
  });

  it('defaults remote_agent_message to ask', () => {
    expect(checkPermission('any-peer', 'remote_agent_message')).toBe('ask');
  });
});

describe('checkPermission — overrides', () => {
  beforeEach(cleanup);

  it('peer override takes precedence over default', () => {
    mkdirSync(join(homedir(), '.sworm'), { recursive: true });
    const config: PermissionsConfig = {
      defaults: {
        remote_spawn: 'ask',
        remote_note: 'allow',
        remote_formation_status: 'allow',
        remote_agent_message: 'ask',
      },
      overrides: [{ peer: 'alice', remote_spawn: 'allow' }],
    };
    savePermissions(config);
    expect(checkPermission('alice', 'remote_spawn')).toBe('allow');
  });

  it('override only applies to the specified peer', () => {
    mkdirSync(join(homedir(), '.sworm'), { recursive: true });
    const config: PermissionsConfig = {
      defaults: {
        remote_spawn: 'ask',
        remote_note: 'allow',
        remote_formation_status: 'allow',
        remote_agent_message: 'ask',
      },
      overrides: [{ peer: 'alice', remote_spawn: 'allow' }],
    };
    savePermissions(config);
    expect(checkPermission('bob', 'remote_spawn')).toBe('ask');
  });

  it('can deny a specific peer', () => {
    mkdirSync(join(homedir(), '.sworm'), { recursive: true });
    const config: PermissionsConfig = {
      defaults: {
        remote_spawn: 'allow',
        remote_note: 'allow',
        remote_formation_status: 'allow',
        remote_agent_message: 'ask',
      },
      overrides: [{ peer: 'mallory', remote_note: 'deny' }],
    };
    savePermissions(config);
    expect(checkPermission('mallory', 'remote_note')).toBe('deny');
  });
});

describe('setPeerPermission', () => {
  beforeEach(cleanup);

  it('adds a new override for a new peer', () => {
    mkdirSync(join(homedir(), '.sworm'), { recursive: true });
    setPeerPermission('charlie', 'remote_spawn', 'allow');
    expect(checkPermission('charlie', 'remote_spawn')).toBe('allow');
  });

  it('updates an existing override for a known peer', () => {
    mkdirSync(join(homedir(), '.sworm'), { recursive: true });
    setPeerPermission('dave', 'remote_spawn', 'allow');
    setPeerPermission('dave', 'remote_spawn', 'deny');
    expect(checkPermission('dave', 'remote_spawn')).toBe('deny');
  });

  it('does not affect other actions on the same peer', () => {
    mkdirSync(join(homedir(), '.sworm'), { recursive: true });
    setPeerPermission('eve', 'remote_spawn', 'deny');
    // remote_note should still fall back to default (allow)
    expect(checkPermission('eve', 'remote_note')).toBe('allow');
  });
});
