import { sign, verify } from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { hashSync, compareSync } from 'bcrypt';
import crypto from 'crypto';
// @ts-ignore
import EVP_BytesToKey from 'evp_bytestokey';
const algorithm = 'aes-256-cbc';
const { keyLength, ivLength } = crypto.getCipherInfo(algorithm);

function deriveLegacyKeyIv(secret: string) {
  const { keyLength, ivLength } = crypto.getCipherInfo(algorithm); // 32, 16
  const pass = Buffer.isBuffer(secret) ? secret : Buffer.from(secret ?? '', 'utf8');

  // evp_bytestokey: key length in **bits**, IV length in **bytes**
  const { key, iv } = EVP_BytesToKey(pass, null, keyLength * 8, ivLength, 'md5');

  if (key.length !== keyLength || iv.length !== ivLength) {
    throw new Error(`Derived wrong sizes (key=${key.length}, iv=${iv.length})`);
  }
  return { key, iv };
}

export function decrypt_legacy_using_IV(hexCiphertext: string) {
  const { key, iv } = deriveLegacyKeyIv(process.env.JWT_SECRET);
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  const out = Buffer.concat([decipher.update(hexCiphertext, 'hex'), decipher.final()]);
  return out.toString('utf8');
}

export function encrypt_legacy_using_IV(utf8Plaintext: string) {
  const { key, iv } = deriveLegacyKeyIv(process.env.JWT_SECRET);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const out = Buffer.concat([cipher.update(utf8Plaintext, 'utf8'), cipher.final()]);
  return out.toString('hex');
}
// Channel credentials (OAuth access and refresh tokens) are stored encrypted
// with AES-256-GCM under CHANNEL_TOKEN_KEY, a base64 32-byte key that is not
// JWT_SECRET. Stored as "enc:v1:<iv>:<tag>:<ciphertext>" (base64 parts), so a
// value without the prefix is a row written before encryption and is read as is.
export const ENCRYPTED_SECRET_PREFIX = 'enc:v1:';

function channelTokenKey() {
  const key = Buffer.from(process.env.CHANNEL_TOKEN_KEY || '', 'base64');
  if (key.length !== 32) {
    throw new Error('CHANNEL_TOKEN_KEY must be a base64 32-byte key');
  }
  return key;
}

export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_SECRET_PREFIX);
}

export function encryptSecret(value: string) {
  if (!value || isEncryptedSecret(value)) {
    return value;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', channelTokenKey(), iv);
  const out = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${ENCRYPTED_SECRET_PREFIX}${iv.toString('base64')}:${cipher
    .getAuthTag()
    .toString('base64')}:${out.toString('base64')}`;
}

export function decryptSecret(value: string) {
  if (!isEncryptedSecret(value)) {
    return value;
  }
  const [iv, tag, data] = value.slice(ENCRYPTED_SECRET_PREFIX.length).split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    channelTokenKey(),
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export class AuthService {
  static hashPassword(password: string) {
    return hashSync(password, 10);
  }
  static comparePassword(password: string, hash: string) {
    return compareSync(password, hash);
  }
  /**
   * `options` is optional so the stored credentials signed through here (they
   * must not expire) keep their shape. Sign-in sessions and the links we email
   * are minted through helpers/auth/session.token.ts, which always sets a
   * `type` and an expiry - use that for anything that signs somebody in.
   */
  static signJWT(value: object, options?: SignOptions) {
    return sign(value, process.env.JWT_SECRET!, options);
  }
  static verifyJWT(token: string) {
    return verify(token, process.env.JWT_SECRET!);
  }

  static fixedEncryption(value: string) {
    return encrypt_legacy_using_IV(value);
  }

  static fixedDecryption(hash: string) {
    return decrypt_legacy_using_IV(hash);
  }
}
