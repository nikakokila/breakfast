// Reads a guest list from a TXT, PDF, CSV or Excel (.xlsx) file, directly in the browser.
// Opera "Package Guest Details" (PKGGSTDTL) Excel reports are recognised automatically.
// The file never leaves the computer; only the final guest list is saved when the shift starts.
//
// Each line (or each row of a PDF table) is one guest. On every line we look for:
//   - a room number   (3–4 digits, e.g. 512 or 1208)
//   - a membership    (Diamond, Gold, Silver or Member — Silver counts as Member)
//   - the guest name  (the remaining words, in the order they are written)
// So "Maria Rossi 512 Gold", "512 | Rossi, Maria | GOLD" and "Gold  Maria Rossi  Room 512" all work.

import { parseRoom } from './rooms.js';

// ---------- Reading files ----------

function decodeText(buffer) {
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

// ---------- Excel (.xlsx) ----------
// An .xlsx file is a ZIP archive of XML files. We read it with the browser's own tools:
// DecompressionStream for the ZIP and DOMParser for the XML. No extra library is needed.

async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This Excel file could not be opened. It may be damaged.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count && view.getUint32(p, true) === 0x02014b50; n++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    files.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = async (name) => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + view.getUint16(f.local + 26, true) + view.getUint16(f.local + 28, true);
    const data = bytes.subarray(start, start + f.size);
    if (f.method === 0) return dec.decode(data);
    if (f.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('This Excel file uses a format this device can’t read. Save it as PDF or TXT instead.');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
  return { names: [...files.keys()], read };
}

const colIndex = (ref) => {
  const letters = /^[A-Z]+/.exec(ref || '')?.[0] || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// Returns the first worksheet as rows of cells: [{ cells: ['', 'ROOM', …], where: '21' }].
async function readXlsxRows(buffer) {
  const zip = await unzip(buffer);
  const xml = (text) => new DOMParser().parseFromString(text, 'application/xml');
  const sheetName = zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]))[0];
  if (!sheetName) throw new Error('No worksheet was found in this Excel file.');
  const shared = [];
  const sst = await zip.read('xl/sharedStrings.xml');
  if (sst) for (const si of xml(sst).getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  const doc = xml(await zip.read(sheetName));
  const rows = [];
  for (const row of doc.getElementsByTagName('row')) {
    const cells = [];
    for (const c of row.getElementsByTagName('c')) {
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let value = v;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = [...c.getElementsByTagName('t')].map((t) => t.textContent).join('');
      cells[colIndex(c.getAttribute('r'))] = String(value).trim();
    }
    rows.push({ cells: Array.from(cells, (x) => x ?? ''), where: row.getAttribute('r') || String(rows.length + 1) });
  }
  return rows;
}

// "HU / WANG" → "Wang Hu", "Alsaed / NEDAL" → "Nedal Alsaed". Capitals become normal case.
function operaName(raw) {
  const tidy = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  const [last, first] = String(raw).split('/');
  return (first ? `${tidy(first)} ${tidy(last)}` : tidy(last)).slice(0, 100);
}

// Opera guest statuses. Guests in the hotel (or leaving today) are expected at breakfast.
const OPERA_STATUS = {
  AR: null, DP: null, PND: null, RG: null, CKIN: null, DUEOUT: null, CKOUT: null,
  NA: 'Not arrived', SNS: 'Share no-show', CS: 'Cancelled share', SX: 'Cancelled', CXL: 'Cancelled', NS: 'No-show', NOSHOW: 'No-show',
};

// Recognises an Opera report by its heading row (ROOM, NAME and GUEST STATUS or ADULTS/CHILDREN).
function readOperaReport(rows) {
  const at = rows.findIndex((r) => {
    const h = r.cells.map((c) => c.toUpperCase());
    return h.includes('ROOM') && h.includes('NAME') && (h.includes('GUEST STATUS') || h.some((c) => c.startsWith('ADULTS')));
  });
  if (at < 0) return null;
  const head = rows[at].cells.map((c) => c.toUpperCase());
  const col = (test) => head.findIndex(test);
  const cRoom = col((c) => c === 'ROOM');
  const cName = col((c) => c === 'NAME');
  const cStatus = col((c) => c === 'GUEST STATUS' || c === 'STATUS');
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
    const row = { line: r.where, fullName: operaName(name), room: /^\d+$/.test(roomCell) ? roomCell : '', rankRaw, rank: rankRaw ? mapRank(rankRaw) : null };
    if (status && OPERA_STATUS[status]) row.skipReason = `${OPERA_STATUS[status]} (${status})`;
    out.push(row);
  }
  if (!out.length) throw new Error('This Opera report has no guests in it.');
  return { rows: out, ignored, hasRankColumn: cRank >= 0, autoMember: cRank < 0, source: 'Opera guest report' };
}

// Returns [{ text, where }], where "where" is the line number shown in the preview.
// Opera reports come back already understood, as lines.prepared.
export async function readGuestFile(file) {
  const name = file.name.toLowerCase();
  if (file.size > 20 * 1024 * 1024) throw new Error('This file is too large (over 20 MB).');
  const buffer = await file.arrayBuffer();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return readPdfLines(buffer);
  if (name.endsWith('.txt') || name.endsWith('.csv') || file.type.startsWith('text/')) {
    return decodeText(buffer).split(/\r\n|\r|\n/).map((text, i) => ({ text, where: String(i + 1) }));
  }
  if (name.endsWith('.xlsx') || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    const rows = await readXlsxRows(buffer);
    const lines = rows.map((r) => ({ text: r.cells.filter(Boolean).join('\t'), where: r.where }));
    lines.prepared = readOperaReport(rows);
    return lines;
  }
  if (/\.xls$/.test(name)) {
    throw new Error('This is an old Excel file (.xls). Open it in Excel and choose File → Save As → “Excel Workbook (.xlsx)”, then import that.');
  }
  if (/\.docx?$/.test(name)) {
    throw new Error('Please use a TXT, PDF or Excel file. In Word: File → Save As → choose “PDF”.');
  }
  throw new Error('Please drop a TXT, PDF or Excel (.xlsx) file.');
}

// ---------- Understanding each line ----------

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function mapRank(word) {
  const w = norm(word).replace(/[^a-z]/g, '');
  if (!w) return null;
  if (w.startsWith('diamond')) return 'DIAMOND';
  if (w.startsWith('gold')) return 'GOLD';
  if (w.startsWith('silver')) return 'MEMBER'; // Silver guests count as Member
  if (w === 'member' || w === 'members' || w === 'mbr') return 'MEMBER';
  return null;
}

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
  if (lines.prepared) return lines.prepared;
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
    rows.push({ line: where, fullName: p.fullName, room: p.room || p.badRoom || '', rankRaw: p.rankRaw, rank: p.rank });
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
