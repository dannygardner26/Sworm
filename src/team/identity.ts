import { generateKeyPairSync, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { generateEncryptionKeypair } from './crypto.js';

const IDENTITY_DIR = join(homedir(), '.sworm', 'identity');
const SIGN_PRIV_PATH = join(IDENTITY_DIR, 'peer.key');
const SIGN_PUB_PATH = join(IDENTITY_DIR, 'peer.pub');
const ENC_PRIV_PATH = join(IDENTITY_DIR, 'peer-enc.key');
const ENC_PUB_PATH = join(IDENTITY_DIR, 'peer-enc.pub');

export interface Identity {
  peerId: string;
  /** Ed25519 public key — used for relay challenge-response auth */
  publicKeyPem: string;
  /** Ed25519 private key */
  privateKeyPem: string;
  /** X25519 public key — shared with teammates for E2E encryption */
  encryptionPublicKeyPem: string;
  /** X25519 private key — never leaves this device */
  encryptionPrivateKeyPem: string;
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(bytes: Buffer): string {
  let num = BigInt('0x' + bytes.toString('hex'));
  let result = '';
  const base = BigInt(58);
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % base)] + result;
    num /= base;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = '1' + result;
  }
  return result || '1';
}

export function derivePeerId(publicKeyPem: string): string {
  const hash = createHash('sha256').update(publicKeyPem).digest();
  return toBase58(hash.subarray(0, 8));
}

export function generateIdentity(): Identity {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  const encKeypair = generateEncryptionKeypair();
  const peerId = derivePeerId(publicKey as string);

  mkdirSync(IDENTITY_DIR, { recursive: true });
  writeFileSync(SIGN_PRIV_PATH, privateKey as string, { mode: 0o600 });
  writeFileSync(SIGN_PUB_PATH, publicKey as string);
  writeFileSync(ENC_PRIV_PATH, encKeypair.privateKeyPem, { mode: 0o600 });
  writeFileSync(ENC_PUB_PATH, encKeypair.publicKeyPem);

  return {
    peerId,
    publicKeyPem: publicKey as string,
    privateKeyPem: privateKey as string,
    encryptionPublicKeyPem: encKeypair.publicKeyPem,
    encryptionPrivateKeyPem: encKeypair.privateKeyPem,
  };
}

export function loadIdentity(): Identity | null {
  if (
    !existsSync(SIGN_PRIV_PATH) ||
    !existsSync(SIGN_PUB_PATH) ||
    !existsSync(ENC_PRIV_PATH) ||
    !existsSync(ENC_PUB_PATH)
  ) {
    return null;
  }
  const privateKeyPem = readFileSync(SIGN_PRIV_PATH, 'utf-8');
  const publicKeyPem = readFileSync(SIGN_PUB_PATH, 'utf-8');
  const encryptionPrivateKeyPem = readFileSync(ENC_PRIV_PATH, 'utf-8');
  const encryptionPublicKeyPem = readFileSync(ENC_PUB_PATH, 'utf-8');
  const peerId = derivePeerId(publicKeyPem);
  return { peerId, publicKeyPem, privateKeyPem, encryptionPublicKeyPem, encryptionPrivateKeyPem };
}

export function getOrCreateIdentity(): Identity {
  return loadIdentity() ?? generateIdentity();
}

export function getIdentityDir(): string {
  return IDENTITY_DIR;
}

/**
 * Generate a new X25519 encryption keypair and persist it, replacing the old one.
 * Returns the updated Identity with the new encryption keys.
 */
export function rotateEncryptionKey(): Identity {
  const identity = loadIdentity();
  if (!identity) throw new Error('No identity found. Run `sworm team init` first.');

  const encKeypair = generateEncryptionKeypair();
  writeFileSync(ENC_PRIV_PATH, encKeypair.privateKeyPem, { mode: 0o600 });
  writeFileSync(ENC_PUB_PATH, encKeypair.publicKeyPem);

  return {
    ...identity,
    encryptionPublicKeyPem: encKeypair.publicKeyPem,
    encryptionPrivateKeyPem: encKeypair.privateKeyPem,
  };
}
