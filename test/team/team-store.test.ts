import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveTeam,
  loadTeam,
  listTeams,
  deleteTeam,
  addMember,
  removeMember,
  updateMemberRole,
  type TeamConfig,
} from '../../src/team/team-store.js';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const TEAMS_DIR = join(homedir(), '.sworm', 'teams');

function cleanup() {
  if (existsSync(TEAMS_DIR)) rmSync(TEAMS_DIR, { recursive: true, force: true });
}

const TEAM: TeamConfig = {
  id: 'test-team-id',
  name: 'Test Team',
  createdAt: 1000000,
  ownerPeerId: 'owner-peer',
  myPeerId: 'owner-peer',
  members: [
    {
      peerId: 'owner-peer',
      displayName: 'Owner',
      role: 'owner',
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n',
      joinedAt: 1000000,
    },
  ],
};

describe('saveTeam / loadTeam', () => {
  beforeEach(cleanup);

  it('round-trips a team', () => {
    saveTeam(TEAM);
    const loaded = loadTeam(TEAM.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(TEAM.id);
    expect(loaded!.name).toBe(TEAM.name);
    expect(loaded!.members).toHaveLength(1);
  });

  it('returns null for unknown team', () => {
    expect(loadTeam('no-such-id')).toBeNull();
  });
});

describe('listTeams', () => {
  beforeEach(cleanup);

  it('returns empty array when no teams exist', () => {
    expect(listTeams()).toEqual([]);
  });

  it('lists all saved teams', () => {
    saveTeam(TEAM);
    saveTeam({ ...TEAM, id: 'second-team', name: 'Second' });
    const teams = listTeams();
    expect(teams).toHaveLength(2);
    const ids = teams.map((t) => t.id).sort();
    expect(ids).toEqual(['second-team', 'test-team-id']);
  });
});

describe('deleteTeam', () => {
  beforeEach(cleanup);

  it('removes the team file', () => {
    saveTeam(TEAM);
    expect(loadTeam(TEAM.id)).not.toBeNull();
    deleteTeam(TEAM.id);
    expect(loadTeam(TEAM.id)).toBeNull();
  });

  it('is a no-op for non-existent team', () => {
    expect(() => deleteTeam('ghost')).not.toThrow();
  });
});

describe('addMember', () => {
  beforeEach(cleanup);

  it('adds a new member', () => {
    saveTeam(TEAM);
    const updated = addMember(TEAM.id, {
      peerId: 'alice',
      displayName: 'Alice',
      role: 'member',
      publicKeyPem: 'key',
      joinedAt: Date.now(),
    });
    expect(updated.members).toHaveLength(2);
  });

  it('throws when adding a duplicate peer', () => {
    saveTeam(TEAM);
    expect(() =>
      addMember(TEAM.id, {
        peerId: 'owner-peer',
        displayName: 'Dup',
        role: 'member',
        publicKeyPem: 'key',
        joinedAt: Date.now(),
      }),
    ).toThrow(/already a member/);
  });
});

describe('removeMember', () => {
  beforeEach(cleanup);

  it('removes a member by peer ID', () => {
    saveTeam(TEAM);
    addMember(TEAM.id, {
      peerId: 'bob',
      displayName: 'Bob',
      role: 'member',
      publicKeyPem: 'key',
      joinedAt: Date.now(),
    });
    const updated = removeMember(TEAM.id, 'bob');
    expect(updated.members.find((m) => m.peerId === 'bob')).toBeUndefined();
  });
});

describe('updateMemberRole', () => {
  beforeEach(cleanup);

  it('changes a member role', () => {
    saveTeam(TEAM);
    addMember(TEAM.id, {
      peerId: 'carol',
      displayName: 'Carol',
      role: 'member',
      publicKeyPem: 'key',
      joinedAt: Date.now(),
    });
    const updated = updateMemberRole(TEAM.id, 'carol', 'admin');
    const carol = updated.members.find((m) => m.peerId === 'carol');
    expect(carol?.role).toBe('admin');
  });
});
