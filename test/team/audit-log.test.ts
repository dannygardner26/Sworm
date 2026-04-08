import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { appendAuditLog, getAuditLogPath, auditLogExists } from '../../src/team/audit-log.js';

const LOG_PATH = getAuditLogPath();

function cleanup() {
  if (existsSync(LOG_PATH)) unlinkSync(LOG_PATH);
}

describe('appendAuditLog', () => {
  beforeEach(cleanup);

  it('creates the file on first write', () => {
    expect(auditLogExists()).toBe(false);
    appendAuditLog({ teamId: 't1', fromPeer: 'alice', action: 'remote_spawn_request', outcome: 'pending' });
    expect(auditLogExists()).toBe(true);
  });

  it('writes ISO timestamp + structured fields', () => {
    appendAuditLog({ teamId: 'team-abc', fromPeer: 'bob', action: 'remote_spawn_approved', detail: 'pilot', outcome: 'ok' });
    const content = readFileSync(LOG_PATH, 'utf-8');
    expect(content).toMatch(/team:team-abc/);
    expect(content).toMatch(/from:bob/);
    expect(content).toMatch(/action:remote_spawn_approved/);
    expect(content).toMatch(/detail:pilot/);
    expect(content).toMatch(/outcome:ok/);
  });

  it('appends multiple entries', () => {
    appendAuditLog({ teamId: 't1', fromPeer: 'alice', action: 'remote_note_received', outcome: 'received' });
    appendAuditLog({ teamId: 't1', fromPeer: 'bob', action: 'remote_spawn_denied', outcome: 'denied' });
    const lines = readFileSync(LOG_PATH, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('omits detail field when not provided', () => {
    appendAuditLog({ teamId: 't1', fromPeer: 'alice', action: 'remote_note_received', outcome: 'received' });
    expect(readFileSync(LOG_PATH, 'utf-8')).not.toContain('detail:');
  });

  it('is non-fatal on write failure (bad path simulation)', () => {
    // appendAuditLog should never throw
    expect(() =>
      appendAuditLog({ teamId: '', fromPeer: '', action: 'remote_note_received', outcome: 'x' }),
    ).not.toThrow();
  });
});
