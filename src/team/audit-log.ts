/**
 * Append-only audit log of all cross-machine team actions.
 * Written to ~/.sworm/audit.log
 *
 * Format (one entry per line):
 *   ISO8601 | team:<id> | from:<peerId> | action:<type> | detail:<...> | outcome:<result>
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const LOG_PATH = join(homedir(), '.sworm', 'audit.log');

export type AuditAction =
  | 'remote_spawn_request'
  | 'remote_spawn_approved'
  | 'remote_spawn_denied'
  | 'remote_spawn_error'
  | 'remote_note_received'
  | 'remote_note_queued'
  | 'remote_agent_message';

export interface AuditEntry {
  teamId: string;
  fromPeer: string;
  action: AuditAction;
  detail?: string;
  outcome: string;
}

export function appendAuditLog(entry: AuditEntry): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    const detail = entry.detail ? ` | detail:${entry.detail}` : '';
    const line =
      `${new Date().toISOString()} | team:${entry.teamId} | from:${entry.fromPeer}` +
      ` | action:${entry.action}${detail} | outcome:${entry.outcome}\n`;
    appendFileSync(LOG_PATH, line, 'utf-8');
  } catch {
    // Audit log failure is non-fatal
  }
}

export function getAuditLogPath(): string {
  return LOG_PATH;
}

export function auditLogExists(): boolean {
  return existsSync(LOG_PATH);
}
