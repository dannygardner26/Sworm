import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  generateEncryptionKeypair,
  deriveSharedSecret,
  encrypt,
  decrypt,
  sign,
  verifySignature,
} from '../../src/team/crypto.js';

describe('generateEncryptionKeypair', () => {
  it('returns two distinct PEM strings', () => {
    const { privateKeyPem, publicKeyPem } = generateEncryptionKeypair();
    expect(privateKeyPem).toContain('PRIVATE KEY');
    expect(publicKeyPem).toContain('PUBLIC KEY');
    expect(privateKeyPem).not.toBe(publicKeyPem);
  });
});

describe('deriveSharedSecret', () => {
  it('is symmetric — both sides get the same secret', () => {
    const alice = generateEncryptionKeypair();
    const bob = generateEncryptionKeypair();
    const aliceSecret = deriveSharedSecret(alice.privateKeyPem, bob.publicKeyPem);
    const bobSecret = deriveSharedSecret(bob.privateKeyPem, alice.publicKeyPem);
    expect(aliceSecret.equals(bobSecret)).toBe(true);
  });

  it('produces 32 bytes', () => {
    const alice = generateEncryptionKeypair();
    const bob = generateEncryptionKeypair();
    expect(deriveSharedSecret(alice.privateKeyPem, bob.publicKeyPem).length).toBe(32);
  });

  it('different peers yield different secrets', () => {
    const alice = generateEncryptionKeypair();
    const bob = generateEncryptionKeypair();
    const carol = generateEncryptionKeypair();
    const s1 = deriveSharedSecret(alice.privateKeyPem, bob.publicKeyPem);
    const s2 = deriveSharedSecret(alice.privateKeyPem, carol.publicKeyPem);
    expect(s1.equals(s2)).toBe(false);
  });
});

describe('encrypt / decrypt', () => {
  const key = Buffer.alloc(32, 0x42);

  it('round-trips plaintext', () => {
    const { nonce, ciphertext } = encrypt('hello world', key);
    expect(decrypt(ciphertext, nonce, key)).toBe('hello world');
  });

  it('round-trips a JSON payload', () => {
    const payload = JSON.stringify({ type: 'note', text: 'hi there', priority: 'normal' });
    const { nonce, ciphertext } = encrypt(payload, key);
    expect(decrypt(ciphertext, nonce, key)).toBe(payload);
  });

  it('ciphertext differs from plaintext', () => {
    const { ciphertext } = encrypt('secret', key);
    expect(Buffer.from(ciphertext, 'base64').toString()).not.toContain('secret');
  });

  it('each call produces a unique nonce', () => {
    const { nonce: n1 } = encrypt('a', key);
    const { nonce: n2 } = encrypt('a', key);
    expect(n1).not.toBe(n2);
  });

  it('throws on tampered ciphertext', () => {
    const { nonce, ciphertext } = encrypt('hello', key);
    const tampered = Buffer.from(ciphertext, 'base64');
    tampered[0] ^= 0xff;
    expect(() => decrypt(tampered.toString('base64'), nonce, key)).toThrow();
  });

  it('throws with wrong key', () => {
    const { nonce, ciphertext } = encrypt('hello', key);
    const wrongKey = Buffer.alloc(32, 0x00);
    expect(() => decrypt(ciphertext, nonce, wrongKey)).toThrow();
  });
});

describe('sign / verifySignature', () => {
  it('valid signature verifies', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const msg = 'sworm-auth:abc123:peer1:team1';
    const sig = sign(msg, privateKey as string);
    expect(verifySignature(msg, sig, publicKey as string)).toBe(true);
  });

  it('wrong message does not verify', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const sig = sign('original', privateKey as string);
    expect(verifySignature('tampered', sig, publicKey as string)).toBe(false);
  });

  it('wrong key does not verify', () => {
    const { privateKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const { publicKey: otherPub } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const sig = sign('msg', privateKey as string);
    expect(verifySignature('msg', sig, otherPub as string)).toBe(false);
  });

  it('returns false on garbage signature', () => {
    const { publicKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    expect(verifySignature('msg', 'bm90YXNpZw==', publicKey as string)).toBe(false);
  });
});
