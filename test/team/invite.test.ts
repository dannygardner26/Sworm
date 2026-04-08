import { describe, it, expect } from 'vitest';
import { createInvite, parseInvite, verifyInvite } from '../../src/team/invite.js';

const OWNER = 'owner-peer-abc';
const TEAM_ID = 'test-team-uuid';
const TEAM_NAME = 'My Team';

describe('createInvite / parseInvite', () => {
  it('round-trips an invite token', () => {
    const { token } = createInvite(TEAM_ID, TEAM_NAME, OWNER);
    const payload = parseInvite(token);
    expect(payload.teamId).toBe(TEAM_ID);
    expect(payload.teamName).toBe(TEAM_NAME);
    expect(payload.createdBy).toBe(OWNER);
    expect(payload.role).toBe('member'); // default
  });

  it('respects custom role', () => {
    const { token } = createInvite(TEAM_ID, TEAM_NAME, OWNER, { role: 'admin' });
    expect(parseInvite(token).role).toBe('admin');
  });

  it('throws on expired token', () => {
    const { token } = createInvite(TEAM_ID, TEAM_NAME, OWNER, { ttlMs: -1000 });
    expect(() => parseInvite(token)).toThrow(/expired/);
  });

  it('throws on malformed token', () => {
    expect(() => parseInvite('not-a-token')).toThrow(/Invalid invite token format/);
  });
});

describe('verifyInvite', () => {
  it('passes for correct owner', () => {
    const { token } = createInvite(TEAM_ID, TEAM_NAME, OWNER);
    expect(() => verifyInvite(token, OWNER)).not.toThrow();
  });

  it('fails for wrong owner', () => {
    const { token } = createInvite(TEAM_ID, TEAM_NAME, OWNER);
    expect(() => verifyInvite(token, 'wrong-owner')).toThrow(/invalid/i);
  });
});
