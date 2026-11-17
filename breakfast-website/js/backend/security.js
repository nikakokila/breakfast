// Passwords are never stored. We store a salted PBKDF2-SHA256 hash (built into the browser).
const ITERATIONS = 150000;
const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [kind, iter, saltHex, hashHex] = String(stored).split('$');
  if (kind !== 'pbkdf2' || !saltHex || !hashHex) return false;
  const hash = toHex(await derive(password, fromHex(saltHex), Number(iter)));
  // Compare without stopping at the first difference.
  let diff = hash.length ^ hashHex.length;
  for (let i = 0; i < Math.min(hash.length, hashHex.length); i++) diff |= hash.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

// Simple limit on repeated wrong passwords or codes.
const attempts = new Map();
export function tooManyAttempts(key, limit = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  attempts.set(key, list);
  return list.length > limit;
}

// Fast, private PIN fingerprint so "type your PIN" can find the right person without trying every account.
// It is an HMAC with a random secret kept on this tablet, so the fingerprint alone does not reveal the PIN.
export async function pinFingerprint(pin, secretHex) {
  const key = await crypto.subtle.importKey('raw', fromHex(secretHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(String(pin))));
}
export const newSecret = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

// Checks the limit without counting this try (used so only wrong PINs count).
export function isLocked(key, limit = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  return (attempts.get(key) || []).filter((t) => now - t < windowMs).length >= limit;
}
export const recordFailure = (key, limit, windowMs) => tooManyAttempts(key, limit, windowMs);
