// START NEW SHIFT (guest preparation) and the ACTIVE BREAKFAST SHIFT screen.
import { api, html, raw, esc, icons, toast, openModal, confirmDialog, fmtTime, rankBadge, setBusy, normalize } from './lib.js';
import { parseRoom } from './rooms.js';
import { readImportFile, recognise, readPlainList, templateTxt, todayIso, addDays, fmtDay } from './guest-import.js';
import { mergeLists, peopleByRoom, totalPeople, paxForRoom } from './guest-merge.js';
import { state, view, go, refreshMe, buzz } from './app.js';
import { celebrate } from './celebrate.js';
import { play } from './sounds.js';
import { currentTheme } from './themes.js';

const CHECK_SVG = raw('<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>');
const PEOPLE_SVG = raw('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.2 19.5c.6-3.3 3-5.2 5.8-5.2s5.2 1.9 5.8 5.2"/><circle cx="17.2" cy="9" r="2.6"/><path d="M16 14.3c2.4.2 4.2 1.9 4.8 5"/></svg>');

const RANKS = ['DIAMOND', 'GOLD', 'MEMBER'];
const PEOPLE_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "2 people" from this room (shown only when more than one person is expected).
export const paxChip = (n, long = false) => (n > 1 ? html`<span class="pax" title="People expected from this room">${PEOPLE_SVG}${long ? `${n} people` : n}</span>` : '');

