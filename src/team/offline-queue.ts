/**
 * File-backed offline message queue.
 *
 * Stores undelivered envelopes per team+peer in:
 *   ~/.sworm/offline-queue/<teamId>.json
 *
 * Structure: { [peerId]: TeamEnvelope[] }
 * Capped at MAX_PER_PEER entries per peer (oldest evicted first).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TeamEnvelope } from './messages.js';

const QUEUE_DIR = join(homedir(), '.sworm', 'offline-queue');
const MAX_PER_PEER = 50;

type QueueFile = Record<string, TeamEnvelope[]>;

function queuePath(teamId: string): string {
  return join(QUEUE_DIR, `${teamId}.json`);
}

function readQueue(teamId: string): QueueFile {
  const path = queuePath(teamId);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as QueueFile;
  } catch {
    return {};
  }
}

function writeQueue(teamId: string, data: QueueFile): void {
  mkdirSync(QUEUE_DIR, { recursive: true });
  writeFileSync(queuePath(teamId), JSON.stringify(data), 'utf-8');
}

/** Add an envelope to the queue for a specific peer. Evicts oldest if over cap. */
export function enqueue(teamId: string, peerId: string, envelope: TeamEnvelope): void {
  const data = readQueue(teamId);
  if (!data[peerId]) data[peerId] = [];
  data[peerId].push(envelope);
  if (data[peerId].length > MAX_PER_PEER) {
    data[peerId] = data[peerId].slice(-MAX_PER_PEER);
  }
  writeQueue(teamId, data);
}

/** Remove and return all queued envelopes for a peer. */
export function flush(teamId: string, peerId: string): TeamEnvelope[] {
  const data = readQueue(teamId);
  const messages = data[peerId] ?? [];
  if (messages.length > 0) {
    delete data[peerId];
    writeQueue(teamId, data);
  }
  return messages;
}

/** How many messages are queued for a peer. */
export function queueSize(teamId: string, peerId: string): number {
  return readQueue(teamId)[peerId]?.length ?? 0;
}

/** Remove all queued messages for a team. */
export function clearTeamQueue(teamId: string): void {
  writeQueue(teamId, {});
}

export function getQueueDir(): string {
  return QUEUE_DIR;
}
