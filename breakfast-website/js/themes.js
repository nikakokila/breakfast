// Personal themes: each employee gets their own look, artwork, welcome screen,
// check-in animation and sounds. All artwork here is original (no logos or characters).
import { esc } from './lib.js';
import { play } from './sounds.js';

export const THEMES = {
  hilton:   { label: 'Hilton heritage', note: 'Navy, paper and gold' },
  darkroom: { label: 'Darkroom', note: 'Photography: film, lenses, light leaks' },
  cocoa:    { label: 'Hot cocoa', note: 'Chocolate, steam and marshmallows' },
  tactical: { label: 'Drop zone', note: 'Battle-royale tactical HUD' },
  idol:     { label: 'Teal idol stage', note: 'Synth-pop concert in teal and pink' },
  prog:     { label: 'Sacred geometry', note: 'Prog metal: odd meters and geometry' },
  brother:  { label: 'Brotherhood', note: 'Crest, stitches and loyalty' },
  goat:     { label: 'GOAT', note: 'Serious black and white' },
};
export const themeIds = Object.keys(THEMES);
const valid = (t) => (THEMES[t] ? t : 'hilton');

let current = 'hilton';
export const currentTheme = () => current;

// ---------------------------------------------------------------- artwork
const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');

const SVG = {
  facade: `<svg viewBox="0 0 64 56" class="t-art"><g fill="none" stroke="currentColor" stroke-width="1.3"><path d="M6 54 H58"/><rect x="12" y="16" width="40" height="38"/><path d="M12 16 L32 6 L52 16"/><path d="M32 6 V1"/><path d="M32 1 L39 3 L32 5" fill="currentColor"/><rect x="17" y="21" width="6" height="6"/><rect x="29" y="21" width="6" height="6"/><rect x="41" y="21" width="6" height="6"/><rect x="17" y="32" width="6" height="6"/><rect x="29" y="32" width="6" height="6"/><rect x="41" y="32" width="6" height="6"/><path d="M27 54 V45 H37 V54"/></g></svg>`,
  // six-blade lens iris; blades rotate to open/close
  iris: `<svg viewBox="-60 -60 120 120" class="t-art iris"><circle r="56" fill="#0d0c0a" stroke="currentColor" stroke-width="3"/><circle r="50" fill="none" stroke="currentColor" stroke-opacity=".35"/>${rep(6, (i) => `<path class="blade" style="--i:${i}" transform="rotate(${i * 60})" d="M0 -50 A50 50 0 0 1 43.3 -25 L8 -6 Z" fill="#2b2824" stroke="#000" stroke-width="1"/>`)}<circle r="4" fill="currentColor" class="pin"/></svg>`,
  mug: `<svg viewBox="0 0 140 130" class="t-art mug"><defs><clipPath id="mugc"><path d="M24 40 H104 V80 A36 36 0 0 1 68 116 H60 A36 36 0 0 1 24 80 Z"/></clipPath></defs><g class="steam" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".7"><path d="M46 32 C38 22 54 16 46 4"/><path d="M64 32 C56 22 72 16 64 4"/><path d="M82 32 C74 22 90 16 82 4"/></g><g clip-path="url(#mugc)"><rect class="cocoa-fill" x="20" y="40" width="90" height="80" fill="#5a2e1a"/><path class="cocoa-wave" d="M10 50 Q30 44 50 50 T90 50 T130 50 V60 H10Z" fill="#7a4126"/><rect class="mallow m1" x="40" y="44" width="16" height="13" rx="5" fill="#fff7f2"/><rect class="mallow m2" x="66" y="40" width="16" height="13" rx="5" fill="#ffe1dc"/></g><path d="M24 40 H104 V80 A36 36 0 0 1 68 116 H60 A36 36 0 0 1 24 80 Z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M104 52 H114 A14 14 0 0 1 114 80 H102" fill="none" stroke="currentColor" stroke-width="4"/><path d="M12 124 H126" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
  chute: `<svg viewBox="0 0 120 160" class="t-art chute"><path d="M10 52 Q60 -14 110 52 Q96 42 85 52 Q72 40 60 52 Q48 40 35 52 Q24 42 10 52Z" fill="#f28c28" stroke="#1a1d14" stroke-width="2.5"/><path d="M60 52 V8" stroke="#1a1d14" stroke-width="1.5" opacity=".5"/><g stroke="#1a1d14" stroke-width="1.5"><path d="M10 52 L44 104"/><path d="M35 52 L50 104"/><path d="M85 52 L70 104"/><path d="M110 52 L76 104"/></g><g class="crate"><rect x="40" y="102" width="40" height="36" fill="#7a5a32" stroke="#1a1d14" stroke-width="2.5"/><path d="M40 102 L80 138 M80 102 L40 138" stroke="#1a1d14" stroke-width="2"/><rect x="40" y="114" width="40" height="8" fill="#f28c28" stroke="#1a1d14" stroke-width="1.5"/></g></svg>`,
  penlights: `<div class="penlights">${rep(11, (i) => `<i style="--i:${i}"></i>`)}</div>`,
  mandala: `<svg viewBox="-100 -100 200 200" class="t-art mandala"><g fill="none" stroke="currentColor" stroke-width="1.2"><g class="ring r1">${rep(7, (i) => `<circle r="28" cx="${(28 * Math.cos((i * 2 * Math.PI) / 7)).toFixed(2)}" cy="${(28 * Math.sin((i * 2 * Math.PI) / 7)).toFixed(2)}"/>`)}</g><g class="ring r2"><polygon points="${rep(7, (i) => `${(80 * Math.cos((i * 4 * Math.PI) / 7 - Math.PI / 2)).toFixed(2)},${(80 * Math.sin((i * 4 * Math.PI) / 7 - Math.PI / 2)).toFixed(2)} `)}"/></g><g class="ring r3"><polygon points="${rep(5, (i) => `${(62 * Math.cos((i * 2 * Math.PI) / 5 - Math.PI / 2)).toFixed(2)},${(62 * Math.sin((i * 2 * Math.PI) / 5 - Math.PI / 2)).toFixed(2)} `)}"/><polygon points="${rep(3, (i) => `${(92 * Math.cos((i * 2 * Math.PI) / 3 + Math.PI / 2)).toFixed(2)},${(92 * Math.sin((i * 2 * Math.PI) / 3 + Math.PI / 2)).toFixed(2)} `)}"/></g><circle r="92"/><circle r="56" stroke-dasharray="2 5"/><circle r="9" fill="currentColor"/></g></svg>`,
  crest: `<svg viewBox="0 0 160 180" class="t-art crest"><path d="M80 6 L148 26 V82 C148 128 116 158 80 174 C44 158 12 128 12 82 V26 Z" fill="#1f3b2d" stroke="#c9a227" stroke-width="5"/><path d="M80 18 L136 34 V82 C136 120 110 146 80 160 C50 146 24 120 24 82 V34 Z" fill="none" stroke="#c9a227" stroke-width="1.5" stroke-dasharray="5 4"/><g fill="none" stroke-width="9"><circle class="ring-l" cx="64" cy="86" r="24" stroke="#f3e9d2"/><circle class="ring-r" cx="96" cy="86" r="24" stroke="#c9a227"/></g><path d="M40 86 Q30 60 42 40 M120 86 Q130 60 118 40" stroke="#c9a227" stroke-width="3" fill="none"/><g fill="#c9a227">${rep(5, (i) => `<ellipse cx="${36 - i * 1.5}" cy="${78 - i * 9}" rx="6" ry="3" transform="rotate(-40 ${36 - i * 1.5} ${78 - i * 9})"/><ellipse cx="${124 + i * 1.5}" cy="${78 - i * 9}" rx="6" ry="3" transform="rotate(40 ${124 + i * 1.5} ${78 - i * 9})"/>`)}</g><path d="M30 128 H130 L122 140 L130 152 H30 L38 140 Z" fill="#7a4a2a" stroke="#c9a227" stroke-width="2"/><text x="80" y="145" text-anchor="middle" font-family="Graduate, serif" font-size="13" fill="#f3e9d2" letter-spacing="2">BROTHERS</text></svg>`,
  goat: `<svg viewBox="0 0 120 120" class="t-art goathead"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"><path d="M44 40 C30 30 22 14 34 6 C40 18 48 26 54 34"/><path d="M76 40 C90 30 98 14 86 6 C80 18 72 26 66 34"/><path d="M40 44 L28 52 L42 58"/><path d="M80 44 L92 52 L78 58"/><path d="M42 40 H78 L72 86 L60 100 L48 86 Z"/><path d="M52 100 L60 116 L68 100"/></g><circle cx="52" cy="60" r="3.5" fill="currentColor"/><circle cx="68" cy="60" r="3.5" fill="currentColor"/></svg>`,
  rings: `<svg viewBox="0 0 200 120" class="t-art bro-rings"><g fill="none" stroke-width="14"><circle class="ring-l" cx="72" cy="60" r="40" stroke="#f3e9d2"/><circle class="ring-r" cx="128" cy="60" r="40" stroke="#c9a227"/></g></svg>`,
};


