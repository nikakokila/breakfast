// Everything the server used to do now runs inside the app, on the tablet.
// The screens still call api('POST', '/api/...') exactly as before; this file answers those calls.
import { data, settings, init, begin, exportAll, replaceAll } from './store.js';
import { hashPassword, verifyPassword, tooManyAttempts, pinFingerprint, newSecret, isLocked, recordFailure } from './security.js';
import { monthlyAnalytics, availableMonths, monthCsv, toCsv, isMonth } from './analytics.js';
import { parseRoom } from '../rooms.js';

export const RANKS = ['DIAMOND', 'GOLD', 'MEMBER'];
const SESSION_KEY = 'bm-session';
const SESSION_HOURS = 12; // shared tablet: log in again each day

export class ApiError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

// ---------- helpers ----------

const now = () => new Date().toISOString();
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const rows = (table) => [...data[table].values()];
const DEFAULT_BRAND = { name: 'Breakfast Manager', subtitle: 'Hotel Restaurant' };

function cleanText(value, field, min, max) {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < min) throw new ApiError(400, `${field} is required${min > 1 ? ` (at least ${min} characters)` : ''}.`);
  if (s.length > max) throw new ApiError(400, `${field} must be ${max} characters or fewer.`);
  return s;
}

function cleanCode(value, field) {
  const s = String(value ?? '').trim();
  if (s.length < 4) throw new ApiError(400, `${field} must be at least 4 characters.`);
  if (s.length > 40) throw new ApiError(400, `${field} must be 40 characters or fewer.`);
  return s;
}

export const THEMES = ['hilton', 'darkroom', 'cocoa', 'tactical', 'idol', 'prog', 'brother', 'goat'];
const themeOf = (u) => (THEMES.includes(u.theme) ? u.theme : 'hilton');
function cleanTheme(value) {
  if (!THEMES.includes(value)) throw new ApiError(400, 'Choose a theme from the list.');
  return value;
}

function publicUser(u) {
  return { id: u.id, fullName: u.full_name, nickname: u.nickname, role: u.role, createdAt: u.created_at, avatarUrl: u.avatar || null, hasPin: !!u.pin_hash, theme: themeOf(u), active: !u.disabled };
}
const activeUsers = () => rows('users').filter((u) => !u.disabled);

// The breakfast team, added automatically once (the owner chose to keep these PINs in the app).
// If a manager later removes someone, they are not added again.
const TEAM = [
  ['Manager', '1707', 'hilton', 'manager'],
  ['Duta', '1801', 'darkroom'], ['Nika', '1802', 'tactical'], ['Luka', '1803', 'cocoa'], ['Miro', '1804', 'prog'],
  ['Dachi', '1805', 'idol'], ['Saba', '1806', 'brother'], ['Levani', '1807', 'goat'],
];
const TEAM_VERSION = 2;
async function ensureTeam() {
  if (data.users.size === 0 || Number(settings.get('teamSeeded') || 0) >= TEAM_VERSION) return;
  const added = [];
  for (const [name, pin, theme, role = 'employee'] of TEAM) {
    if (rows('users').some((u) => u.nickname.toLowerCase() === name.toLowerCase())) continue;
    const tx = begin();
    try {
      const fields = await pinFields(tx, pin);
      tx.insert('users', { ...fields, full_name: name, nickname: name, role, theme, avatar: null, created_at: now() });
      audit(tx, null, 'account_created', null, { nickname: name, role, theme, by: 'built-in team list' });
      await tx.commit();
      added.push(name);
    } catch { /* PIN already used by someone else: skip this person */ }
  }
  const t = begin(); t.setting('teamSeeded', TEAM_VERSION); await t.commit();
  return added;
}

// Every PIN must belong to one person, because logging in is "type your PIN".
async function pinSecret() {
  if (!settings.get('pinSecret')) { const t = begin(); t.setting('pinSecret', newSecret()); await t.commit(); }
  return settings.get('pinSecret');
}
async function pinFields(tx, pin, exceptId = null) {
  const tag = await pinFingerprint(pin, await pinSecret());
  for (const u of activeUsers()) {
    if (u.id === exceptId || !u.pin_hash) continue;
    const same = u.pin_tag ? u.pin_tag === tag : await verifyPassword(pin, u.pin_hash);
    if (same) throw new ApiError(409, 'Someone else already uses this PIN. Choose a different one.');
  }
  return { pin_hash: await hashPassword(pin), pin_tag: tag };
}

// A PIN is exactly 4 digits.
function cleanPin(value, field = 'PIN') {
  const pin = String(value ?? '').trim();
  if (!/^\d{4}$/.test(pin)) throw new ApiError(400, `${field} must be exactly 4 digits.`);
  return pin;
}

