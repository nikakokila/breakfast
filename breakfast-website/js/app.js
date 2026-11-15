// App entry: first-time setup, login gate, top navigation, page routing.
import { api, html, raw, avatar, icons, toast, fmtDateShort, fmtTime, setBusy, downloadFile } from './lib.js';
import { renderPrepare, renderActiveShift } from './shift.js';
import { renderHistory, renderShiftDetail } from './history.js';
import { renderSettings } from './settings.js';
import { renderAnalytics } from './analytics.js';

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
  { path: /^\/register$/, view: (p) => renderAuth('register'), public: true },
  { path: /^\/home$/, view: renderHome, nav: 'home' },
  { path: /^\/prepare$/, view: renderPrepare, nav: 'shift' },
  { path: /^\/shift$/, view: renderActiveShift, nav: 'shift' },
  { path: /^\/history$/, view: renderHistory, nav: 'history' },
  { path: /^\/history\/(\d+)$/, view: (m) => renderShiftDetail(m[1]), nav: 'history' },
  { path: /^\/analytics(?:\/(\d{4}-\d{2}))?$/, view: renderAnalytics, nav: 'analytics' },
  { path: /^\/settings$/, view: renderSettings, nav: 'settings' },
];

export function go(path) {
  if (location.hash === '#' + path) render();
  else location.hash = path;
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

export async function refreshMe() {
  const data = await api('GET', '/api/me');
  state.me = data.user;
  state.activeShiftId = data.activeShiftId ?? null;
  return data;
}

export async function refreshBrand() {
  try { state.brand = await api('GET', '/api/branding'); } catch { /* keep defaults */ }
  document.title = state.brand.name;
}

window.addEventListener('auth-lost', () => {
  state.me = null;
  toast('Your session ended. Please log in again.', 'error');
  go('/login');
});

// ---------- Login / Create account ----------
function renderAuth(mode) {
  const isLogin = mode === 'login';
  app.innerHTML = String(html`
    <div class="auth">
      <section class="auth-brand">
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
        <div class="auth-foot">For authorised hotel staff only.</div>
      </section>

      <section class="auth-panel">
        <div class="auth-card">
          <div class="auth-mobile-brand brand-lockup">${brandLockup()}</div>
          <div class="tabs" role="tablist">
            <a class="tab ${isLogin ? 'active' : ''}" href="#/login" role="tab" style="display:grid;place-items:center;text-decoration:none">Log In</a>
            <a class="tab ${!isLogin ? 'active' : ''}" href="#/register" role="tab" style="display:grid;place-items:center;text-decoration:none">Create Account</a>
          </div>
          <h2>${isLogin ? 'Welcome back' : 'Create your account'}</h2>
          <p class="lede">${isLogin ? 'Log in to manage this morning’s breakfast service.' : 'Each employee has their own account. You’ll need the employee access code from your manager.'}</p>
          <div id="auth-error"></div>
          <form id="auth-form" novalidate>
            ${!isLogin ? html`
              <div class="field"><label for="fullName">Full name</label><input class="input" id="fullName" name="fullName" autocomplete="name" required></div>
              <div class="field"><label for="nickname">Nickname <span class="muted">(shown in the app — optional)</span></label><input class="input" id="nickname" name="nickname" maxlength="30"></div>` : ''}
            <div class="field"><label for="email">Work email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
            <div class="field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required minlength="8">
              ${!isLogin ? html`<span class="hint">At least 8 characters.</span>` : ''}</div>
            ${!isLogin ? html`
              <div class="field"><label for="accessCode">Employee access code</label><input class="input" id="accessCode" name="accessCode" autocomplete="off" required>
                <span class="hint">Stops people outside the team from creating accounts.</span></div>` : ''}
            <button class="btn btn-primary btn-lg btn-block" type="submit">${isLogin ? 'Log In' : 'Create Account'}</button>
          </form>
          <p class="muted small" style="margin-top:18px;text-align:center">
            ${isLogin ? html`New employee? <a href="#/register">Create an account</a>` : html`Already have an account? <a href="#/login">Log in</a>`}
          </p>
        </div>
      </section>
    </div>
  `);

  const form = document.getElementById('auth-form');
  form.querySelector('input').focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button[type=submit]');
    const errBox = document.getElementById('auth-error');
    errBox.innerHTML = '';
    setBusy(btn, true, isLogin ? 'Logging in…' : 'Creating account…');
    try {
      await api('POST', isLogin ? '/api/auth/login' : '/api/auth/register', data);
      await refreshMe();
      toast(isLogin ? `Welcome back, ${state.me.nickname}.` : `Welcome, ${state.me.nickname}! Your account is ready.`, 'success');
      go('/home');
    } catch (err) {
      errBox.innerHTML = String(html`<div class="form-error">${err.message}</div>`);
      setBusy(btn, false);
    }
  });
}

