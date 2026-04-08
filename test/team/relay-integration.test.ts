/**
 * Integration test: two peers connect to a real (in-process) relay server,
 * exchange presence and an encrypted note, then disconnect cleanly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { RelayServer } from '../../src/relay/server.js';
import { RelayClient } from '../../src/team/relay-client.js';
import { MessageHandler } from '../../src/team/message-handler.js';
import { generateEncryptionKeypair, deriveSharedSecret, decrypt } from '../../src/team/crypto.js';
import { derivePeerId } from '../../src/team/identity.js';
import type { Identity } from '../../src/team/identity.js';
import { randomUUID } from 'node:crypto';
import type { NoteMessage, PresenceMessage, AgentSpawnAckMessage } from '../../src/team/messages.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeIdentity(): Identity {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const enc = generateEncryptionKeypair();
  return {
    peerId: derivePeerId(publicKey as string),
    publicKeyPem: publicKey as string,
    privateKeyPem: privateKey as string,
    encryptionPublicKeyPem: enc.publicKeyPem,
    encryptionPrivateKeyPem: enc.privateKeyPem,
  };
}

function waitFor<T>(
  emitter: RelayClient,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
    emitter.once(event as never, (arg: T) => { clearTimeout(t); resolve(arg); });
  });
}

// ── Test setup ────────────────────────────────────────────────────────────

const TEAM_ID = 'integration-test-team';
let relay: RelayServer;
let relayUrl: string;

beforeEach(async () => {
  // Use port 0 so the OS assigns a free port
  relay = new RelayServer({ port: 0, logger: () => {} });
  await relay.listen();
  relayUrl = `ws://127.0.0.1:${relay.port}`;
});

afterEach(async () => {
  await relay.close();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('relay auth', () => {
  it('connects and authenticates successfully', async () => {
    const alice = makeIdentity();
    const client = new RelayClient(alice, TEAM_ID, { relayUrl });
    await client.connect();
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('two peers can connect to the same team', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });

    await Promise.all([clientA.connect(), clientB.connect()]);
    expect(clientA.connected).toBe(true);
    expect(clientB.connected).toBe(true);

    clientA.disconnect();
    clientB.disconnect();
  });
});

describe('presence broadcast', () => {
  it('bob receives alice\'s presence broadcast', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });

    await Promise.all([clientA.connect(), clientB.connect()]);

    const received: PresenceMessage[] = [];
    const handler = new MessageHandler(bob, TEAM_ID, {
      onPresence: (_from, msg) => received.push(msg),
    });
    clientB.on('envelope', (env) => handler.handle(env));

    const envPromise = waitFor(clientB, 'envelope');
    clientA.sendBroadcast({
      type: 'presence',
      status: 'online',
      encryptionPublicKey: alice.encryptionPublicKeyPem,
    });
    await envPromise;

    expect(received).toHaveLength(1);
    expect(received[0].status).toBe('online');
    expect(received[0].encryptionPublicKey).toBe(alice.encryptionPublicKeyPem);

    clientA.disconnect();
    clientB.disconnect();
  });
});

describe('encrypted note', () => {
  it('bob receives an encrypted note from alice', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });

    await Promise.all([clientA.connect(), clientB.connect()]);

    const notes: NoteMessage[] = [];
    // For the MessageHandler to decrypt, it needs alice's enc key cached on bob's side.
    // We simulate this by giving the handler alice's key directly via a mock team store.
    // Here we test the relay-client-level crypto by bypassing the store and handling inline.
    clientB.on('envelope', (env) => {
      // Manually decrypt since we don't have a team on disk in this test
      if (!env.encrypted || !env.nonce) return;
      const secret = deriveSharedSecret(bob.encryptionPrivateKeyPem, alice.encryptionPublicKeyPem);
      const plaintext = decrypt(env.payload, env.nonce, secret);
      notes.push(JSON.parse(plaintext) as NoteMessage);
    });

    const envPromise = waitFor(clientB, 'envelope');
    clientA.sendEncrypted(
      bob.peerId,
      { type: 'note', text: 'Hello Bob!', priority: 'normal' },
      bob.encryptionPublicKeyPem,
    );
    await envPromise;

    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('Hello Bob!');

    clientA.disconnect();
    clientB.disconnect();
  });

  it('relay does not forward message to wrong peer', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const carol = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    const clientC = new RelayClient(carol, TEAM_ID, { relayUrl });

    await Promise.all([clientA.connect(), clientB.connect(), clientC.connect()]);

    const carolReceived: unknown[] = [];
    clientC.on('envelope', (env) => carolReceived.push(env));

    // Alice sends directly to Bob
    const envPromise = waitFor(clientB, 'envelope');
    clientA.sendEncrypted(
      bob.peerId,
      { type: 'note', text: 'For Bob only' },
      bob.encryptionPublicKeyPem,
    );
    await envPromise;

    // Give Carol a moment to (not) receive anything
    await new Promise((r) => setTimeout(r, 100));
    expect(carolReceived).toHaveLength(0);

    clientA.disconnect();
    clientB.disconnect();
    clientC.disconnect();
  });
});

describe('peer_list — late joiners see existing peers', () => {
  it('bob learns about alice who was already online', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    await clientA.connect(); // Alice connects first

    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    const onlinePromise = waitFor<string>(clientB, 'peer_online');
    await clientB.connect(); // Bob connects second
    const peerId = await onlinePromise;

    expect(peerId).toBe(alice.peerId);
    expect(clientB.isOnline(alice.peerId)).toBe(true);

    clientA.disconnect();
    clientB.disconnect();
  });

  it('isOnline returns false for offline peer', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect()]);

    const offlinePromise = waitFor<string>(clientB, 'peer_offline');
    clientA.disconnect();
    await offlinePromise;

    expect(clientB.isOnline(alice.peerId)).toBe(false);
    clientB.disconnect();
  });
});

describe('formation_status broadcast', () => {
  it('bob receives alice\'s formation_status broadcast', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect()]);

    const received: unknown[] = [];
    clientB.on('envelope', (env) => {
      if (!env.encrypted) received.push(JSON.parse(env.payload));
    });

    const envPromise = waitFor(clientB, 'envelope');
    clientA.sendBroadcast({ type: 'formation_status', formation: 'pilot', wormCount: 3 });
    await envPromise;

    expect(received).toHaveLength(1);
    expect((received[0] as { formation: string }).formation).toBe('pilot');
    expect((received[0] as { wormCount: number }).wormCount).toBe(3);

    clientA.disconnect();
    clientB.disconnect();
  });

  it('formation null (killed) broadcasts correctly', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect()]);

    const received: unknown[] = [];
    clientB.on('envelope', (env) => {
      if (!env.encrypted) received.push(JSON.parse(env.payload));
    });

    const envPromise = waitFor(clientB, 'envelope');
    clientA.sendBroadcast({ type: 'formation_status', formation: null, wormCount: 0 });
    await envPromise;

    expect((received[0] as { formation: null }).formation).toBeNull();

    clientA.disconnect();
    clientB.disconnect();
  });
});

describe('peer_status events', () => {
  it('bob gets notified when alice connects', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await clientB.connect();

    const onlinePromise = waitFor<string>(clientB, 'peer_online');
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    await clientA.connect();

    const peerId = await onlinePromise;
    expect(peerId).toBe(alice.peerId);

    clientA.disconnect();
    clientB.disconnect();
  });

  it('bob gets notified when alice disconnects', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect()]);

    const offlinePromise = waitFor<string>(clientB, 'peer_offline');
    clientA.disconnect();
    const peerId = await offlinePromise;
    expect(peerId).toBe(alice.peerId);

    clientB.disconnect();
  });
});

describe('agent spawn request / ack roundtrip', () => {
  it('alice sends a spawn request and bob acks ok', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect()]);

    const requestId = randomUUID();
    const acks: AgentSpawnAckMessage[] = [];

    // Alice listens for the ack — manually decrypt since there's no team store in this test
    const ackEnvPromise = new Promise<void>((resolve) => {
      clientA.on('envelope', (env) => {
        if (!env.encrypted || !env.nonce) return;
        const secret = deriveSharedSecret(alice.encryptionPrivateKeyPem, bob.encryptionPublicKeyPem);
        const msg = JSON.parse(decrypt(env.payload, env.nonce, secret));
        if (msg.type === 'agent_spawn_ack') { acks.push(msg as AgentSpawnAckMessage); resolve(); }
      });
    });

    // Bob listens for the spawn request and immediately acks ok
    clientB.on('envelope', (env) => {
      if (!env.encrypted || !env.nonce) return;
      const secret = deriveSharedSecret(bob.encryptionPrivateKeyPem, alice.encryptionPublicKeyPem);
      const msg = JSON.parse(decrypt(env.payload, env.nonce, secret));
      if (msg.type === 'agent_spawn_request') {
        clientB.sendEncrypted(alice.peerId,
          { type: 'agent_spawn_ack', requestId: msg.requestId, status: 'ok' },
          alice.encryptionPublicKeyPem,
        );
      }
    });

    clientA.sendEncrypted(bob.peerId,
      { type: 'agent_spawn_request', formation: 'pilot', requestId, requestedBy: 'alice' },
      bob.encryptionPublicKeyPem,
    );

    await ackEnvPromise;
    expect(acks).toHaveLength(1);
    expect(acks[0].requestId).toBe(requestId);
    expect(acks[0].status).toBe('ok');

    clientA.disconnect();
    clientB.disconnect();
  });

  it('bob can deny and alice receives the denial', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect()]);

    const requestId = randomUUID();
    const acks: AgentSpawnAckMessage[] = [];

    const ackEnvPromise = new Promise<void>((resolve) => {
      clientA.on('envelope', (env) => {
        if (!env.encrypted || !env.nonce) return;
        const secret = deriveSharedSecret(alice.encryptionPrivateKeyPem, bob.encryptionPublicKeyPem);
        const msg = JSON.parse(decrypt(env.payload, env.nonce, secret));
        if (msg.type === 'agent_spawn_ack') { acks.push(msg as AgentSpawnAckMessage); resolve(); }
      });
    });

    clientB.on('envelope', (env) => {
      if (!env.encrypted || !env.nonce) return;
      const secret = deriveSharedSecret(bob.encryptionPrivateKeyPem, alice.encryptionPublicKeyPem);
      const msg = JSON.parse(decrypt(env.payload, env.nonce, secret));
      if (msg.type === 'agent_spawn_request') {
        clientB.sendEncrypted(alice.peerId,
          { type: 'agent_spawn_ack', requestId: msg.requestId, status: 'denied', reason: 'Not now' },
          alice.encryptionPublicKeyPem,
        );
      }
    });

    clientA.sendEncrypted(bob.peerId,
      { type: 'agent_spawn_request', formation: 'review', requestId, requestedBy: 'alice' },
      bob.encryptionPublicKeyPem,
    );

    await ackEnvPromise;
    expect(acks[0].status).toBe('denied');
    expect(acks[0].reason).toBe('Not now');

    clientA.disconnect();
    clientB.disconnect();
  });
});