// Nicknames are shown on the login screen, so each must be different.
function cleanNickname(value, fallbackFullName, exceptId = null) {
  const nickname = value ? cleanText(value, 'Nickname', 1, 30) : fallbackFullName.split(' ')[0];
  const taken = rows('users').find((u) => !u.disabled && u.id !== exceptId && u.nickname.toLowerCase() === nickname.toLowerCase());
  if (taken) throw new ApiError(409, `Someone already uses the name “${nickname}”. Add a last initial, for example “${nickname} ${(fallbackFullName.split(' ')[1] || 'K')[0]}.”`);
  return nickname;
}

const LOCK_CHOICES = [0, 5, 15, 30, 60];
const lockMinutes = () => (settings.has('lockMinutes') ? Number(settings.get('lockMinutes')) : 30);

function audit(tx, user, action, shiftId = null, details = null) {
  tx.insert('audit_log', { created_at: now(), user_id: user?.id ?? null, user_name: user?.nickname ?? null, action, shift_id: shiftId, details });
}

function currentUser() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { /* no session */ }
  if (!s || !s.userId || !s.expiresAt || new Date(s.expiresAt) < new Date()) return null;
  const u = data.users.get(s.userId);
  return u && !u.disabled ? u : null;
}
function startSession(user) {
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, expiresAt })); } catch { /* storage blocked */ }
}
function endSession() { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

function requireUser() {
  const user = currentUser();
  if (!user) throw new ApiError(401, 'Please log in.');
  return user;
}
function requireManager() {
  const user = requireUser();
  if (user.role !== 'manager') throw new ApiError(403, 'Only managers can do this.');
  return user;
}

function getShift(id) {
  const shift = data.shifts.get(Number(id));
  if (!shift) throw new ApiError(404, 'Shift not found.');
  return shift;
}
function requireActive(shift) {
  if (shift.status !== 'ACTIVE') throw new ApiError(409, 'This shift is already finished.');
}
const activeShift = () => rows('shifts').find((s) => s.status === 'ACTIVE') || null;
const shiftGuests = (shiftId) => rows('guests').filter((g) => g.shift_id === shiftId);
const shiftArrivals = (shiftId) => rows('arrivals').filter((a) => a.shift_id === shiftId);
const arrivalOf = (guestId) => rows('arrivals').find((a) => a.guest_id === guestId) || null;

export function computeStats(shiftId) {
  const guests = shiftGuests(shiftId);
  const arrivals = shiftArrivals(shiftId);
  const counts = { DIAMOND: 0, GOLD: 0, MEMBER: 0 };
  let unknown = 0;
  for (const a of arrivals) {
    if (!a.guest_id) { unknown++; continue; }
    const g = data.guests.get(a.guest_id);
    if (g) counts[g.rank]++;
  }
  const checkedIn = counts.DIAMOND + counts.GOLD + counts.MEMBER;
  return {
    expected: guests.length, checkedIn, remaining: guests.length - checkedIn, notArrived: guests.length - checkedIn,
    diamond: counts.DIAMOND, gold: counts.GOLD, member: counts.MEMBER, unknown, totalArrivals: checkedIn + unknown,
  };
}

function shiftPayload(shift) {
  const arrivals = shiftArrivals(shift.id);
  const byGuest = new Map(arrivals.filter((a) => a.guest_id).map((a) => [a.guest_id, a]));
  const guests = shiftGuests(shift.id)
    .sort((a, b) => Number(a.room) - Number(b.room) || a.full_name.localeCompare(b.full_name))
    .map((g) => {
      const a = byGuest.get(g.id);
      return {
        id: g.id, fullName: g.full_name, room: g.room, floor: g.floor, rank: g.rank,
        arrival: a ? { id: a.id, arrivedAt: a.arrived_at, checkedInName: a.checked_in_name, checkedInBy: a.checked_in_by } : null,
      };
    });
  const unknownArrivals = arrivals.filter((a) => !a.guest_id).sort((a, b) => a.arrived_at.localeCompare(b.arrived_at))
    .map((a) => ({ id: a.id, name: a.unknown_name, room: a.unknown_room, floor: a.unknown_floor, arrivedAt: a.arrived_at, checkedInName: a.checked_in_name }));
  const recent = [...arrivals].sort((a, b) => b.arrived_at.localeCompare(a.arrived_at) || b.id - a.id).slice(0, 15).map((a) => {
    const g = a.guest_id ? data.guests.get(a.guest_id) : null;
    return { id: a.id, name: g?.full_name ?? a.unknown_name, room: g?.room ?? a.unknown_room, rank: g?.rank || 'UNKNOWN', arrivedAt: a.arrived_at, checkedInName: a.checked_in_name };
  });
  return {
    shift: {
      id: shift.id, shiftDate: shift.shift_date, startedAt: shift.started_at, finishedAt: shift.finished_at,
      startedBy: shift.started_by, startedByName: shift.started_by_name, finishedByName: shift.finished_by_name, status: shift.status,
    },
    guests, unknownArrivals, recent, stats: computeStats(shift.id),
  };
}

const hotelTime = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '');

