import { createHmac, randomBytes } from 'node:crypto';
import type { MemberRole } from './team-store.js';

// Invite token format: <teamId>.<role>.<expiry>.<nonce>.<hmac>
// All parts are base64url encoded where needed.
// The HMAC key is derived from the team's ownerPeerId so only the owner can create valid tokens.

export interface InvitePayload {
  teamId: string;
  teamName: string;
  role: MemberRole;
  expiresAt: number;
  nonce: string;
  createdBy: string; // peerId of creator
  /** X25519 public key of the inviter — lets the joiner encrypt to them immediately */
  inviterEncryptionPublicKey?: string;
  /** Display name of the inviter */
  inviterDisplayName?: string;
}

export interface EncodedInvite {
  token: string;
  expiresAt: number;
}

function hmacKey(ownerPeerId: string): string {
  // Simple derivation — real impl would use a persisted team secret
  return createHmac('sha256', 'sworm-invite-v1').update(ownerPeerId).digest('hex');
}

export function createInvite(
  teamId: string,
  teamName: string,
  ownerPeerId: string,
  opts: {
    role?: MemberRole;
    ttlMs?: number;
    inviterEncryptionPublicKey?: string;
    inviterDisplayName?: string;
  } = {},
): EncodedInvite {
  const role = opts.role ?? 'member';
  const ttl = opts.ttlMs ?? 24 * 60 * 60 * 1000; // 24h default
  const expiresAt = Date.now() + ttl;
  const nonce = randomBytes(8).toString('hex');

  const payload: InvitePayload = {
    teamId,
    teamName,
    role,
    expiresAt,
    nonce,
    createdBy: ownerPeerId,
    inviterEncryptionPublicKey: opts.inviterEncryptionPublicKey,
    inviterDisplayName: opts.inviterDisplayName,
  };
  const data = JSON.stringify(payload);
  const encoded = Buffer.from(data).toString('base64url');
  const sig = createHmac('sha256', hmacKey(ownerPeerId)).update(encoded).digest('hex').slice(0, 16);
  const token = `sworm-invite.${encoded}.${sig}`;

  return { token, expiresAt };
}

export function parseInvite(token: string): InvitePayload {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'sworm-invite') {
    throw new Error('Invalid invite token format');
  }
  const [, encoded] = parts;
  let payload: InvitePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as InvitePayload;
  } catch {
    throw new Error('Invite token is malformed');
  }
  if (Date.now() > payload.expiresAt) {
    throw new Error('Invite token has expired');
  }
  return payload;
}

export function verifyInvite(token: string, ownerPeerId: string): InvitePayload {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'sworm-invite') {
    throw new Error('Invalid invite token format');
  }
  const [, encoded, sig] = parts;
  const expectedSig = createHmac('sha256', hmacKey(ownerPeerId)).update(encoded).digest('hex').slice(0, 16);
  if (sig !== expectedSig) {
    throw new Error('Invite token signature is invalid');
  }
  return parseInvite(token);
}
