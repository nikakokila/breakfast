// App entry: first-time setup, login gate, top navigation, page routing.
import { api, html, raw, avatar, icons, toast, fmtDateShort, fmtTime, setBusy, downloadFile, openModal, afterHistorySettles } from './lib.js';
import { renderPrepare, renderActiveShift } from './shift.js';
import { renderHistory, renderShiftDetail } from './history.js';
import { renderSettings } from './settings.js';
import { renderAnalytics } from './analytics.js';
import { art, heritageStrip, startHeritage } from './celebrate.js';
import { applyTheme, welcome } from './themes.js';
import { play, isMuted, setMuted } from './sounds.js';

const app = document.getElementById('app');
export const state = { me: null, activeShiftId: null, brand: { name: 'Breakfast Manager', subtitle: '', logo: 'img/emblem.svg' }, needsSetup: false };

// Name, subtitle and logo are set by a manager in Settings → App settings.
function brandLockup(extraClass = '') {
  const b = state.brand;
  return html`
    <img src="${b.logo}" alt="" class="${b.logo.startsWith('data:') ? 'logo-img' : 'emblem'}">
    <div class="brand-text ${extraClass}"><div class="brand-name">${b.name}</div>${b.subtitle ? html`<div class="brand-sub">${b.subtitle}</div>` : ''}</div>`;
}

function applyBrand() {
  document.title = state.brand.name;
  const icon = document.querySelector('link[rel=icon]');
  if (icon) icon.href = state.brand.logo;
}
let cleanup = null;

// ---------- Routing ----------
// Pages live in the URL hash: #/home, #/prepare, #/shift, #/history, #/history/12, #/settings
const routes = [
  { path: /^\/setup$/, view: () => renderSetup(), public: true },
  { path: /^\/login$/, view: (p) => renderAuth('login'), public: true },
  { path: /^\/home$/, view: renderHome, nav: 'home' },
  { path: /^\/prepare$/, view: renderPrepare, nav: 'shift' },
  { path: /^\/shift$/, view: renderActiveShift, nav: 'shift' },
  { path: /^\/history$/, view: renderHistory, nav: 'history' },
  { path: /^\/history\/(\d+)$/, view: (m) => renderShiftDetail(m[1]), nav: 'history' },
  { path: /^\/analytics(?:\/(\d{4}-\d{2}))?$/, view: renderAnalytics, nav: 'analytics' },
  { path: /^\/settings$/, view: renderSettings, nav: 'settings' },
];

export function go(path) {
  // Wait until a just-closed pop-up has removed its history step, so the two don't collide.
  afterHistorySettles().then(() => {
    if (location.hash === '#' + path) render();
    else location.hash = path;
  });
}

async function render() {
  cleanup?.();
  cleanup = null;
  document.getElementById('modal-root').innerHTML = '';
  const path = location.hash.slice(1) || '/home';
  const route = routes.find((r) => r.path.test(path));
  if (!route) return go('/home');

  // A brand-new tablet starts with setup; after that, login is always the entry point.
  if (state.needsSetup && path !== '/setup') return go('/setup');
  if (!state.needsSetup && path === '/setup') return go(state.me ? '/home' : '/login');
  if (!route.public && !state.me) return go('/login');
  if (route.public && state.me) return go('/home');

  if (route.public) app.innerHTML = '';
  else renderShell(route.nav);
  const result = await route.view(path.match(route.path));
  if (typeof result === 'function') cleanup = result;
  window.scrollTo(0, 0);
}