function checkImage(dataUrl, maxBytes) {
  const m = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new ApiError(400, 'Please choose a PNG, JPG or WebP image.');
  if (m[1] === 'svg+xml') throw new ApiError(400, 'Please use a PNG, JPG or WebP image.');
  if (m[2].length * 0.75 > maxBytes) throw new ApiError(413, `Image must be smaller than ${Math.round(maxBytes / 1024)} KB after resizing.`);
  return dataUrl;
}

// ---------- routes ----------

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, regex, keys, handler });
};

// ----- first-time setup -----

route('GET', '/api/setup-status', () => ({ needsSetup: data.users.size === 0 }));

route('POST', '/api/setup', async ({ body }) => {
  if (data.users.size > 0) throw new ApiError(409, 'This tablet is already set up.');
  const fullName = cleanText(body.fullName, 'Full name', 2, 80);
  const nickname = cleanNickname(body.nickname, fullName);
  const pin = cleanPin(body.pin);
  const deleteCode = cleanCode(body.deleteCode, 'Delete code');
  const brandName = body.brandName ? cleanText(body.brandName, 'App name', 2, 40) : DEFAULT_BRAND.name;
  const tx = begin();
  const user = tx.insert('users', {
    ...(await pinFields(tx, pin)), full_name: fullName, nickname, role: 'manager', theme: 'hilton', avatar: null, created_at: now(),
  });
  tx.setting('deleteCode', deleteCode);
  tx.setting('brandName', brandName);
  tx.setting('brandSubtitle', 'Breakfast Manager');
  audit(tx, user, 'app_setup', null, { nickname });
  await tx.commit();
  await ensureTeam();
  startSession(user);
  return { user: publicUser(user) };
});

// ----- branding & app settings -----

route('GET', '/api/branding', () => ({
  name: settings.get('brandName') || DEFAULT_BRAND.name,
  subtitle: settings.get('brandSubtitle') ?? DEFAULT_BRAND.subtitle,
  logo: settings.get('logo') || 'img/emblem.svg',
  hero: settings.get('hero') || null,
  lockMinutes: lockMinutes(),
}));

route('GET', '/api/settings', () => {
  requireManager();
  return {
    brandName: settings.get('brandName') || DEFAULT_BRAND.name,
    brandSubtitle: settings.get('brandSubtitle') ?? '',
    hasLogo: !!settings.get('logo'),
    hasHero: !!settings.get('hero'),
    accessCode: settings.get('accessCode') || '',
    deleteCode: settings.get('deleteCode') || '',
    lastBackupAt: settings.get('lastBackupAt') || null,
    lockMinutes: lockMinutes(),
    timeZone: timeZone(),
  };
});

route('PUT', '/api/settings', async ({ body }) => {
  const manager = requireManager();
  // Check everything first, so a mistake changes nothing.
  const brandName = cleanText(body.brandName, 'App name', 2, 40);
  const deleteCode = cleanCode(body.deleteCode, 'Delete code');
  const lock = body.lockMinutes === undefined ? undefined : Number(body.lockMinutes);
  if (lock !== undefined && !LOCK_CHOICES.includes(lock)) throw new ApiError(400, 'Choose when the app locks itself.');
  const tx = begin();
  tx.setting('brandName', brandName);
  tx.setting('brandSubtitle', String(body.brandSubtitle ?? '').trim().slice(0, 40));
  tx.setting('deleteCode', deleteCode);
  if (lock !== undefined) tx.setting('lockMinutes', lock);
  audit(tx, manager, 'settings_changed');
  await tx.commit();
  return { ok: true };
});

route('PUT', '/api/settings/logo', async ({ body }) => {
  const manager = requireManager();
  const tx = begin();
  tx.setting('logo', checkImage(body.dataUrl, 400 * 1024));
  audit(tx, manager, 'logo_changed');
  await tx.commit();
  return { ok: true };
});

// Photo shown in the large header area of every screen (Resort design).
route('PUT', '/api/settings/hero', async ({ body }) => {
  const manager = requireManager();
  const hero = checkImage(body.dataUrl, 700 * 1024);
  const tx = begin();
  tx.setting('hero', hero);
  audit(tx, manager, 'hero_changed');
  await tx.commit();
  return { ok: true };
});

route('DELETE', '/api/settings/hero', async () => {
  const manager = requireManager();
  const tx = begin();
  tx.setting('hero', null);
  audit(tx, manager, 'hero_removed');
  await tx.commit();
  return { ok: true };
});

