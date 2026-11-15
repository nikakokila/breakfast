// Reads a guest list from a TXT or PDF file, directly in the browser.
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

// Returns [{ text, where }], where "where" is the line number shown in the preview.
export async function readGuestFile(file) {
  const name = file.name.toLowerCase();
  if (file.size > 20 * 1024 * 1024) throw new Error('This file is too large (over 20 MB).');
  const buffer = await file.arrayBuffer();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return readPdfLines(buffer);
  if (name.endsWith('.txt') || name.endsWith('.csv') || file.type.startsWith('text/')) {
    return decodeText(buffer).split(/\r\n|\r|\n/).map((text, i) => ({ text, where: String(i + 1) }));
  }
  if (/\.(xlsx|xls|docx?)$/.test(name)) {
    throw new Error('Please use a TXT or PDF file. In Excel or Word: File → Save As → choose “PDF” or “Text (.txt)”.');
  }
  throw new Error('Please drop a TXT or PDF file.');
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
