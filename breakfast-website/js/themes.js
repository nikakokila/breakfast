// The app's single design: "Resort" (sunrise hero, serif titles, floating white cards, teal accents).
// Kept as a small module so the look can be changed in one place later.
import { esc } from './lib.js';
import { play } from './sounds.js';

export const THEMES = { resort: { label: 'Resort', note: 'Sunrise hero, elegant serif, teal and sand' } };
export const themeIds = Object.keys(THEMES);
export const currentTheme = () => 'resort';

// Sets the design on the page. Every person gets the same look.
export function applyTheme() {
  document.documentElement.dataset.theme = 'resort';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = '#12262a';
}

// A rising sun over a calm horizon, used on the welcome screen.
const SUNRISE = `<svg viewBox="0 0 200 140" class="t-art sunrise" aria-hidden="true">
  <defs><radialGradient id="sun-g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff3d6"/><stop offset=".6" stop-color="#ffd59a"/><stop offset="1" stop-color="#f0a868"/></radialGradient>
    <clipPath id="sky"><rect x="0" y="0" width="200" height="96"/></clipPath>
    <radialGradient id="glow-g" cx="50%" cy="100%" r="60%"><stop offset="0" stop-color="#ffd59a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd59a" stop-opacity="0"/></radialGradient></defs>
  <ellipse cx="100" cy="96" rx="100" ry="60" fill="url(#glow-g)" clip-path="url(#sky)"/>
  <g class="rays" stroke="#ffe3b3" stroke-width="2" stroke-linecap="round" opacity=".7">${Array.from({ length: 9 }, (_, i) => {
    const a = Math.PI + (i / 8) * Math.PI;
    return `<path d="M${100 + Math.cos(a) * 46} ${96 + Math.sin(a) * 46} L${100 + Math.cos(a) * 62} ${96 + Math.sin(a) * 62}"/>`;
  }).join('')}</g>
  <g clip-path="url(#sky)"><circle class="sun" cx="100" cy="96" r="34" fill="url(#sun-g)"/></g>
  <path d="M10 96 H190" stroke="rgba(255,255,255,.7)" stroke-width="1.5" stroke-linecap="round"/>
  <path class="wave w1" d="M0 104 Q25 99 50 104 T100 104 T150 104 T200 104" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/>
  <path class="wave w2" d="M0 114 Q25 109 50 114 T100 114 T150 114 T200 114" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/>
  <path class="wave w3" d="M20 124 Q45 120 70 124 T120 124 T170 124" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.5"/>
</svg>`;

export function welcome(user) {
  applyTheme();
  play('resort', 'login');
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const el = document.createElement('div');
  el.className = 'welcome';
  el.innerHTML = `<div class="w-bg"></div><div class="w-art">${SUNRISE}</div>
    <p class="w-kicker">Welcome to the morning</p>
    <h1 class="w-title">${greeting}, <em>${esc(user.nickname)}</em></h1>
    <p class="w-sub">Breakfast service · Hilton</p><div class="w-bar"><i></i></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  return new Promise((resolve) => {
    const done = () => { el.classList.add('out'); setTimeout(() => el.remove(), 500); resolve(); };
    const t = setTimeout(done, 1900);
    el.addEventListener('click', () => { clearTimeout(t); done(); }, { once: true });
  });
}

// Check-in: a soft ring of light expands and a check draws itself.
export function celebrateArt() {
  return `<i class="cel-rip"></i><i class="cel-rip r2"></i><div class="cel-core"><svg width="58" height="58" viewBox="0 0 54 54"><path d="M14 28 L23 37 L41 18" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
}
export const celebrateWord = () => 'Checked in';