route('DELETE', '/api/settings/logo', async () => {
  const manager = requireManager();
  const tx = begin();
  tx.setting('logo', null);
  audit(tx, manager, 'logo_removed');
  await tx.commit();
  return { ok: true };
});

// ----- backup & restore -----

route('GET', '/api/backup', async () => {
  const manager = requireManager();
  const tx = begin();
  tx.setting('lastBackupAt', now());
  audit(tx, manager, 'backup_downloaded');
  await tx.commit();
  return { filename: `breakfast-backup-${todayLocal()}.json`, backup: exportAll() };
});

route('POST', '/api/restore', async ({ body }) => {
  // Allowed on a brand-new tablet, or by a manager.
  if (data.users.size > 0) requireManager();
  await replaceAll(body.backup);
  endSession();
  return { ok: true, users: data.users.size, shifts: data.shifts.size };
});

// ----- accounts -----

// Everyone who can log in on this tablet, for the "Who's working?" screen.
route('GET', '/api/profiles', async () => { await ensureTeam(); return {
  profiles: activeUsers().sort((a, b) => a.nickname.localeCompare(b.nickname))
    .map((u) => ({ id: u.id, nickname: u.nickname, fullName: u.full_name, avatarUrl: u.avatar || null, role: u.role, hasPin: !!u.pin_hash, theme: themeOf(u) })),
}; });

// Staff accounts are created by a manager (Settings → Team). There is no self-signup.
route('POST', '/api/auth/register', () => { throw new ApiError(410, 'Ask a manager to add you in Settings → Team.'); });

// Log in by typing your PIN: the PIN tells us who you are.
route('POST', '/api/auth/pin', async ({ body }) => {
  if (isLocked('pin-login', 5, 60 * 1000)) throw new ApiError(429, 'Too many wrong PINs. Wait one minute and try again.');
  const pin = String(body.pin ?? '').trim();
  if (!/^\d{4}$/.test(pin)) throw new ApiError(400, 'Enter your 4-digit PIN.');
  const tx = begin();
  const tag = await pinFingerprint(pin, await pinSecret());
  let user = activeUsers().find((u) => u.pin_tag && u.pin_tag === tag) || null;
  if (user && !(await verifyPassword(pin, user.pin_hash))) user = null;
  if (!user) {
    // Accounts from before PIN fingerprints: check them one by one and remember the fingerprint.
    for (const u of activeUsers().filter((x) => x.pin_hash && !x.pin_tag)) {
      if (await verifyPassword(pin, u.pin_hash)) { user = u; tx.update('users', { ...u, pin_tag: tag }); break; }
    }
  }
  if (!user) { recordFailure('pin-login', 5, 60 * 1000); throw new ApiError(401, 'Wrong PIN. Try again.'); }
  audit(tx, user, 'logged_in');
  await tx.commit();
  startSession(user);
  return { user: publicUser(data.users.get(user.id)) };
});

// Log in by tapping your name and entering your PIN.
// Accounts made before PINs existed log in once with their password and then choose a PIN.
route('POST', '/api/auth/login', async ({ body }) => {
  const user = data.users.get(Number(body.userId));
  if (!user || user.disabled) throw new ApiError(404, 'This account no longer exists.');
  if (tooManyAttempts('login:' + user.id, 5, 2 * 60 * 1000)) throw new ApiError(429, 'Too many wrong tries. Wait 2 minutes, or ask a manager to reset your PIN.');
  let ok = false;
  if (user.pin_hash) ok = await verifyPassword(String(body.pin ?? ''), user.pin_hash);
  else if (user.password_hash) ok = await verifyPassword(String(body.password ?? ''), user.password_hash);
  if (!ok) throw new ApiError(401, user.pin_hash ? 'Wrong PIN. Try again.' : 'Wrong password. Try again.');
  const tx = begin();
  audit(tx, user, 'logged_in');
  await tx.commit();
  startSession(user);
  return { user: publicUser(user), needsPin: !user.pin_hash };
});

// Choose or change your own PIN.
route('PUT', '/api/me/pin', async ({ body }) => {
  const user = requireUser();
  if (user.pin_hash && !(await verifyPassword(String(body.currentPin ?? ''), user.pin_hash))) {
    throw new ApiError(403, 'Your current PIN is not right.');
  }
  const pin = cleanPin(body.pin, 'New PIN');
  const tx = begin();
  const { password_hash, email, ...rest } = user;
  tx.update('users', { ...rest, ...(await pinFields(tx, pin, user.id)) });
  audit(tx, user, user.pin_hash ? 'pin_changed' : 'pin_created');
  await tx.commit();
  void password_hash; void email;
  return { user: publicUser(data.users.get(user.id)) };
});

