import { describe, it, expect } from 'vitest';
import { derivePeerId } from '../../src/team/identity.js';
import { generateKeyPairSync } from 'node:crypto';

function makePubKey(): string {
  const { publicKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return publicKey as string;
}

describe('derivePeerId', () => {
  it('returns a non-empty string', () => {
    const pub = makePubKey();
    const id = derivePeerId(pub);
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('is deterministic — same key always yields same peer ID', () => {
    const pub = makePubKey();
    expect(derivePeerId(pub)).toBe(derivePeerId(pub));
  });

  it('is unique — different keys yield different peer IDs', () => {
    const a = derivePeerId(makePubKey());
    const b = derivePeerId(makePubKey());
    expect(a).not.toBe(b);
  });

  it('only contains base58 characters', () => {
    const BASE58 = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
    const id = derivePeerId(makePubKey());
    expect(id).toMatch(BASE58);
  });

  it('is reasonably short (≤ 12 chars for 8-byte input)', () => {
    const id = derivePeerId(makePubKey());
    expect(id.length).toBeLessThanOrEqual(12);
  });
});