const soundIcon = () => (isMuted()
  ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>'
  : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13"/></svg>');

// ---------- Shell (top bar) ----------
export function renderShell(active) {
  const me = state.me;
  const live = !!state.activeShiftId;
  const shiftHref = live ? '/shift' : '/prepare';
  // Desktop/tablet: links in the top bar. Phones: an app-style tab bar at the bottom.
  const link = (key, href, label, icon) => html`
    <a href="#${href}" class="${active === key ? 'active' : ''}" ${key === 'shift' ? raw('data-shift-link') : ''}>
      ${icon ? icon : ''}<span class="lbl">${label}</span>${key === 'shift' && live ? raw('<i class="live-dot" title="Shift in progress"></i>') : ''}
    </a>`;
  app.innerHTML = String(html`
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand-lockup" href="#/home">${brandLockup()}</a>
        <nav class="nav">
          ${link('home', '/home', 'Home')}
          ${link('shift', shiftHref, live ? 'Active shift' : 'New shift')}
          ${link('history', '/history', 'Previous shifts')}
          ${link('analytics', '/analytics', 'Analytics')}
          ${link('settings', '/settings', 'Settings')}
        </nav>
        <a class="user-chip" href="#/settings" title="Profile & settings">
          <span class="who"><b>${me.nickname}</b><span>${me.role}</span></span>
          ${avatar(me)}
        </a>
        <button class="sound-btn" type="button" id="sound-btn" title="Sounds on or off" aria-pressed="${isMuted() ? 'true' : 'false'}">${raw(soundIcon())}</button>
        <button class="lock-btn" type="button" id="lock-btn" title="Lock and switch user">${icons.lock}<span>Lock</span></button>
      </div>
    </header>
    <main class="page" id="view"></main>
    <nav class="tabbar" aria-label="Main">
      ${link('home', '/home', 'Home', icons.home)}
      ${link('shift', shiftHref, live ? 'Shift' : 'New shift', icons.cup)}
      ${link('history', '/history', 'History', icons.history)}
      ${link('analytics', '/analytics', 'Analytics', icons.chart)}
      ${link('settings', '/settings', 'Settings', icons.gear)}
    </nav>
  `);
}

function updateShiftLinks() {
  const live = !!state.activeShiftId;
  document.querySelectorAll('[data-shift-link]').forEach((a) => {
    a.setAttribute('href', live ? '#/shift' : '#/prepare');
    const inTabbar = !!a.closest('.tabbar');
    a.querySelector('.lbl').textContent = live ? (inTabbar ? 'Shift' : 'Active shift') : 'New shift';
    a.querySelector('.live-dot')?.remove();
    if (live) a.insertAdjacentHTML('beforeend', '<i class="live-dot" title="Shift in progress"></i>');
  });
}

export const view = () => document.getElementById('view');
document.addEventListener('click', (e) => { if (e.target.closest('#lock-btn')) lockApp(); });
document.addEventListener('click', (e) => {
  const b = e.target.closest('#sound-btn');
  if (!b) return;
  setMuted(!isMuted());
  b.setAttribute('aria-pressed', isMuted() ? 'true' : 'false');
  b.innerHTML = soundIcon();
  toast(isMuted() ? 'Sounds off.' : 'Sounds on.');
});

export async function refreshMe() {
  const data = await api('GET', '/api/me');
  state.me = data.user;
  state.activeShiftId = data.activeShiftId ?? null;
  applyTheme(state.me?.theme || 'hilton');
  return data;
}

export async function refreshBrand() {
  try { state.brand = await api('GET', '/api/branding'); } catch { /* keep defaults */ }
  document.title = state.brand.name;
  // A manager-uploaded header photo replaces the painted sunrise.
  document.documentElement.style.setProperty('--hero-img', state.brand.hero ? `url("${state.brand.hero}")` : 'none');
  document.documentElement.classList.toggle('has-hero-photo', !!state.brand.hero);
}

window.addEventListener('auth-lost', () => {
  state.me = null;
  toast('Your session ended. Please log in again.', 'error');
  go('/login');
});

// ---------- Login: tap your name, enter your PIN ----------
const authBrandPanel = () => html`
  <section class="auth-brand">
    ${art.sprig}
    <div class="brand-lockup">${brandLockup()}</div>
    <div class="auth-hero">
      <h1>Every guest,<br><em>warmly</em> accounted for.</h1>
      <p>Prepare the morning guest list, check guests in at the door, and keep a permanent record of every breakfast shift.</p>
      <ul class="auth-points">
        <li>Instant room-number search</li>
        <li>Works on this tablet, even without internet</li>
        <li>Complete history of previous shifts</li>
      </ul>
    </div>
    <div class="auth-foot">${art.facade}<span><b>Hospitality since 1919.</b><br>For authorised hotel staff only.</span></div>
  </section>`;

// Login: just type your PIN. The PIN tells the app who you are.
async function renderAuth() {
  applyTheme('hilton');
  const { profiles } = await api('GET', '/api/profiles');
  const legacy = profiles.filter((p) => !p.hasPin);
  app.innerHTML = String(html`
    <div class="auth">
      ${authBrandPanel()}
      <section class="auth-panel">
        <div class="auth-card pin-login">
          <div class="auth-mobile-brand brand-lockup">${brandLockup()}</div>
          <div class="pinpad-head">
            <h2>Enter your PIN</h2>
            <p class="muted" id="pin-msg">Your PIN unlocks your own workspace.</p>
            <div class="pin-dots big" aria-hidden="true">${[0, 1, 2, 3].map(() => html`<i></i>`)}</div>
          </div>
          <div class="pin-keys big">
            ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => html`<button type="button" class="pin-key" data-d="${d}">${d}</button>`)}
            <span></span>
            <button type="button" class="pin-key" data-d="0">0</button>
            <button type="button" class="pin-key ghost" data-act="back" aria-label="Delete last digit">⌫</button>
          </div>
          ${legacy.length ? html`<p class="legacy-login"><button class="link-btn small" type="button" id="legacy-btn">Older account without a PIN?</button></p>` : ''}
          <p class="muted small pin-foot">Forgot your PIN? Ask a manager to set a new one.</p>
        </div>
      </section>
    </div>`);
  const card = app.querySelector('.pin-login');
  const dots = card.querySelectorAll('.pin-dots i');
  const msg = card.querySelector('#pin-msg');
  let pin = '';
  let busy = false;
  const draw = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const submit = async () => {
    busy = true;
    msg.textContent = 'Checking…';
    msg.classList.remove('err');
    try {
      const { user } = await api('POST', '/api/auth/pin', { pin });
      buzz(20);
      card.classList.add('unlocked');
      document.removeEventListener('keydown', onKey);
      await welcome(user);
      await refreshMe();
      markActive();
      go('/home');
    } catch (err) {
      play('hilton', 'warn');
      buzz([60, 50, 60]);
      msg.textContent = err.message;
      msg.classList.add('err');
      const row = card.querySelector('.pin-dots');
      row.classList.add('shake');
      setTimeout(() => row.classList.remove('shake'), 400);
      pin = '';
      draw();
      busy = false;
    }
  };
  const press = (d) => {
    if (busy || pin.length >= 4) return;
    pin += d;
    draw();
    if (pin.length === 4) submit();
  };
  card.addEventListener('click', (e) => {
    const k = e.target.closest('.pin-key');
    if (k?.dataset.d) press(k.dataset.d);
    if (k?.dataset.act === 'back' && !busy) { pin = pin.slice(0, -1); draw(); }
    if (e.target.closest('#legacy-btn')) {
      openModal(String(html`<div class="modal-head"><h2>Choose your name</h2><p>This account was made before PINs. Log in once with your old password, then choose a PIN.</p></div>
        <div class="modal-body"><div class="profile-grid">${legacy.map((p) => html`<button class="profile-tile" type="button" data-profile="${p.id}">${avatar(p, 'lg')}<b>${p.nickname}</b></button>`)}</div></div>`),
      (m, close) => m.addEventListener('click', (ev) => {
        const t = ev.target.closest('[data-profile]');
        if (t) { close(); openPasswordLogin(legacy.find((p) => p.id === Number(t.dataset.profile))); }
      }));
    }
  });
  const onKey = (e) => {
    if (document.getElementById('modal-root').children.length) return;
    if (/^\d$/.test(e.key)) press(e.key);
    if (e.key === 'Backspace' && !busy) { pin = pin.slice(0, -1); draw(); }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

async function afterLogin(result, profile) {
  await refreshMe();
  markActive();
  if (result.needsPin) {
    await choosePin(profile.nickname);
  }
  await welcome(state.me);
  go('/home');
}

// Big number pad. Logs in automatically on the 4th digit.
function openPinPad(profile) {
  if (!profile.hasPin) return openPasswordLogin(profile);
  let pin = '';
  let busy = false;
  const close = openModal(String(html`
    <div class="pinpad" role="group" aria-label="Enter PIN">
      <div class="pinpad-head">
        ${avatar(profile, 'lg')}
        <h2>${profile.nickname}</h2>
        <p class="muted" id="pin-msg">Enter your PIN</p>
        <div class="pin-dots" aria-hidden="true">${[0, 1, 2, 3].map(() => html`<i></i>`)}</div>
      </div>
      <div class="pin-keys">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => html`<button type="button" class="pin-key" data-d="${d}">${d}</button>`)}
        <button type="button" class="pin-key ghost" data-act="cancel">Cancel</button>
        <button type="button" class="pin-key" data-d="0">0</button>
        <button type="button" class="pin-key ghost" data-act="back" aria-label="Delete last digit">⌫</button>
      </div>
    </div>`), (m, closeFn) => {
    const dots = m.querySelectorAll('.pin-dots i');
    const msg = m.querySelector('#pin-msg');
    const draw = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
    const submit = async () => {
      busy = true;
      msg.textContent = 'Checking…';
      try {
        const result = await api('POST', '/api/auth/login', { userId: profile.id, pin });
        buzz(20);
        closeFn();
        await afterLogin(result, profile);
      } catch (err) {
        buzz([60, 50, 60]);
        msg.textContent = err.message;
        msg.classList.add('err');
        m.querySelector('.pin-dots').classList.add('shake');
        setTimeout(() => m.querySelector('.pin-dots')?.classList.remove('shake'), 400);
        pin = '';
        draw();
        busy = false;
      }
    };
    const press = (d) => {
      if (busy || pin.length >= 4) return;
      pin += d;
      msg.classList.remove('err');
      msg.textContent = 'Enter your PIN';
      draw();
      if (pin.length === 4) submit();
    };
    m.addEventListener('click', (e) => {
      const k = e.target.closest('.pin-key');
      if (!k) return;
      if (k.dataset.d) press(k.dataset.d);
      if (k.dataset.act === 'back' && !busy) { pin = pin.slice(0, -1); draw(); }
      if (k.dataset.act === 'cancel') closeFn();
    });
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace' && !busy) { pin = pin.slice(0, -1); draw(); }
    };
    document.addEventListener('keydown', onKey);
    new MutationObserver((_, obs) => { if (!m.isConnected) { document.removeEventListener('keydown', onKey); obs.disconnect(); } })
      .observe(document.getElementById('modal-root'), { childList: true });
  });
  void close;
}

// For accounts created before PINs: log in once with the old password.
function openPasswordLogin(profile) {
  openModal(String(html`
    <div class="modal-head"><h2>${profile.nickname}</h2><p>Log in with your old password once. Then you’ll choose a 4-digit PIN.</p></div>
    <form autocomplete="off">
      <div class="modal-body"><div id="pw-error"></div>
        <div class="field"><label for="old-pw">Password</label><input class="input" type="password" id="old-pw" name="password" autofocus></div></div>
      <div class="modal-foot"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-primary" type="submit">Log in</button></div>
    </form>`), (m, close) => {
    m.querySelector('[data-close]').onclick = close;
    m.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const result = await api('POST', '/api/auth/login', { userId: profile.id, password: m.querySelector('#old-pw').value });
        close();
        await afterLogin(result, profile);
      } catch (err) {
        m.querySelector('#pw-error').innerHTML = String(html`<div class="form-error">${err.message}</div>`);
      }
    });
  });
}