// Managers can give an employee a new PIN when they forget it.
route('PUT', '/api/users/:id/pin', async ({ body, params }) => {
  const manager = requireManager();
  const target = data.users.get(Number(params.id));
  if (!target) throw new ApiError(404, 'Employee not found.');
  const pin = cleanPin(body.pin, 'New PIN');
  const tx = begin();
  const { password_hash, email, ...rest } = target;
  tx.update('users', { ...rest, ...(await pinFields(tx, pin, target.id)) });
  audit(tx, manager, 'pin_reset', null, { userId: target.id, nickname: target.nickname });
  await tx.commit();
  void password_hash; void email;
  return { ok: true };
});

route('POST', '/api/auth/logout', () => { endSession(); return { ok: true }; });

route('GET', '/api/me', () => {
  const user = currentUser();
  if (!user) return { user: null };
  return { user: publicUser(user), activeShiftId: activeShift()?.id ?? null };
});

route('PUT', '/api/me/nickname', async ({ body }) => {
  const user = requireUser();
  const nickname = cleanNickname(cleanText(body.nickname, 'Nickname', 1, 30), user.full_name, user.id);
  const tx = begin();
  tx.update('users', { ...user, nickname });
  audit(tx, user, 'nickname_changed', null, { from: user.nickname, to: nickname });
  await tx.commit();
  return { user: publicUser(data.users.get(user.id)) };
});

route('PUT', '/api/me/avatar', async ({ body }) => {
  const user = requireUser();
  const avatar = checkImage(body.dataUrl, 300 * 1024);
  const tx = begin();
  tx.update('users', { ...user, avatar });
  audit(tx, user, 'avatar_changed');
  await tx.commit();
  return { user: publicUser(data.users.get(user.id)) };
});

route('DELETE', '/api/me/avatar', async () => {
  const user = requireUser();
  const tx = begin();
  tx.update('users', { ...user, avatar: null });
  audit(tx, user, 'avatar_removed');
  await tx.commit();
  return { user: publicUser(data.users.get(user.id)) };
});

route('GET', '/api/users', () => {
  requireManager();
  return { users: activeUsers().sort((a, b) => a.created_at.localeCompare(b.created_at)).map(publicUser) };
});

// Managers add staff: name, PIN, role and personal theme.
route('POST', '/api/users', async ({ body }) => {
  const manager = requireManager();
  const fullName = cleanText(body.fullName, 'Name', 1, 80);
  const nickname = cleanNickname(body.nickname, fullName);
  const pin = cleanPin(body.pin);
  const role = body.role === 'manager' ? 'manager' : 'employee';
  const theme = cleanTheme(body.theme || 'hilton');
  const tx = begin();
  const user = tx.insert('users', { ...(await pinFields(tx, pin)), full_name: fullName, nickname, role, theme, avatar: null, created_at: now() });
  audit(tx, manager, 'account_created', null, { nickname, role, theme });
  await tx.commit();
  return { user: publicUser(user) };
});

route('PUT', '/api/users/:id/theme', async ({ body, params }) => {
  const manager = requireManager();
  const target = data.users.get(Number(params.id));
  if (!target || target.disabled) throw new ApiError(404, 'Employee not found.');
  const theme = cleanTheme(body.theme);
  const tx = begin();
  tx.update('users', { ...target, theme });
  audit(tx, manager, 'theme_changed', null, { userId: target.id, nickname: target.nickname, theme });
  await tx.commit();
  return { user: publicUser(data.users.get(target.id)) };
});

route('PUT', '/api/me/theme', async ({ body }) => {
  const user = requireUser();
  const theme = cleanTheme(body.theme);
  const tx = begin();
  tx.update('users', { ...user, theme });
  await tx.commit();
  return { user: publicUser(data.users.get(user.id)) };
});

// Removing someone keeps their name on old shifts; they just can't log in any more.
route('DELETE', '/api/users/:id', async ({ params }) => {
  const manager = requireManager();
  const target = data.users.get(Number(params.id));
  if (!target || target.disabled) throw new ApiError(404, 'Employee not found.');
  if (target.id === manager.id) throw new ApiError(409, 'You can’t remove your own account.');
  if (target.role === 'manager' && activeUsers().filter((u) => u.role === 'manager').length <= 1) throw new ApiError(409, 'There must always be at least one manager.');
  const tx = begin();
  const { pin_hash, pin_tag, password_hash, ...rest } = target;
  tx.update('users', { ...rest, disabled: true, removed_at: now() });
  audit(tx, manager, 'account_removed', null, { userId: target.id, nickname: target.nickname });
  await tx.commit();
  void pin_hash; void pin_tag; void password_hash;
  return { ok: true };
});

