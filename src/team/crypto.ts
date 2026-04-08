import {
  generateKeyPairSync,
  diffieHellman,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

export interface EncryptionKeypair {
  privateKeyPem: string;
  publicKeyPem: string;
}

export function generateEncryptionKeypair(): EncryptionKeypair {
  const { privateKey, publicKey } = generateKeyPairSync('x25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKeyPem: privateKey as string, publicKeyPem: publicKey as string };
}

/**
 * Derive a symmetric encryption key from two X25519 keys via ECDH + HKDF.
 * Symmetric: deriveSharedSecret(alicePriv, bobPub) === deriveSharedSecret(bobPriv, alicePub)
 */
export function deriveSharedSecret(myPrivKeyPem: string, theirPubKeyPem: string): Buffer {
  const privKey = createPrivateKey(myPrivKeyPem);
  const pubKey = createPublicKey(theirPubKeyPem);
  const rawSecret = diffieHellman({ privateKey: privKey, publicKey: pubKey });
  return Buffer.from(hkdfSync('sha256', rawSecret, '', 'sworm-e2e-v1', 32));
}

/**
 * Encrypt plaintext JSON with AES-256-GCM. Returns base64 ciphertext (payload+tag) and nonce.
 */
export function encrypt(plaintext: string, key: Buffer): { nonce: string; ciphertext: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    nonce: nonce.toString('base64'),
    ciphertext: Buffer.concat([encrypted, tag]).toString('base64'),
  };
}

/**
 * Decrypt AES-256-GCM ciphertext. The last 16 bytes of the ciphertext are the auth tag.
 */
export function decrypt(ciphertext: string, nonce: string, key: Buffer): string {
  const payload = Buffer.from(ciphertext, 'base64');
  const nonceBuf = Buffer.from(nonce, 'base64');
  const tag = payload.subarray(payload.length - 16);
  const encrypted = payload.subarray(0, payload.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, nonceBuf);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf-8') + decipher.final('utf-8');
}

/** Ed25519 sign — used for relay challenge-response auth. */
export function sign(message: string, privateKeyPem: string): string {
  return cryptoSign(undefined, Buffer.from(message), privateKeyPem).toString('base64');
}

/** Ed25519 verify. */
export function verifySignature(message: string, signature: string, publicKeyPem: string): boolean {
  try {
    return cryptoVerify(
      undefined,
      Buffer.from(message),
      publicKeyPem,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}
