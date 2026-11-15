// Monthly statistics, calculated from completed shifts only (an active shift isn't final yet).
import { data as store } from './store.js';

const RANKS = ['DIAMOND', 'GOLD', 'MEMBER'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function isMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const daysInMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
// 0 = Monday … 6 = Sunday
const weekdayIndex = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};
const rate = (part, whole) => (whole > 0 ? part / whole : null);
const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function loadMonth(month) {
  const shifts = [...store.shifts.values()]
    .filter((s) => s.status === 'COMPLETED' && s.shift_date.startsWith(`${month}-`))
    .sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.started_at.localeCompare(b.started_at));
  if (!shifts.length) return { shifts, guests: [], arrivals: [] };
  const ids = new Set(shifts.map((s) => s.id));
  const guests = [...store.guests.values()].filter((g) => ids.has(g.shift_id));
  const arrivals = [...store.arrivals.values()].filter((a) => ids.has(a.shift_id)).map((a) => {
    const g = a.guest_id ? store.guests.get(a.guest_id) : null;
    return { ...a, rank: g?.rank ?? null, full_name: g?.full_name ?? null, room: g?.room ?? null };
  });
  return { shifts, guests, arrivals };
}

function summarize({ shifts, guests, arrivals }) {
  const expected = guests.length;
  const checkedIn = arrivals.filter((a) => a.guest_id).length;
  const unknown = arrivals.length - checkedIn;
  const days = new Set(shifts.map((s) => s.shift_date));
  const durations = shifts.filter((s) => s.finished_at).map((s) => (new Date(s.finished_at) - new Date(s.started_at)) / 60000);
  return {
    serviceDays: days.size,
    shifts: shifts.length,
    expected,
    checkedIn,
    unknown,
    totalServed: checkedIn + unknown,
    noShows: expected - checkedIn,
    attendanceRate: rate(checkedIn, expected),
    avgServedPerDay: days.size ? (checkedIn + unknown) / days.size : null,
    avgShiftMinutes: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
  };
}