// Asks the logged-in person to choose a PIN (used once for older accounts).
export function choosePin(name) {
  return new Promise((resolve) => {
    openModal(String(html`
      <div class="modal-head"><h2>Choose your PIN</h2><p>${name ? `${name}, from` : 'From'} now on you log in with a 4-digit PIN instead of a password.</p></div>
      <form autocomplete="off">
        <div class="modal-body"><div id="cp-error"></div>
          <div class="name-row">
            <div class="field"><label for="cp-pin">New PIN</label><input class="input pin-input" type="password" inputmode="numeric" maxlength="4" id="cp-pin" autofocus></div>
            <div class="field"><label for="cp-pin2">Repeat PIN</label><input class="input pin-input" type="password" inputmode="numeric" maxlength="4" id="cp-pin2"></div>
          </div></div>
        <div class="modal-foot"><button class="btn btn-gold" type="submit">Save PIN</button></div>
      </form>`), (m, close) => {
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const a = m.querySelector('#cp-pin').value, b = m.querySelector('#cp-pin2').value;
        const err = m.querySelector('#cp-error');
        if (a !== b) { err.innerHTML = String(html`<div class="form-error">The two PINs are different.</div>`); return; }
        try { await api('PUT', '/api/me/pin', { pin: a }); close(); resolve(true); }
        catch (x) { err.innerHTML = String(html`<div class="form-error">${x.message}</div>`); }
      });
    });
  });
}

