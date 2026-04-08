import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { TeamEnvelope, TeamMessage, RelayMessage } from './messages.js';
import type { Identity } from './identity.js';
import { sign } from './crypto.js';
import { deriveSharedSecret, encrypt } from './crypto.js';

export interface RelayClientOptions {
  relayUrl: string;
  /** Initial reconnect delay in ms. Doubles on each failure up to max. Default: 1000 */
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  /** How often to send pings (ms). Default: 20_000 */
  pingIntervalMs?: number;
}

type RelayClientEvents = {
  connected: [];
  disconnected: [];
  envelope: [envelope: TeamEnvelope];
  peer_online: [peerId: string];
  peer_offline: [peerId: string];
  error: [err: Error];
};

export class RelayClient extends EventEmitter<RelayClientEvents> {
  private ws: WebSocket | null = null;
  private identity: Identity;
  private teamId: string;
  private opts: Required<RelayClientOptions>;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentReconnectDelay: number;
  private _connected = false;
  private _stopping = false;
  /** Peers currently online in this team, per relay reports */
  private _onlinePeers = new Set<string>();

  constructor(identity: Identity, teamId: string, opts: RelayClientOptions) {
    super();
    this.identity = identity;
    this.teamId = teamId;
    this.opts = {
      relayUrl: opts.relayUrl,
      reconnectDelayMs: opts.reconnectDelayMs ?? 1_000,
      maxReconnectDelayMs: opts.maxReconnectDelayMs ?? 30_000,
      pingIntervalMs: opts.pingIntervalMs ?? 20_000,
    };
    this.currentReconnectDelay = this.opts.reconnectDelayMs;
  }

  /** Connect and resolve once the relay confirms auth. Rejects on first connection error. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._stopping = false;
      this.attemptConnect(resolve, reject);
    });
  }

  disconnect(): void {
    this._stopping = true;
    this.clearTimers();
    this.ws?.close();
  }

  get connected(): boolean {
    return this._connected;
  }

  // ── Internal connection logic ────────────────────────────────────────────

  private attemptConnect(
    onFirstConnected?: () => void,
    onFirstError?: (e: Error) => void,
  ): void {
    const ws = new WebSocket(this.opts.relayUrl);
    this.ws = ws;

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as RelayMessage;
        this.onRelayMessage(msg, onFirstConnected, onFirstError);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      this._connected = false;
      this._onlinePeers.clear();
      this.clearTimers();
      this.emit('disconnected');
      if (!this._stopping) {
        this.reconnectTimer = setTimeout(() => {
          this.currentReconnectDelay = Math.min(
            this.currentReconnectDelay * 2,
            this.opts.maxReconnectDelayMs,
          );
          this.attemptConnect(); // no resolve/reject on reconnects
        }, this.currentReconnectDelay);
      }
    });

    ws.on('error', (err) => {
      if (onFirstError) {
        onFirstError(err);
        onFirstError = undefined;
      }
      this.emit('error', err);
    });
  }

  private onRelayMessage(
    msg: RelayMessage,
    onFirstConnected?: () => void,
    onFirstError?: (e: Error) => void,
  ): void {
    switch (msg.type) {
      case 'challenge': {
        const challenge = `sworm-auth:${msg.nonce}:${this.identity.peerId}:${this.teamId}`;
        const signature = sign(challenge, this.identity.privateKeyPem);
        this.sendRaw({
          type: 'auth',
          peerId: this.identity.peerId,
          teamId: this.teamId,
          signature,
          publicKeyPem: this.identity.publicKeyPem,
        });
        break;
      }
      case 'auth_ok': {
        this._connected = true;
        this.currentReconnectDelay = this.opts.reconnectDelayMs; // reset backoff on success
        this.startPing();
        this.emit('connected');
        // Don't resolve yet — wait for the peer_list that the relay always sends next,
        // so that isOnline() returns accurate results immediately after connect() resolves.
        break;
      }
      case 'auth_fail': {
        const err = new Error(`Relay auth failed: ${msg.reason}`);
        onFirstError?.(err);
        this.emit('error', err);
        this._stopping = true;
        this.ws?.close();
        break;
      }
      case 'pong':
        break; // heartbeat ack
      case 'peer_status':
        if (msg.status === 'online') {
          this._onlinePeers.add(msg.peerId);
          this.emit('peer_online', msg.peerId);
        } else {
          this._onlinePeers.delete(msg.peerId);
          this.emit('peer_offline', msg.peerId);
        }
        break;
      case 'peer_list':
        for (const peerId of msg.peers) {
          this._onlinePeers.add(peerId);
          this.emit('peer_online', peerId);
        }
        // peer_list is always the last message after auth_ok — safe to resolve connect() now.
        onFirstConnected?.();
        onFirstConnected = undefined;
        break;
      case 'envelope':
        this.emit('envelope', msg.envelope);
        break;
    }
  }

  isOnline(peerId: string): boolean {
    return this._onlinePeers.has(peerId);
  }

  getOnlinePeers(): string[] {
    return [...this._onlinePeers];
  }

  // ── Sending ──────────────────────────────────────────────────────────────

  /** Send an unencrypted broadcast to all team members (e.g. presence). */
  sendBroadcast(message: TeamMessage): void {
    const envelope: TeamEnvelope = {
      id: randomUUID(),
      teamId: this.teamId,
      fromPeer: this.identity.peerId,
      toPeer: '*',
      timestamp: Date.now(),
      encrypted: false,
      payload: JSON.stringify(message),
    };
    this.sendRaw({ type: 'envelope', envelope });
  }

  /** Send an E2E-encrypted message to a specific peer. */
  sendEncrypted(
    toPeer: string,
    message: TeamMessage,
    theirEncryptionPublicKey: string,
  ): void {
    const sharedSecret = deriveSharedSecret(
      this.identity.encryptionPrivateKeyPem,
      theirEncryptionPublicKey,
    );
    const { nonce, ciphertext } = encrypt(JSON.stringify(message), sharedSecret);
    const envelope: TeamEnvelope = {
      id: randomUUID(),
      teamId: this.teamId,
      fromPeer: this.identity.peerId,
      toPeer,
      timestamp: Date.now(),
      encrypted: true,
      nonce,
      payload: ciphertext,
    };
    this.sendRaw({ type: 'envelope', envelope });
  }

  /** Send a pre-built envelope directly (used when flushing the offline queue). */
  sendEnvelope(envelope: TeamEnvelope): void {
    this.sendRaw({ type: 'envelope', envelope });
  }

  private sendRaw(msg: RelayMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      this.sendRaw({ type: 'ping' });
    }, this.opts.pingIntervalMs);
  }

  private clearTimers(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }
}
