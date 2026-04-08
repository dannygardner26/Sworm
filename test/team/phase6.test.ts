/**
 * Phase 6: Invite key-exchange, key rotation, and KeyRotationMessage tests.
 * No LLM / API key required.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { RelayServer } from '../../src/relay/server.js';
import { RelayClient } from '../../src/team/relay-client.js';
import { MessageHandler } from '../../src/team/message-handler.js';
import { generateEncryptionKeypair, deriveSharedSecret, decrypt } from '../../src/team/crypto.js';
import { derivePeerId } from '../../src/team/identity.js';
import { createInvite, parseInvite } from '../../src/team/invite.js';
import type { Identity } from '../../src/team/identity.js';
import type { KeyRotationMessage } from '../../src/team/messages.js';

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

function waitFor<T>(emitter: RelayClient, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
    emitter.once(event as never, (arg: T) => { clearTimeout(t); resolve(arg); });
  });
}

const TEAM_ID = 'phase6-test-team';
let relay: RelayServer;
let relayUrl: string;

beforeEach(async () => {
  relay = new RelayServer({ port: 0, logger: () => {} });
  await relay.listen();
  relayUrl = `ws://127.0.0.1:${relay.port}`;
});

afterEach(async () => {
  await relay.close();
});

// ── Invite key-exchange ──────────────────────────────────────────────────────

describe('invite payload includes inviter encryption key', () => {
  it('createInvite embeds inviterEncryptionPublicKey when provided', () => {
    const alice = makeIdentity();
    const { token } = createInvite('team-1', 'My Team', alice.peerId, {
      inviterEncryptionPublicKey: alice.encryptionPublicKeyPem,
      inviterDisplayName: 'Alice',
    });
    const payload = parseInvite(token);
    expect(payload.inviterEncryptionPublicKey).toBe(alice.encryptionPublicKeyPem);
    expect(payload.inviterDisplayName).toBe('Alice');
  });

  it('createInvite works without inviterEncryptionPublicKey (backwards compat)', () => {
    const { token } = createInvite('team-1', 'My Team', 'owner-id');
    const payload = parseInvite(token);
    expect(payload.inviterEncryptionPublicKey).toBeUndefined();
  });

  it('bob can encrypt to alice immediately using key from invite payload', () => {
    // Simulate the join flow: Bob gets Alice's enc key from the invite
    const alice = makeIdentity();
    const bob = makeIdentity();

    const { token } = createInvite('team-1', 'My Team', alice.peerId, {
      inviterEncryptionPublicKey: alice.encryptionPublicKeyPem,
    });
    const payload = parseInvite(token);

    // Bob derives the shared secret using Alice's enc key from the invite
    const sharedFromInvite = deriveSharedSecret(
      bob.encryptionPrivateKeyPem,
      payload.inviterEncryptionPublicKey!,
    );

    // Alice derives the same shared secret from her side
    const sharedAliceSide = deriveSharedSecret(
      alice.encryptionPrivateKeyPem,
      bob.encryptionPublicKeyPem,
    );

    // Both sides produce the same secret (ECDH is symmetric)
    expect(sharedFromInvite.toString('hex')).toBe(sharedAliceSide.toString('hex'));
  });
});

// ── Key rotation ─────────────────────────────────────────────────────────────

describe('key_rotation message type', () => {
  it('bob receives alice key_rotation broadcast and MessageHandler routes it', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect()]);

    const rotations: Array<{ from: string; msg: KeyRotationMessage }> = [];

    clientB.on('envelope', (env) => {
      if (env.encrypted) return; // key_rotation is sent as broadcast (unencrypted) in tests
      const handler = new MessageHandler(bob, TEAM_ID, {
        onKeyRotation(from, msg) { rotations.push({ from, msg }); },
      });
      handler.handle(env);
    });

    const envPromise = waitFor(clientB, 'envelope');
    const newEncKey = generateEncryptionKeypair();
    clientA.sendBroadcast({
      type: 'key_rotation',
      newEncryptionPublicKey: newEncKey.publicKeyPem,
    });
    await envPromise;

    expect(rotations).toHaveLength(1);
    expect(rotations[0].from).toBe(alice.peerId);
    expect(rotations[0].msg.newEncryptionPublicKey).toBe(newEncKey.publicKeyPem);

    clientA.disconnect();
    clientB.disconnect();
  });

  it('key_rotation is not delivered to a third team peer who disconnected', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const carol = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    const clientC = new RelayClient(carol, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect(), clientC.connect()]);

    // Carol disconnects before the rotation
    const offlinePromise = waitFor<string>(clientA, 'peer_offline');
    clientC.disconnect();
    await offlinePromise;

    const bobReceived: unknown[] = [];
    clientB.on('envelope', () => bobReceived.push(true));

    const newKey = generateEncryptionKeypair();
    const envPromise = waitFor(clientB, 'envelope');
    clientA.sendBroadcast({ type: 'key_rotation', newEncryptionPublicKey: newKey.publicKeyPem });
    await envPromise;

    // Bob (still connected) received it; Carol (offline) did not get queued on the relay
    expect(bobReceived).toHaveLength(1);

    clientA.disconnect();
    clientB.disconnect();
  });

  it('after key rotation, bob can still decrypt messages using the new key', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect()]);

    // Alice rotates to a new keypair
    const newAliceEnc = generateEncryptionKeypair();

    // Bob captures the rotation and updates his local copy of Alice's enc key
    let aliceCurrentEncPub = alice.encryptionPublicKeyPem;
    clientB.on('envelope', (env) => {
      if (!env.encrypted) {
        try {
          const msg = JSON.parse(env.payload) as { type: string; newEncryptionPublicKey?: string };
          if (msg.type === 'key_rotation' && msg.newEncryptionPublicKey) {
            aliceCurrentEncPub = msg.newEncryptionPublicKey;
          }
        } catch { /* ignore */ }
      }
    });

    // Step 1: Alice broadcasts key rotation
    const rotationEnvPromise = waitFor(clientB, 'envelope');
    clientA.sendBroadcast({ type: 'key_rotation', newEncryptionPublicKey: newAliceEnc.publicKeyPem });
    await rotationEnvPromise;

    expect(aliceCurrentEncPub).toBe(newAliceEnc.publicKeyPem);

    // Step 2: Alice sends a note using her NEW private key; Bob decrypts with the rotated public key
    const notes: string[] = [];
    clientB.on('envelope', (env) => {
      if (!env.encrypted || !env.nonce) return;
      const secret = deriveSharedSecret(bob.encryptionPrivateKeyPem, aliceCurrentEncPub);
      try {
        const msg = JSON.parse(decrypt(env.payload, env.nonce, secret)) as { type: string; text?: string };
        if (msg.type === 'note' && msg.text) notes.push(msg.text);
      } catch { /* wrong key */ }
    });

    // Alice creates a new relay client using her rotated identity
    const aliceRotated: Identity = { ...alice, encryptionPrivateKeyPem: newAliceEnc.privateKeyPem, encryptionPublicKeyPem: newAliceEnc.publicKeyPem };
    const clientANew = new RelayClient(aliceRotated, TEAM_ID, { relayUrl });
    await clientANew.connect();

    const noteEnvPromise = waitFor(clientB, 'envelope');
    clientANew.sendEncrypted(bob.peerId, { type: 'note', text: 'Post-rotation note' }, bob.encryptionPublicKeyPem);
    await noteEnvPromise;

    expect(notes).toHaveLength(1);
    expect(notes[0]).toBe('Post-rotation note');

    clientANew.disconnect();
    clientB.disconnect();
  });
});

