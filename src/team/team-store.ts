import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { z } from 'zod';

const TEAMS_DIR = join(homedir(), '.sworm', 'teams');

export const MemberRoleSchema = z.enum(['viewer', 'member', 'admin', 'owner']);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const MemberRecordSchema = z.object({
  peerId: z.string(),
  displayName: z.string(),
  role: MemberRoleSchema,
  publicKeyPem: z.string(),
  /** X25519 public key — populated when the peer first comes online */
  encryptionPublicKey: z.string().optional(),
  joinedAt: z.number(),
  lastSeenAt: z.number().optional(),
  /** Last known active formation name, or null if none was active */
  lastKnownFormation: z.string().nullable().optional(),
});
export type MemberRecord = z.infer<typeof MemberRecordSchema>;

export const TeamConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  ownerPeerId: z.string(),
  myPeerId: z.string(),
  members: z.array(MemberRecordSchema).default([]),
  /** Relay WebSocket URL. Defaults to wss://relay.sworm.dev */
  relayUrl: z.string().default('wss://relay.sworm.dev'),
});
export type TeamConfig = z.infer<typeof TeamConfigSchema>;

function teamPath(teamId: string): string {
  return join(TEAMS_DIR, `${teamId}.yaml`);
}

export function saveTeam(team: TeamConfig): void {
  mkdirSync(TEAMS_DIR, { recursive: true });
  writeFileSync(teamPath(team.id), toYaml(team, { indent: 2 }), 'utf-8');
}

export function loadTeam(teamId: string): TeamConfig | null {
  const path = teamPath(teamId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = parseYaml(raw);
    return TeamConfigSchema.parse(parsed);
  } catch {
    return null;
  }
}

export function listTeams(): TeamConfig[] {
  if (!existsSync(TEAMS_DIR)) return [];
  return readdirSync(TEAMS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => loadTeam(f.replace(/\.yaml$/, '')))
    .filter((t): t is TeamConfig => t !== null);
}

export function deleteTeam(teamId: string): void {
  const path = teamPath(teamId);
  if (existsSync(path)) unlinkSync(path);
}

export function addMember(teamId: string, member: MemberRecord): TeamConfig {
  const team = loadTeam(teamId);
  if (!team) throw new Error(`Team "${teamId}" not found`);
  const already = team.members.some((m) => m.peerId === member.peerId);
  if (already) throw new Error(`Peer "${member.peerId}" is already a member`);
  const updated = { ...team, members: [...team.members, member] };
  saveTeam(updated);
  return updated;
}

export function removeMember(teamId: string, peerId: string): TeamConfig {
  const team = loadTeam(teamId);
  if (!team) throw new Error(`Team "${teamId}" not found`);
  const updated = { ...team, members: team.members.filter((m) => m.peerId !== peerId) };
  saveTeam(updated);
  return updated;
}

export function updateMemberRole(teamId: string, peerId: string, role: MemberRole): TeamConfig {
  const team = loadTeam(teamId);
  if (!team) throw new Error(`Team "${teamId}" not found`);
  const updated = {
    ...team,
    members: team.members.map((m) => (m.peerId === peerId ? { ...m, role } : m)),
  };
  saveTeam(updated);
  return updated;
}

export function updateMemberPresence(
  teamId: string,
  peerId: string,
  patch: { lastSeenAt?: number; lastKnownFormation?: string | null },
): void {
  const team = loadTeam(teamId);
  if (!team) return;
  saveTeam({
    ...team,
    members: team.members.map((m) =>
      m.peerId === peerId ? { ...m, ...patch } : m,
    ),
  });
}

export function updateMemberEncryptionKey(
  teamId: string,
  peerId: string,
  encryptionPublicKey: string,
): void {
  const team = loadTeam(teamId);
  if (!team) return;

  const exists = team.members.some((m) => m.peerId === peerId);
  if (exists) {
    saveTeam({
      ...team,
      members: team.members.map((m) =>
        m.peerId === peerId ? { ...m, encryptionPublicKey } : m,
      ),
    });
  } else {
    // Peer isn't in our member list yet (full sync happens via relay member_list).
    // Add a stub so we can decrypt their messages immediately.
    saveTeam({
      ...team,
      members: [
        ...team.members,
        {
          peerId,
          displayName: `Peer-${peerId.slice(0, 6)}`,
          role: 'member' as MemberRole,
          publicKeyPem: '',
          encryptionPublicKey,
          joinedAt: Date.now(),
        },
      ],
    });
  }
}

export function getTeamsDir(): string {
  return TEAMS_DIR;
}
