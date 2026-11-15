// ANALYTICS — monthly breakfast statistics from completed shifts.
import { api, html, raw, icons, fmtDateShort, rankBadge, downloadExport } from './lib.js';
import { state, view, go } from './app.js';

const RANK_LABEL = { DIAMOND: 'Diamond', GOLD: 'Gold', MEMBER: 'Member', UNKNOWN: 'Unknown' };
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const monthName = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};
const addMonths = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const num = (n, digits = 0) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const pct = (r) => (r === null || r === undefined ? '—' : `${Math.round(r * 100)}%`);

// "+12% vs October" style comparison. For rates the change is shown in percentage points.
function delta(cur, prev, { isRate = false, lowerIsBetter = false, prevLabel } = {}) {
  if (cur === null || prev === null || prev === undefined || cur === undefined) return '';
  if (!isRate && !prev) return '';
  const diff = isRate ? Math.round((cur - prev) * 100) : Math.round(((cur - prev) / prev) * 100);
  if (diff === 0) return html`<span class="delta flat">No change vs ${prevLabel}</span>`;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return html`<span class="delta ${good ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}${isRate ? ' pts' : '%'} vs ${prevLabel}</span>`;
}

export async function renderAnalytics(match) {
  const el = view();
  const month = match?.[1] || new Date().toISOString().slice(0, 7);
  el.innerHTML = String(html`<div class="card empty"><h3>Loading ${monthName(month)}…</h3></div>`);

  let data;
  try { data = await api('GET', `/api/analytics?month=${month}`); }
  catch (err) { el.innerHTML = String(html`<div class="card empty"><h3>${err.message}</h3></div>`); return; }

  const k = data.kpis;
  const p = data.previous;
  const prevLabel = monthName(addMonths(month, -1)).split(' ')[0];
  // Totals of a month that isn't over yet can't be compared with a full month; rates and averages can.
  const total = (cur, prev, opts = {}) => (data.inProgress ? '' : delta(cur, prev, { prevLabel, ...opts }));
  const hasData = k.shifts > 0;
  const options = [...new Set([month, ...data.months])].sort().reverse();

  const head = html`
    <div class="page-head an-head">
      <div>
        <div class="eyebrow">Monthly report</div>
        <h1>${monthName(month)}</h1>
        <p>${hasData
          ? `${data.inProgress ? 'Month in progress · ' : ''}${k.serviceDays} breakfast day${k.serviceDays === 1 ? '' : 's'}${data.inProgress ? ' so far' : ''} · completed shifts only · times in ${data.timeZone.replace(/_/g, ' ')}`
          : 'No completed shifts in this month yet.'}</p>
      </div>
      <div class="an-controls no-print">
        <div class="month-picker">
          <button class="btn btn-outline btn-sm" data-month="${addMonths(month, -1)}" aria-label="Previous month">‹</button>
          <select class="select" id="month-select" aria-label="Month">
            ${options.map((m) => html`<option value="${m}" ${m === month ? 'selected' : ''}>${monthName(m)}</option>`)}
          </select>
          <button class="btn btn-outline btn-sm" data-month="${addMonths(month, 1)}" aria-label="Next month">›</button>
        </div>
        ${hasData ? html`
          <button class="btn btn-outline btn-sm" type="button" data-export="/api/analytics/export?month=${month}">${icons.download} CSV</button>
          <button class="btn btn-primary btn-sm" id="print-btn">${icons.print} Print / PDF</button>` : ''}
      </div>
    </div>`;

  if (!hasData) {
    el.innerHTML = String(html`${head}
      <div class="card empty"><div class="empty-icon">${icons.chart}</div><h3>Nothing to report for ${monthName(month)}</h3>
        <p>Statistics appear here as soon as a breakfast shift in this month is finished.</p></div>`);
    bind(el);
    return;
  }

  // ---------- KPI tiles ----------
  const kpis = html`
    <div class="kpis">
      <div class="kpi hero">
        <div class="label">Guests served</div>
        <div class="value">${num(k.totalServed)}</div>
        <div class="sub">${num(k.checkedIn)} expected + ${num(k.unknown)} unknown</div>
        ${total(k.totalServed, p.totalServed)}
      </div>
      <div class="kpi">
        <div class="label">Attendance rate</div>
        <div class="value">${pct(k.attendanceRate)}</div>
        <div class="sub">of expected guests came</div>
        ${delta(k.attendanceRate, p.attendanceRate, { isRate: true, prevLabel })}
      </div>
      <div class="kpi">
        <div class="label">Expected guests</div>
        <div class="value">${num(k.expected)}</div>
        <div class="sub">on the guest lists</div>
        ${total(k.expected, p.expected)}
      </div>
      <div class="kpi">
        <div class="label">Did not arrive</div>
        <div class="value">${num(k.noShows)}</div>
        <div class="sub">${pct(k.expected ? k.noShows / k.expected : null)} of expected</div>
        ${data.inProgress ? delta(k.expected ? k.noShows / k.expected : null, p.expected ? p.noShows / p.expected : null, { isRate: true, lowerIsBetter: true, prevLabel }) : total(k.noShows, p.noShows, { lowerIsBetter: true })}
      </div>
      <div class="kpi">
        <div class="label">Average per day</div>
        <div class="value">${num(k.avgServedPerDay, 1)}</div>
        <div class="sub">guests served</div>
        ${delta(k.avgServedPerDay, p.avgServedPerDay, { prevLabel })}
      </div>
      <div class="kpi">
        <div class="label">Unique guests</div>
        <div class="value">${num(k.uniqueGuests)}</div>
        <div class="sub">${num(k.returningGuests)} came on more than one day</div>
      </div>
    </div>`;

  // ---------- Highlights ----------
  const peakEnd = (label) => { const [h, m] = label.split(':').map(Number); const t = h * 60 + m + 30; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const highlights = html`
    <div class="highlights">
      ${k.peakSlot ? html`<div><span class="hl-label">Busiest time</span><b>${k.peakSlot.label}–${peakEnd(k.peakSlot.label)}</b><span class="muted">${pct(k.peakSlot.share)} of all arrivals</span></div>` : ''}
      ${k.busiestDay ? html`<div><span class="hl-label">Busiest day</span><b>${fmtDateShort(k.busiestDay.date)}</b><span class="muted">${k.busiestDay.totalServed} guests served</span></div>` : ''}
      ${k.quietestDay ? html`<div><span class="hl-label">Quietest day</span><b>${fmtDateShort(k.quietestDay.date)}</b><span class="muted">${k.quietestDay.totalServed} guests served</span></div>` : ''}
      ${k.avgShiftMinutes ? html`<div><span class="hl-label">Average shift</span><b>${Math.floor(k.avgShiftMinutes / 60)} h ${String(Math.round(k.avgShiftMinutes % 60)).padStart(2, '0')} min</b><span class="muted">start to finish</span></div>` : ''}
    </div>`;

  // ---------- Daily attendance (stacked bars) ----------
  const maxDay = Math.max(1, ...data.daily.filter((d) => d.service).map((d) => Math.max(d.totalServed, d.expected)));
  const scaleTop = Math.ceil(maxDay / 10) * 10;
  const seg = (cls, n) => (n ? html`<i class="seg ${cls}" style="height:${(n / scaleTop) * 100}%"></i>` : '');
  const dailyChart = html`
    <section class="card an-card">
      <div class="card-head"><h2>Guests served per day</h2>
        <div class="legend">
          <span><i class="sw DIAMOND"></i>Diamond</span><span><i class="sw GOLD"></i>Gold</span>
          <span><i class="sw MEMBER"></i>Member</span><span><i class="sw UNKNOWN"></i>Unknown</span>
          <span><i class="sw expected"></i>Expected</span>
        </div>
      </div>
      <div class="chart-wrap">
        <div class="y-axis"><span>${scaleTop}</span><span>${scaleTop / 2}</span><span>0</span></div>
        <div class="day-chart" style="--days:${data.daily.length}">
          ${data.daily.map((d) => {
            const day = Number(d.date.slice(8));
            const showLabel = day === 1 || day % 5 === 0;
            if (!d.service) return html`<div class="day off" title="${fmtDateShort(d.date)}: no completed shift"><div class="bar"></div><span class="x ${showLabel ? '' : 'hide'}">${day}</span></div>`;
            const tip = `${fmtDateShort(d.date)}: ${d.totalServed} served (${d.diamond} Diamond, ${d.gold} Gold, ${d.member} Member, ${d.unknown} Unknown) · ${d.expected} expected · ${pct(d.rate)} attendance`;
            return html`<div class="day ${d.weekday >= 5 ? 'weekend' : ''}" title="${tip}" aria-label="${tip}">
              <div class="bar">
                <i class="exp" style="bottom:${(d.expected / scaleTop) * 100}%"></i>
                <div class="stack">${seg('UNKNOWN', d.unknown)}${seg('MEMBER', d.member)}${seg('GOLD', d.gold)}${seg('DIAMOND', d.diamond)}</div>
              </div>
              <span class="x ${showLabel ? '' : 'hide'}">${day}</span>
            </div>`;
          })}
        </div>
      </div>
      <p class="chart-note muted small">Shaded columns are weekends. Hover or tap a day for details.</p>
    </section>`;

  // ---------- Arrival times ----------
  const maxSlot = Math.max(1, ...data.timeSlots.map((t) => t.count));
  const timeChart = html`
    <section class="card an-card">
      <div class="card-head"><h2>When guests arrive</h2><span class="muted small">All arrivals, in 30-minute slots</span></div>
      <div class="slots">
        ${data.timeSlots.map((t) => html`
          <div class="slot ${k.peakSlot && t.label === k.peakSlot.label ? 'peak' : ''}" title="${t.label}: ${t.count} arrivals (${pct(t.share)})">
            <span class="slot-n">${t.count || ''}</span>
            <div class="slot-bar"><i style="height:${(t.count / maxSlot) * 100}%"></i></div>
            <span class="slot-x">${t.label}</span>
          </div>`)}
      </div>
    </section>`;

  // ---------- Membership ----------
  const rankCard = html`
    <section class="card an-card">
      <div class="card-head"><h2>By membership</h2><span class="muted small">Arrived / expected</span></div>
      <div class="rank-rows">
        ${data.byRank.map((r) => html`
          <div class="rank-row">
            <div class="rank-name">${rankBadge(r.rank)}</div>
            ${r.rank === 'UNKNOWN'
              ? html`<div class="rank-bar"><i class="UNKNOWN" style="width:${k.totalServed ? (r.arrived / k.totalServed) * 100 : 0}%"></i></div>
                     <div class="rank-figs"><b>${num(r.arrived)}</b><span class="muted">${pct(k.totalServed ? r.arrived / k.totalServed : null)} of served</span></div>`
              : html`<div class="rank-bar"><i class="${r.rank}" style="width:${(r.rate || 0) * 100}%"></i></div>
                     <div class="rank-figs"><b>${num(r.arrived)} / ${num(r.expected)}</b><span class="muted">${pct(r.rate)} came</span></div>`}
          </div>`)}
      </div>
    </section>`;

  // ---------- Weekdays ----------
  const maxWd = Math.max(1, ...data.weekdays.map((w) => w.avgServed || 0));
  const weekdayCard = html`
    <section class="card an-card">
      <div class="card-head"><h2>Average by weekday</h2><span class="muted small">Guests served per day</span></div>
      <div class="wd-rows">
        ${data.weekdays.map((w, i) => html`
          <div class="wd-row ${i >= 5 ? 'weekend' : ''}">
            <span class="wd-name">${WEEKDAY_SHORT[i]}</span>
            <div class="wd-bar"><i style="width:${((w.avgServed || 0) / maxWd) * 100}%"></i></div>
            <span class="wd-val">${w.days ? num(w.avgServed, 1) : '—'}</span>
          </div>`)}
      </div>
    </section>`;

  // ---------- Staff (managers) ----------
  const staffCard = data.staff ? html`
    <section class="card an-card">
      <div class="card-head"><h2>Check-ins by employee</h2><span class="muted small">Visible to managers only</span></div>
      <div class="wd-rows">
        ${data.staff.map((s) => html`
          <div class="wd-row">
            <span class="wd-name staff-name" title="${s.fullName}">${s.name}</span>
            <div class="wd-bar"><i style="width:${(s.share || 0) * 100}%"></i></div>
            <span class="wd-val">${num(s.checkIns)}</span>
          </div>`)}
      </div>
    </section>` : '';

  // ---------- Day by day table ----------
  const days = data.daily.filter((d) => d.service);
  const table = html`
    <section class="card an-card">
      <div class="card-head"><h2>Day by day</h2><span class="muted small">${days.length} breakfast days</span></div>
      <div class="table-wrap"><table class="stack an-table">
        <thead><tr><th>Date</th><th class="r">Expected</th><th class="r">Checked in</th><th class="r">Diamond</th><th class="r">Gold</th><th class="r">Member</th><th class="r">Unknown</th><th class="r">Served</th><th class="r">Did not arrive</th><th class="r">Attendance</th></tr></thead>
        <tbody>
          ${days.map((d) => html`<tr>
            <td class="td-name"><b>${fmtDateShort(d.date)}</b><span class="day-sub">${d.checkedIn} of ${d.expected} expected came · ${d.unknown} unknown</span></td>
            <td class="r num td-hide-sm">${d.expected}</td>
            <td class="r num td-hide-sm">${d.checkedIn}</td>
            <td class="r num td-hide-sm">${d.diamond}</td><td class="r num td-hide-sm">${d.gold}</td><td class="r num td-hide-sm">${d.member}</td><td class="r num td-hide-sm">${d.unknown}</td>
            <td class="r num" data-label="Served"><b>${d.totalServed}</b></td>
            <td class="r num td-hide-sm">${d.noShows}</td>
            <td class="r num" data-label="Attendance"><span class="rate-pill ${d.rate >= 0.8 ? 'good' : d.rate < 0.6 ? 'low' : ''}">${pct(d.rate)}</span></td>
          </tr>`)}
        </tbody>
        <tfoot><tr>
          <td class="td-name"><b>Total</b><span class="day-sub">${num(k.checkedIn)} of ${num(k.expected)} expected came · ${num(k.unknown)} unknown</span></td>
          <td class="r num td-hide-sm"><b>${num(k.expected)}</b></td>
          <td class="r num td-hide-sm"><b>${num(k.checkedIn)}</b></td>
          ${data.byRank.map((r) => html`<td class="r num td-hide-sm"><b>${num(r.arrived)}</b></td>`)}
          <td class="r num" data-label="Served"><b>${num(k.totalServed)}</b></td>
          <td class="r num td-hide-sm"><b>${num(k.noShows)}</b></td>
          <td class="r num" data-label="Attendance"><b>${pct(k.attendanceRate)}</b></td>
        </tr></tfoot>
      </table></div>
    </section>`;

  el.innerHTML = String(html`
    ${head}
    <p class="print-only print-meta">Printed ${new Date().toLocaleString('en-GB')} by ${state.me.nickname}</p>
    ${kpis}
    ${highlights}
    ${dailyChart}
    <div class="an-grid">${timeChart}${rankCard}</div>
    <div class="an-grid">${weekdayCard}${staffCard || ''}</div>
    ${table}
  `);
  bind(el);
  void raw; void RANK_LABEL;
}

function bind(el) {
  el.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => go(`/analytics/${b.dataset.month}`)));
  el.querySelector('#month-select')?.addEventListener('change', (e) => go(`/analytics/${e.target.value}`));
  el.querySelector('#print-btn')?.addEventListener('click', () => window.print());
  el.querySelector('[data-export]')?.addEventListener('click', (e) => downloadExport(e.currentTarget.dataset.export));
}
