import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { TeamEnvelope, RelayMessage } from '../team/messages.js';
import { verifySignature } from '../team/crypto.js';
import { derivePeerId } from '../team/identity.js';

interface AuthedClient {
  ws: WebSocket;
  peerId: string;
  teamId: string;
  lastSeen: number;
}

export interface RelayServerOptions {
  port?: number;
  host?: string;
  /** How often to ping clients (ms). Default: 30_000 */
  pingIntervalMs?: number;
  /** How long without a ping before a client is dropped (ms). Default: 90_000 */
  pingTimeoutMs?: number;
  /** Called on each log event — defaults to console.log */
  logger?: (msg: string) => void;
}

export class RelayServer {
  private wss: WebSocketServer;
  private httpServer: ReturnType<typeof createServer>;
  /** ws -> authenticated client (null = pending auth) */
  private clients = new Map<WebSocket, AuthedClient | null>();
  /** teamId -> peerId -> client */
  private routing = new Map<string, Map<string, AuthedClient>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private log: (msg: string) => void;
  private _port: number;

  /** The actual bound port — useful when port: 0 is used to get a free port */
  get port(): number { return this._port; }

  constructor(opts: RelayServerOptions = {}) {
    this._port = opts.port ?? 7891;
    this.log = opts.logger ?? ((msg) => console.log(`[relay] ${msg}`));

    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws) => this.onConnection(ws));

    const pingMs = opts.pingIntervalMs ?? 30_000;
    const timeoutMs = opts.pingTimeoutMs ?? 90_000;
    this.heartbeatTimer = setInterval(() => this.heartbeat(timeoutMs), pingMs);
  }

  listen(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this._port, () => {
        // When port 0 was requested, capture the OS-assigned port
        const addr = this.httpServer.address();
        if (addr && typeof addr === 'object') this._port = addr.port;
        this.log(`listening on port ${this._port}`);
        resolve();
      });
    });
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────

  private onConnection(ws: WebSocket): void {
    this.clients.set(ws, null); // pending auth

    const nonce = randomBytes(16).toString('hex');
    this.send(ws, { type: 'challenge', nonce });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as RelayMessage;
        this.onMessage(ws, msg, nonce);
      } catch {
        ws.close(1008, 'Bad message');
      }
    });

    ws.on('close', () => this.onClose(ws));
    ws.on('error', () => ws.close());
  }

  private onMessage(ws: WebSocket, msg: RelayMessage, nonce: string): void {
    const client = this.clients.get(ws);

    if (client === null) {
      if (msg.type !== 'auth') {
        ws.close(1008, 'Expected auth');
        return;
      }
      this.onAuth(ws, msg, nonce);
      return;
    }

    if (!client) return;
    client.lastSeen = Date.now();

    switch (msg.type) {
      case 'ping':
        this.send(ws, { type: 'pong' });
        break;
      case 'envelope':
        this.routeEnvelope(client, msg.envelope);
        break;
    }
  }

  private onAuth(
    ws: WebSocket,
    msg: Extract<RelayMessage, { type: 'auth' }>,
    nonce: string,
  ): void {
    // 1. Verify signature over "sworm-auth:<nonce>:<peerId>:<teamId>"
    const challenge = `sworm-auth:${nonce}:${msg.peerId}:${msg.teamId}`;
    if (!verifySignature(challenge, msg.signature, msg.publicKeyPem)) {
      this.send(ws, { type: 'auth_fail', reason: 'Invalid signature' });
      ws.close(1008, 'Auth failed');
      return;
    }

    // 2. Verify the claimed peerId matches what we'd derive from their public key
    if (derivePeerId(msg.publicKeyPem) !== msg.peerId) {
      this.send(ws, { type: 'auth_fail', reason: 'PeerID mismatch' });
      ws.close(1008, 'Auth failed');
      return;
    }

    const client: AuthedClient = {
      ws,
      peerId: msg.peerId,
      teamId: msg.teamId,
      lastSeen: Date.now(),
    };

    this.clients.set(ws, client);

    if (!this.routing.has(msg.teamId)) {
      this.routing.set(msg.teamId, new Map());
    }

    // Snapshot current online peers BEFORE adding this client, so we can tell them who's here
    const alreadyOnline = [...(this.routing.get(msg.teamId)?.keys() ?? [])];
    this.routing.get(msg.teamId)!.set(msg.peerId, client);

    this.send(ws, { type: 'auth_ok', peerId: msg.peerId });

    // Tell the new peer who's already online in their team (always sent, even if empty,
    // so the client knows when its online-peer set is fully populated)
    this.send(ws, { type: 'peer_list', peers: alreadyOnline });

    // Tell existing peers that this new peer is online
    this.broadcastToTeam(msg.teamId, msg.peerId, {
      type: 'peer_status',
      peerId: msg.peerId,
      status: 'online',
    });

    this.log(`${msg.peerId} joined team ${msg.teamId} (${this.teamSize(msg.teamId)} online)`);
  }

  private onClose(ws: WebSocket): void {
    const client = this.clients.get(ws);
    this.clients.delete(ws);
    if (!client) return;

    const teamPeers = this.routing.get(client.teamId);
    if (teamPeers) {
      teamPeers.delete(client.peerId);
      if (teamPeers.size === 0) this.routing.delete(client.teamId);
    }

    this.broadcastToTeam(client.teamId, client.peerId, {
      type: 'peer_status',
      peerId: client.peerId,
      status: 'offline',
    });

    this.log(`${client.peerId} left team ${client.teamId}`);
  }

  // ── Routing ──────────────────────────────────────────────────────────────

  private routeEnvelope(sender: AuthedClient, envelope: TeamEnvelope): void {
    // Drop spoofed envelopes
    if (envelope.fromPeer !== sender.peerId || envelope.teamId !== sender.teamId) return;

    const teamPeers = this.routing.get(envelope.teamId);
    if (!teamPeers) return;

    if (envelope.toPeer === '*') {
      for (const [peerId, client] of teamPeers) {
        if (peerId !== sender.peerId) {
          this.send(client.ws, { type: 'envelope', envelope });
        }
      }
    } else {
      const target = teamPeers.get(envelope.toPeer);
      if (target) {
        this.send(target.ws, { type: 'envelope', envelope });
      }
      // Peer offline — dropped for now (Phase 3: offline queue)
    }
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────

  private heartbeat(timeoutMs: number): void {
    const now = Date.now();
    for (const [ws, client] of this.clients) {
      if (client && now - client.lastSeen > timeoutMs) {
        this.log(`${client.peerId} timed out`);
        ws.close(1001, 'Heartbeat timeout');
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private send(ws: WebSocket, msg: RelayMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private broadcastToTeam(teamId: string, excludePeerId: string, msg: RelayMessage): void {
    const teamPeers = this.routing.get(teamId);
    if (!teamPeers) return;
    for (const [peerId, client] of teamPeers) {
      if (peerId !== excludePeerId) this.send(client.ws, msg);
    }
  }

  private teamSize(teamId: string): number {
    return this.routing.get(teamId)?.size ?? 0;
  }

  close(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.wss.clients.forEach((ws) => ws.close());
    return new Promise((resolve) => this.httpServer.close(() => resolve()));
  }
}