// ---------- Lock: back to "Who's working?" ----------
export async function lockApp(reason) {
  try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ }
  state.me = null;
  applyTheme('hilton');
  if (reason) toast(reason);
  go('/login');
}

// Locks the app after it has not been used for a while (set in App settings).
const ACTIVE_KEY = 'bm-last-active';
function markActive() { try { localStorage.setItem(ACTIVE_KEY, String(Date.now())); } catch { /* ignore */ } }
function idleTooLong() {
  const minutes = state.brand.lockMinutes ?? 30;
  if (!minutes) return false;
  let last = 0;
  try { last = Number(localStorage.getItem(ACTIVE_KEY) || 0); } catch { /* ignore */ }
  return last > 0 && Date.now() - last > minutes * 60000;
}
let lastMark = 0;
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => {
  if (Date.now() - lastMark > 15000) { lastMark = Date.now(); markActive(); }
}, { passive: true }));
setInterval(() => { if (state.me && idleTooLong()) lockApp('Locked after a period without use.'); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me && idleTooLong()) lockApp('Locked after a period without use.');
});

// Short vibration on Android (ignored where not supported).
export function buzz(pattern) { try { navigator.vibrate?.(pattern); } catch { /* ignore */ } }

// ---------- First-time setup (brand-new tablet) ----------
function renderSetup() {
  app.innerHTML = String(html`
    <div class="auth">
      <section class="auth-brand">
        ${art.sprig}
        <div class="brand-lockup">${brandLockup()}</div>
        <div class="auth-hero">
          <h1>Set up<br><em>this tablet.</em></h1>
          <p>Everything the team records is saved on this tablet. It works without internet, and a manager can download a backup at any time.</p>
          <ul class="auth-points">
            <li>Create the manager account</li>
            <li>The team (Duta, Nika, Luka, Miro, Dachi, Saba, Levani) is added for you</li>
            <li>Choose the code for deleting shifts</li>
          </ul>
        </div>
        <div class="auth-foot">${art.facade}<span><b>Hospitality since 1919.</b><br>You only do this once.</span></div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <div class="auth-mobile-brand brand-lockup">${brandLockup()}</div>
          <h2>Set up this tablet</h2>
          <p class="lede">This first account is the manager. The rest of the team is added for you automatically.</p>
          <div id="setup-error"></div>
          <form id="setup-form" novalidate autocomplete="off">
            <div class="name-row">
              <div class="field"><label for="s-fullName">Your full name</label><input class="input" id="s-fullName" name="fullName" required value="Manager"></div>
              <div class="field"><label for="s-nickname">Name on the login screen <span class="muted">(optional)</span></label><input class="input" id="s-nickname" name="nickname" maxlength="30"></div>
            </div>
            <div class="name-row">
              <div class="field"><label for="s-pin">Your 4-digit PIN</label><input class="input pin-input" id="s-pin" name="pin" type="password" inputmode="numeric" maxlength="4" required value="1707"><span class="hint">You’ll log in with this.</span></div>
              <div class="field"><label for="s-pin2">Repeat PIN</label><input class="input pin-input" id="s-pin2" type="password" inputmode="numeric" maxlength="4" required value="1707"></div>
            </div>
            <div class="field"><label for="s-brand">App name</label><input class="input" id="s-brand" name="brandName" maxlength="40" value="Breakfast Manager"><span class="hint">Shown at the top of every screen. You can change it later in Settings.</span></div>
            <div class="field"><label for="s-delete">Delete code</label><input class="input" id="s-delete" name="deleteCode" required minlength="4"><span class="hint">Needed to delete a shift. You can change it later in Settings.</span></div>
            <button class="btn btn-gold btn-lg btn-block" type="submit">Finish setup</button>
          </form>
          <div class="setup-restore">
            <p class="muted small">Moving from another tablet?</p>
            <label class="btn btn-outline btn-sm" style="cursor:pointer">Restore a backup file<input type="file" id="restore-file" accept=".json,application/json" class="sr-only"></label>
          </div>
        </div>
      </section>
    </div>`);

  const form = document.getElementById('setup-form');
  form.querySelector('input').focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const errBox = document.getElementById('setup-error');
    errBox.innerHTML = '';
    if (form.pin.value !== form.querySelector('#s-pin2').value) {
      errBox.innerHTML = String(html`<div class="form-error">The two PINs are different.</div>`);
      return;
    }
    setBusy(btn, true, 'Setting up…');
    try {
      await api('POST', '/api/setup', Object.fromEntries(new FormData(form)));
      state.needsSetup = false;
      await refreshBrand(); applyBrand();
      await refreshMe();
      markActive();
      toast('All set. Welcome to your breakfast app!', 'success');
      go('/home');
    } catch (err) {
      errBox.innerHTML = String(html`<div class="form-error">${err.message}</div>`);
      setBusy(btn, false);
    }
  });
  document.getElementById('restore-file').addEventListener('change', (e) => restoreFromFile(e.target.files[0]));
}

