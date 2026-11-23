// Reads spreadsheets directly in the browser, with no extra library:
//   - Excel .xlsx (a ZIP of XML files)
//   - older Excel .xls (the binary "BIFF" format Opera exports), including Excel 95 files
//   - the HTML or XML files some systems save with an .xls name
// Every format comes back the same way:
//   { sheets: [{ name, hidden, rows: [{ cells: ['', 'ROOM', …], where: '12' }] }], active }
// where "where" is the row number people see in Excel and "active" is the sheet that was open when the file was saved.

const ERR_DAMAGED = 'This Excel file could not be opened. It may be damaged.';

// ---------- .xlsx ----------

async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(ERR_DAMAGED);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= bytes.length && view.getUint32(p, true) === 0x02014b50; n++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    files.set(name.toLowerCase(), { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = async (name) => {
    const f = files.get(name.toLowerCase());
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
  const letters = /^[A-Z]+/i.exec(ref || '')?.[0]?.toUpperCase();
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const fmtNumber = (n) => (Number.isFinite(n) ? String(Number.isInteger(n) ? n : Math.round(n * 1e6) / 1e6) : '');
const tidyCell = (v) => String(v ?? '').replace(/ /g, ' ').trim();

// Turns a sparse { row: { col: value } } map into the rows list.
function toRows(grid) {
  return [...grid.keys()].sort((a, b) => a - b).map((r) => {
    const line = grid.get(r);
    const cells = [];
    for (const [c, v] of line) cells[c] = tidyCell(v);
    return { cells: Array.from(cells, (x) => x ?? ''), where: String(r + 1) };
  });
}

async function readXlsx(buffer) {
  const zip = await unzip(buffer);
  const xml = (text) => new DOMParser().parseFromString(text, 'application/xml');
  const shared = [];
  const sst = await zip.read('xl/sharedStrings.xml');
  if (sst) {
    for (const si of xml(sst).getElementsByTagName('si')) {
      // Leave out phonetic guides (<rPh>), which are not part of the cell text.
      shared.push([...si.getElementsByTagName('t')].filter((t) => t.parentNode?.nodeName !== 'rPh').map((t) => t.textContent).join(''));
    }
  }

  // Sheet names and order come from workbook.xml; the file of each sheet from its relationships.
  let list = [];
  let activeTab = 0;
  const wbText = await zip.read('xl/workbook.xml');
  if (wbText) {
    const wb = xml(wbText);
    const relsText = await zip.read('xl/_rels/workbook.xml.rels');
    const targets = new Map();
    if (relsText) {
      for (const r of xml(relsText).getElementsByTagName('Relationship')) {
        const t = r.getAttribute('Target') || '';
        targets.set(r.getAttribute('Id'), t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`);
      }
    }
    activeTab = Number(wb.getElementsByTagName('workbookView')[0]?.getAttribute('activeTab') || 0);
    list = [...wb.getElementsByTagName('sheet')].map((s) => ({
      name: s.getAttribute('name') || 'Sheet',
      hidden: !!s.getAttribute('state') && s.getAttribute('state') !== 'visible',
      path: targets.get(s.getAttribute('r:id')) || null,
    }));
  }
  if (!list.length || list.some((s) => !s.path)) {
    list = zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]))
      .map((path, i) => ({ name: `Sheet${i + 1}`, hidden: false, path }));
    activeTab = 0;
  }
  if (!list.length) throw new Error('No worksheet was found in this Excel file.');

  const sheets = [];
  let active = 0;
  for (const [i, s] of list.entries()) {
    const text = await zip.read(s.path);
    if (text == null) continue;
    const grid = new Map();
    let rowNo = -1;
    for (const row of xml(text).getElementsByTagName('row')) {
      rowNo = row.getAttribute('r') ? Number(row.getAttribute('r')) - 1 : rowNo + 1;
      const line = new Map();
      let col = -1;
      for (const c of row.getElementsByTagName('c')) {
        const at = colIndex(c.getAttribute('r'));
        col = at >= 0 ? at : col + 1;
        const type = c.getAttribute('t');
        let value = c.getElementsByTagName('v')[0]?.textContent ?? '';
        if (type === 's') value = shared[Number(value)] ?? '';
        else if (type === 'inlineStr') value = [...c.getElementsByTagName('t')].map((t) => t.textContent).join('');
        else if (type === 'b') value = value === '1' ? 'TRUE' : 'FALSE';
        if (value !== '') line.set(col, value);
      }
      if (line.size) grid.set(rowNo, line);
    }
    if (i === activeTab) active = sheets.length;
    sheets.push({ name: s.name, hidden: s.hidden, rows: toRows(grid) });
  }
  return { sheets, active };
}

// ---------- .xls (binary) ----------
// The file is a "compound file": a tiny file system with 512-byte sectors. The sheet data lives in a
// stream called "Workbook" (Excel 97 and later) or "Book" (Excel 95), as a list of binary records.

function compoundStream(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 512 || view.getUint32(0, true) !== 0xe011cfd0 || view.getUint32(4, true) !== 0xe11ab1a1) return null;
  const END = 0xfffffffa; // values from here up mean "no more sectors"
  const sectorSize = 2 ** view.getUint16(0x1e, true);
  const miniSize = 2 ** view.getUint16(0x20, true);
  const at = (s) => (s + 1) * sectorSize;
  const okSector = (s) => s < END && at(s) < bytes.length;            // the last sector may be cut short
  const fullSector = (s) => s < END && at(s) + sectorSize <= bytes.length;
  const u32 = (dv, off) => dv.getUint32(off, true);

  // The sector allocation table (FAT), listed in the header and in extra "DIFAT" sectors.
  const fatSectors = [];
  for (let i = 0; i < 109; i++) { const s = u32(view, 0x4c + i * 4); if (s < END) fatSectors.push(s); }
  let difat = u32(view, 0x44);
  for (let n = 0; n < u32(view, 0x48) && fullSector(difat); n++) {
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per; i++) { const s = u32(view, at(difat) + i * 4); if (s < END) fatSectors.push(s); }
    difat = u32(view, at(difat) + per * 4);
  }
  const fat = [];
  for (const s of fatSectors) {
    if (!fullSector(s)) throw new Error(ERR_DAMAGED);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(u32(view, at(s) + i * 4));
  }
  const chain = (start, table) => {
    const out = [];
    const seen = new Set();
    for (let s = start; s < END && !seen.has(s); s = table[s] ?? END) { seen.add(s); out.push(s); }
    return out;
  };
  const readChain = (start, size = Infinity) => {
    const sectors = chain(start, fat).filter(okSector);
    const total = Math.min(size, sectors.length * sectorSize);
    const out = new Uint8Array(total);
    let off = 0;
    for (const s of sectors) {
      const n = Math.min(sectorSize, total - off);
      if (n <= 0) break;
      out.set(bytes.subarray(at(s), Math.min(bytes.length, at(s) + n)), off);
      off += n;
    }
    return out;
  };

  // The directory: 128-byte entries with a UTF-16 name, a type, a first sector and a size.
  const dir = readChain(u32(view, 0x30));
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const type = dir[off + 0x42];
    if (type !== 1 && type !== 2 && type !== 5) continue;
    const nameLen = Math.min(64, dv.getUint16(off + 0x40, true));
    const name = new TextDecoder('utf-16le').decode(dir.subarray(off, off + Math.max(0, nameLen - 2)));
    entries.push({ name, type, start: u32(dv, off + 0x74), size: u32(dv, off + 0x78) });
  }
  const entry = entries.find((e) => e.type === 2 && /^workbook$/i.test(e.name)) || entries.find((e) => e.type === 2 && /^book$/i.test(e.name));
  if (!entry) return null;
  if (entry.size >= u32(view, 0x38)) return readChain(entry.start, entry.size);

  // Small streams live inside the "mini stream" (64-byte pieces), which belongs to the root entry.
  const root = entries.find((e) => e.type === 5);
  if (!root) throw new Error(ERR_DAMAGED);
  const mini = readChain(root.start, root.size);
  const miniFatBytes = readChain(u32(view, 0x3c));
  const mfv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const miniFat = Array.from({ length: miniFatBytes.length / 4 }, (_, i) => mfv.getUint32(i * 4, true));
  const out = new Uint8Array(entry.size);
  let off = 0;
  for (const s of chain(entry.start, miniFat)) {
    const n = Math.min(miniSize, entry.size - off);
    if (n <= 0) break;
    out.set(mini.subarray(s * miniSize, s * miniSize + n), off);
    off += n;
  }
  return out;
}

// Excel stores many whole numbers in a packed 30-bit "RK" form.
function rkNumber(rk) {
  let n;
  if (rk & 2) n = (rk | 0) >> 2;
  else {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(4, rk & 0xfffffffc, true);
    n = dv.getFloat64(0, true);
  }
  return rk & 1 ? n / 100 : n;
}

function readBiff(stream) {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const records = [];
  for (let p = 0; p + 4 <= stream.length;) {
    const type = view.getUint16(p, true);
    const len = view.getUint16(p + 2, true);
    records.push({ type, offset: p, data: stream.subarray(p + 4, Math.min(stream.length, p + 4 + len)) });
    p += 4 + len;
  }
  if (!records.length || records[0].type !== 0x0809) throw new Error(ERR_DAMAGED);
  const vers = new DataView(records[0].data.buffer, records[0].data.byteOffset).getUint16(0, true);
  const biff8 = vers >= 0x0600;
  if (vers < 0x0500) throw new Error('This Excel file is from a very old version of Excel. Open it and choose File → Save As → “Excel Workbook (.xlsx)”.');

  let codepage = 1252;
  const byte8 = (u8) => {
    try { return new TextDecoder(codepage === 1200 ? 'utf-16le' : `windows-${codepage}`).decode(u8); } catch { return new TextDecoder('windows-1252').decode(u8); }
  };
  const dvOf = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // A string inside one record (Excel 97+: length, a flags byte, then 1 or 2 bytes per character).
  const recString = (u8, off, lenBytes = 2) => {
    const dv = dvOf(u8);
    const cch = lenBytes === 2 ? dv.getUint16(off, true) : u8[off];
    off += lenBytes;
    if (!biff8) return byte8(u8.subarray(off, off + cch));
    const flags = u8[off++];
    if (flags & 8) off += 2; // rich text runs (skipped)
    if (flags & 4) off += 4; // phonetic data (skipped)
    if (flags & 1) return new TextDecoder('utf-16le').decode(u8.subarray(off, off + cch * 2));
    let s = '';
    for (let i = 0; i < cch && off + i < u8.length; i++) s += String.fromCharCode(u8[off + i]);
    return s;
  };

  // The shared string table can be split over several CONTINUE records.
  const readSst = (segments) => {
    let si = 0;
    let p = 0;
    const next = () => { while (si < segments.length && p >= segments[si].length) { si++; p = 0; } return si < segments.length; };
    const u8 = () => (next() ? segments[si][p++] : 0);
    const u16 = () => u8() | (u8() << 8);
    const u32 = () => (u16() | (u16() << 16)) >>> 0;
    const skip = (n) => { while (n > 0 && next()) { const k = Math.min(n, segments[si].length - p); p += k; n -= k; } };
    const chars = (cch, high) => {
      let out = '';
      while (cch > 0) {
        if (si >= segments.length) break;
        if (p >= segments[si].length) {
          si++; p = 0;
          if (si >= segments.length) break;
          high = segments[si][p++] & 1; // a continued character array starts with a new flags byte
          continue;
        }
        const seg = segments[si];
        const n = Math.min(cch, high ? (seg.length - p) >> 1 : seg.length - p);
        if (n <= 0) { p = seg.length; continue; }
        if (high) for (let i = 0; i < n; i++) out += String.fromCharCode(seg[p + 2 * i] | (seg[p + 2 * i + 1] << 8));
        else for (let i = 0; i < n; i++) out += String.fromCharCode(seg[p + i]);
        p += high ? 2 * n : n;
        cch -= n;
      }
      return out;
    };
    u32();
    const unique = u32();
    const out = [];
    for (let i = 0; i < unique && next(); i++) {
      const cch = u16();
      const flags = u8();
      const runs = flags & 8 ? u16() : 0;
      const ext = flags & 4 ? u32() : 0;
      out.push(chars(cch, flags & 1));
      skip(runs * 4 + ext);
    }
    return out;
  };

  // Workbook globals: sheet list, shared strings, code page, which sheet was open.
  const sheetsInfo = [];
  let sst = [];
  let activeTab = 0;
  let i = 1;
  for (; i < records.length && records[i].type !== 0x000a; i++) {
    const { type, data } = records[i];
    const dv = dvOf(data);
    if (type === 0x002f) throw new Error('This Excel file is password-protected. Remove the password and try again.');
    if (type === 0x0042 && data.length >= 2) codepage = dv.getUint16(0, true);
    if (type === 0x003d && data.length >= 12) activeTab = dv.getUint16(10, true);
    if (type === 0x0085 && data.length >= 7) {
      sheetsInfo.push({ pos: dv.getUint32(0, true), hidden: data[4] !== 0, kind: data[5], name: recString(data, 6, 1) });
    }
    if (type === 0x00fc) {
      const segments = [data];
      while (records[i + 1]?.type === 0x003c) segments.push(records[++i].data);
      sst = readSst(segments);
    }
  }

  const byOffset = new Map(records.map((r, n) => [r.offset, n]));
  const sheets = [];
  let active = 0;
  sheetsInfo.forEach((info, tab) => {
    if (info.kind !== 0) return; // charts and macro sheets have no cells
    let n = byOffset.get(info.pos);
    if (n === undefined || records[n].type !== 0x0809) return;
    const grid = new Map();
    const put = (row, col, value) => {
      if (value === '' || value == null) return;
      if (!grid.has(row)) grid.set(row, new Map());
      grid.get(row).set(col, value);
    };
    let pendingFormula = null;
    for (n++; n < records.length && records[n].type !== 0x000a; n++) {
      const { type, data } = records[n];
      if (data.length < 6 && type !== 0x0207) continue;
      const dv = dvOf(data);
      const row = data.length >= 4 ? dv.getUint16(0, true) : 0;
      const col = data.length >= 4 ? dv.getUint16(2, true) : 0;
      switch (type) {
        case 0x00fd: if (data.length >= 10) put(row, col, sst[dv.getUint32(6, true)] ?? ''); break; // LABELSST
        case 0x0204: case 0x00d6: put(row, col, recString(data, 6)); break; // LABEL, RSTRING
        case 0x0203: if (data.length >= 14) put(row, col, fmtNumber(dv.getFloat64(6, true))); break; // NUMBER
        case 0x027e: if (data.length >= 10) put(row, col, fmtNumber(rkNumber(dv.getUint32(6, true)))); break; // RK
        case 0x00bd: { // MULRK: several RK numbers in a row
          const count = Math.floor((data.length - 6) / 6);
          for (let k = 0; k < count; k++) put(row, col + k, fmtNumber(rkNumber(dv.getUint32(4 + k * 6 + 2, true))));
          break;
        }
        case 0x0205: if (data.length >= 8 && !data[7]) put(row, col, data[6] ? 'TRUE' : 'FALSE'); break; // BOOLERR
        case 0x0006: { // FORMULA: keep the last calculated value
          if (data.length < 14) break;
          if (data[12] === 0xff && data[13] === 0xff) {
            if (data[6] === 0) pendingFormula = { row, col };
            else if (data[6] === 1) put(row, col, data[8] ? 'TRUE' : 'FALSE');
          } else put(row, col, fmtNumber(dv.getFloat64(6, true)));
          break;
        }
        case 0x0207: // STRING: the text result of the formula just before
          if (pendingFormula && data.length >= 2) put(pendingFormula.row, pendingFormula.col, recString(data, 0));
          pendingFormula = null;
          break;
        default: break;
      }
    }
    if (tab === activeTab) active = sheets.length;
    sheets.push({ name: info.name || `Sheet${tab + 1}`, hidden: info.hidden, rows: toRows(grid) });
  });
  if (!sheets.length) throw new Error('No worksheet was found in this Excel file.');
  return { sheets, active };
}

// ---------- HTML / XML saved as .xls ----------

function readMarkup(text) {
  if (/urn:schemas-microsoft-com:office:spreadsheet/i.test(text) && /<(\w+:)?Workbook[\s>]/.test(text)) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const all = (el, tag) => [...el.getElementsByTagNameNS('*', tag)];
    const attr = (el, name) => el.getAttribute(`ss:${name}`) ?? el.getAttributeNS('urn:schemas-microsoft-com:office:spreadsheet', name);
    const sheets = all(doc, 'Worksheet').map((ws, i) => {
      const grid = new Map();
      let r = -1;
      for (const row of all(ws, 'Row')) {
        r = attr(row, 'Index') ? Number(attr(row, 'Index')) - 1 : r + 1;
        let c = -1;
        const line = new Map();
        for (const cell of all(row, 'Cell')) {
          c = attr(cell, 'Index') ? Number(attr(cell, 'Index')) - 1 : c + 1;
          const value = all(cell, 'Data').map((d) => d.textContent).join('');
          if (value !== '') line.set(c, value);
          c += Number(attr(cell, 'MergeAcross') || 0);
        }
        if (line.size) grid.set(r, line);
      }
      return { name: attr(ws, 'Name') || `Sheet${i + 1}`, hidden: false, rows: toRows(grid) };
    });
    const active = Number(all(doc, 'ActiveSheet')[0]?.textContent || 0);
    if (!sheets.length) throw new Error(ERR_DAMAGED);
    return { sheets, active: Math.min(active, sheets.length - 1) };
  }
  // An HTML page with one or more tables: all their rows, top to bottom, as one sheet.
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const grid = new Map();
  let r = 0;
  for (const tr of doc.querySelectorAll('tr')) {
    const line = new Map();
    let c = 0;
    for (const cell of tr.children) {
      if (!/^T[DH]$/.test(cell.tagName)) continue;
      const value = cell.textContent.replace(/\s+/g, ' ');
      if (value.trim()) line.set(c, value);
      c += Math.max(1, Number(cell.getAttribute('colspan')) || 1);
    }
    if (line.size) grid.set(r, line);
    r++;
  }
  if (!grid.size) throw new Error('No table was found in this file.');
  return { sheets: [{ name: doc.title || 'Sheet1', hidden: false, rows: toRows(grid) }], active: 0 };
}

// ---------- entry point ----------

export const isSpreadsheetName = (name) => /\.(xlsx|xlsm|xls)$/i.test(name);

// decodeText turns bytes into text (UTF-8, UTF-16 or Windows-1252); passed in so there is one copy of it.
export async function readSpreadsheet(buffer, decodeText) {
  const head = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  if (head[0] === 0x50 && head[1] === 0x4b) return readXlsx(buffer);              // "PK": a ZIP, so .xlsx
  if (head[0] === 0xd0 && head[1] === 0xcf) {                                    // compound file, so .xls
    const stream = compoundStream(buffer);
    if (!stream) throw new Error('This file is not an Excel workbook. If it is a Word or other Office file, save the list as Excel or PDF.');
    return readBiff(stream);
  }
  const text = decodeText(buffer);
  if (/^\s*</.test(text)) return readMarkup(text);
  throw new Error(ERR_DAMAGED);
}
