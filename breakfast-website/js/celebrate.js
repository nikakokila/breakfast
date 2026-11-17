// Check-in celebration, heritage facts and line illustrations for the Hilton heritage look.
import { html, raw } from './lib.js';
import { currentTheme, celebrateArt, celebrateWord } from './themes.js';
import { play } from './sounds.js';

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Full-screen "pop" after a check-in, in the logged-in person's theme. It never blocks taps.
export function celebrate({ name, room, rank }) {
  const theme = currentTheme();
  play(theme, 'checkin');
  if (reduceMotion()) return;
  document.querySelector('.celebrate')?.remove();
  const el = document.createElement('div');
  el.className = `celebrate c-${theme}${rank === 'DIAMOND' ? ' is-diamond' : ''}`;
  el.setAttribute('aria-hidden', 'true');
  const tier = rank === 'UNKNOWN' ? 'Unknown guest' : rank ? rank.charAt(0) + rank.slice(1).toLowerCase() : '';
  el.innerHTML = String(html`
    <div class="cel-disc">${raw(celebrateArt(theme))}<div class="cel-sparks"></div></div>
    <div class="cel-word">${celebrateWord(theme)}</div>
    <div class="cel-name">${name || 'Guest'}</div>
    <div class="cel-sub">${room ? `Room ${room}` : 'No room'}${tier ? `  ·  ${tier}` : ''}</div>`);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  if (rank === 'DIAMOND') {
    const box = el.querySelector('.cel-sparks');
    for (let i = 0; i < 22; i++) {
      const s = document.createElement('i');
      box.appendChild(s);
      const a = (i / 22) * Math.PI * 2;
      const r = 100 + Math.random() * 50;
      s.animate([
        { transform: 'translate(0,0) rotate(45deg) scale(1)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * r}px,${Math.sin(a) * r}px) rotate(225deg) scale(.3)`, opacity: 0 },
      ], { duration: 850, delay: 300, easing: 'cubic-bezier(.1,.8,.3,1)', fill: 'both' });
    }
  }
  const remove = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 280); };
  setTimeout(remove, 1500);
}

// Facts checked against Hilton's own history page (stories.hilton.com/history).
export const HERITAGE = [
  ['1919', 'Conrad Hilton bought his first hotel, the Mobley, in Cisco, Texas.'],
  ['1893', 'The first American brownie was baked in the kitchen of today’s Palmer House Hilton.'],
  ['1925', 'The first hotel to carry the Hilton name opened in Dallas.'],
  ['1947', 'The Roosevelt Hilton became the first hotel with televisions in guest rooms.'],
  ['1949', 'Hilton International was born with the opening of the Caribe Hilton in Puerto Rico.'],
  ['1949', 'Conrad Hilton bought the original Waldorf Astoria in New York.'],
  ['1954', 'The piña colada was created at the bar of the Caribe Hilton.'],
];

export const art = {
  facade: raw(`<svg class="art-facade" width="74" height="64" viewBox="0 0 64 56" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.3"><path d="M6 54 H58"/><rect x="12" y="16" width="40" height="38"/><path d="M12 16 L32 6 L52 16"/><path d="M32 6 V1"/><path d="M32 1 L39 3 L32 5" class="gold-fill"/><rect x="17" y="21" width="6" height="6"/><rect x="29" y="21" width="6" height="6"/><rect x="41" y="21" width="6" height="6"/><rect x="17" y="32" width="6" height="6"/><rect x="29" y="32" width="6" height="6"/><rect x="41" y="32" width="6" height="6"/><path d="M27 54 V45 H37 V54"/><path d="M24 45 Q32 40 40 45" class="gold-line"/></g></svg>`),
  sprig: raw(`<svg class="art-sprig" width="190" height="124" viewBox="0 0 170 110" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.2"><path d="M10 105 C40 70 70 50 120 20"/><ellipse cx="38" cy="78" rx="11" ry="4.5" transform="rotate(-50 38 78)"/><ellipse cx="54" cy="70" rx="11" ry="4.5" transform="rotate(30 54 70)"/><ellipse cx="66" cy="56" rx="12" ry="5" transform="rotate(-45 66 56)"/><ellipse cx="84" cy="50" rx="12" ry="5" transform="rotate(25 84 50)"/><ellipse cx="96" cy="36" rx="11" ry="4.5" transform="rotate(-40 96 36)"/><circle cx="122" cy="19" r="4"/></g></svg>`),
  cup: raw(`<svg class="art-cup" width="120" height="110" viewBox="0 0 120 110" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M22 50 H86 V66 A28 28 0 0 1 58 94 H50 A28 28 0 0 1 22 66 Z"/><path d="M86 56 H94 A11 11 0 0 1 94 78 H82"/><path d="M10 100 H100"/><path d="M42 40 C36 32 48 26 42 16"/><path d="M56 40 C50 32 62 26 56 16"/><path d="M70 40 C64 32 76 26 70 16"/></g></svg>`),
};

export function heritageStrip() {
  const [year, text] = HERITAGE[0];
  return html`
    <div class="heritage" aria-live="off">
      ${art.facade}
      <div class="heritage-text"><div class="heritage-year" data-h-year>Since ${year}</div><div class="heritage-fact" data-h-fact>${text}</div></div>
    </div>`;
}

// Rotates the fact every few seconds; returns a function that stops it.
export function startHeritage(root) {
  let i = 0;
  const t = setInterval(() => {
    const fact = root.querySelector('[data-h-fact]');
    const year = root.querySelector('[data-h-year]');
    if (!fact || !year) return;
    fact.classList.add('out');
    setTimeout(() => {
      i = (i + 1) % HERITAGE.length;
      year.textContent = i === 0 ? `Since ${HERITAGE[0][0]}` : HERITAGE[i][0];
      fact.textContent = HERITAGE[i][1];
      fact.classList.remove('out');
    }, 450);
  }, 6500);
  return () => clearInterval(t);
}
