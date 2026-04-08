import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { enqueue, flush, queueSize, clearTeamQueue } from '../../src/team/offline-queue.js';
import type { TeamEnvelope } from '../../src/team/messages.js';

const QUEUE_DIR = join(homedir(), '.sworm', 'offline-queue');
const TEAM = 'test-queue-team';

function cleanup() {
  if (existsSync(QUEUE_DIR)) rmSync(QUEUE_DIR, { recursive: true, force: true });
}

function makeEnvelope(id: string): TeamEnvelope {
  return {
    id,
    teamId: TEAM,
    fromPeer: 'me',
    toPeer: 'alice',
    timestamp: Date.now(),
    encrypted: false,
    payload: '{}',
  };
}

describe('enqueue / flush', () => {
  beforeEach(cleanup);

  it('stores and returns messages in order', () => {
    enqueue(TEAM, 'alice', makeEnvelope('msg-1'));
    enqueue(TEAM, 'alice', makeEnvelope('msg-2'));
    const result = flush(TEAM, 'alice');
    expect(result.map((e) => e.id)).toEqual(['msg-1', 'msg-2']);
  });

  it('flush empties the queue', () => {
    enqueue(TEAM, 'alice', makeEnvelope('msg-1'));
    flush(TEAM, 'alice');
    expect(queueSize(TEAM, 'alice')).toBe(0);
  });

  it('flush returns empty array for unknown peer', () => {
    expect(flush(TEAM, 'nobody')).toEqual([]);
  });

  it('different peers have independent queues', () => {
    enqueue(TEAM, 'alice', makeEnvelope('a1'));
    enqueue(TEAM, 'bob', makeEnvelope('b1'));
    expect(flush(TEAM, 'alice').map((e) => e.id)).toEqual(['a1']);
    expect(flush(TEAM, 'bob').map((e) => e.id)).toEqual(['b1']);
  });
});

describe('queueSize', () => {
  beforeEach(cleanup);

  it('returns 0 for empty queue', () => {
    expect(queueSize(TEAM, 'alice')).toBe(0);
  });

  it('returns correct count after enqueue', () => {
    enqueue(TEAM, 'alice', makeEnvelope('m1'));
    enqueue(TEAM, 'alice', makeEnvelope('m2'));
    expect(queueSize(TEAM, 'alice')).toBe(2);
  });
});

describe('eviction cap', () => {
  beforeEach(cleanup);

  it('never exceeds 50 messages per peer', () => {
    for (let i = 0; i < 60; i++) {
      enqueue(TEAM, 'alice', makeEnvelope(`msg-${i}`));
    }
    const result = flush(TEAM, 'alice');
    expect(result.length).toBe(50);
    // Oldest messages evicted — we should have msgs 10-59
    expect(result[0].id).toBe('msg-10');
    expect(result[49].id).toBe('msg-59');
  });
});

describe('clearTeamQueue', () => {
  beforeEach(cleanup);

  it('clears all peers for a team', () => {
    enqueue(TEAM, 'alice', makeEnvelope('a1'));
    enqueue(TEAM, 'bob', makeEnvelope('b1'));
    clearTeamQueue(TEAM);
    expect(queueSize(TEAM, 'alice')).toBe(0);
    expect(queueSize(TEAM, 'bob')).toBe(0);
  });
});