// Instruments and gear (original line drawings, used as background decoration)
const GEAR = {
  guitar: `<svg viewBox="0 0 120 380" class="t-art"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M50 18 L70 18 L74 4 L46 4 Z"/>${[0, 1, 2].map((i) => `<circle cx="42" cy="${10 + i * 4}" r="2"/><circle cx="78" cy="${10 + i * 4}" r="2"/>`).join('')}<path d="M52 18 V196 M68 18 V196"/>${[40, 62, 82, 100, 116, 130, 143, 155, 166, 176, 186].map((y) => `<path d="M52 ${y} H68"/>`).join('')}<path d="M52 196 C30 180 6 196 12 236 C16 262 4 272 8 304 C14 352 106 352 112 304 C116 272 104 262 108 236 C114 196 90 180 68 196"/><path d="M40 196 C38 184 30 180 26 188"/><rect x="44" y="236" width="32" height="12" rx="3"/><rect x="44" y="266" width="32" height="12" rx="3"/><path d="M42 304 H78"/><path d="M55 18 V304 M58.5 18 V304 M61.5 18 V304 M65 18 V304" stroke-width="0.8"/><circle cx="96" cy="300" r="5"/><circle cx="90" cy="318" r="5"/></g></svg>`,
  bass: `<svg viewBox="0 0 110 420" class="t-art"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M48 4 H62 L66 40 H44 Z"/><circle cx="38" cy="14" r="3"/><circle cx="38" cy="30" r="3"/><circle cx="72" cy="14" r="3"/><circle cx="72" cy="30" r="3"/><path d="M50 40 V236 M60 40 V236"/>${[70, 100, 126, 150, 172, 192, 210, 226].map((y) => `<path d="M50 ${y} H60"/>`).join('')}<path d="M50 236 C24 220 2 240 10 280 C14 300 2 312 8 344 C16 396 94 396 102 344 C108 312 96 300 100 280 C108 240 86 220 60 236"/><rect x="40" y="290" width="30" height="14" rx="4"/><path d="M53 40 V346 M57 40 V346" stroke-width="0.8"/><path d="M38 346 H72"/></g></svg>`,
  drums: `<svg viewBox="0 0 320 220" class="t-art"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="160" cy="150" r="56"/><circle cx="160" cy="150" r="44" stroke-width="1"/><ellipse cx="118" cy="78" rx="30" ry="12"/><path d="M88 78 V104 C88 116 148 116 148 104 V78"/><ellipse cx="202" cy="78" rx="30" ry="12"/><path d="M172 78 V104 C172 116 232 116 232 104 V78"/><ellipse cx="270" cy="150" rx="34" ry="13"/><path d="M236 150 V184 C236 198 304 198 304 184 V150"/><ellipse cx="54" cy="150" rx="30" ry="11"/><path d="M24 150 V176 C24 188 84 188 84 176 V150"/><ellipse cx="40" cy="40" rx="40" ry="8"/><path d="M40 48 V214"/><ellipse cx="282" cy="36" rx="38" ry="7"/><path d="M282 43 V214"/><ellipse cx="54" cy="112" rx="28" ry="5"/><path d="M110 206 L90 216 M210 206 L230 216"/></g></svg>`,
  amp: `<svg viewBox="0 0 200 260" class="t-art"><g fill="none" stroke="currentColor" stroke-width="2.4"><rect x="10" y="6" width="180" height="56" rx="6"/>${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${40 + i * 24}" cy="40" r="6"/>`).join('')}<path d="M24 20 H120" stroke-width="1.5"/><rect x="10" y="70" width="180" height="184" rx="6"/><rect x="22" y="82" width="156" height="160" rx="4" stroke-width="1"/>${[0, 1].map((r) => [0, 1].map((c) => `<circle cx="${62 + c * 76}" cy="${122 + r * 80}" r="32"/><circle cx="${62 + c * 76}" cy="${122 + r * 80}" r="10"/>`).join('')).join('')}</g></svg>`,
  mic: `<svg viewBox="0 0 120 360" class="t-art"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="38" y="6" width="44" height="64" rx="22"/><path d="M38 30 H82 M38 46 H82 M52 8 V68 M68 8 V68" stroke-width="1"/><path d="M44 70 L50 150 H70 L76 70"/><path d="M60 150 V330"/><path d="M60 330 L20 356 M60 330 L100 356 M60 330 V356"/><path d="M60 196 C30 210 30 240 60 250" stroke-width="1.4" stroke-dasharray="3 4"/></g></svg>`,
  headphones: `<svg viewBox="0 0 200 180" class="t-art"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M30 120 V96 A70 70 0 0 1 170 96 V120"/><path d="M40 96 A60 60 0 0 1 160 96" stroke-width="1.2"/><rect x="14" y="104" width="38" height="66" rx="16"/><rect x="148" y="104" width="38" height="66" rx="16"/><path d="M24 120 V154 M176 120 V154" stroke-width="1.2"/></g></svg>`,
  speaker: `<svg viewBox="0 0 120 220" class="t-art"><g fill="none" stroke="currentColor" stroke-width="2.4"><rect x="6" y="6" width="108" height="208" rx="10"/><circle cx="60" cy="54" r="22"/><circle cx="60" cy="54" r="7"/><circle class="cone" cx="60" cy="146" r="44"/><circle cx="60" cy="146" r="16"/></g></svg>`,
  synth: `<svg viewBox="0 0 420 120" class="t-art"><g fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="4" width="412" height="112" rx="8"/><path d="M4 44 H416"/>${Array.from({ length: 8 }, (_, i) => `<circle cx="${28 + i * 22}" cy="24" r="6"/>`).join('')}<rect x="220" y="14" width="80" height="20" rx="3"/>${Array.from({ length: 5 }, (_, i) => `<path d="M${320 + i * 18} 14 V36"/>`).join('')}${Array.from({ length: 21 }, (_, i) => `<path d="M${14 + i * 19} 44 V116"/>`).join('')}${[0, 1, 3, 4, 5, 7, 8, 10, 11, 12, 14, 15, 17, 18, 19].map((i) => `<rect x="${26 + i * 19}" y="44" width="10" height="42" fill="currentColor" stroke="none"/>`).join('')}</g></svg>`,
  helmet: `<svg viewBox="0 0 200 170" class="t-art"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"><path d="M20 120 C14 50 60 12 100 12 C140 12 186 50 180 120 Z"/><path d="M20 120 H180 L172 140 H28 Z"/><path d="M40 64 C60 50 140 50 160 64" stroke-width="1.4"/><rect x="88" y="26" width="24" height="16" rx="3"/><path d="M28 140 C40 162 60 166 70 150 M172 140 C160 162 140 166 130 150"/>${[0, 1, 2, 3, 4].map((i) => `<path d="M${54 + i * 23} 92 l6 6" stroke-width="1.2"/>`).join('')}</g></svg>`,
  backpack: `<svg viewBox="0 0 170 220" class="t-art"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"><path d="M44 30 C44 12 126 12 126 30"/><rect x="22" y="30" width="126" height="176" rx="26"/><rect x="40" y="118" width="90" height="66" rx="12"/><path d="M40 140 H130"/><rect x="40" y="52" width="90" height="46" rx="10"/><path d="M85 52 V98" stroke-width="1.2"/><path d="M22 70 H6 V170 H22 M148 70 H164 V170 H148" stroke-width="1.8"/>${[0, 1, 2, 3].map((i) => `<path d="M${52 + i * 22} 192 v10" stroke-width="1.4"/>`).join('')}</g></svg>`,
  grenade: `<svg viewBox="0 0 120 170" class="t-art"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"><ellipse cx="60" cy="106" rx="42" ry="56"/><path d="M24 80 H96 M18 106 H102 M24 132 H96 M46 52 V160 M74 52 V160" stroke-width="1.2"/><rect x="44" y="34" width="32" height="18" rx="3"/><path d="M76 38 C100 30 106 54 92 74"/><circle cx="36" cy="26" r="10"/><path d="M44 34 L40 30"/></g></svg>`,
  crate: `<svg viewBox="0 0 200 170" class="t-art"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"><path d="M20 50 L100 20 L180 50 L100 80 Z"/><path d="M20 50 V130 L100 162 V80 M180 50 V130 L100 162"/><path d="M20 90 L100 122 L180 90" stroke-width="1.4"/><path d="M60 35 L140 65 M60 66 V146" stroke-width="1.4"/></g></svg>`,
  sight: `<svg viewBox="0 0 200 200" class="t-art"><g fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="100" cy="100" r="80"/><circle cx="100" cy="100" r="60" stroke-width="1"/><path d="M100 4 V60 M100 140 V196 M4 100 H60 M140 100 H196"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M100 20 V28" transform="rotate(${i * 45} 100 100)" stroke-width="1.2"/>`).join('')}<circle cx="100" cy="100" r="3" fill="currentColor"/></g></svg>`,
};
const gear = (name, cls) => `<div class="fx-gear ${cls}">${GEAR[name]}</div>`;

const strip = (cls) => `<div class="fx-strip ${cls}">${rep(14, () => '<i></i>')}</div>`;

// Decorative layer shown behind the app for each theme (pointer-events: none).
const FX = {
  hilton: () => '',
  darkroom: () => `
    <i class="fx-leak l1"></i><i class="fx-leak l2"></i><i class="fx-leak l3"></i>
    ${strip('left')}${strip('right')}
    <div class="fx-polaroid p1"><i></i><span>golden hour</span></div>
    <div class="fx-polaroid p2"><i></i><span>lobby, 7:02</span></div>
    <div class="fx-polaroid p3"><i></i><span>first light</span></div>
    <div class="fx-vf"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><i class="cross"></i><i class="grid"></i></div>
    <div class="fx-hud"><b class="af">● AF-S</b><span>ISO 400</span><span>f/2.8</span><span>1/125</span><span>+0.3 EV</span><span>WB ☀</span><span class="exp">36 EXP</span></div>
    <div class="fx-bars">${rep(8, (i) => `<i style="--i:${i}"></i>`)}</div>
    <div class="fx-grain"></div>`,
  cocoa: () => `
    <div class="fx-dust"></div>
    <svg class="fx-drip" viewBox="0 0 1200 40" preserveAspectRatio="none"><path d="M0 0 H1200 V12 C1180 12 1176 30 1164 30 C1152 30 1150 12 1130 12 C1090 12 1088 22 1076 22 C1064 22 1062 12 1030 12 C990 12 986 36 972 36 C958 36 956 12 930 12 C880 12 878 20 866 20 C854 20 852 12 820 12 C770 12 768 32 754 32 C740 32 738 12 700 12 C650 12 648 24 636 24 C624 24 622 12 590 12 C540 12 536 34 522 34 C508 34 506 12 470 12 C420 12 418 20 406 20 C394 20 392 12 360 12 C310 12 306 30 292 30 C278 30 276 12 240 12 C190 12 188 22 176 22 C164 22 162 12 130 12 C80 12 76 34 62 34 C48 34 46 12 0 12 Z"/></svg>
    ${rep(7, (i) => `<i class="fx-mallow" style="--i:${i};--y:${18 + ((i * 37) % 60)}%;--d:${6 + i * 0.7}s"></i>`)}
    ${rep(4, (i) => `<svg class="fx-steam" style="--i:${i}" viewBox="0 0 40 160"><path d="M20 158 C4 130 36 110 20 80 C4 50 36 30 20 2" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>`)}
    <div class="fx-sign">Luka’s cocoa bar · always warm</div>`,
  tactical: () => `
    <div class="fx-map"></div>
    <div class="fx-coords top">${'ABCDEFGHIJKL'.split('').map((c) => `<b>${c}</b>`).join('')}</div>
    <div class="fx-coords side">${rep(8, (i) => `<b>${i + 1}</b>`)}</div>
    <div class="fx-zone"></div><div class="fx-zone safe"></div>
    <div class="fx-flight"><svg viewBox="0 0 40 40"><path d="M20 2 L24 16 L38 22 L38 26 L24 23 L23 34 L28 38 L12 38 L17 34 L16 23 L2 26 L2 22 L16 16 Z" fill="currentColor"/></svg></div>
    <div class="fx-compass"><div class="track">${rep(3, () => ['N', '15', '30', 'NE', '60', '75', 'E', '105', '120', 'SE', '150', '165', 'S', '195', '210', 'SW', '240', '255', 'W', '285', '300', 'NW', '330', '345'].map((d) => `<b>${d}</b>`).join(''))}</div><i class="needle"></i></div>
    ${gear('helmet', 'g-helmet')}${gear('backpack', 'g-backpack')}${gear('crate', 'g-crate')}${gear('grenade', 'g-grenade')}${gear('sight', 'g-sight')}
    <div class="fx-scan"></div>
    <div class="fx-brackets"><i></i><i></i><i></i><i></i></div>`,
  idol: () => `
    <div class="fx-beams"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>
    <div class="fx-holo"></div>
    ${rep(14, (i) => `<span class="fx-note" style="--i:${i};--s:${22 + ((i * 7) % 4) * 8}px;--d:${9 + ((i * 3) % 5) * 1.3}s">${['♪', '♫', '♬', '♩'][i % 4]}</span>`)}
    ${rep(18, (i) => `<i class="fx-spark" style="--i:${i};--x:${(i * 53) % 100}%;--y:${((i * 31) % 90) + 6}%;--d:${2 + (i % 4) * 0.6}s"></i>`)}
    ${gear('mic', 'g-mic')}${gear('headphones', 'g-phones')}${gear('speaker', 'g-spk-l')}${gear('speaker', 'g-spk-r')}${gear('synth', 'g-synth')}
    <div class="fx-keys">${rep(36, (i) => `<i class="${[1, 3, 6, 8, 10].includes(i % 12) ? 'blk' : ''}"></i>`)}</div>
    <div class="fx-eq">${rep(40, (i) => `<i style="--i:${i};--d:${0.6 + ((i * 7) % 5) * 0.15}s"></i>`)}</div>`,
  prog: () => `
    <div class="fx-geo">${SVG.mandala}</div>
    <svg class="fx-fib" viewBox="0 0 377 233"><g fill="none" stroke="currentColor" stroke-width="1"><rect x="0" y="0" width="377" height="233"/><path d="M233 0 V233 M233 144 H377 M322 144 V233 M233 199 H322 M233 199 V233"/><path d="M233 233 A233 233 0 0 1 0 0 M233 0 A144 144 0 0 1 377 144 M377 144 A89 89 0 0 1 288 233 M288 233 A55 55 0 0 1 233 178"/></g></svg>
    <div class="fx-rays"></div>
    ${gear('guitar', 'g-guitar')}${gear('bass', 'g-bass')}${gear('drums', 'g-drums')}${gear('amp', 'g-amp')}
    <div class="fx-meter"><div class="track">${rep(4, () => ['7/8', '5/4', '13/16', '11/8', '9/8', '15/16', '6/4', '17/16'].map((m) => `<b>${m}</b>`).join('<i>◇</i>'))}</div></div>`,
  brother: () => `
    <div class="fx-stripes"></div>
    <div class="fx-crest">${SVG.crest}</div>
    <div class="fx-stitch"></div>
    ${rep(9, (i) => `<i class="fx-star" style="--i:${i};--x:${((i * 41) % 96) + 2}%;--y:${((i * 27) % 80) + 12}%;--s:${14 + (i % 3) * 8}px;--d:${3 + (i % 3)}s">★</i>`)}
    <div class="fx-banner">ride or die · brothers for life · ride or die · brothers for life ·</div>`,
  goat: () => `
    <div class="fx-goat-word">GOAT</div>
    <div class="fx-halftone"></div>
    <div class="fx-goat-icon">${SVG.goat}</div>
    <div class="fx-rules"></div>
    <div class="fx-marquee"><div class="track">${rep(6, () => '<b>G.O.A.T.</b><span>GREATEST OF ALL TIME</span>').replace(/$/, '')}</div></div>`,
};

// ---------------------------------------------------------------- apply
export function applyTheme(theme) {
  current = valid(theme);
  document.documentElement.dataset.theme = current;
  let layer = document.getElementById('fx');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'fx';
    layer.setAttribute('aria-hidden', 'true');
    document.body.prepend(layer);
  }
  if (layer.dataset.for !== current) {
    layer.dataset.for = current;
    layer.className = `fx fx-${current}`;
    layer.innerHTML = FX[current]();
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bar').trim() || '#0b2545';
}

// ---------------------------------------------------------------- welcome screen
const WELCOME = {
  hilton:   (n) => ({ art: SVG.facade, title: `Good to see you, <em>${n}</em>`, sub: 'Hospitality since 1919' }),
  darkroom: (n) => ({ art: SVG.iris, title: `${n}, you’re in focus`, sub: 'ISO 400 · f/2.8 · 1/125 · ready to shoot' }),
  cocoa:    (n) => ({ art: SVG.mug, title: `A warm cocoa for ${n}`, sub: 'Two marshmallows, extra steam' }),
  tactical: (n) => ({ art: `<div class="w-stack">${GEAR.sight}${SVG.chute}</div>`, title: `Deploying ${n}`, sub: 'Drop zone: restaurant · squad ready' }),
  idol:     (n) => ({ art: `<div class="w-stack">${GEAR.mic}${SVG.penlights}</div>`, title: `${n}, you’re on stage`, sub: '♪ Tonight’s setlist: breakfast service ♪' }),
  prog:     (n) => ({ art: `<div class="w-stack">${SVG.mandala}${GEAR.guitar}</div>`, title: n, sub: 'Enter in 7/8 · the spiral begins' }),
  brother:  (n) => ({ art: SVG.crest, title: `Welcome back, brother ${n}`, sub: 'Ride or die' }),
  goat:     (n) => ({ art: SVG.goat, title: `The GOAT has arrived`, sub: `${n} · greatest of all time` }),
};

export function welcome(user) {
  const theme = valid(user.theme);
  applyTheme(theme);
  play(theme, 'login');
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const w = WELCOME[theme](esc(user.nickname));
  const el = document.createElement('div');
  el.className = `welcome w-${theme}`;
  el.innerHTML = `<div class="w-bg"></div><div class="w-art">${w.art}</div><h1 class="w-title">${w.title}</h1><p class="w-sub">${w.sub}</p><div class="w-bar"><i></i></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  return new Promise((resolve) => {
    const done = () => { el.classList.add('out'); setTimeout(() => el.remove(), 450); resolve(); };
    const t = setTimeout(done, 2100);
    el.addEventListener('click', () => { clearTimeout(t); done(); }, { once: true });
  });
}