route('PUT', '/api/users/:id/role', async ({ body, params }) => {
  const manager = requireManager();
  if (!['employee', 'manager'].includes(body.role)) throw new ApiError(400, 'Unknown role.');
  const target = data.users.get(Number(params.id));
  if (!target) throw new ApiError(404, 'Employee not found.');
  if (target.role === 'manager' && body.role === 'employee' && activeUsers().filter((u) => u.role === 'manager').length <= 1) {
    throw new ApiError(409, 'There must always be at least one manager.');
  }
  const tx = begin();
  tx.update('users', { ...target, role: body.role });
  audit(tx, manager, 'role_changed', null, { userId: target.id, nickname: target.nickname, from: target.role, to: body.role });
  await tx.commit();
  return { ok: true };
});

// ----- shifts -----

route('GET', '/api/shifts/active', () => {
  requireUser();
  const shift = activeShift();
  return shift ? shiftPayload(shift) : { shift: null };
});

route('POST', '/api/shifts', async ({ body }) => {
  const user = requireUser();
  const list = Array.isArray(body.guests) ? body.guests : [];
  if (!list.length) throw new ApiError(400, 'Add at least one expected guest before starting the shift.');
  if (list.length > 1000) throw new ApiError(400, 'Too many guests in one shift.');
  const guests = list.map((g, i) => {
    const where = `Guest #${i + 1}`;
    const fullName = cleanText(g.fullName, `${where}: full name`, 2, 100);
    const room = parseRoom(g.room);
    if (!room.ok) throw new ApiError(400, `${where} (${fullName}): ${room.error}`);
    const rank = String(g.rank ?? '').toUpperCase();
    if (!RANKS.includes(rank)) throw new ApiError(400, `${where} (${fullName}): membership must be Diamond, Gold or Member.`);
    return { fullName, room: room.room, floor: room.floor, rank };
  });
  if (activeShift()) throw new ApiError(409, 'Another shift is already active. Finish it before starting a new one.');
  const tx = begin();
  const shift = tx.insert('shifts', {
    shift_date: todayLocal(), started_at: now(), finished_at: null, started_by: user.id, started_by_name: user.nickname,
    finished_by: null, finished_by_name: null, status: 'ACTIVE', final_stats: null,
  });
  for (const g of guests) tx.insert('guests', { shift_id: shift.id, full_name: g.fullName, room: g.room, floor: g.floor, rank: g.rank });
  audit(tx, user, 'shift_started', shift.id, { expectedGuests: guests.length });
  await tx.commit();
  return shiftPayload(shift);
});

route('POST', '/api/shifts/:id/checkin', async ({ body, params }) => {
  const user = requireUser();
  const shift = getShift(params.id);
  requireActive(shift);
  const guest = data.guests.get(Number(body.guestId));
  if (!guest || guest.shift_id !== shift.id) throw new ApiError(404, 'Guest not found on this shift.');
  const existing = arrivalOf(guest.id);
  if (existing) throw new ApiError(409, 'ALREADY ARRIVED', { code: 'ALREADY_ARRIVED', arrivedAt: existing.arrived_at, checkedInName: existing.checked_in_name });
  const tx = begin();
  tx.insert('arrivals', { shift_id: shift.id, guest_id: guest.id, unknown_name: null, unknown_room: null, unknown_floor: null, arrived_at: now(), checked_in_by: user.id, checked_in_name: user.nickname });
  audit(tx, user, 'guest_checked_in', shift.id, { guestId: guest.id, name: guest.full_name, room: guest.room });
  await tx.commit();
  return shiftPayload(shift);
});

route('POST', '/api/shifts/:id/unknown', async ({ body, params }) => {
  const user = requireUser();
  const shift = getShift(params.id);
  requireActive(shift);
  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 100) || null;
  const roomText = String(body.room ?? '').trim();
  let room = null;
  if (roomText) { room = parseRoom(roomText); if (!room.ok) throw new ApiError(400, room.error); }
  if (!name && !room) throw new ApiError(400, 'Enter a room number or a name for the unknown guest.');
  const tx = begin();
  tx.insert('arrivals', { shift_id: shift.id, guest_id: null, unknown_name: name, unknown_room: room?.room ?? null, unknown_floor: room?.floor ?? null, arrived_at: now(), checked_in_by: user.id, checked_in_name: user.nickname });
  audit(tx, user, 'unknown_arrival_registered', shift.id, { name, room: room?.room ?? null });
  await tx.commit();
  return shiftPayload(shift);
});