// ---------- First-time setup (brand-new tablet) ----------
function renderSetup() {
  app.innerHTML = String(html`
    <div class="auth">
      <section class="auth-brand">
        <div class="brand-lockup">${brandLockup()}</div>
        <div class="auth-hero">
          <h1>Set up<br><em>this tablet.</em></h1>
          <p>Everything the team records is saved on this tablet. It works without internet, and a manager can download a backup at any time.</p>
          <ul class="auth-points">
            <li>Create the manager account</li>
            <li>Choose the employee access code</li>
            <li>Choose the code for deleting shifts</li>
          </ul>
        </div>
        <div class="auth-foot">You only do this once.</div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <div class="auth-mobile-brand brand-lockup">${brandLockup()}</div>
          <h2>Set up this tablet</h2>
          <p class="lede">This first account becomes the manager. Employees create their own accounts later with the access code.</p>
          <div id="setup-error"></div>
          <form id="setup-form" novalidate autocomplete="off">
            <div class="name-row">
              <div class="field"><label for="s-fullName">Your full name</label><input class="input" id="s-fullName" name="fullName" required></div>
              <div class="field"><label for="s-nickname">Nickname <span class="muted">(optional)</span></label><input class="input" id="s-nickname" name="nickname" maxlength="30"></div>
            </div>
            <div class="field"><label for="s-email">Work email</label><input class="input" id="s-email" name="email" type="email" required></div>
            <div class="field"><label for="s-password">Password</label><input class="input" id="s-password" name="password" type="password" autocomplete="new-password" required minlength="8"><span class="hint">At least 8 characters.</span></div>
            <div class="field"><label for="s-brand">App name</label><input class="input" id="s-brand" name="brandName" maxlength="40" value="Breakfast Manager"><span class="hint">Shown at the top of every screen. You can change it later in Settings.</span></div>
            <div class="name-row">
              <div class="field"><label for="s-access">Employee access code</label><input class="input" id="s-access" name="accessCode" required minlength="4"><span class="hint">Needed to create an account.</span></div>
              <div class="field"><label for="s-delete">Delete code</label><input class="input" id="s-delete" name="deleteCode" required minlength="4"><span class="hint">Needed to delete a shift.</span></div>
            </div>
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
    setBusy(btn, true, 'Setting up…');
    try {
      await api('POST', '/api/setup', Object.fromEntries(new FormData(form)));
      state.needsSetup = false;
      await refreshBrand(); applyBrand();
      await refreshMe();
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

      ${needBackup ? html`
        <div class="backup-banner">
          <div><b>${daysSinceBackup === null ? 'No backup yet' : `Last backup ${daysSinceBackup} days ago`}</b>
            <span>All shifts are stored only on this tablet. Download a backup and keep it somewhere safe, such as email or Google Drive.</span></div>
          <button class="btn btn-gold btn-sm" id="home-backup">Download backup</button>
        </div>` : ''}
      <div class="home-grid">
        ${active.shift ? html`
          <a class="action-card primary" href="#/shift">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center"><div class="icon">${icons.guests}</div><span class="live-pill">Live</span></div>
              <h2>CONTINUE ACTIVE SHIFT</h2>
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
            <div>
              <div class="icon">${icons.plus}</div>
              <h2>START NEW SHIFT</h2>
              <p>Enter every expected breakfast guest — name, room and membership — then start the shift.</p>
            </div>
            <span class="go">Prepare guest list ${icons.arrow}</span>
          </a>`}
        <a class="action-card" href="#/history">
          <div>
            <div class="icon">${icons.history}</div>
            <h2>PREVIOUS SHIFTS</h2>
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
  return () => window.removeEventListener('live', onLive);
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
  render();
})();
