import type {
  TeamEnvelope,
  TeamMessage,
  PresenceMessage,
  NoteMessage,
  FormationStatusMessage,
  AgentSpawnRequestMessage,
  AgentSpawnAckMessage,
  KeyRotationMessage,
  AgentMessageMessage,
} from './messages.js';
import type { Identity } from './identity.js';
import { decrypt, deriveSharedSecret } from './crypto.js';
import { loadTeam, updateMemberEncryptionKey, updateMemberPresence } from './team-store.js';

export interface MessageHandlerCallbacks {
  onNote?: (from: string, message: NoteMessage) => void;
  onPresence?: (from: string, message: PresenceMessage) => void;
  onFormationStatus?: (from: string, message: FormationStatusMessage) => void;
  onSpawnRequest?: (from: string, message: AgentSpawnRequestMessage) => void;
  onSpawnAck?: (from: string, message: AgentSpawnAckMessage) => void;
  onKeyRotation?: (from: string, message: KeyRotationMessage) => void;
  onAgentMessage?: (from: string, message: AgentMessageMessage) => void;
}

export class MessageHandler {
  private identity: Identity;
  private teamId: string;
  private callbacks: MessageHandlerCallbacks;

  constructor(identity: Identity, teamId: string, callbacks: MessageHandlerCallbacks) {
    this.identity = identity;
    this.teamId = teamId;
    this.callbacks = callbacks;
  }

  handle(envelope: TeamEnvelope): void {
    const message = this.decode(envelope);
    if (!message) return;

    switch (message.type) {
      case 'presence':
        if (message.encryptionPublicKey) {
          updateMemberEncryptionKey(this.teamId, envelope.fromPeer, message.encryptionPublicKey);
        }
        updateMemberPresence(this.teamId, envelope.fromPeer, { lastSeenAt: envelope.timestamp });
        this.callbacks.onPresence?.(envelope.fromPeer, message);
        break;

      case 'note':
        this.callbacks.onNote?.(envelope.fromPeer, message);
        break;

      case 'formation_status':
        updateMemberPresence(this.teamId, envelope.fromPeer, {
          lastSeenAt: envelope.timestamp,
          lastKnownFormation: message.formation,
        });
        this.callbacks.onFormationStatus?.(envelope.fromPeer, message);
        break;

      case 'agent_spawn_request':
        this.callbacks.onSpawnRequest?.(envelope.fromPeer, message);
        break;

      case 'agent_spawn_ack':
        this.callbacks.onSpawnAck?.(envelope.fromPeer, message);
        break;

      case 'key_rotation':
        updateMemberEncryptionKey(this.teamId, envelope.fromPeer, message.newEncryptionPublicKey);
        this.callbacks.onKeyRotation?.(envelope.fromPeer, message);
        break;

      case 'agent_message':
        this.callbacks.onAgentMessage?.(envelope.fromPeer, message);
        break;
    }
  }

  private decode(envelope: TeamEnvelope): TeamMessage | null {
    if (!envelope.encrypted) {
      try {
        return JSON.parse(envelope.payload) as TeamMessage;
      } catch {
        return null;
      }
    }

    const team = loadTeam(this.teamId);
    const sender = team?.members.find((m) => m.peerId === envelope.fromPeer);
    if (!sender?.encryptionPublicKey || !envelope.nonce) return null;

    try {
      const sharedSecret = deriveSharedSecret(
        this.identity.encryptionPrivateKeyPem,
        sender.encryptionPublicKey,
      );
      const plaintext = decrypt(envelope.payload, envelope.nonce, sharedSecret);
      return JSON.parse(plaintext) as TeamMessage;
    } catch {
      return null;
    }
  }
}
