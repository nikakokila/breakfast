// Reads the guest lists used to prepare a breakfast shift, directly in the browser.
// The files never leave the device; only the final guest list is saved when the shift starts.
//
// Three kinds of list are understood:
//   1. Breakfast list  — who is expected at breakfast: the Opera "Package Guest Details" report (PKGGSTDTL),
//                        or any TXT / PDF / CSV list with one guest per line (name · room · membership).
//   2. Tier list       — the reception's Diamond / Gold / Silver "Breakfast report" (Room N, Guest Name, PAX, Tier).
//   3. Complimentary   — the Opera "Guest Request/Comment" report of guests given free breakfast.
// Excel files may be .xlsx or the older .xls that Opera exports. Each file is recognised by its headings,
// so it does not matter which upload box it was dropped on.

import { parseRoom } from './rooms.js';
import { readSpreadsheet, isSpreadsheetName } from './sheets.js';

// ---------- Reading files ----------

export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Older Windows programs save text as "ANSI" (Windows-1252).
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

let pdfjsPromise = null;
function loadPdfJs() {
  // The PDF reader is large, so it is only loaded the first time a PDF is dropped.
  pdfjsPromise ||= import(new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return pdfjs;
  });
  return pdfjsPromise;
}

async function readPdfLines(buffer) {
  const pdfjs = await loadPdfJs();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error('This PDF is password-protected. Remove the password and try again.');
    throw new Error('This PDF could not be opened. It may be damaged.');
  }
  const lines = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    // Group text pieces that sit on the same height into one line, left to right.
    const pieces = items
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || 10 }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const p of pieces) {
      const row = rows.find((r) => Math.abs(r.y - p.y) <= Math.max(2, p.h * 0.45));
      if (row) row.items.push(p); else rows.push({ y: p.y, items: [p] });
    }
    rows.sort((a, b) => b.y - a.y);
    rows.forEach((r, i) => {
      r.items.sort((a, b) => a.x - b.x);
      let text = '';
      let end = null;
      for (const it of r.items) {
        const gap = end === null ? 0 : it.x - end;
        // A wide gap means a new table column; mark it with a tab so cells stay separate.
        text += end === null ? '' : gap > Math.max(8, it.h * 0.9) ? '\t' : gap > 1 ? ' ' : '';
        text += it.str;
        end = it.x + it.w;
      }
      lines.push({ text, where: doc.numPages > 1 ? `p${n}·${i + 1}` : String(i + 1) });
    });
  }
  if (!lines.length) {
    throw new Error('This PDF has no readable text. It is probably a scanned image. Export the list as a text PDF or a TXT file instead.');
  }
  return lines;
}

// CSV with commas, semicolons or tabs, and "quoted, values".
function parseCsv(text) {
  const first = text.split(/\r\n|\r|\n/).slice(0, 5).join('\n');
  const sep = [',', ';', '\t'].map((s) => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { cells.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell); rows.push(cells); cells = []; cell = '';
    } else cell += ch;
  }
  if (cell || cells.length) { cells.push(cell); rows.push(cells); }
  return rows.map((c, i) => ({ cells: c.map((x) => x.trim()), where: String(i + 1) }));
}

const linesFromRows = (rows) => rows.map((r) => ({ text: r.cells.filter(Boolean).join('\t'), where: r.where }));

// Opens any supported file. Returns { sheets: [{ name, rows }], active, lines } —
// "sheets" for lists with columns (Excel, CSV), "lines" for the one-guest-per-line reader.
export async function readImportFile(file) {
  const name = file.name.toLowerCase();
  if (file.size > 20 * 1024 * 1024) throw new Error('This file is too large (over 20 MB).');
  if (/\.docx?$/.test(name)) throw new Error('Please use an Excel, PDF or TXT file. In Word: File → Save As → choose “PDF”.');
  const buffer = await file.arrayBuffer();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const lines = await readPdfLines(buffer);
    return { sheets: [{ name: 'PDF', rows: lines.map((l) => ({ cells: l.text.split('\t').map((s) => s.trim()), where: l.where })) }], active: 0, lines };
  }
  if (isSpreadsheetName(name) || /spreadsheet|ms-excel/.test(file.type)) {
    const book = await readSpreadsheet(buffer, decodeText);
    const main = book.sheets[book.active]?.rows.length ? book.sheets[book.active] : book.sheets.find((s) => s.rows.length) || book.sheets[0];
    return { ...book, lines: linesFromRows(main?.rows || []) };
  }
  if (name.endsWith('.txt') || name.endsWith('.csv') || file.type.startsWith('text/') || !file.type) {
    const text = decodeText(buffer);
    const lines = text.split(/\r\n|\r|\n/).map((t, i) => ({ text: t, where: String(i + 1) }));
    const rows = name.endsWith('.csv') ? parseCsv(text) : lines.map((l) => ({ cells: l.text.split('\t').map((s) => s.trim()), where: l.where }));
    return { sheets: [{ name: 'Text', rows }], active: 0, lines };
  }
  throw new Error('Please use an Excel (.xlsx or .xls), PDF or TXT file.');
}

