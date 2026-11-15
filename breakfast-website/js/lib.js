import { handle, ApiError } from './backend/api.js';
// Shared helpers for the browser side: safe HTML, API calls, dates, toasts and modals.

// ---------- Safe HTML ----------
// Everything inserted with html`...` is escaped, so a guest called "<script>" can't break the page.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < values.length ? part(values[i]) : ''); });
  return raw(out);
}

// ---------- API ----------
export async function api(method, path, body) {
  try {
    // Copy data in and out so the screens can never change saved records by accident.
    const result = await handle(method, path, body === undefined ? {} : JSON.parse(JSON.stringify(body)));
    return result === undefined ? {} : JSON.parse(JSON.stringify(result));
  } catch (e) {
    const err = new Error(e.message || 'Something went wrong.');
    err.status = e.status || 500;
    err.data = { error: err.message, ...(e.extra || {}) };
    if (!(e instanceof ApiError)) console.error(e);
    if (err.status === 401 && !path.startsWith('/api/auth')) window.dispatchEvent(new Event('auth-lost'));
    throw err;
  }
}

// Saves a file to the tablet's Downloads folder.
export function downloadFile(filename, content, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Runs an export (CSV) and saves it.
export async function downloadExport(path) {
  try {
    const { filename, csv } = await api('GET', path);
    downloadFile(filename, csv);
    toast(`Saved ${filename} to Downloads.`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// ---------- Dates ----------
export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
export function fmtDateLong(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
export function fmtDateShort(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
export function fmtDay(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------- Small UI pieces ----------
export const rankBadge = (rank) => html`<span class="badge ${rank}">${rank}</span>`;

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('');
}
export function avatar(user, cls = '') {
  return user.avatarUrl
    ? html`<span class="avatar ${cls}"><img src="${user.avatarUrl}" alt=""></span>`
    : html`<span class="avatar ${cls}">${initials(user.nickname)}</span>`;
}

export const icons = {
  plus: raw('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'),
  chart: raw('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>'),
  download: raw('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'),
  print: raw('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9V3h10v6M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></svg>'),
  history: raw('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>'),
  search: raw('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'),
  arrow: raw('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'),
  back: raw('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>'),
  guests: raw('<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>'),
  home: raw('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>'),
  cup: raw('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3"/></svg>'),
  gear: raw('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'),
  upload: raw('<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 14l3-3 3 3"/></svg>'),
  lock: raw('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'),
};

// ---------- Toasts ----------
export function toast(message, type = 'info') {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="t-icon">${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</span><span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 3600);
  setTimeout(() => el.remove(), 4000);
}

// ---------- Modals ----------
// openModal(htmlContent, onMount) -> close()
export function openModal(content, onMount) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${content}</div>`;
  const previousFocus = document.activeElement;
  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    previousFocus?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  root.appendChild(backdrop);
  const modal = backdrop.querySelector('.modal');
  onMount?.(modal, close);
  (modal.querySelector('[autofocus]') || modal.querySelector('button.btn-primary, button.btn-gold, button.btn-danger'))?.focus();
  return close;
}

// confirmDialog -> Promise<boolean>
export function confirmDialog({ title, text = '', body = '', confirmText = 'Confirm', cancelText = 'Cancel', variant = 'primary' }) {
  return new Promise((resolve) => {
    let answered = false;
    const close = openModal(String(html`
      <div class="modal-head"><h2>${title}</h2>${text ? html`<p>${text}</p>` : ''}</div>
      ${body ? html`<div class="modal-body">${raw(String(body))}</div>` : ''}
      <div class="modal-foot">
        <button class="btn btn-outline" data-act="cancel">${cancelText}</button>
        <button class="btn btn-${variant}" data-act="ok">${confirmText}</button>
      </div>`), (modal, closeFn) => {
      modal.querySelector('[data-act=cancel]').onclick = () => { answered = true; closeFn(); resolve(false); };
      modal.querySelector('[data-act=ok]').onclick = () => { answered = true; closeFn(); resolve(true); };
    });
    // If closed with Escape or backdrop click, treat as cancel.
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.modal-backdrop')) { observer.disconnect(); if (!answered) resolve(false); }
    });
    observer.observe(document.getElementById('modal-root'), { childList: true });
    void close;
  });
}

export function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) { button.dataset.label = button.innerHTML; button.disabled = true; if (label) button.textContent = label; }
  else { button.disabled = false; if (button.dataset.label) button.innerHTML = button.dataset.label; }
}

// Text matching that ignores case and accents ("Jose" finds "José").
export const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