// ---------------------------------------------------------------- check-in celebration
const CELEBRATE = {
  hilton:   () => `<i class="cel-rip"></i><i class="cel-rip r2"></i><div class="cel-core"><svg width="56" height="56" viewBox="0 0 54 54"><path d="M14 28 L23 37 L41 18" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`,
  darkroom: () => `<div class="cel-flash"></div>${SVG.iris}`,
  cocoa:    () => SVG.mug,
  tactical: () => `${SVG.chute}<i class="smoke s1"></i><i class="smoke s2"></i><i class="smoke s3"></i>`,
  idol:     () => `${SVG.penlights}${rep(8, (i) => `<span class="burst-note" style="--i:${i};--bx:${Math.round(Math.cos(i * Math.PI / 4) * 160)}px;--by:${Math.round(Math.sin(i * Math.PI / 4) * 120 - 40)}px">${['♪', '♫'][i % 2]}</span>`)}`,
  prog:     () => SVG.mandala,
  brother:  () => `${SVG.rings}<i class="shock"></i>`,
  goat:     () => `<div class="goat-slam">GOAT</div>`,
};
const SUBLINE = {
  hilton: 'Checked in', darkroom: 'Captured', cocoa: 'Served', tactical: '+1 secured', idol: 'Encore!', prog: 'In 7/8', brother: 'Brotherhood +1', goat: 'Certified',
};

export function celebrateArt(theme) { return CELEBRATE[valid(theme)](); }
export function celebrateWord(theme) { return SUBLINE[valid(theme)]; }