export function monthlyAnalytics(month, timeZone, { includeStaff = false } = {}) {
  const data = loadMonth(month);
  const { shifts, guests, arrivals } = data;
  const kpis = summarize(data);
  const previous = summarize(loadMonth(shiftMonth(month, -1)));

  const dateOfShift = new Map(shifts.map((s) => [s.id, s.shift_date]));

  // ---- Membership breakdown ----
  const byRank = RANKS.map((rank) => {
    const exp = guests.filter((g) => g.rank === rank).length;
    const arr = arrivals.filter((a) => a.guest_id && a.rank === rank).length;
    return { rank, expected: exp, arrived: arr, noShows: exp - arr, rate: rate(arr, exp) };
  });
  byRank.push({ rank: 'UNKNOWN', expected: null, arrived: kpis.unknown, noShows: null, rate: null });

  // ---- Day by day ----
  const daily = [];
  for (let d = 1; d <= daysInMonth(month); d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const dayShiftIds = new Set(shifts.filter((s) => s.shift_date === date).map((s) => s.id));
    if (!dayShiftIds.size) { daily.push({ date, weekday: weekdayIndex(date), service: false }); continue; }
    const g = guests.filter((x) => dayShiftIds.has(x.shift_id));
    const a = arrivals.filter((x) => dayShiftIds.has(x.shift_id));
    const counts = Object.fromEntries(RANKS.map((r) => [r, a.filter((x) => x.guest_id && x.rank === r).length]));
    const checked = counts.DIAMOND + counts.GOLD + counts.MEMBER;
    const unk = a.length - checked;
    daily.push({
      date, weekday: weekdayIndex(date), service: true,
      expected: g.length, checkedIn: checked, diamond: counts.DIAMOND, gold: counts.GOLD, member: counts.MEMBER,
      unknown: unk, totalServed: a.length, noShows: g.length - checked, rate: rate(checked, g.length),
    });
  }
  const served = daily.filter((d) => d.service);
  const busiest = served.reduce((best, d) => (!best || d.totalServed > best.totalServed ? d : best), null);
  const quietest = served.reduce((best, d) => (!best || d.totalServed < best.totalServed ? d : best), null);

  // ---- Arrival times (30-minute slots, hotel time) ----
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const slotCounts = new Map();
  for (const a of arrivals) {
    const [h, m] = fmt.format(new Date(a.arrived_at)).split(':').map(Number);
    const slot = h * 60 + (m < 30 ? 0 : 30);
    slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);
  }
  const used = [...slotCounts.keys()];
  const first = Math.min(6 * 60, ...used);
  const last = Math.max(10 * 60 + 30, ...used);
  const timeSlots = [];
  for (let s = first; s <= last; s += 30) {
    const label = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    timeSlots.push({ label, count: slotCounts.get(s) || 0, share: rate(slotCounts.get(s) || 0, arrivals.length) });
  }
  const peak = timeSlots.reduce((best, t) => (t.count > (best?.count ?? 0) ? t : best), null);

  // ---- Weekdays ----
  const weekdays = WEEKDAYS.map((name, i) => {
    const ds = served.filter((d) => d.weekday === i);
    const total = ds.reduce((s, d) => s + d.totalServed, 0);
    return { name, days: ds.length, avgServed: ds.length ? total / ds.length : null };
  });

  // ---- Guests ----
  const visits = new Map();
  for (const a of arrivals.filter((x) => x.guest_id)) {
    const key = `${normName(a.full_name)}|${a.room}`;
    const set = visits.get(key) || new Set();
    set.add(dateOfShift.get(a.shift_id));
    visits.set(key, set);
  }
  const uniqueGuests = visits.size;
  const returningGuests = [...visits.values()].filter((s) => s.size > 1).length;

  const result = {
    month,
    inProgress: month === new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(new Date()),
    kpis: { ...kpis, uniqueGuests, returningGuests, busiestDay: busiest, quietestDay: quietest, peakSlot: peak },
    previous,
    byRank,
    daily,
    timeSlots,
    weekdays,
  };

  // ---- Staff (managers only) ----
  if (includeStaff) {
    const counts = new Map();
    for (const a of arrivals) counts.set(a.checked_in_by, (counts.get(a.checked_in_by) || 0) + 1);
    result.staff = [...counts].map(([userId, n]) => {
      const u = store.users.get(userId);
      return { name: u?.nickname || 'Former employee', fullName: u?.full_name || '', checkIns: n, share: rate(n, arrivals.length) };
    }).sort((a, b) => b.checkIns - a.checkIns);
  }
  return result;
}

// Months that have at least one completed shift, newest first.
export function availableMonths() {
  const months = new Set([...store.shifts.values()].filter((s) => s.status === 'COMPLETED').map((s) => s.shift_date.slice(0, 7)));
  return [...months].sort().reverse();
}

// ---------- CSV (opens in Excel and Google Sheets) ----------
const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote when needed; prefix formula-like text so spreadsheets don't execute it.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
const pct = (r) => (r === null || r === undefined ? '' : `${Math.round(r * 100)}%`);

export function monthCsv(report) {
  const rows = [['Date', 'Weekday', 'Expected', 'Checked in', 'Diamond', 'Gold', 'Member', 'Unknown', 'Total served', 'Did not arrive', 'Attendance']];
  for (const d of report.daily.filter((x) => x.service)) {
    rows.push([d.date, WEEKDAYS[d.weekday], d.expected, d.checkedIn, d.diamond, d.gold, d.member, d.unknown, d.totalServed, d.noShows, pct(d.rate)]);
  }
  const k = report.kpis;
  const r = Object.fromEntries(report.byRank.map((x) => [x.rank, x.arrived]));
  rows.push(['Total', '', k.expected, k.checkedIn, r.DIAMOND, r.GOLD, r.MEMBER, r.UNKNOWN, k.totalServed, k.noShows, pct(k.attendanceRate)]);
  return toCsv(rows);
}
