// PREVIOUS SHIFTS — list by calendar date, and full read-only detail (managers can log corrections).
import { api, html, raw, icons, toast, openModal, fmtTime, fmtDateLong, fmtDateShort, rankBadge, setBusy, downloadExport } from './lib.js';
import { state, view, go } from './app.js';

const trashIcon = raw('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>');

// Asks for the delete code, then permanently deletes the shift.
function deleteShiftModal(shift, onDeleted) {
  const label = `${fmtDateLong(shift.shiftDate)} · ${fmtTime(shift.startedAt)}${shift.finishedAt ? ` – ${fmtTime(shift.finishedAt)}` : ''}`;
  openModal(String(html`
    <div class="modal-head"><h2>Delete shift</h2><p>${label}</p></div>
    <form autocomplete="off">
      <div class="modal-body">
        <div id="d-error"></div>
        <p>This permanently deletes the shift, its guest list, all arrivals and its activity log. It cannot be undone.</p>
        <div class="field"><label>Delete code</label><input class="input" type="password" name="code" required autofocus autocomplete="off" placeholder="Enter the delete code"></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-danger" type="submit">Delete shift</button></div>
    </form>`), (m, close) => {
    m.querySelector('[data-close]').onclick = close;
    m.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = new FormData(e.target).get('code');
      const btn = e.target.querySelector('[type=submit]');
      setBusy(btn, true, 'Deleting…');
      try {
        await api('DELETE', `/api/shifts/${shift.id}`, { code });
        close();
        toast('Shift deleted.', 'success');
        onDeleted();
      } catch (err) {
        m.querySelector('#d-error').innerHTML = String(html`<div class="form-error">${err.message}</div>`);
        const input = m.querySelector('[name=code]');
        input.value = '';
        input.focus();
        setBusy(btn, false);
      }
    });
  });
}

export async function renderHistory() {
  const el = view();
  const { shifts } = await api('GET', '/api/shifts');

  const groups = new Map();
  for (const s of shifts) {
    if (!groups.has(s.shiftDate)) groups.set(s.shiftDate, []);
    groups.get(s.shiftDate).push(s);
  }

  el.innerHTML = String(html`
    <div class="page-head">
      <div>
        <div class="eyebrow">Shared team history</div>
        <h1>Previous shifts</h1>
        <p>Every completed breakfast shift, organised by date. Records are permanent and read-only.</p>
      </div>
    </div>
    ${shifts.length === 0 ? html`
      <div class="card empty"><div class="empty-icon">${icons.history}</div><h3>No completed shifts yet</h3>
        <p>When a shift is finished, it will be saved here for the whole team.</p></div>` : ''}
    ${[...groups].map(([date, list]) => html`
      <section class="date-group">
        <h3>${fmtDateLong(date)}</h3>
        <div class="card">
          ${list.map((s) => html`
            <div class="shift-item">
            <a class="shift-row" href="#/history/${s.id}">
              <div><div class="times">${fmtTime(s.startedAt)} – ${fmtTime(s.finishedAt)}</div><div class="muted small">Started by ${s.startedByName}</div></div>
              <div class="mini-stats">
                <span class="mini d">${s.stats.diamond} Diamond</span><span class="mini g">${s.stats.gold} Gold</span>
                <span class="mini m">${s.stats.member} Member</span><span class="mini u">${s.stats.unknown} Unknown</span>
                <span class="mini">${s.stats.notArrived} did not arrive</span>
              </div>
              <div class="arrival-ratio"><b>${s.stats.checkedIn}/${s.stats.expected}</b><div class="muted small">expected arrived</div></div>
              <span class="muted">${icons.arrow}</span>
            </a>
            <button class="shift-del" type="button" title="Delete shift" aria-label="Delete shift" data-delete-shift="${s.id}">${trashIcon}</button>
            </div>`)}
        </div>
      </section>`)}
  `);

  el.onclick = (e) => {
    const b = e.target.closest('[data-delete-shift]');
    if (!b) return;
    e.preventDefault();
    const shift = shifts.find((x) => x.id === Number(b.dataset.deleteShift));
    if (shift) deleteShiftModal(shift, () => renderHistory());
  };
}

function describe(a) {
  const d = a.details || {};
  const who = (n, r) => `${n || 'Unknown guest'}${r ? ` (${r})` : ''}`;
  switch (a.action) {
    case 'guest_added': return `Added ${who(d.name, d.room)} to the list during the shift (${d.rank})`;
    case 'shift_started': return `Started the shift with ${d.expectedGuests} expected guests`;
    case 'guest_checked_in': return `Checked in ${who(d.name, d.room)}`;
    case 'unknown_arrival_registered': return `Registered unknown arrival: ${who(d.name, d.room)}`;
    case 'checkin_undone': return `Undid check-in of ${who(d.name, d.room)} (was ${fmtTime(d.originalArrival)} by ${d.originalCheckedInBy})`;
    case 'shift_finished': return `Finished the shift — ${d.totalArrivals} arrivals, ${d.notArrived} did not arrive`;
    case 'correction': return `Correction: ${who(d.name, d.room)} ${d.change}${d.arrivedAt ? ` at ${fmtTime(d.arrivedAt)}` : ''}. Reason: “${d.reason}”`;
    default: return a.action.replace(/_/g, ' ');
  }
}