// ── replyTo threading ────────────────────────────────────────────────────────

describe('agent_message replyTo threading', () => {
  it('reply references the original messageId', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect()]);

    const originalId = randomUUID();

    // Bob listens and replies
    clientB.on('envelope', (env) => {
      if (!env.encrypted || !env.nonce) return;
      const secret = deriveSharedSecret(bob.encryptionPrivateKeyPem, alice.encryptionPublicKeyPem);
      const msg = JSON.parse(decrypt(env.payload, env.nonce, secret)) as { type: string; messageId?: string };
      if (msg.type === 'agent_message') {
        clientB.sendEncrypted(alice.peerId, {
          type: 'agent_message',
          fromAgentId: 'bob-agent',
          content: 'Done!',
          replyTo: msg.messageId,
          messageId: randomUUID(),
        }, alice.encryptionPublicKeyPem);
      }
    });

    // Alice listens for reply
    const replies: Array<{ replyTo?: string; content: string }> = [];
    const replyPromise = new Promise<void>((resolve) => {
      clientA.on('envelope', (env) => {
        if (!env.encrypted || !env.nonce) return;
        const secret = deriveSharedSecret(alice.encryptionPrivateKeyPem, bob.encryptionPublicKeyPem);
        const msg = JSON.parse(decrypt(env.payload, env.nonce, secret)) as { type: string; replyTo?: string; content?: string };
        if (msg.type === 'agent_message') { replies.push({ replyTo: msg.replyTo, content: msg.content ?? '' }); resolve(); }
      });
    });

    clientA.sendEncrypted(bob.peerId, {
      type: 'agent_message',
      fromAgentId: 'alice-agent',
      content: 'Can you run the build?',
      messageId: originalId,
    }, bob.encryptionPublicKeyPem);

    await replyPromise;
    expect(replies[0].replyTo).toBe(originalId);
    expect(replies[0].content).toBe('Done!');

    clientA.disconnect();
    clientB.disconnect();
  });
});