// The three lists that can be imported. Each file is recognised by its headings, wherever it is dropped.
const LISTS = [
  { kind: 'breakfast', title: 'Breakfast list', hint: 'Opera package report — who is expected', empty: 'Who is expected at breakfast (Opera package report, TXT or PDF)' },
  { kind: 'tier', title: 'Diamond · Gold · Silver', hint: 'Tier list — optional', empty: 'Diamond and Gold always get breakfast; Silver only if on the breakfast list' },
  { kind: 'comp', title: 'Complimentary breakfast', hint: 'Request report — optional', empty: 'Guests given free breakfast (Opera request report)' },
];
const LIST_NAME = { breakfast: 'breakfast list', tier: 'Diamond · Gold · Silver list', comp: 'complimentary list' };
const ACCEPT = '.xlsx,.xls,.pdf,.txt,.csv,text/plain,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// =====================================================================
//  START NEW SHIFT — prepare the expected guest list
// =====================================================================
export async function renderPrepare() {
  const el = view();
  await refreshMe();
  if (state.activeShiftId) {
    el.innerHTML = String(html`
      <div class="card card-pad empty">
        <div class="empty-icon">${icons.guests}</div>
        <h3>A breakfast shift is already active</h3>
        <p>Finish the current shift before starting a new one.</p>
        <p style="margin-top:16px"><a class="btn btn-primary" href="#/shift">Go to active shift</a></p>
      </div>`);
    return;
  }

  // The draft list is kept in this browser until START SHIFT, so a refresh doesn't lose it.
  const draftKey = `bm-draft-${state.me.id}`;
  let guests = [];
  try { guests = JSON.parse(localStorage.getItem(draftKey) || '[]'); } catch { guests = []; }
  let editingId = null;
  const save = () => { try { localStorage.setItem(draftKey, JSON.stringify(guests)); } catch { /* storage full or blocked */ } };

  el.innerHTML = String(html`
    <a class="back" href="#/home">${icons.back} Home</a>
    <div class="page-head">
      <div>
        <div class="eyebrow">Start new shift · Step 1 of 2</div>
        <h1>Prepare the guest list</h1>
        <p>Import today’s lists or enter guests by hand. Only the room number is needed — the floor is worked out automatically.</p>
      </div>
    </div>

    <div class="prep-grid">
      <div class="prep-side">
      <div class="card import-card" id="dropzone">
        <input type="file" id="import-file" multiple accept="${ACCEPT}" class="sr-only">
        <div class="ic-head">
          <span class="dz-icon">${icons.upload}</span>
          <div>
            <div class="dz-title">Import guest lists</div>
            <div class="dz-text">Tap a list or drop files here · Excel, PDF or TXT</div>
          </div>
        </div>
        <div class="il-list">
          ${LISTS.map((s, i) => html`<button type="button" class="il-item" data-slot="${s.kind}">
            <span class="il-n">${i + 1}</span>
            <span class="il-text"><b>${s.title}</b><small>${s.hint}</small></span>
            <span class="il-plus" aria-hidden="true">${icons.plus}</span>
          </button>`)}
        </div>
        <span class="dz-text small">Typing a list yourself? <a href="#" id="template-link">Download a TXT template</a></span>
      </div>
      <div class="card prep-form">
        <div class="card-head"><h2 id="form-title">Add a guest</h2></div>
        <form class="card-pad" id="guest-form" novalidate>
          <div id="form-error"></div>
          <div class="name-row">
            <div class="field">
              <label for="g-first">First name</label>
              <input class="input" id="g-first" autocomplete="off" maxlength="50" placeholder="e.g. Maria">
            </div>
            <div class="field">
              <label for="g-last">Last name</label>
              <input class="input" id="g-last" autocomplete="off" maxlength="50" placeholder="e.g. Rossi">
            </div>
          </div>
          <div class="room-row">
            <div class="field">
              <label for="g-room">Room number</label>
              <input class="input room-input" id="g-room" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="e.g. 1208">
              <span class="hint" id="room-hint">Floors 5–15, rooms 01–18.</span>
            </div>
            <div class="field">
              <label for="g-people">People</label>
              <select class="select people-select" id="g-people" title="How many people from this room come to breakfast">
                ${PEOPLE_CHOICES.map((n) => html`<option value="${n}">${n}</option>`)}
              </select>
              <span class="hint">in room</span>
            </div>
          </div>
          <div class="field">
            <label for="g-rank">Membership rank</label>
            <select class="select" id="g-rank">
              <option value="">Select membership…</option>
              ${RANKS.map((r) => html`<option value="${r}">${r}</option>`)}
            </select>
            <span class="hint">Silver guests count as Member.</span>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary btn-block" type="submit" id="add-btn">${icons.plus} Add guest</button>
            <button class="btn btn-outline hidden" type="button" id="cancel-edit">Cancel</button>
          </div>
          <p class="muted small" style="margin-top:12px">Tip: press <span class="kbd">Enter</span> to add and jump straight to the next guest.</p>
        </form>
      </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <span class="count-chip"><b id="count">0</b> expected guests</span>
            <span class="people-total" id="people-total"></span>
            <div class="rank-tally" id="tally"></div>
          </div>
          <button class="btn btn-ghost btn-sm" id="clear-all">Clear list</button>
        </div>
        <div id="list"></div>
        <div class="prep-foot">
          <p class="muted small">Review the list carefully. You can still edit or remove guests until the shift starts.</p>
          <button class="btn btn-gold btn-lg" id="start-btn">Start shift ${icons.arrow}</button>
        </div>
      </div>
    </div>
  `);

  const form = el.querySelector('#guest-form');
  const nameIn = el.querySelector('#g-first'); // first box gets focus after each guest
  const lastIn = el.querySelector('#g-last');
  const clean = (v) => v.trim().replace(/\s+/g, ' ');
  // Imported guests only have a full name; split it on the first space for editing.
  const splitName = (full) => { const i = full.indexOf(' '); return i < 0 ? [full, ''] : [full.slice(0, i), full.slice(i + 1)]; };
  const roomIn = el.querySelector('#g-room');
  const peopleIn = el.querySelector('#g-people');
  const rankIn = el.querySelector('#g-rank');
  const roomHint = el.querySelector('#room-hint');
  const formError = el.querySelector('#form-error');
  let peopleTouched = false;
  const setPeople = (n) => {
    const v = Math.max(1, Math.min(20, n || 1));
    if (![...peopleIn.options].some((o) => Number(o.value) === v)) peopleIn.add(new Option(String(v), String(v)));
    peopleIn.value = String(v);
  };

  function updateRoomHint() {
    const v = roomIn.value.trim();
    roomIn.classList.remove('invalid');
    if (!v) { roomHint.className = 'hint'; roomHint.textContent = 'Floors 5–15, rooms 01–18.'; return; }
    const r = parseRoom(v);
    if (r.ok) {
      roomHint.className = 'hint ok';
      const others = guests.filter((g) => g.room === r.room && g.id !== editingId);
      roomHint.textContent = `✓ Floor ${r.floor} · Room ${String(r.position).padStart(2, '0')}${others.length ? ` · ${plural(others.length, 'guest')} already listed` : ''}`;
      // Show how many people this room already has, unless the number was changed by hand.
      if (!peopleTouched && !editingId) setPeople(others.length ? peopleByRoom(guests).get(r.room) : 1);
    } else if (v.length >= 3) { roomHint.className = 'hint err'; roomHint.textContent = r.error; roomIn.classList.add('invalid'); }
    else { roomHint.className = 'hint'; roomHint.textContent = 'Keep typing…'; }
  }
  roomIn.addEventListener('input', () => { roomIn.value = roomIn.value.replace(/\D/g, ''); updateRoomHint(); });
  peopleIn.addEventListener('change', () => { peopleTouched = true; });

  function drawList() {
    el.querySelector('#count').textContent = guests.length;
    const people = totalPeople(guests);
    el.querySelector('#people-total').innerHTML = guests.length ? String(html`${PEOPLE_SVG}<b>${people}</b> ${people === 1 ? 'person' : 'people'}`) : '';
    const tally = Object.fromEntries(RANKS.map((r) => [r, guests.filter((g) => g.rank === r).length]));
    el.querySelector('#tally').innerHTML = String(html`${RANKS.map((r) => html`<span class="badge ${r}">${tally[r]} ${r}</span>`)}`);
    el.querySelector('#start-btn').disabled = guests.length === 0;
    el.querySelector('#clear-all').classList.toggle('hidden', guests.length === 0);

    const list = el.querySelector('#list');
    if (!guests.length) {
      list.innerHTML = String(html`<div class="empty"><div class="empty-icon">${icons.guests}</div><h3>No guests yet</h3><p>Import the lists or add guests by hand. They will appear here.</p></div>`);
      return;
    }
    const roomPeople = peopleByRoom(guests);
    const rows = [...guests].reverse(); // newest first, so you can see what you just typed
    list.innerHTML = String(html`
      <div class="table-wrap"><table class="stack">
        <thead><tr><th>#</th><th>Room</th><th>Floor</th><th>Guest</th><th>Membership</th><th></th></tr></thead>
        <tbody>
          ${rows.map((g) => {
            const r = parseRoom(g.room);
            const n = roomPeople.get(g.room);
            return html`<tr class="${editingId === g.id ? 'editing' : ''}">
              <td class="muted num td-hide-sm">${guests.indexOf(g) + 1}</td>
              <td class="room-cell">${g.room}<span class="floor-sm">Floor ${r.floor}</span></td>
              <td class="floor-tag td-hide-sm">Floor ${r.floor}</td>
              <td class="td-name"><b>${g.fullName}</b><div class="badge-sm">${rankBadge(g.rank)} ${paxChip(n)}</div></td>
              <td class="td-hide-sm"><span class="rank-cell">${rankBadge(g.rank)} ${paxChip(n)}</span></td>
              <td class="actions">
                <button class="btn btn-ghost btn-sm" data-edit="${g.id}">Edit</button>
                <button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-remove="${g.id}">Remove</button>
              </td>
            </tr>`;
          })}
        </tbody>
      </table></div>`);
  }

  function resetForm() {
    editingId = null;
    peopleTouched = false;
    form.reset();
    setPeople(1);
    formError.innerHTML = '';
    el.querySelector('#form-title').textContent = 'Add a guest';
    el.querySelector('#add-btn').innerHTML = `${icons.plus} Add guest`;
    el.querySelector('#cancel-edit').classList.add('hidden');
    updateRoomHint();
    nameIn.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const first = clean(nameIn.value);
    const last = clean(lastIn.value);
    const fullName = [first, last].filter(Boolean).join(' ');
    const room = parseRoom(roomIn.value);
    const rank = rankIn.value;
    const problems = [];
    if (!first) problems.push('Enter the guest’s first name.');
    if (!last) problems.push('Enter the guest’s last name.');
    if (!room.ok) problems.push(room.error);
    if (!RANKS.includes(rank)) problems.push('Choose a membership rank: Diamond, Gold or Member.');
    const dup = guests.find((g) => g.id !== editingId && normalize(g.fullName) === normalize(fullName) && g.room === room.room);
    if (dup) problems.push(`${fullName} in room ${room.room} is already on the list.`);
    if (problems.length) {
      formError.innerHTML = String(html`<div class="form-error">${problems.map((p) => html`<div>${p}</div>`)}</div>`);
      (!first ? nameIn : !last ? lastIn : !room.ok ? roomIn : rankIn).focus();
      return;
    }
    const pax = paxForRoom(guests, room.room, Number(peopleIn.value), editingId);
    if (editingId) {
      Object.assign(guests.find((g) => g.id === editingId), { fullName, room: room.room, rank, pax });
      toast(`Updated ${fullName}.`, 'success');
    } else {
      guests.push({ id: newId(), fullName, room: room.room, rank, pax });
    }
    save();
    resetForm();
    drawList();
  });

  // Enter in the rank dropdown submits too (handy for fast typing).
  rankIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); } });
  el.querySelector('#cancel-edit').addEventListener('click', () => { resetForm(); drawList(); });

  el.querySelector('#list').addEventListener('click', async (e) => {
    const editId = e.target.closest('[data-edit]')?.dataset.edit;
    const removeId = e.target.closest('[data-remove]')?.dataset.remove;
    if (editId) {
      const g = guests.find((x) => x.id === editId);
      editingId = g.id;
      peopleTouched = true;
      [nameIn.value, lastIn.value] = splitName(g.fullName); roomIn.value = g.room; rankIn.value = g.rank;
      setPeople(peopleByRoom(guests).get(g.room));
      updateRoomHint();
      el.querySelector('#form-title').textContent = 'Edit guest';
      el.querySelector('#add-btn').textContent = 'Save changes';
      el.querySelector('#cancel-edit').classList.remove('hidden');
      drawList();
      nameIn.focus();
      if (window.innerWidth < 960) form.scrollIntoView({ behavior: 'smooth' });
    }
    if (removeId) {
      const g = guests.find((x) => x.id === removeId);
      guests = guests.filter((x) => x.id !== removeId);
      if (editingId === removeId) resetForm();
      save();
      drawList();
      toast(`Removed ${g.fullName} (${g.room}).`);
    }
  });

  el.querySelector('#clear-all').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Clear the whole list?', text: `This removes all ${guests.length} guests you’ve entered.`, confirmText: 'Clear list', variant: 'danger' });
    if (!ok) return;
    guests = []; save(); resetForm(); drawList();
  });

  el.querySelector('#start-btn').addEventListener('click', async () => {
    const tally = Object.fromEntries(RANKS.map((r) => [r, guests.filter((g) => g.rank === r).length]));
    const ok = await confirmDialog({
      title: 'Start the breakfast shift?',
      text: 'The guest list will be saved and attendance tracking begins.',
      body: String(html`<div class="summary">
        <div class="summary-row total"><span>Total expected guests</span><b>${guests.length}</b></div>
        <div class="summary-row"><span>${rankBadge('DIAMOND')}</span><b>${tally.DIAMOND}</b></div>
        <div class="summary-row"><span>${rankBadge('GOLD')}</span><b>${tally.GOLD}</b></div>
        <div class="summary-row"><span>${rankBadge('MEMBER')}</span><b>${tally.MEMBER}</b></div>
        <div class="summary-row"><span>People expected (all rooms)</span><b>${totalPeople(guests)}</b></div>
      </div>`),
      confirmText: 'Start shift',
      variant: 'gold',
    });
    if (!ok) return;
    const btn = el.querySelector('#start-btn');
    setBusy(btn, true, 'Starting…');
    try {
      await api('POST', '/api/shifts', { guests: guests.map(({ fullName, room, rank, pax }) => ({ fullName, room, rank, pax: pax ?? 1 })) });
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      await refreshMe();
      toast('Shift started. Good service!', 'success');
      go('/shift');
    } catch (err) {
      toast(err.message, 'error');
      setBusy(btn, false);
    }
  });

  // ---------- Import: up to three lists, combined into one ----------
  const dropzone = el.querySelector('#dropzone');
  const fileInput = el.querySelector('#import-file');
  let pickFor = null; // which list the file picker was opened for
  const imp = { files: {}, day: todayIso(), fillMember: false, mode: 'add', open: {}, modal: null, redraw: null };
  const importOpen = () => !!imp.modal?.isConnected;

  el.querySelector('#template-link').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const url = URL.createObjectURL(new Blob(['﻿' + templateTxt()], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'guest-list-template.txt' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const choose = (kind) => { pickFor = kind; fileInput.click(); };
  el.querySelector('.il-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot]');
    if (b) choose(b.dataset.slot);
  });
  dropzone.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === dropzone) { e.preventDefault(); choose('breakfast'); }
  });
  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    handleFiles(files, pickFor);
    pickFor = null;
  });

  async function handleFiles(files, hint) {
    if (!files.length) return;
    if (!importOpen()) Object.assign(imp, { files: {}, day: todayIso(), fillMember: false, mode: 'add', open: {} });
    const title = dropzone.querySelector('.dz-title');
    dropzone.classList.add('reading');
    let added = 0;
    try {
      for (const file of files) {
        title.textContent = `Reading ${file.name}…`;
        try {
          const book = await readImportFile(file);
          const found = recognise(book);
          // Lists with known headings go to their own box; a plain list goes where it was dropped.
          const kind = found.kind || hint || 'breakfast';
          const data = found.kind ? found.data : readPlainList(book, kind);
          imp.files[kind] = { fileName: file.name, data };
          if (kind === 'breakfast') imp.fillMember = !!data.autoMember;
          if (found.kind && hint && found.kind !== hint) toast(`“${file.name}” is the ${LIST_NAME[found.kind]}, so it was put there.`);
          added++;
        } catch (err) {
          toast(`${file.name}: ${err.message}`, 'error');
        }
      }
    } finally {
      dropzone.classList.remove('reading');
      title.textContent = 'Import guest lists';
    }
    if (added) openImport();
  }

  // The import window: the three lists at the top, the combined result below.
  function openImport() {
    if (importOpen()) { imp.redraw(); return; }
    openModal(String(html`
      <div class="modal-head"><h2>Import guest lists</h2>
        <p class="imp-day">For breakfast on <select class="select select-sm" id="imp-day"></select></p></div>
      <div class="modal-body" id="import-body"></div>
      <div class="modal-foot"><button class="btn btn-outline" data-close>Cancel</button><button class="btn btn-gold" id="do-import">Import guests</button></div>
    `), (m, close) => {
      imp.modal = m;
      m.classList.add('modal-wide');
      const bodyEl = m.querySelector('#import-body');
      const importBtn = m.querySelector('#do-import');
      const daySel = m.querySelector('#imp-day');

      const result = () => mergeLists({
        breakfast: imp.files.breakfast?.data, tier: imp.files.tier?.data, comp: imp.files.comp?.data,
        existing: imp.mode === 'add' ? guests : [], breakfastDate: imp.day, fillMember: imp.fillMember,
      });

      imp.redraw = () => {
        const today = todayIso();
        const days = [...new Set([today, addDays(today, 1), imp.day])].sort();
        daySel.innerHTML = String(html`${days.map((d) => html`<option value="${d}" ${d === imp.day ? 'selected' : ''}>${d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : ''} ${fmtDay(d)}</option>`)}`);
        const r = result();
        bodyEl.innerHTML = String(importBody(r));
        const n = r.fresh.length;
        const changed = r.changed.length;
        importBtn.disabled = !n && !changed;
        importBtn.textContent = n ? `Import ${plural(n, 'guest')}${changed ? ` · update ${changed}` : ''}` : changed ? `Update ${plural(changed, 'guest')}` : 'Nothing to import';
      };

      daySel.addEventListener('change', () => { imp.day = daySel.value; imp.redraw(); });
      bodyEl.addEventListener('click', (e) => {
        const add = e.target.closest('[data-add]')?.dataset.add;
        const remove = e.target.closest('[data-remove-file]')?.dataset.removeFile;
        const day = e.target.closest('[data-day]')?.dataset.day;
        if (add) choose(add);
        if (remove) { delete imp.files[remove]; imp.redraw(); }
        if (day) { imp.day = day; imp.redraw(); }
      });
      bodyEl.addEventListener('change', (e) => {
        if (e.target.id === 'fill-member') imp.fillMember = e.target.checked;
        if (e.target.name === 'mode') imp.mode = e.target.value;
        if (e.target.matches('[data-sheet]')) imp.files.tier.data.pick = Number(e.target.value);
        imp.redraw();
      });
      // Remember which sections are open while the window redraws.
      bodyEl.addEventListener('toggle', (e) => { if (e.target.dataset.section) imp.open[e.target.dataset.section] = e.target.open; }, true);

      m.querySelector('[data-close]').onclick = close;
      importBtn.onclick = () => {
        const r = result();
        guests = r.entries.map((g) => ({ id: g.id || newId(), fullName: g.fullName, room: g.room, rank: g.rank, pax: g.pax ?? 1 }));
        save();
        resetForm();
        drawList();
        close();
        const names = Object.values(imp.files).map((f) => f.fileName).join(', ');
        toast(`Imported ${plural(r.fresh.length, 'guest')}${r.changed.length ? `, updated ${r.changed.length}` : ''} from ${names}.`, 'success');
      };
      imp.redraw();
    });
  }

  function slotView(list, i, r) {
    const file = imp.files[list.kind];
    if (!file) {
      return html`<button type="button" class="il-row empty" data-add="${list.kind}">
        <span class="il-n">${i + 1}</span>
        <span class="il-text"><b>${list.title}</b><small>${list.empty}</small></span>
        <span class="il-plus" aria-hidden="true">${icons.plus}</span></button>`;
    }
    const d = file.data;
    const today = todayIso();
    const near = (day) => day === today || day === addDays(today, 1);
    let facts = '';
    let warn = null;
    let extra = '';
    if (list.kind === 'breakfast') {
      const skipped = r.issues.filter((x) => x.list === 'Breakfast list').length;
      facts = [d.source, `${plural(d.rows.length - skipped, 'guest')} ready`, skipped ? `${skipped} skipped` : ''].filter(Boolean).join(' · ');
      if (d.breakfastDate && d.breakfastDate !== imp.day) {
        warn = { text: `This report is for breakfast on ${fmtDay(d.breakfastDate)}.`, day: near(d.breakfastDate) ? d.breakfastDate : null };
      }
    } else if (list.kind === 'tier') {
      const s = d.sheets[d.pick];
      const rooms = (t) => new Set(s.rows.filter((x) => x.tier === t).map((x) => x.room)).size;
      const other = rooms('OTHER');
      facts = [d.source, `${rooms('DIAMOND')} Diamond · ${rooms('GOLD')} Gold · ${rooms('SILVER')} Silver${other ? ` · ${other} other` : ''}`].filter(Boolean).join(' · ');
      if (s.date && s.date !== imp.day) warn = { text: `This list is dated ${fmtDay(s.date)}, not the breakfast date.`, day: near(s.date) ? s.date : null };
      if (d.sheets.length > 1) {
        extra = html`<label class="sheet-pick">Sheet <select class="select select-sm" data-sheet>
          ${d.sheets.map((x, k) => html`<option value="${k}" ${k === d.pick ? 'selected' : ''}>${x.name}${x.date ? ` · ${fmtDay(x.date)}` : ''}</option>`)}
        </select></label>`;
      }
    } else {
      const rooms = new Set(d.rows.map((x) => x.room)).size;
      facts = [d.source, `${plural(d.rows.length, 'guest')} in ${plural(rooms, 'room')}`].filter(Boolean).join(' · ');
    }
    return html`<div class="il-row">
      <span class="il-n done">${CHECK_SVG}</span>
      <div class="il-text">
        <b>${list.title}</b>
        <small class="file-name">${file.fileName}</small>
        <small>${facts}</small>
        ${extra}
        ${warn ? html`<div class="il-warn">${warn.text}${warn.day ? html` <button type="button" class="link-btn small" data-day="${warn.day}">Use ${fmtDay(warn.day)}</button>` : ''}</div>` : ''}
      </div>
      <span class="il-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-add="${list.kind}">Change</button>
        <button type="button" class="btn btn-ghost btn-sm il-x" data-remove-file="${list.kind}" title="Remove this file" aria-label="Remove ${list.title}">✕</button>
      </span>
    </div>`;
  }

  function importBody(r) {
    const f = imp.files;
    const s = r.stats;
    const ranks = (rk) => r.fresh.filter((g) => g.rank === rk).length;
    const happened = [];
    if (f.tier) {
      if (s.upgraded) happened.push(html`<li><b>${plural(s.upgraded, 'guest')}</b> on the breakfast list ${s.upgraded === 1 ? 'is' : 'are'} Diamond or Gold</li>`);
      if (s.tierAdded) happened.push(html`<li><b>${plural(s.tierAdded, 'Diamond/Gold room')}</b> not on the breakfast list ${s.tierAdded === 1 ? 'is' : 'are'} added — one entry per room</li>`);
      if (s.noBreakfast) happened.push(html`<li class="muted"><b>${plural(s.noBreakfast, 'Silver/other room')}</b> not on the breakfast list — no breakfast</li>`);
      if (s.nameDiffers) happened.push(html`<li class="warn"><b>${plural(s.nameDiffers, 'room')}</b> with a different name on the two lists — check the details</li>`);
    }
    if (f.comp) {
      if (s.compAdded || s.compOnList) happened.push(html`<li><b>${plural(s.compAdded, 'complimentary guest')}</b> added${s.compOnList ? html` · ${s.compOnList} already on the list` : ''}</li>`);
      if (s.compLater) happened.push(html`<li class="muted"><b>${plural(s.compLater, 'complimentary guest')}</b> not for this breakfast (arriving later or already left)</li>`);
    }
    if (r.changed.length) happened.push(html`<li><b>${plural(r.changed.length, 'guest')}</b> already on your list will be updated (tier or people)</li>`);
    const hasFiles = Object.keys(f).length > 0;
    return html`
      <div class="il-group">${LISTS.map((list, i) => slotView(list, i, r))}</div>
      ${hasFiles ? html`
        <div class="summary" style="margin-top:16px">
          <div class="summary-row total"><span>Guests ready to import</span><b>${r.fresh.length}</b></div>
          ${RANKS.map((rk) => html`<div class="summary-row"><span>${rankBadge(rk)}</span><b>${ranks(rk)}</b></div>`)}
          <div class="summary-row"><span>${PEOPLE_SVG} People expected${imp.mode === 'add' && guests.length ? ' (whole list)' : ''}</span><b>${r.people}</b></div>
          ${r.issues.length ? html`<div class="summary-row warn"><span>Rows that will be skipped</span><b>${r.issues.length}</b></div>` : ''}
        </div>
        ${happened.length ? html`<ul class="imp-happened">${happened}</ul>` : ''}
        ${r.rankOnly ? html`
          <label class="check-row" style="margin-top:12px"><input type="checkbox" id="fill-member" ${imp.fillMember ? 'checked' : ''}>
            <span>Set ${plural(r.rankOnly, 'row')} with a blank or other membership to <b>MEMBER</b></span></label>` : ''}
        ${guests.length ? html`
          <div class="import-mode">
            <label class="check-row"><input type="radio" name="mode" value="add" ${imp.mode === 'add' ? 'checked' : ''}><span>Add to the ${plural(guests.length, 'guest')} already on the list</span></label>
            <label class="check-row"><input type="radio" name="mode" value="replace" ${imp.mode === 'replace' ? 'checked' : ''}><span>Replace the current list</span></label>
          </div>` : ''}
        ${r.details.length ? html`
          <details class="imp-details" data-section="details" ${imp.open.details ? 'open' : ''}>
            <summary>Show the tier and complimentary lists room by room</summary>
            <div class="table-wrap"><table><thead><tr><th>Room</th><th>Guest</th><th>List</th><th>People</th><th>Result</th></tr></thead><tbody>
              ${r.details.map((d) => html`<tr class="tone-${d.tone}">
                <td class="num">${d.room || '—'}</td><td>${d.name || '—'}</td>
                <td class="small">${d.list === 'Complimentary' ? 'Complimentary' : ''}${d.label ? html`${d.list === 'Complimentary' ? ' · ' : ''}${d.label}` : ''}</td>
                <td class="num">${d.pax || ''}</td><td class="small">${d.result}</td></tr>`)}
            </tbody></table></div>
          </details>` : ''}
        ${r.issues.length ? html`
          <details class="issues" data-section="issues" ${imp.open.issues || r.fresh.length === 0 ? 'open' : ''}>
            <summary>Show the ${plural(r.issues.length, 'skipped row')}</summary>
            <div class="table-wrap"><table><thead><tr><th>List</th><th>Line</th><th>Name</th><th>Room</th><th>Problem</th></tr></thead><tbody>
              ${r.issues.map((x) => html`<tr><td class="small">${x.list}</td><td class="muted num">${x.line}</td><td>${x.name || '—'}</td><td class="num">${x.room || '—'}</td><td class="small" style="color:var(--danger)">${x.problem}</td></tr>`)}
            </tbody></table></div>
            <p class="muted small" style="margin-top:8px">Fix these in the file and import again, or add them by hand.</p>
          </details>` : ''}
      ` : html`<p class="muted small" style="margin-top:14px">Add at least one list to see the guests.</p>`}
    `;
  }

  // Dropping files anywhere on this page works, not only on the box.
  let dragDepth = 0;
  const onDragEnter = (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); dragDepth++; dropzone.classList.add('dragging'); } };
  const onDragOver = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
  const onDragLeave = () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropzone.classList.remove('dragging'); };
  const onDrop = (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('dragging');
    handleFiles([...e.dataTransfer.files], null);
  };
  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);

  drawList();
  nameIn.focus();
  return () => {
    window.removeEventListener('dragenter', onDragEnter);
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('dragleave', onDragLeave);
    window.removeEventListener('drop', onDrop);
  };
}