// Reads a backup file and replaces everything on this tablet with it.
export async function restoreFromFile(file) {
  if (!file) return;
  let backup;
  try { backup = JSON.parse(await file.text()); }
  catch { toast('That file is not a backup file.', 'error'); return; }
  try {
    const r = await api('POST', '/api/restore', { backup });
    toast(`Backup restored: ${r.users} account${r.users === 1 ? '' : 's'}, ${r.shifts} shift${r.shifts === 1 ? '' : 's'}. Please log in.`, 'success');
    state.me = null;
    state.needsSetup = r.users === 0;
    await refreshBrand(); applyBrand();
    go(state.needsSetup ? '/setup' : '/login');
  } catch (err) { toast(err.message, 'error'); }
}

export async function downloadBackup() {
  try {
    const { filename, backup } = await api('GET', '/api/backup');
    downloadFile(filename, JSON.stringify(backup), 'application/json');
    toast(`Backup saved to Downloads (${filename}). Keep a copy off this tablet.`, 'success');
    return true;
  } catch (err) { toast(err.message, 'error'); return false; }
}

// ---------- Home ----------
async function renderHome() {
  const el = view();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const draw = async () => {
    const [active, history] = await Promise.all([api('GET', '/api/shifts/active'), api('GET', '/api/shifts')]);
    const appSettings = state.me.role === 'manager' ? await api('GET', '/api/settings') : null;
    const daysSinceBackup = appSettings?.lastBackupAt ? Math.floor((Date.now() - new Date(appSettings.lastBackupAt)) / 86400000) : null;
    const needBackup = appSettings && history.shifts.length > 0 && (daysSinceBackup === null || daysSinceBackup >= 7);
    const s = active.shift ? active.stats : null;
    const last = history.shifts.slice(0, 4);
    el.innerHTML = String(html`
      <div class="page-head">
        <div>
          <div class="eyebrow">${today}</div>
          <h1>${greeting}, ${state.me.nickname}.</h1>
          <p>${active.shift ? 'A breakfast shift is in progress.' : 'Ready when you are. Start a shift once the guest list is in hand.'}</p>
        </div>
      </div>

      ${heritageStrip()}
      ${needBackup ? html`
        <div class="backup-banner">
          <div><b>${daysSinceBackup === null ? 'No backup yet' : `Last backup ${daysSinceBackup} days ago`}</b>
            <span>All shifts are stored only on this tablet. Download a backup and keep it somewhere safe, such as email or Google Drive.</span></div>
          <button class="btn btn-gold btn-sm" id="home-backup">Download backup</button>
        </div>` : ''}
      <div class="home-grid">
        ${active.shift ? html`
          <a class="action-card primary" href="#/shift">
            ${art.cup}
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center"><div class="icon">${icons.guests}</div><span class="live-pill">Live</span></div>
              <h2>Continue the <em>shift</em></h2>
              <p>Started at ${fmtTime(active.shift.startedAt)} by ${active.shift.startedByName}.</p>
              <div class="home-mini">
                <div><b>${s.checkedIn}/${s.expected}</b><span>Checked in</span></div>
                <div><b>${s.remaining}</b><span>Remaining</span></div>
                <div><b>${s.unknown}</b><span>Unknown</span></div>
              </div>
            </div>
            <span class="go">Open attendance ${icons.arrow}</span>
          </a>` : html`
          <a class="action-card primary" href="#/prepare">
            ${art.cup}
            <div>
              <div class="icon">${icons.plus}</div>
              <h2>Start a new <em>shift</em></h2>
              <p>Enter every expected breakfast guest — name, room and membership — then start the shift.</p>
            </div>
            <span class="go">Prepare guest list ${icons.arrow}</span>
          </a>`}
        <a class="action-card" href="#/history">
          <div>
            <div class="icon">${icons.history}</div>
            <h2>Previous <em>shifts</em></h2>
            <p>${history.shifts.length
              ? `${history.shifts.length} completed shift${history.shifts.length === 1 ? '' : 's'} on record, shared by the whole team.`
              : 'Completed shifts will appear here, organised by date.'}</p>
          </div>
          <span class="go">View history ${icons.arrow}</span>
        </a>
      </div>

      ${last.length ? html`
        <div class="card home-recent">
          <div class="card-head"><h2>Recent shifts</h2><a class="btn btn-ghost btn-sm" href="#/history">See all</a></div>
          ${last.map((sh) => html`
            <a class="shift-row" href="#/history/${sh.id}">
              <div><div class="times">${fmtDateShort(sh.shiftDate)}</div><div class="muted small">${fmtTime(sh.startedAt)} – ${fmtTime(sh.finishedAt)}</div></div>
              <div class="mini-stats">
                <span class="mini d">${sh.stats.diamond} Diamond</span><span class="mini g">${sh.stats.gold} Gold</span>
                <span class="mini m">${sh.stats.member} Member</span><span class="mini u">${sh.stats.unknown} Unknown</span>
              </div>
              <div class="arrival-ratio"><b>${sh.stats.checkedIn}/${sh.stats.expected}</b><div class="muted small">arrived</div></div>
              <span class="muted">${icons.arrow}</span>
            </a>`)}
        </div>` : ''}
    `);
  };

  await draw();
  el.addEventListener('click', async (e) => {
    if (e.target.closest('#home-backup') && (await downloadBackup())) draw();
  });
  const onLive = () => { if (document.body.contains(el)) draw(); };
  window.addEventListener('live', onLive);
  const stopHeritage = startHeritage(el);
  return () => { window.removeEventListener('live', onLive); stopHeritage(); };
}

// ---------- Start ----------
window.addEventListener('hashchange', render);
(async () => {
  try {
    state.needsSetup = (await api('GET', '/api/setup-status')).needsSetup;
  } catch (err) {
    app.innerHTML = String(html`<div class="boot"><div style="max-width:420px;text-align:center;padding:24px"><h2>The app could not open its storage</h2><p class="muted" style="margin-top:8px">${err.message}</p></div></div>`);
    return;
  }
  await refreshBrand();
  applyBrand();
  try { await refreshMe(); } catch { state.me = null; }
  if (state.me && idleTooLong()) { try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ } state.me = null; }
  if (state.me) markActive();
  render();
})();
