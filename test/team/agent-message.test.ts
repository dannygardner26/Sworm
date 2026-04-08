/**
 * Phase 5: Agent-to-agent messaging integration tests.
 * Two peers connect to an in-process relay and exchange agent_message envelopes.
 * No LLM / API key required.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { RelayServer } from '../../src/relay/server.js';
import { RelayClient } from '../../src/team/relay-client.js';
import { MessageHandler } from '../../src/team/message-handler.js';
import { generateEncryptionKeypair, deriveSharedSecret, decrypt } from '../../src/team/crypto.js';
import { derivePeerId } from '../../src/team/identity.js';
import type { Identity } from '../../src/team/identity.js';
import type { AgentMessageMessage } from '../../src/team/messages.js';

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

const TEAM_ID = 'agent-msg-test-team';
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

describe('agent_message relay delivery', () => {
  it('bob receives an encrypted agent_message from alice', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect()]);

    const received: AgentMessageMessage[] = [];
    clientB.on('envelope', (env) => {
      if (!env.encrypted || !env.nonce) return;
      const secret = deriveSharedSecret(bob.encryptionPrivateKeyPem, alice.encryptionPublicKeyPem);
      const msg = JSON.parse(decrypt(env.payload, env.nonce, secret)) as AgentMessageMessage;
      if (msg.type === 'agent_message') received.push(msg);
    });

    const envPromise = waitFor(clientB, 'envelope');
    const msg: AgentMessageMessage = {
      type: 'agent_message',
      fromAgentId: 'alice-agent-1',
      toAgentId: 'bob-agent-2',
      content: 'Please update the hero section banner',
      messageId: randomUUID(),
    };
    clientA.sendEncrypted(bob.peerId, msg, bob.encryptionPublicKeyPem);
    await envPromise;

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('agent_message');
    expect(received[0].content).toBe('Please update the hero section banner');
    expect(received[0].fromAgentId).toBe('alice-agent-1');
    expect(received[0].toAgentId).toBe('bob-agent-2');

    clientA.disconnect();
    clientB.disconnect();
  });

  it('agent_message without toAgentId is still delivered (broadcast to any agent)', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect()]);

    const received: AgentMessageMessage[] = [];
    clientB.on('envelope', (env) => {
      if (!env.encrypted || !env.nonce) return;
      const secret = deriveSharedSecret(bob.encryptionPrivateKeyPem, alice.encryptionPublicKeyPem);
      const msg = JSON.parse(decrypt(env.payload, env.nonce, secret)) as AgentMessageMessage;
      if (msg.type === 'agent_message') received.push(msg);
    });

    const envPromise = waitFor(clientB, 'envelope');
    clientA.sendEncrypted(bob.peerId, {
      type: 'agent_message',
      fromAgentId: 'alice-agent-1',
      content: 'Task for any available agent',
      messageId: randomUUID(),
    }, bob.encryptionPublicKeyPem);
    await envPromise;

    expect(received[0].toAgentId).toBeUndefined();
    expect(received[0].content).toBe('Task for any available agent');

    clientA.disconnect();
    clientB.disconnect();
  });

  it('message handler routes agent_message to onAgentMessage callback', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect()]);

    const received: Array<{ from: string; msg: AgentMessageMessage }> = [];

    // Bob uses MessageHandler — but since MessageHandler needs team-store for decryption,
    // we simulate decryption inline and call handle() with a plaintext envelope.
    clientB.on('envelope', (env) => {
      if (!env.encrypted || !env.nonce) return;
      const secret = deriveSharedSecret(bob.encryptionPrivateKeyPem, alice.encryptionPublicKeyPem);
      const plaintext = decrypt(env.payload, env.nonce, secret);
      // Feed as an unencrypted envelope to MessageHandler so it can route without the store
      const handler = new MessageHandler(bob, TEAM_ID, {
        onAgentMessage(from, msg) { received.push({ from, msg }); },
      });
      handler.handle({ ...env, encrypted: false, payload: plaintext });
    });

    const envPromise = waitFor(clientB, 'envelope');
    const agentMsg: AgentMessageMessage = {
      type: 'agent_message',
      fromAgentId: 'alice-agent',
      content: 'Hey Bob agent, can you run the tests?',
      messageId: randomUUID(),
    };
    clientA.sendEncrypted(bob.peerId, agentMsg, bob.encryptionPublicKeyPem);
    await envPromise;

    expect(received).toHaveLength(1);
    expect(received[0].from).toBe(alice.peerId);
    expect(received[0].msg.content).toBe('Hey Bob agent, can you run the tests?');

    clientA.disconnect();
    clientB.disconnect();
  });

  it('agent_message is not delivered to a third peer (point-to-point)', async () => {
    const alice = makeIdentity();
    const bob = makeIdentity();
    const carol = makeIdentity();
    const clientA = new RelayClient(alice, TEAM_ID, { relayUrl });
    const clientB = new RelayClient(bob, TEAM_ID, { relayUrl });
    const clientC = new RelayClient(carol, TEAM_ID, { relayUrl });
    await Promise.all([clientA.connect(), clientB.connect(), clientC.connect()]);

    const carolReceived: unknown[] = [];
    clientC.on('envelope', () => carolReceived.push(true));

    const envPromise = waitFor(clientB, 'envelope');
    clientA.sendEncrypted(bob.peerId, {
      type: 'agent_message',
      fromAgentId: 'alice-agent',
      content: 'For Bob only',
      messageId: randomUUID(),
    }, bob.encryptionPublicKeyPem);
    await envPromise;

    await new Promise((r) => setTimeout(r, 100));
    expect(carolReceived).toHaveLength(0);

    clientA.disconnect();
    clientB.disconnect();
    clientC.disconnect();
  });
});

describe('agent runtime inbox (drainInbox)', () => {
  it('drainInbox reads and clears the inbox file', async () => {
    const { AgentRuntime } = await import('../../src/agent/runtime.js');
    const { mkdirSync, writeFileSync, existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');

    const agentId = `test-agent-${randomUUID()}`;
    const inboxDir = join(homedir(), '.sworm', 'agent-inbox');
    const inboxPath = join(inboxDir, `${agentId}.jsonl`);
    mkdirSync(inboxDir, { recursive: true });

    const line1 = JSON.stringify({ content: 'First message', fromAgentId: 'sender-1' });
    const line2 = JSON.stringify({ content: 'Second message', fromAgentId: 'sender-2' });
    writeFileSync(inboxPath, `${line1}\n${line2}\n`, 'utf-8');

    // Run the agent for one iteration — it should drain the inbox
    const received: string[] = [];
    const runtime = new AgentRuntime(
      {
        provider: 'test',
        userPrompt: 'noop',
        workingDir: process.cwd(),
        agentId,
        maxIterations: 1,
      },
      // Mock provider that ends immediately
      {
        name: 'mock',
        async chat() {
          return { content: 'done', stopReason: 'end_turn' as const };
        },
      },
      [],
      (output) => {
        if (output.type === 'text' && output.content.startsWith('[Team Message]')) {
          received.push(output.content);
        }
      },
    );

    await runtime.run();

    expect(received).toHaveLength(2);
    expect(received[0]).toContain('First message');
    expect(received[1]).toContain('Second message');

    // File should be cleared after drain
    expect(readFileSync(inboxPath, 'utf-8')).toBe('');
  });
});