// =====================================================================
//  ACTIVE BREAKFAST SHIFT — search, check in, unknown arrivals, finish
// =====================================================================
export async function renderActiveShift() {
  const el = view();
  let data = await api('GET', '/api/shifts/active');
  if (!data.shift) {
    el.innerHTML = String(html`
      <div class="card card-pad empty">
        <div class="empty-icon">${icons.guests}</div>
        <h3>No shift is active right now</h3>
        <p>Prepare the guest list to start a new breakfast shift.</p>
        <p style="margin-top:16px"><a class="btn btn-gold" href="#/prepare">Start new shift</a></p>
      </div>`);
    return;
  }

  const shiftId = data.shift.id;
  let query = '';
  let filter = 'waiting';
  // How many people are expected from each room (worked out again whenever the data changes).
  let peopleCache = { of: null, map: new Map() };
  const roomPeople = (room) => {
    if (peopleCache.of !== data) peopleCache = { of: data, map: peopleByRoom(data.guests) };
    return peopleCache.map.get(room) || 1;
  };
  let seenRecent = new Set(data.recent.map((r) => r.id));
  let flashId = null;
  let finishing = false;

  el.innerHTML = String(html`
    <div class="shift-bar">
      <div class="meta">
        <span class="live-pill" style="background:var(--success-soft);color:var(--success)">Shift active</span>
        <h1>Breakfast attendance</h1>
        <span class="muted small" id="shift-meta"></span>
      </div>
      <button class="btn btn-danger-outline" id="finish-btn">Finish shift</button>
    </div>

    <div class="stats" id="stats"></div>

    <div class="shift-grid">
      <div>
        <div class="search-box">
          ${icons.search}
          <input class="search-input" id="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" aria-label="Search by room number or guest name">
          <button class="btn btn-ghost search-clear hidden" id="clear-search">Clear</button>
          <div class="search-mode" role="group" aria-label="Keyboard">
            <button type="button" data-mode="room" title="Number keyboard for room numbers">123</button>
            <button type="button" data-mode="name" title="Letter keyboard for names">ABC</button>
          </div>
        </div>
        <div class="search-help">
          <span>Type a room like <b>1208</b>, or tap <b>ABC</b> to search by name. <span class="kbd">Enter</span> checks in a single match</span>
          <div class="filters" id="filters"></div>
        </div>
        <div class="results" id="results"></div>
      </div>

      <aside class="card side-card">
        <div class="card-head">
          <h2>Recent arrivals</h2>
          <div class="side-actions">
            <button class="btn btn-ghost btn-sm" id="open-add-guest">+ Add guest</button>
            <button class="btn btn-ghost btn-sm" id="open-unknown">+ Unknown arrival</button>
          </div>
        </div>
        <ul class="recent-list" id="recent"></ul>
      </aside>
    </div>
  `);

  const searchIn = el.querySelector('#search');

  // 123 = number keyboard for rooms (default), ABC = letters for names. Remembered on this tablet.
  let mode = 'room';
  try { mode = localStorage.getItem('bm-search-mode') || 'room'; } catch { /* ignore */ }
  function setMode(m, focus = true) {
    mode = m;
    try { localStorage.setItem('bm-search-mode', m); } catch { /* ignore */ }
    searchIn.setAttribute('inputmode', m === 'room' ? 'numeric' : 'text');
    searchIn.placeholder = m === 'room' ? 'Room number' : 'Guest name';
    el.querySelectorAll('.search-mode [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    if (focus) { searchIn.blur(); setTimeout(() => searchIn.focus(), 30); }
  }
  setMode(mode, false);
  el.querySelector('.search-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) setMode(b.dataset.mode);
  });

  // Keep the screen on during breakfast service (Android/Chrome).
  let wakeLock = null;
  const keepAwake = async () => {
    try { if (document.visibilityState === 'visible' && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed */ }
  };
  const onVisible = () => { if (document.visibilityState === 'visible') keepAwake(); };
  keepAwake();
  document.addEventListener('visibilitychange', onVisible);

  // ---------- drawing ----------
  function drawMeta() {
    el.querySelector('#shift-meta').textContent =
      `Started ${fmtTime(data.shift.startedAt)} by ${data.shift.startedByName}`;
  }

  function drawStats() {
    const s = data.stats;
    const pct = s.expected ? Math.round((s.checkedIn / s.expected) * 100) : 0;
    el.querySelector('#stats').innerHTML = String(html`
      <div class="stat navy"><div class="label">Expected</div><div class="value">${s.expected}</div>
        <div class="progress"><i style="width:${pct}%"></i></div><div class="sub">${s.expectedPeople && s.expectedPeople !== s.expected ? `${s.expectedPeople} people · ` : ''}${pct}% arrived</div></div>
      <div class="stat s-arrived"><div class="label">Checked in</div><div class="value">${s.checkedIn}</div><div class="sub">${s.totalArrivals} arrivals incl. unknown</div></div>
      <div class="stat s-remaining"><div class="label">Remaining</div><div class="value">${s.remaining}</div><div class="sub">not arrived yet</div></div>
      <div class="stat s-diamond"><div class="label">Diamond</div><div class="value">${s.diamond}</div><div class="sub">arrivals</div></div>
      <div class="stat s-gold"><div class="label">Gold</div><div class="value">${s.gold}</div><div class="sub">arrivals</div></div>
      <div class="stat s-member"><div class="label">Member</div><div class="value">${s.member}</div><div class="sub">arrivals</div></div>
      <div class="stat s-unknown"><div class="label">Unknown</div><div class="value">${s.unknown}</div><div class="sub">arrivals</div></div>
    `);
  }

  function drawFilters() {
    const waiting = data.guests.filter((g) => !g.arrival).length;
    const arrived = data.guests.length - waiting;
    const chip = (key, label, n) => html`<button class="chip ${filter === key ? 'active' : ''}" data-filter="${key}">${label}<span class="n">${n}</span></button>`;
    el.querySelector('#filters').innerHTML = query ? '' : String(html`
      ${chip('waiting', 'Waiting', waiting)}${chip('arrived', 'Arrived', arrived)}${chip('all', 'All', data.guests.length)}`);
  }

  function matches() {
    const q = query.trim();
    if (!q) {
      const list = data.guests.filter((g) => filter === 'all' || (filter === 'waiting' ? !g.arrival : g.arrival));
      return list.sort((a, b) => (!!a.arrival - !!b.arrival) || Number(a.room) - Number(b.room));
    }
    if (/^\d+$/.test(q)) {
      // Room search: exact room first, then rooms starting with what was typed.
      return data.guests
        .filter((g) => g.room.startsWith(q))
        .sort((a, b) => (b.room === q) - (a.room === q) || Number(a.room) - Number(b.room));
    }
    const nq = normalize(q);
    return data.guests.filter((g) => normalize(g.fullName).includes(nq));
  }

  function guestCard(g) {
    return html`
      <div class="guest ${g.arrival ? 'arrived' : ''} ${flashId === g.id ? 'flash' : ''}" data-guest="${g.id}">
        <div class="room-block"><b>${g.room}</b><span>Floor ${g.floor}</span></div>
        <div class="guest-main">
          <div class="guest-name">${g.fullName}</div>
          <div class="guest-meta">
            ${rankBadge(g.rank)}
            ${paxChip(roomPeople(g.room), true)}
            <span class="status ${g.arrival ? 'arrived' : 'waiting'}">${g.arrival ? 'Arrived' : 'Not arrived'}</span>
          </div>
        </div>
        <div class="guest-side">
          ${g.arrival ? html`
            <div class="arrived-box">${CHECK_SVG}<b>Arrived</b><span>${fmtTime(g.arrival.arrivedAt)} · ${g.arrival.checkedInName}</span>
              <button class="link-btn small" data-undo="${g.arrival.id}" data-name="${g.fullName}" data-room="${g.room}">Undo</button></div>` : html`
            <button class="checkin-box" data-checkin="${g.id}">${CHECK_SVG}<span>Check in</span></button>`}
        </div>
      </div>`;
  }

  function unknownCard() {
    const q = query.trim();
    const isDigits = /^\d+$/.test(q);
    const room = isDigits ? parseRoom(q) : null;
    return html`
      <div class="unknown-card">
        <div class="top"><span class="badge UNKNOWN">Unknown</span><span class="big">UNKNOWN</span></div>
        <p>${isDigits ? html`Room <b>${q}</b> is` : html`<b>“${q}”</b> is`} not on today’s expected guest list.
          ${room && !room.ok ? html`<br><span style="color:var(--danger);font-weight:600">${room.error}</span>` : ''}</p>
        <form class="unknown-form" id="unknown-inline">
          <div class="field"><input class="input" name="room" inputmode="numeric" maxlength="4" placeholder="Room" value="${isDigits ? q : ''}"></div>
          <div class="field"><input class="input" name="name" maxlength="100" placeholder="Guest name (optional)" value="${isDigits ? '' : q}"></div>
          <button class="btn btn-primary" type="submit">Register unknown arrival</button>
        </form>
        <p class="muted small" style="margin-top:10px">Unknown guests are counted separately and never get a Diamond, Gold or Member rank.
          If this guest should have been on today’s list, <button type="button" class="link-btn small" id="add-from-unknown">add them to the guest list</button> instead.</p>
      </div>`;
  }

  function drawResults() {
    const list = matches();
    const box = el.querySelector('#results');
    el.querySelector('#clear-search').classList.toggle('hidden', !query);
    if (query.trim() && list.length === 0) {
      box.innerHTML = String(unknownCard());
      return;
    }
    if (!list.length) {
      box.innerHTML = String(html`<div class="card empty"><h3>${filter === 'waiting' ? 'Everyone has arrived 🎉' : 'Nobody here yet'}</h3>
        <p>${filter === 'waiting' ? 'All expected guests are checked in.' : 'Checked-in guests will appear here.'}</p></div>`);
    } else {
      box.innerHTML = String(html`${list.map(guestCard)}`);
    }
    // Unknown arrivals are listed under the "All" and "Arrived" views.
    if (!query && filter !== 'waiting' && data.unknownArrivals.length) {
      box.insertAdjacentHTML('beforeend', String(html`
        <div class="card" style="margin-top:8px">
          <div class="card-head"><h2>Unknown arrivals <span class="muted">(${data.unknownArrivals.length})</span></h2></div>
          <div class="table-wrap"><table class="stack"><thead><tr><th>Room</th><th>Name</th><th>Arrived</th><th>Registered by</th><th></th></tr></thead><tbody>
          ${data.unknownArrivals.map((u) => html`<tr>
            <td class="room-cell">${u.room || '—'}</td><td class="td-name">${u.name || html`<span class="muted">No name</span>`}</td>
            <td class="num" data-label="Arrived">${fmtTime(u.arrivedAt)}</td><td data-label="Registered by">${u.checkedInName}</td>
            <td class="actions"><button class="link-btn small" data-undo="${u.id}" data-name="${u.name || 'Unknown guest'}" data-room="${u.room || ''}">Undo</button></td>
          </tr>`)}
          </tbody></table></div>
        </div>`));
    }
  }

  function drawRecent() {
    const ul = el.querySelector('#recent');
    if (!data.recent.length) {
      ul.innerHTML = String(html`<li style="display:block;text-align:center;padding:30px 18px" class="muted">No arrivals yet.</li>`);
      return;
    }
    ul.innerHTML = String(html`${data.recent.map((r) => html`
      <li class="${seenRecent.has(r.id) ? '' : 'new'}">
        <span class="recent-room">${r.room || '—'}</span>
        <span style="min-width:0"><div class="recent-name">${r.name || 'Unknown guest'}</div>${rankBadge(r.rank)}</span>
        <span class="recent-time">${fmtTime(r.arrivedAt)}<div class="small">${r.checkedInName}</div></span>
      </li>`)}`);
    seenRecent = new Set(data.recent.map((r) => r.id));
  }

  function drawAll() { drawMeta(); drawStats(); drawFilters(); drawResults(); drawRecent(); }

  // ---------- actions ----------
  function showAlreadyArrived(name, room, arrivedAt, by) {
    const people = roomPeople(room);
    if (people > 1) {
      // A room for several people: the first one is registered, the others simply go in.
      const waiting = data.guests.filter((x) => x.room === room && !x.arrival);
      buzz(35);
      play(currentTheme(), 'note');
      openModal(String(html`
        <div class="modal-head room-alert"><span class="room-tag">Room ${room} · already registered</span>
          <h2 style="margin-top:10px">Expecting ${people} people</h2>
          <p><b>${name}</b> was checked in at <b>${fmtTime(arrivedAt)}</b> by ${by}.
            This room is registered for <b>${people} people</b>, so the others from the room can go in — no need to check them in again.</p>
          ${waiting.length ? html`<p class="small">Also on the list for this room: ${waiting.map((x) => x.fullName).join(', ')}.</p>` : ''}</div>
        <div class="modal-foot"><button class="btn btn-primary" data-close>OK</button></div>`),
        (m, close) => { m.querySelector('[data-close]').onclick = close; });
      return;
    }
    buzz([80, 60, 80]);
    play(currentTheme(), 'warn');
    openModal(String(html`
      <div class="modal-head dup-alert"><span class="dup-tag">Duplicate prevented</span>
        <h2 style="margin-top:10px">Already arrived</h2>
        <p><b>${name}</b> (room ${room}) was already checked in at <b>${fmtTime(arrivedAt)}</b> by ${by}. This room is registered for 1 person.</p></div>
      <div class="modal-foot"><button class="btn btn-primary" data-close>OK</button></div>`),
      (m, close) => { m.querySelector('[data-close]').onclick = close; });
  }

  async function checkIn(guestId, button) {
    const g = data.guests.find((x) => x.id === guestId);
    if (g?.arrival) return showAlreadyArrived(g.fullName, g.room, g.arrival.arrivedAt, g.arrival.checkedInName);
    setBusy(button, true, 'Checking in…');
    try {
      data = await api('POST', `/api/shifts/${shiftId}/checkin`, { guestId });
      const ng = data.guests.find((x) => x.id === guestId);
      buzz(35);
      celebrate({ name: ng.fullName, room: ng.room, rank: ng.rank });
      toast(`${ng.fullName} (${ng.room}) checked in at ${fmtTime(ng.arrival.arrivedAt)}.`, 'success');
      flashId = guestId;
      query = '';
      searchIn.value = '';
      drawAll();
      flashId = null;
      searchIn.focus();
    } catch (err) {
      if (err.data?.code === 'ALREADY_ARRIVED') {
        showAlreadyArrived(g.fullName, g.room, err.data.arrivedAt, err.data.checkedInName);
        await reload();
      } else {
        toast(err.message, 'error');
        setBusy(button, false);
      }
    }
  }

  async function registerUnknown(room, name) {
    try {
      data = await api('POST', `/api/shifts/${shiftId}/unknown`, { room, name });
      buzz(35);
      celebrate({ name: name || 'Unknown guest', room, rank: 'UNKNOWN' });
      toast(`Unknown arrival registered${room ? ` for room ${room}` : ''}.`, 'success');
      query = '';
      searchIn.value = '';
      drawAll();
      searchIn.focus();
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    }
  }

  // Late guest: add someone to today's expected list during the shift (logged), optionally checking them in at once.
  function openAddGuestModal(prefill = {}) {
    openModal(String(html`
      <div class="modal-head"><h2>Add guest to today’s list</h2>
        <p>For an expected guest who was missing from the list. The addition is recorded in the shift log.</p></div>
      <form>
        <div class="modal-body">
          <div id="ag-error"></div>
          <div class="name-row">
            <div class="field"><label for="ag-first">First name</label><input class="input" id="ag-first" name="first" maxlength="50" value="${prefill.first || ''}" autofocus></div>
            <div class="field"><label for="ag-last">Last name</label><input class="input" id="ag-last" name="last" maxlength="50" value="${prefill.last || ''}"></div>
          </div>
          <div class="room-row">
            <div class="field"><label for="ag-room">Room number</label><input class="input room-input" id="ag-room" name="room" inputmode="numeric" maxlength="4" value="${prefill.room || ''}"><span class="hint" id="ag-hint"></span></div>
            <div class="field"><label for="ag-people">People</label>
              <select class="select people-select" id="ag-people" name="people">${PEOPLE_CHOICES.map((n) => html`<option value="${n}">${n}</option>`)}</select>
              <span class="hint">in room</span></div>
          </div>
          <div class="field"><label for="ag-rank">Membership</label>
            <select class="select" id="ag-rank" name="rank"><option value="">Select membership…</option>${RANKS.map((r) => html`<option value="${r}">${r}</option>`)}</select>
            <span class="hint">Silver guests count as Member.</span></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-outline" data-close>Cancel</button>
          <button type="submit" class="btn btn-outline" value="add">Add to list</button>
          <button type="submit" class="btn btn-gold" value="checkin">Add &amp; check in</button>
        </div>
      </form>`), (m, close) => {
      m.querySelector('[data-close]').onclick = close;
      const roomField = m.querySelector('[name=room]');
      const hint = m.querySelector('#ag-hint');
      const peopleField = m.querySelector('[name=people]');
      let peopleTouched = false;
      peopleField.addEventListener('change', () => { peopleTouched = true; });
      const showHint = () => {
        roomField.value = roomField.value.replace(/\D/g, '');
        const r = parseRoom(roomField.value);
        hint.className = 'hint ' + (r.ok ? 'ok' : roomField.value.length >= 3 ? 'err' : '');
        hint.textContent = r.ok ? `✓ Floor ${r.floor}` : roomField.value.length >= 3 ? r.error : '';
        // A room that is already on the list starts with its current number of people.
        if (r.ok && !peopleTouched) {
          const n = data.guests.some((x) => x.room === r.room) ? Math.min(10, roomPeople(r.room)) : 1;
          peopleField.value = String(n);
        }
      };
      roomField.addEventListener('input', showHint);
      showHint();
      if (prefill.first) m.querySelector(prefill.room ? '[name=rank]' : '[name=room]').focus();
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const first = f.first.trim().replace(/\s+/g, ' ');
        const last = f.last.trim().replace(/\s+/g, ' ');
        const problems = [];
        if (!first) problems.push('Enter the first name.');
        if (!last) problems.push('Enter the last name.');
        const r = parseRoom(f.room);
        if (!r.ok) problems.push(r.error);
        if (!RANKS.includes(f.rank)) problems.push('Choose a membership.');
        const errBox = m.querySelector('#ag-error');
        if (problems.length) {
          errBox.innerHTML = String(html`<div class="form-error">${problems.map((x) => html`<div>${x}</div>`)}</div>`);
          return;
        }
        const alsoCheckIn = e.submitter?.value === 'checkin';
        m.querySelectorAll('button').forEach((b) => (b.disabled = true));
        try {
          const pax = paxForRoom(data.guests, r.room, Number(f.people) || 1);
          const res = await api('POST', `/api/shifts/${shiftId}/guests`, { fullName: `${first} ${last}`, room: r.room, rank: f.rank, pax });
          data = res;
          if (alsoCheckIn) data = await api('POST', `/api/shifts/${shiftId}/checkin`, { guestId: res.addedGuestId });
          close();
          if (alsoCheckIn) celebrate({ name: `${first} ${last}`, room: r.room, rank: f.rank });
          toast(alsoCheckIn ? `${first} ${last} (${r.room}) added and checked in.` : `${first} ${last} (${r.room}) added to today’s list.`, 'success');
          flashId = res.addedGuestId;
          query = ''; searchIn.value = '';
          drawAll();
          flashId = null;
          searchIn.focus();
        } catch (err) {
          errBox.innerHTML = String(html`<div class="form-error">${err.message}</div>`);
          m.querySelectorAll('button').forEach((b) => (b.disabled = false));
        }
      });
    });
  }

  function openUnknownModal() {
    openModal(String(html`
      <div class="modal-head"><h2>Register unknown arrival</h2>
        <p>For a guest who is not on the expected list. They will be counted as <b>UNKNOWN</b>.</p></div>
      <form id="unknown-modal-form">
        <div class="modal-body">
          <div class="field"><label>Room number</label><input class="input room-input" name="room" inputmode="numeric" maxlength="4" autofocus><span class="hint" id="um-hint"></span></div>
          <div class="field"><label>Guest name <span class="muted">(optional)</span></label><input class="input" name="name" maxlength="100"></div>
        </div>
        <div class="modal-foot"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-primary" type="submit">Register arrival</button></div>
      </form>`), (m, close) => {
      m.querySelector('[data-close]').onclick = close;
      const roomField = m.querySelector('[name=room]');
      roomField.addEventListener('input', () => {
        roomField.value = roomField.value.replace(/\D/g, '');
        const r = parseRoom(roomField.value);
        const hint = m.querySelector('#um-hint');
        hint.className = 'hint ' + (r.ok ? 'ok' : roomField.value.length >= 3 ? 'err' : '');
        hint.textContent = r.ok ? `✓ Floor ${r.floor}` : roomField.value.length >= 3 ? r.error : '';
      });
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        if (await registerUnknown(f.room.trim(), f.name.trim())) close();
      });
    });
  }

  async function undo(arrivalId, name, room) {
    const ok = await confirmDialog({
      title: 'Undo this check-in?',
      text: `${name}${room ? ` (room ${room})` : ''} will be marked as not arrived. This action is recorded in the shift log.`,
      confirmText: 'Undo check-in',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      data = await api('DELETE', `/api/shifts/${shiftId}/arrivals/${arrivalId}`);
      toast('Check-in undone.');
      drawAll();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function finishShift() {
    const fresh = await api('GET', '/api/shifts/active');
    if (fresh.shift) data = fresh;
    const s = data.stats;
    const ok = await confirmDialog({
      title: 'Finish this shift?',
      text: 'The shift will be saved permanently and moved to Previous Shifts.',
      body: String(html`<div class="summary">
        <div class="summary-row"><span>Total expected guests</span><b>${s.expected}</b></div>
        <div class="summary-row total"><span>Total actual arrivals</span><b>${s.totalArrivals}</b></div>
        <div class="summary-row"><span>${rankBadge('DIAMOND')} arrivals</span><b>${s.diamond}</b></div>
        <div class="summary-row"><span>${rankBadge('GOLD')} arrivals</span><b>${s.gold}</b></div>
        <div class="summary-row"><span>${rankBadge('MEMBER')} arrivals</span><b>${s.member}</b></div>
        <div class="summary-row"><span>${rankBadge('UNKNOWN')} arrivals</span><b>${s.unknown}</b></div>
        <div class="summary-row warn"><span>Guests who did not arrive</span><b>${s.notArrived}</b></div>
      </div>`),
      cancelText: 'Keep shift active',
      confirmText: 'Confirm & finish shift',
      variant: 'danger',
    });
    if (!ok) return;
    finishing = true;
    try {
      await api('POST', `/api/shifts/${shiftId}/finish`);
      await refreshMe();
      toast('Shift completed and saved.', 'success');
      go(`/history/${shiftId}`);
    } catch (err) { finishing = false; toast(err.message, 'error'); }
  }

  async function reload() {
    if (finishing || !document.body.contains(el)) return;
    const fresh = await api('GET', '/api/shifts/active');
    if (finishing) return;
    if (!fresh.shift || fresh.shift.id !== shiftId) {
      toast('This shift was finished by another employee.');
      go(`/history/${shiftId}`);
      return;
    }
    data = fresh;
    drawStats(); drawFilters(); drawRecent();
    // Don't redraw results while someone is typing in the inline unknown form.
    if (!el.querySelector('#unknown-inline')?.contains(document.activeElement)) drawResults();
  }

  // ---------- events ----------
  searchIn.addEventListener('input', () => { query = searchIn.value; drawFilters(); drawResults(); });
  searchIn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { query = ''; searchIn.value = ''; drawFilters(); drawResults(); }
    if (e.key === 'Enter') {
      // Stop the same Enter press from also pressing the OK button of the pop-up it opens.
      e.preventDefault();
      const list = matches();
      if (query.trim() && list.length === 1) checkIn(list[0].id, el.querySelector(`[data-checkin="${list[0].id}"]`));
      else if (query.trim() && list.length === 0) el.querySelector('#unknown-inline button')?.focus();
    }
  });
  el.querySelector('#clear-search').addEventListener('click', () => { query = ''; searchIn.value = ''; drawFilters(); drawResults(); searchIn.focus(); });
  el.querySelector('#filters').addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]')?.dataset.filter;
    if (f) { filter = f; drawFilters(); drawResults(); }
  });
  el.querySelector('#results').addEventListener('click', (e) => {
    const c = e.target.closest('[data-checkin]');
    if (c) return checkIn(Number(c.dataset.checkin), c);
    const u = e.target.closest('[data-undo]');
    if (u) return undo(Number(u.dataset.undo), u.dataset.name, u.dataset.room);
  });
  el.querySelector('#results').addEventListener('submit', async (e) => {
    if (e.target.id !== 'unknown-inline') return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await registerUnknown(f.room.trim(), f.name.trim());
  });
  el.querySelector('#open-unknown').addEventListener('click', openUnknownModal);
  el.querySelector('#open-add-guest').addEventListener('click', () => openAddGuestModal());
  el.querySelector('#results').addEventListener('click', (e) => {
    if (e.target.id !== 'add-from-unknown') return;
    const q = query.trim();
    if (/^\d+$/.test(q)) return openAddGuestModal({ room: q });
    const parts = q.split(/\s+/);
    openAddGuestModal({ first: parts[0], last: parts.slice(1).join(' ') });
  });
  el.querySelector('#finish-btn').addEventListener('click', finishShift);

  const onKey = (e) => {
    if (e.key === '/' && document.activeElement !== searchIn && !document.querySelector('.modal-backdrop') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault(); searchIn.focus();
    }
  };
  const onLive = (e) => { if (e.detail.shiftId === shiftId) reload(); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('live', onLive);

  drawAll();
  searchIn.focus();
  return () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('live', onLive);
    document.removeEventListener('visibilitychange', onVisible);
    wakeLock?.release?.().catch(() => {});
  };
}

void raw; void esc;