route('DELETE', '/api/shifts/:id/arrivals/:arrivalId', async ({ params }) => {
  const user = requireUser();
  const shift = getShift(params.id);
  requireActive(shift);
  const arrival = data.arrivals.get(Number(params.arrivalId));
  if (!arrival || arrival.shift_id !== shift.id) throw new ApiError(404, 'Arrival not found.');
  const guest = arrival.guest_id ? data.guests.get(arrival.guest_id) : null;
  const tx = begin();
  tx.remove('arrivals', arrival.id);
  audit(tx, user, 'checkin_undone', shift.id, {
    name: guest?.full_name ?? arrival.unknown_name, room: guest?.room ?? arrival.unknown_room, unknown: !guest,
    originalArrival: arrival.arrived_at, originalCheckedInBy: arrival.checked_in_name,
  });
  await tx.commit();
  return shiftPayload(shift);
});

route('POST', '/api/shifts/:id/guests', async ({ body, params }) => {
  const user = requireUser();
  const shift = getShift(params.id);
  requireActive(shift);
  const fullName = cleanText(body.fullName, 'Guest name', 2, 100);
  const room = parseRoom(body.room);
  if (!room.ok) throw new ApiError(400, room.error);
  const rank = String(body.rank ?? '').toUpperCase();
  if (!RANKS.includes(rank)) throw new ApiError(400, 'Choose a membership: Diamond, Gold or Member.');
  if (shiftGuests(shift.id).some((g) => g.room === room.room && g.full_name.toLowerCase() === fullName.toLowerCase())) {
    throw new ApiError(409, `${fullName} in room ${room.room} is already on this shift’s list.`);
  }
  const tx = begin();
  const guest = tx.insert('guests', { shift_id: shift.id, full_name: fullName, room: room.room, floor: room.floor, rank });
  audit(tx, user, 'guest_added', shift.id, { name: fullName, room: room.room, rank });
  await tx.commit();
  return { ...shiftPayload(shift), addedGuestId: guest.id };
});

route('POST', '/api/shifts/:id/finish', async ({ params }) => {
  const user = requireUser();
  const shift = getShift(params.id);
  requireActive(shift);
  const stats = computeStats(shift.id);
  const tx = begin();
  const done = tx.update('shifts', { ...shift, status: 'COMPLETED', finished_at: now(), finished_by: user.id, finished_by_name: user.nickname, final_stats: stats });
  audit(tx, user, 'shift_finished', shift.id, stats);
  await tx.commit();
  return shiftPayload(done);
});

route('GET', '/api/shifts', () => {
  requireUser();
  const shifts = rows('shifts').filter((s) => s.status === 'COMPLETED')
    .sort((a, b) => b.shift_date.localeCompare(a.shift_date) || b.started_at.localeCompare(a.started_at))
    .map((s) => ({ id: s.id, shiftDate: s.shift_date, startedAt: s.started_at, finishedAt: s.finished_at, startedByName: s.started_by_name, stats: s.final_stats || computeStats(s.id) }));
  return { shifts };
});

route('GET', '/api/shifts/:id', ({ params }) => {
  requireUser();
  const shift = getShift(params.id);
  const payload = shiftPayload(shift);
  payload.finalStats = shift.final_stats || null;
  payload.activity = rows('audit_log').filter((a) => a.shift_id === shift.id).sort((a, b) => a.id - b.id)
    .map((a) => ({ at: a.created_at, by: a.user_name, action: a.action, details: a.details }));
  return payload;
});

route('POST', '/api/shifts/:id/corrections', async ({ body, params }) => {
  const manager = requireManager();
  const shift = getShift(params.id);
  if (shift.status !== 'COMPLETED') throw new ApiError(409, 'Corrections are only for completed shifts.');
  const reason = cleanText(body.reason, 'Reason for the correction', 3, 300);
  const tx = begin();
  if (body.action === 'mark-arrived' || body.action === 'mark-not-arrived') {
    const guest = data.guests.get(Number(body.guestId));
    if (!guest || guest.shift_id !== shift.id) throw new ApiError(404, 'Guest not found on this shift.');
    const arrival = arrivalOf(guest.id);
    if (body.action === 'mark-arrived') {
      if (arrival) throw new ApiError(409, 'This guest is already marked as arrived.');
      const at = new Date(body.arrivedAt);
      if (Number.isNaN(at.getTime())) throw new ApiError(400, 'Please give a valid arrival time.');
      tx.insert('arrivals', { shift_id: shift.id, guest_id: guest.id, unknown_name: null, unknown_room: null, unknown_floor: null, arrived_at: at.toISOString(), checked_in_by: manager.id, checked_in_name: `${manager.nickname} (correction)` });
      audit(tx, manager, 'correction', shift.id, { change: 'marked as arrived', name: guest.full_name, room: guest.room, arrivedAt: at.toISOString(), reason });
    } else {
      if (!arrival) throw new ApiError(409, 'This guest is already marked as not arrived.');
      tx.remove('arrivals', arrival.id);
      audit(tx, manager, 'correction', shift.id, { change: 'marked as not arrived', name: guest.full_name, room: guest.room, removedArrival: arrival.arrived_at, originalCheckedInBy: arrival.checked_in_name, reason });
    }
  } else if (body.action === 'remove-unknown') {
    const arrival = data.arrivals.get(Number(body.arrivalId));
    if (!arrival || arrival.shift_id !== shift.id || arrival.guest_id) throw new ApiError(404, 'Unknown arrival not found.');
    tx.remove('arrivals', arrival.id);
    audit(tx, manager, 'correction', shift.id, { change: 'removed unknown arrival', name: arrival.unknown_name, room: arrival.unknown_room, removedArrival: arrival.arrived_at, originalCheckedInBy: arrival.checked_in_name, reason });
  } else {
    throw new ApiError(400, 'Unknown correction type.');
  }
  tx.update('shifts', { ...shift, final_stats: computeStats(shift.id) });
  await tx.commit();
  return { ok: true };
});

