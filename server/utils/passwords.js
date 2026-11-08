import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SCRYPT_PREFIX = 'scrypt$';

export async function hashPassword(password) {
  if (typeof password !== 'string' || !password) throw new Error('Password is required');
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 32, SCRYPT_OPTIONS);
  return `${SCRYPT_PREFIX}${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  if (!stored.startsWith(SCRYPT_PREFIX)) return false;

  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  if (!/^[A-Za-z0-9_-]{22}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return false;

  try {
    const salt = Buffer.from(parts[1], 'base64url');
    const expected = Buffer.from(parts[2], 'base64url');
    const actual = await scrypt(password, salt, expected.length, SCRYPT_OPTIONS);
    return expected.length === 32 && crypto.timingSafeEqual(actual, expected);
  } catch (err) {
    return false;
  }
}

// Used when an account does not exist so a failed login costs the same amount
// of work as a real one, instead of revealing which usernames exist by timing.
export const DUMMY_PASSWORD_HASH = `${SCRYPT_PREFIX}${Buffer.alloc(16, 7).toString('base64url')}$${Buffer.alloc(32, 11).toString('base64url')}`;

export default { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH };
