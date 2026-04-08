// ── Message payloads (inside E2E-encrypted envelopes) ──────────────────────

export interface PresenceMessage {
  type: 'presence';
  status: 'online' | 'idle' | 'offline';
  formation?: string;
  /** X25519 public key PEM — sent on connect so peers can cache it */
  encryptionPublicKey?: string;
}

export interface NoteMessage {
  type: 'note';
  text: string;
  priority?: 'normal' | 'urgent';
}

export interface FormationStatusMessage {
  type: 'formation_status';
  /** Formation name, or null when no formation is active */
  formation: string | null;
  wormCount: number;
}

export interface AgentSpawnRequestMessage {
  type: 'agent_spawn_request';
  formation: string;
  requestId: string;
  /** Display name of the requester (for the approval prompt) */
  requestedBy: string;
}

export interface AgentSpawnAckMessage {
  type: 'agent_spawn_ack';
  requestId: string;
  status: 'ok' | 'denied' | 'error';
  reason?: string;
}

export interface KeyRotationMessage {
  type: 'key_rotation';
  newEncryptionPublicKey: string;
}

export interface AgentMessageMessage {
  type: 'agent_message';
  /** Worm ID of the sending agent */
  fromAgentId: string;
  /** Worm ID of the target agent — if omitted, deliver to any running agent */
  toAgentId?: string;
  content: string;
  /** Message ID for threaded replies */
  replyTo?: string;
  messageId: string;
}

export type TeamMessage =
  | PresenceMessage
  | NoteMessage
  | FormationStatusMessage
  | AgentSpawnRequestMessage
  | AgentSpawnAckMessage
  | KeyRotationMessage
  | AgentMessageMessage;

// ── Wire envelope ────────────────────────────────────────────────────────────

export interface TeamEnvelope {
  id: string;
  teamId: string;
  fromPeer: string;
  /** Peer ID, or '*' for broadcast to all team members */
  toPeer: string;
  timestamp: number;
  /** false for unencrypted broadcasts (e.g. presence) */
  encrypted: boolean;
  /** base64 GCM nonce — only present when encrypted */
  nonce?: string;
  /** JSON string (unencrypted) or base64 AES-256-GCM ciphertext (encrypted) */
  payload: string;
}

// ── Relay transport messages (not E2E encrypted) ─────────────────────────────

export type RelayMessage =
  | { type: 'challenge'; nonce: string }
  | { type: 'auth'; peerId: string; teamId: string; signature: string; publicKeyPem: string }
  | { type: 'auth_ok'; peerId: string }
  | { type: 'auth_fail'; reason: string }
  | { type: 'envelope'; envelope: TeamEnvelope }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'peer_status'; peerId: string; status: 'online' | 'offline' }
  /** Sent to a newly connected peer listing who is already online in their team */
  | { type: 'peer_list'; peers: string[] };