route('DELETE', '/api/shifts/:id', async ({ body, params }) => {
  const user = requireUser();
  if (tooManyAttempts('delete-shift:' + user.id, 10)) throw new ApiError(429, 'Too many attempts. Please wait a few minutes.');
  const code = settings.get('deleteCode');
  if (!code || String(body.code ?? '') !== String(code)) throw new ApiError(403, 'Wrong delete code.');
  const shift = getShift(params.id);
  const stats = shift.final_stats || computeStats(shift.id);
  const tx = begin();
  for (const a of shiftArrivals(shift.id)) tx.remove('arrivals', a.id);
  for (const g of shiftGuests(shift.id)) tx.remove('guests', g.id);
  for (const l of rows('audit_log').filter((x) => x.shift_id === shift.id)) tx.remove('audit_log', l.id);
  tx.remove('shifts', shift.id);
  audit(tx, user, 'shift_deleted', null, { deletedShiftId: shift.id, shiftDate: shift.shift_date, startedAt: shift.started_at, startedBy: shift.started_by_name, status: shift.status, stats });
  await tx.commit();
  return { ok: true };
});

route('GET', '/api/shifts/:id/export', ({ params }) => {
  requireUser();
  const shift = getShift(params.id);
  const p = shiftPayload(shift);
  const out = [['Room', 'Floor', 'Guest', 'Membership', 'Status', 'Arrival time', 'Checked in by']];
  for (const g of p.guests) out.push([g.room, g.floor, g.fullName, g.rank, g.arrival ? 'Arrived' : 'Did not arrive', hotelTime(g.arrival?.arrivedAt), g.arrival?.checkedInName ?? '']);
  for (const u of p.unknownArrivals) out.push([u.room ?? '', u.floor ?? '', u.name ?? 'Unknown guest', 'UNKNOWN', 'Arrived', hotelTime(u.arrivedAt), u.checkedInName]);
  const s = p.stats;
  out.push([], ['Shift date', shift.shift_date], ['Started', hotelTime(shift.started_at), 'by', shift.started_by_name],
    ['Finished', hotelTime(shift.finished_at), 'by', shift.finished_by_name ?? ''],
    ['Expected', s.expected, 'Checked in', s.checkedIn, 'Did not arrive', s.notArrived],
    ['Diamond', s.diamond, 'Gold', s.gold, 'Member', s.member, 'Unknown', s.unknown]);
  return { filename: `breakfast-shift-${shift.shift_date}-${shift.id}.csv`, csv: toCsv(out) };
});

// ----- analytics -----

function monthParam(query) {
  const month = query.get('month') || todayLocal().slice(0, 7);
  if (!isMonth(month)) throw new ApiError(400, 'Month must look like 2026-11.');
  return month;
}

route('GET', '/api/analytics', ({ query }) => {
  const user = requireUser();
  const month = monthParam(query);
  const months = availableMonths();
  const current = todayLocal().slice(0, 7);
  if (!months.includes(current)) months.unshift(current);
  return {
    ...monthlyAnalytics(month, timeZone(), { includeStaff: user.role === 'manager' }),
    months: [...new Set(months)].sort().reverse(),
    timeZone: timeZone(),
  };
});

route('GET', '/api/analytics/export', ({ query }) => {
  requireUser();
  const month = monthParam(query);
  return { filename: `breakfast-report-${month}.csv`, csv: monthCsv(monthlyAnalytics(month, timeZone())) };
});

// ---------- dispatcher ----------

export async function handle(method, url, body = {}) {
  await init();
  const u = new URL(url, 'https://app.local');
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = u.pathname.match(r.regex);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return r.handler({ body: body || {}, params, query: u.searchParams });
  }
  throw new ApiError(404, 'Not found.');
}