// ---------- Dates ----------
// Dates are passed around as "YYYY-MM-DD" text, in the hotel's own time.

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const todayIso = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
const dayNumber = (day) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
export const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);
export const fmtDay = (day, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', opts).format(new Date(y, m - 1, d));
};

const validDay = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(y, m - 1, d).getDate() === d;

// Understands 23.11.2026, 23.11.26, 11/23/26, 23/11/2026, 2026-11-23 and Excel's day numbers (46349).
// For "a/b/yy", whichever of day/month or month/day is possible (and closest to today) wins.
export function parseDay(value, near = todayIso()) {
  const s = String(value ?? '').trim();
  if (/^\d{5}(\.\d+)?$/.test(s) && Number(s) > 30000 && Number(s) < 80000) {
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return validDay(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null;
  m = /^(\d{1,2})([./-])(\d{1,2})\2(\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const year = m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
  const a = Number(m[1]);
  const b = Number(m[3]);
  const dayFirst = validDay(year, b, a) ? iso(year, b, a) : null;
  const monthFirst = validDay(year, a, b) ? iso(year, a, b) : null;
  if (m[2] === '.') return dayFirst; // dots are always day.month
  if (!dayFirst || !monthFirst) return dayFirst || monthFirst;
  return Math.abs(daysBetween(near, dayFirst)) <= Math.abs(daysBetween(near, monthFirst)) ? dayFirst : monthFirst;
}

// ---------- Names and memberships ----------

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const titleCase = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// "HU / WANG" → "Wang Hu", "MOSINYAN/ALINA" → "Alina Mosinyan". Capitals become normal case.
function operaName(raw) {
  const [last, first] = String(raw).split('/');
  return (first && first.trim() ? `${titleCase(first)} ${titleCase(last)}` : titleCase(last)).slice(0, 100);
}

export function mapRank(word) {
  const w = norm(word).replace(/[^a-z]/g, '');
  if (!w) return null;
  if (w.startsWith('diamond')) return 'DIAMOND';
  if (w.startsWith('gold')) return 'GOLD';
  if (w.startsWith('silver')) return 'MEMBER'; // Silver guests count as Member
  if (w === 'member' || w === 'members' || w === 'mbr') return 'MEMBER';
  return null;
}

// Tier codes on the reception's list: D, G, S, DR (Diamond Reserve), "booking", …
export function tierOf(raw) {
  const w = norm(raw).replace(/[^a-z]/g, '');
  if (!w) return null;
  if (w === 'd' || w === 'dr' || w === 'ld' || w.startsWith('diamond') || w.startsWith('lifetimediamond')) return 'DIAMOND';
  if (w === 'g' || w.startsWith('gold')) return 'GOLD';
  if (w === 's' || w.startsWith('silver')) return 'SILVER';
  return 'OTHER';
}
const TIER_LABEL = { DIAMOND: 'Diamond', GOLD: 'Gold', SILVER: 'Silver' };
export const tierLabel = (tier, raw) => {
  if (/reserve/i.test(raw || '') || /^dr$/i.test((raw || '').trim())) return 'Diamond Reserve';
  return TIER_LABEL[tier] || titleCase(String(raw || 'No tier'));
};

const headerIndex = (cells) => cells.map((c) => String(c).toUpperCase().replace(/\s+/g, ' ').trim());
const peopleCount = (s) => {
  const nums = String(s ?? '').match(/\d+/g);
  return nums ? nums.reduce((a, n) => a + Number(n), 0) : null;
};

// ---------- 1. Opera "Package Guest Details" report ----------

// Opera guest statuses. Guests in the hotel (or leaving today) are expected at breakfast.
const OPERA_STATUS = {
  AR: null, DP: null, PND: null, RG: null, CKIN: null, DUEOUT: null, CKOUT: null,
  NA: 'Not arrived', SNS: 'Share no-show', CS: 'Cancelled share', SX: 'Cancelled', CXL: 'Cancelled', NS: 'No-show', NOSHOW: 'No-show',
};

// Recognised by its heading row (ROOM, NAME and GUEST STATUS or ADULTS/CHILDREN).
export function readOperaPackage(rows) {
  const at = rows.findIndex((r) => {
    const h = headerIndex(r.cells);
    return h.includes('ROOM') && h.includes('NAME') && (h.includes('GUEST STATUS') || h.some((c) => c.startsWith('ADULTS')));
  });
  if (at < 0) return null;
  const head = headerIndex(rows[at].cells);
  const col = (test) => head.findIndex(test);
  const cRoom = col((c) => c === 'ROOM');
  const cName = col((c) => c === 'NAME');
  const cStatus = col((c) => c === 'GUEST STATUS' || c === 'STATUS');
  const cPeople = col((c) => c.startsWith('ADULTS'));
  const cRank = col((c) => /MEMBER|TIER|HONORS|HHONORS|VIP/.test(c));
  const out = [];
  let ignored = at + 1;
  for (const r of rows.slice(at + 1)) {
    const name = (r.cells[cName] || '').trim();
    const roomCell = (r.cells[cRoom] || '').trim();
    // Package headings and TOTAL lines sit in the room column and have no guest name.
    if (!name) { ignored++; continue; }
    const status = cStatus >= 0 ? (r.cells[cStatus] || '').trim().toUpperCase() : '';
    const rankRaw = cRank >= 0 ? (r.cells[cRank] || '').trim() : '';
    const pax = cPeople >= 0 ? peopleCount(r.cells[cPeople]) : null; // "2/1" = 2 adults and 1 child
    const row = { line: r.where, fullName: operaName(name), room: /^\d+$/.test(roomCell) ? roomCell : '', rankRaw, rank: rankRaw ? mapRank(rankRaw) : null, pax: pax ?? 1 };
    if (status && OPERA_STATUS[status]) row.skipReason = `${OPERA_STATUS[status]} (${status})`;
    out.push(row);
  }
  if (!out.length) throw new Error('This Opera report has no guests in it.');
  // "PACKAGE GUEST DETAILS 11/22/26-11/22/26" is one night, so breakfast is the morning after.
  let breakfastDate = null;
  for (const r of rows.slice(0, at)) {
    const m = r.cells.join(' ').match(/PACKAGE GUEST DETAILS\s+(\S+)\s*-\s*(\S+)/i);
    if (m) {
      const from = parseDay(m[1]);
      const to = parseDay(m[2]);
      if (from && from === to) breakfastDate = addDays(from, 1);
    }
  }
  return { rows: out, ignored, hasRankColumn: cRank >= 0, autoMember: cRank < 0, source: 'Opera package report', breakfastDate };
}

// ---------- 2. Diamond / Gold / Silver list ----------

// Finds the table with Room, Guest Name, PAX and Tier columns on one sheet.
function readTierSheet(rows) {
  const at = rows.findIndex((r) => {
    const h = headerIndex(r.cells);
    // Room, name, tier AND a people (PAX) column: a breakfast list with a membership column is not a tier list.
    return h.some((c) => /^(ROOM|RM)\b/.test(c)) && h.some((c) => /\bTIER\b|^LEVEL$|^STATUS$/.test(c)) && h.some((c) => /NAME/.test(c))
      && h.some((c) => /^(PAX|PERSONS?|PEOPLE|GUESTS?|ADULTS?|#\s*GSTS?|NO\.? OF GUESTS)$/.test(c));
  });
  if (at < 0) return null;
  const head = headerIndex(rows[at].cells);
  const col = (test) => head.findIndex(test);
  const cRoom = col((c) => /^(ROOM|RM)\b/.test(c));
  const cName = col((c) => /NAME/.test(c));
  const cTier = col((c) => /\bTIER\b/.test(c)) >= 0 ? col((c) => /\bTIER\b/.test(c)) : col((c) => /^LEVEL$|^STATUS$/.test(c));
  const cPax = col((c) => /^(PAX|PERSONS?|PEOPLE|GUESTS?|ADULTS?|#\s*GSTS?|NO\.? OF GUESTS)$/.test(c));
  const cStay = col((c) => /STAY|DATES?$|ARRIVAL/.test(c));
  // The "Date:" at the top of the report.
  let date = null;
  for (const r of rows.slice(0, at)) {
    r.cells.forEach((c, i) => {
      if (date) return;
      const inline = /^date\s*:?\s*(.+)$/i.exec(c);
      if (inline && parseDay(inline[1])) date = parseDay(inline[1]);
      else if (/^date\s*:?$/i.test(c)) {
        const next = r.cells.slice(i + 1).find((x) => x);
        if (next) date = parseDay(next);
      }
    });
  }
  const out = [];
  let ignored = at + 1;
  for (const r of rows.slice(at + 1)) {
    const roomCell = (r.cells[cRoom] || '').trim();
    const name = (r.cells[cName] || '').trim();
    if (!roomCell && !name) { ignored++; continue; }
    if (!/^\d{3,4}$/.test(roomCell) && !name) { ignored++; continue; } // totals and notes
    const tierRaw = cTier >= 0 ? (r.cells[cTier] || '').trim() : '';
    const pax = cPax >= 0 ? peopleCount(r.cells[cPax]) : null;
    out.push({
      line: r.where, room: roomCell, fullName: titleCase(name).slice(0, 100), tierRaw, tier: tierOf(tierRaw) || 'OTHER',
      pax: Math.min(20, Math.max(1, pax ?? 1)), stay: cStay >= 0 ? (r.cells[cStay] || '').trim() : '',
    });
  }
  return { rows: out, ignored, date };
}

// All sheets that hold a tier table. The one open when the file was saved is chosen first.
export function readTierBook(book) {
  const sheets = [];
  book.sheets.forEach((s, index) => {
    const t = readTierSheet(s.rows);
    if (t && t.rows.length) sheets.push({ index, name: s.name, ...t });
  });
  if (!sheets.length) return null;
  const open = sheets.findIndex((s) => s.index === book.active);
  return { sheets, pick: open >= 0 ? open : sheets.length - 1, source: 'Diamond · Gold · Silver list' };
}

// ---------- 3. Opera "Guest Request/Comment" report (complimentary breakfast) ----------

// "MOSINYAN/ALINA 3130021854  BLUE" → name "Alina Mosinyan", tier "BLUE".
function requestName(cell) {
  let s = String(cell).replace(/\s+/g, ' ').trim();
  let tierRaw = '';
  const t = /\s(LIFETIME DIAMOND|DIAMOND RESERVE|DIAMOND|GOLD|SILVER|BLUE|MEMBER)$/i.exec(s);
  if (t) { tierRaw = t[1]; s = s.slice(0, t.index).trim(); }
  const conf = /\s\d{6,}(\s.*)?$/.exec(s); // the confirmation number and anything after it
  if (conf) s = s.slice(0, conf.index).trim();
  return { fullName: operaName(s), tierRaw };
}

export function readRequestReport(rows) {
  const at = rows.findIndex((r) => {
    const h = headerIndex(r.cells);
    return h.includes('GUEST NAME') && h.some((c) => /^RM\s*#|^ROOM/.test(c)) && h.some((c) => /#\s*GSTS|REQUEST|ARRIVE/.test(c));
  });
  if (at < 0) return null;
  const head = headerIndex(rows[at].cells);
  const col = (test) => head.findIndex(test);
  const cName = col((c) => c === 'GUEST NAME');
  const cRoom = col((c) => /^RM\s*#|^ROOM/.test(c));
  const cArrive = col((c) => /^ARRIV/.test(c));
  const cDepart = col((c) => /^DEPART/.test(c));
  const cPax = col((c) => /#\s*GSTS|GUESTS|PAX/.test(c));
  const cNote = col((c) => /REQUESTS?\/COMN?T|COMMENT/.test(c));
  let businessDate = null;
  for (const r of rows.slice(0, at)) {
    const i = r.cells.findIndex((c) => /^BUSINESS DATE/i.test(c));
    if (i >= 0) businessDate = parseDay(r.cells.slice(i + 1).find((x) => x) || '');
  }
  const near = businessDate || todayIso();
  const out = [];
  let ignored = at + 1;
  for (const r of rows.slice(at + 1)) {
    const nameCell = (r.cells[cName] || '').trim();
    const roomCell = (r.cells[cRoom] || '').trim();
    // Guest lines have a "LAST/FIRST" name or a room; heading lines, totals and "END OF REPORT" do not.
    // A guest without a room yet is kept, so the preview can show it.
    if (!nameCell || /^(TOTAL|END OF|PAGE)/i.test(nameCell) || !(/^\d{3,4}$/.test(roomCell) || nameCell.includes('/'))) { ignored++; continue; }
    const { fullName, tierRaw } = requestName(nameCell);
    const tier = tierRaw ? tierOf(tierRaw) : null;
    const pax = cPax >= 0 ? peopleCount(r.cells[cPax]) : null;
    out.push({
      line: r.where, fullName, room: roomCell, tierRaw, rank: tier === 'DIAMOND' || tier === 'GOLD' ? tier : null,
      arrive: cArrive >= 0 ? parseDay(r.cells[cArrive], near) : null,
      depart: cDepart >= 0 ? parseDay(r.cells[cDepart], near) : null,
      pax: Math.min(20, Math.max(1, pax ?? 1)),
      note: cNote >= 0 ? (r.cells[cNote] || '').trim() : '',
    });
  }
  if (!out.length) throw new Error('This request report has no guests in it.');
  return { rows: out, ignored, businessDate, source: 'Opera request report' };
}

// ---------- Which list is this file? ----------

// Returns { kind: 'breakfast' | 'tier' | 'comp', data } when the headings make it clear, otherwise { kind: null }.
export function recognise(book) {
  const order = [book.active, ...book.sheets.map((_, i) => i).filter((i) => i !== book.active)].filter((i) => book.sheets[i]);
  for (const i of order) {
    const data = readOperaPackage(book.sheets[i].rows);
    if (data) return { kind: 'breakfast', data };
  }
  const tier = readTierBook(book);
  if (tier) return { kind: 'tier', data: tier };
  for (const i of order) {
    const data = readRequestReport(book.sheets[i].rows);
    if (data) return { kind: 'comp', data };
  }
  return { kind: null };
}

// A plain list (one guest per line) read for a particular box.
export function readPlainList(book, kind) {
  const parsed = extractGuests(book.lines);
  if (kind === 'breakfast') return { ...parsed, source: '' };
  if (kind === 'tier') {
    const rows = parsed.rows.map((r) => ({ line: r.line, room: r.room, fullName: r.fullName, tierRaw: r.rankRaw, tier: tierOf(r.rankRaw) || 'OTHER', pax: 1, stay: '' }));
    return { sheets: [{ index: 0, name: 'List', rows, ignored: parsed.ignored, date: null }], pick: 0, source: '' };
  }
  return { rows: parsed.rows.map((r) => ({ line: r.line, fullName: r.fullName, room: r.room, tierRaw: r.rankRaw, rank: r.rank === 'DIAMOND' || r.rank === 'GOLD' ? r.rank : null, arrive: null, depart: null, pax: 1, note: '' })), ignored: parsed.ignored, source: '' };
}

// ---------- One guest per line (TXT, PDF, simple lists) ----------
//
// On every line we look for:
//   - a room number   (3–4 digits, e.g. 512 or 1208)
//   - a membership    (Diamond, Gold, Silver or Member — Silver counts as Member)
//   - the guest name  (the remaining words, in the order they are written)
// So "Maria Rossi 512 Gold", "512 | Rossi, Maria | GOLD" and "Gold  Maria Rossi  Room 512" all work.

// Words that describe a column rather than being part of a name.
const FILLER = new Set(['room', 'rm', 'no', 'nr', 'num', 'number', 'floor', 'guest', 'guests', 'name', 'names', 'first', 'last',
  'surname', 'mr', 'mrs', 'ms', 'miss', 'dr', 'honors', 'hhonors', 'tier', 'level', 'elite', 'status', 'membership', 'rank', 'vip']);

const hasLetter = /\p{L}/u;
const trimPunct = (s) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

function parseLine(text, lastNameFirst = false) {
  // Split into tokens on spaces, tabs, | ; and commas. Remember "Rossi, Maria" style commas,
  // and which column (cell) each token is in, for tab, | or ; separated lists.
  const tokens = [];
  text.split(/\t|\s\|\s|\||;/).forEach((cellText, cell) => {
    for (const m of cellText.matchAll(/([^\s,]+)(,[ \t]+)?/g)) tokens.push({ raw: m[1], commaSpace: !!m[2], cell });
  });

  let room = null;          // first valid room number
  let badRoom = null;       // a 3–4 digit number that isn't a valid room
  let rank = null;
  let rankRaw = '';
  const nameTokens = [];

  tokens.forEach((t, i) => {
    const clean = trimPunct(t.raw);
    if (!clean) return;
    const digits = clean.replace(/^#/, '');
    if (/^\d{3,4}$/.test(digits)) {
      const r = parseRoom(digits);
      if (r.ok) { if (!room) room = r.room; } else if (!badRoom) badRoom = digits;
      return;
    }
    const rk = mapRank(clean);
    if (rk) {
      if (!rank) { rank = rk; rankRaw = clean; }
      return;
    }
    // One-letter membership codes (D/G/S/M) only count at the very end of a line.
    if (i === tokens.length - 1 && /^[DGSM]$/.test(clean) && nameTokens.length) {
      rank = { D: 'DIAMOND', G: 'GOLD', S: 'MEMBER', M: 'MEMBER' }[clean];
      rankRaw = clean;
      return;
    }
    if (!hasLetter.test(clean) || /\d/.test(clean) || FILLER.has(norm(clean))) return;
    nameTokens.push({ word: clean, commaSpace: t.commaSpace, next: tokens[i + 1], cell: t.cell });
  });

  // "Rossi, Maria" → "Maria Rossi"
  const flips = nameTokens.filter((t, i) => t.commaSpace && i < nameTokens.length - 1 && t.next && trimPunct(t.next.raw) === nameTokens[i + 1].word);
  let words = nameTokens.map((t) => t.word);
  if (flips.length === 1) {
    const at = nameTokens.indexOf(flips[0]) + 1;
    words = [...words.slice(at), ...words.slice(0, at)];
  } else if (lastNameFirst && words.length > 1) {
    // The heading row said "Last name … First name": put the first name in front.
    const firstCell = nameTokens[0].cell;
    const at = nameTokens.some((t) => t.cell !== firstCell) ? nameTokens.findIndex((t) => t.cell !== firstCell) : 1;
    words = [...words.slice(at), ...words.slice(0, at)];
  }
  const fullName = words.join(' ').slice(0, 100);
  return { fullName, room, badRoom, rank, rankRaw };
}

// Turns file lines into guest rows for the preview.
// Lines with no guest information at all (titles, headings, page numbers) are ignored.
export function extractGuests(lines) {
  const rows = [];
  let ignored = 0;
  let lastNameFirst = false;
  for (const { text, where } of lines) {
    if (!text || !text.trim()) continue;
    const p = parseLine(text, lastNameFirst);
    const looksLikeGuest = (p.room && (p.fullName || p.rank)) || (p.rank && (p.fullName || p.badRoom));
    if (!looksLikeGuest) {
      // Remember the column order from a heading row such as "Last name | First name | Room".
      const h = norm(text);
      const last = h.search(/\b(last|surname|family)\b/);
      const first = h.search(/\b(first|given)\b/);
      if (last >= 0 && first >= 0) lastNameFirst = last < first;
      ignored++;
      continue;
    }
    rows.push({ line: where, fullName: p.fullName, room: p.room || p.badRoom || '', rankRaw: p.rankRaw, rank: p.rank, pax: 1 });
  }
  if (!rows.length) {
    throw new Error('No guests were found. Each line should have the guest’s name, room number and membership, for example: Maria Rossi 512 Gold');
  }
  return { rows, ignored, hasRankColumn: rows.some((r) => r.rankRaw) };
}

// A ready-made example file people can fill in.
export function templateTxt() {
  return [
    'Breakfast guest list',
    'One guest per line: first name, last name, room number, membership (Diamond, Gold, Silver or Member)',
    '',
    'Maria Rossi 512 Gold',
    'John Smith 1208 Diamond',
    'Aiko Tanaka 903 Silver',
    'Omar Haddad 618 Member',
    '',
  ].join('\r\n');
}