export async function renderShiftDetail(id) {
  const el = view();
  let data;
  try { data = await api('GET', `/api/shifts/${id}`); }
  catch (err) {
    el.innerHTML = String(html`<div class="card empty"><h3>${err.message}</h3><p><a href="#/history">Back to previous shifts</a></p></div>`);
    return;
  }
  if (data.shift.status === 'ACTIVE') return go('/shift');

  const isManager = state.me.role === 'manager';
  let filter = 'all';

  const draw = () => {
    const s = data.finalStats || data.stats;
    const guests = data.guests.filter((g) => filter === 'all' || (filter === 'arrived' ? g.arrival : !g.arrival));
    const arrivedCount = data.guests.filter((g) => g.arrival).length;
    const chip = (key, label, n) => html`<button class="chip ${filter === key ? 'active' : ''}" data-filter="${key}">${label}<span class="n">${n}</span></button>`;

    el.innerHTML = String(html`
      <a class="back" href="#/history">${icons.back} Previous shifts</a>
      <div class="page-head">
        <div>
          <div class="eyebrow">Completed shift</div>
          <h1>${fmtDateLong(data.shift.shiftDate)}</h1>
        </div>
        <div class="head-actions">
          <span class="badge MEMBER" style="color:var(--success);background:var(--success-soft);border-color:#bfe3cf">Completed</span>
          <button class="btn btn-outline btn-sm no-print" type="button" data-export="/api/shifts/${data.shift.id}/export">${icons.download} Download CSV</button>
          <button class="btn btn-danger-outline btn-sm no-print" type="button" data-delete-this>${trashIcon} Delete shift</button>
        </div>
      </div>

      ${isManager
        ? html`<div class="readonly-note">${icons.lock}<span>You’re a manager: you can correct attendance below. Every correction requires a reason and is logged permanently.</span></div>`
        : html`<div class="readonly-note">${icons.lock}<span>This shift is read-only. Ask a manager if a record needs correcting.</span></div>`}

      <div class="card" style="margin-bottom:22px">
        <div class="meta-grid">
          <div><div class="label">Started</div><div class="val">${fmtTime(data.shift.startedAt)}</div></div>
          <div><div class="label">Finished</div><div class="val">${fmtTime(data.shift.finishedAt)}</div></div>
          <div><div class="label">Started by</div><div class="val">${data.shift.startedByName}</div></div>
          <div><div class="label">Finished by</div><div class="val">${data.shift.finishedByName || '—'}</div></div>
        </div>
      </div>

      <div class="stats">
        <div class="stat navy"><div class="label">Expected</div><div class="value">${s.expected}</div><div class="sub">${s.totalArrivals} total arrivals</div></div>
        <div class="stat s-arrived"><div class="label">Checked in</div><div class="value">${s.checkedIn}</div><div class="sub">expected guests</div></div>
        <div class="stat s-remaining"><div class="label">Not arrived</div><div class="value">${s.notArrived}</div><div class="sub">did not arrive</div></div>
        <div class="stat s-diamond"><div class="label">Diamond</div><div class="value">${s.diamond}</div><div class="sub">arrivals</div></div>
        <div class="stat s-gold"><div class="label">Gold</div><div class="value">${s.gold}</div><div class="sub">arrivals</div></div>
        <div class="stat s-member"><div class="label">Member</div><div class="value">${s.member}</div><div class="sub">arrivals</div></div>
        <div class="stat s-unknown"><div class="label">Unknown</div><div class="value">${s.unknown}</div><div class="sub">arrivals</div></div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Expected guest list</h2>
          <div class="filters">${chip('all', 'All', data.guests.length)}${chip('arrived', 'Arrived', arrivedCount)}${chip('missing', 'Did not arrive', data.guests.length - arrivedCount)}</div>
        </div>
        <div class="table-wrap"><table class="stack">
          <thead><tr><th>Room</th><th>Floor</th><th>Guest</th><th>Membership</th><th>Status</th><th>Arrival time</th><th>Checked in by</th>${isManager ? html`<th></th>` : ''}</tr></thead>
          <tbody>
            ${guests.length ? '' : html`<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">No guests in this view.</td></tr>`}
            ${guests.map((g) => html`<tr>
              <td class="room-cell">${g.room}<span class="floor-sm">Floor ${g.floor}</span></td>
              <td class="floor-tag td-hide-sm">${g.floor}</td>
              <td class="td-name"><b>${g.fullName}</b></td>
              <td data-label="Membership">${rankBadge(g.rank)}</td>
              <td data-label="Status"><span class="status ${g.arrival ? 'arrived' : 'waiting'}">${g.arrival ? 'Arrived' : 'Did not arrive'}</span></td>
              <td class="num" data-label="Arrival">${g.arrival ? fmtTime(g.arrival.arrivedAt) : '—'}</td>
              <td data-label="Checked in by">${g.arrival ? g.arrival.checkedInName : '—'}</td>
              ${isManager ? html`<td class="actions"><button class="btn btn-ghost btn-sm" data-correct="${g.id}">Correct</button></td>` : ''}
            </tr>`)}
          </tbody>
        </table></div>
      </div>

      <div class="card section">
        <div class="card-head"><h2>Unknown arrivals <span class="muted">(${data.unknownArrivals.length})</span></h2></div>
        ${data.unknownArrivals.length ? html`
          <div class="table-wrap"><table class="stack">
            <thead><tr><th>Room</th><th>Floor</th><th>Name</th><th>Status</th><th>Arrival time</th><th>Registered by</th>${isManager ? html`<th></th>` : ''}</tr></thead>
            <tbody>${data.unknownArrivals.map((u) => html`<tr>
              <td class="room-cell">${u.room || '—'}${u.floor ? html`<span class="floor-sm">Floor ${u.floor}</span>` : ''}</td><td class="floor-tag td-hide-sm">${u.floor || '—'}</td>
              <td class="td-name">${u.name || html`<span class="muted">No name</span>`}</td><td data-label="Status">${rankBadge('UNKNOWN')}</td>
              <td class="num" data-label="Arrival">${fmtTime(u.arrivedAt)}</td><td data-label="Registered by">${u.checkedInName}</td>
              ${isManager ? html`<td class="actions"><button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-remove-unknown="${u.id}">Remove</button></td>` : ''}
            </tr>`)}</tbody>
          </table></div>` : html`<p class="card-pad muted">No unknown guests arrived during this shift.</p>`}
      </div>

      <div class="card section">
        <div class="card-head"><h2>Shift activity log</h2><span class="muted small">${data.activity.length} recorded actions</span></div>
        <ul class="log-list">
          ${data.activity.map((a) => html`<li class="${a.action === 'correction' ? 'correction' : ''}">
            <span class="t">${fmtTime(a.at)}</span><span class="who">${a.by || '—'}</span><span class="what">${describe(a)}</span>
          </li>`)}
        </ul>
      </div>
    `);
  };

  async function reload() {
    data = await api('GET', `/api/shifts/${id}`);
    draw();
  }

  function correctionModal(kind, target) {
    const isArrived = kind === 'guest' && target.arrival;
    const title = kind === 'unknown' ? 'Remove unknown arrival' : isArrived ? 'Mark as not arrived' : 'Mark as arrived';
    const label = kind === 'unknown' ? `${target.name || 'Unknown guest'}${target.room ? ` · room ${target.room}` : ''}` : `${target.fullName} · room ${target.room}`;
    const defaultTime = fmtTime(data.shift.startedAt);
    openModal(String(html`
      <div class="modal-head"><h2>${title}</h2><p>${label}</p></div>
      <form>
        <div class="modal-body">
          <div id="c-error"></div>
          ${kind === 'guest' && !isArrived ? html`<div class="field"><label>Arrival time</label><input class="input" type="time" name="time" value="${defaultTime}" required></div>` : ''}
          <div class="field"><label>Reason for correction</label><input class="input" name="reason" maxlength="300" required autofocus placeholder="e.g. Guest arrived but wasn’t checked in"></div>
          <p class="muted small">Your name, the time and this reason will be saved in the shift log.</p>
        </div>
        <div class="modal-foot"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save correction</button></div>
      </form>`), (m, close) => {
      m.querySelector('[data-close]').onclick = close;
      m.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const body = { reason: f.reason };
        if (kind === 'unknown') Object.assign(body, { action: 'remove-unknown', arrivalId: target.id });
        else if (isArrived) Object.assign(body, { action: 'mark-not-arrived', guestId: target.id });
        else Object.assign(body, { action: 'mark-arrived', guestId: target.id, arrivedAt: new Date(`${data.shift.shiftDate}T${f.time}`).toISOString() });
        const btn = e.target.querySelector('[type=submit]');
        setBusy(btn, true, 'Saving…');
        try {
          await api('POST', `/api/shifts/${id}/corrections`, body);
          close();
          toast('Correction saved and logged.', 'success');
          reload();
        } catch (err) {
          m.querySelector('#c-error').innerHTML = String(html`<div class="form-error">${err.message}</div>`);
          setBusy(btn, false);
        }
      });
    });
  }

  el.onclick = (e) => {
    if (e.target.closest('[data-delete-this]')) return deleteShiftModal(data.shift, () => go('/history'));
    const ex = e.target.closest('[data-export]');
    if (ex) return downloadExport(ex.dataset.export);
    const f = e.target.closest('[data-filter]')?.dataset.filter;
    if (f) { filter = f; draw(); return; }
    const c = e.target.closest('[data-correct]');
    if (c) return correctionModal('guest', data.guests.find((g) => g.id === Number(c.dataset.correct)));
    const r = e.target.closest('[data-remove-unknown]');
    if (r) return correctionModal('unknown', data.unknownArrivals.find((u) => u.id === Number(r.dataset.removeUnknown)));
  };

  draw();
  void fmtDateShort;
}
