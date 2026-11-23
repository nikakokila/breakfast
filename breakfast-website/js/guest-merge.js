// Combines the three lists into one breakfast guest list.
//
//   Breakfast list   Everyone on it is expected, exactly as before.
//   Complimentary    Always gets breakfast, as long as they slept at the hotel the night before the breakfast date.
//                    Diamond or Gold guests on it keep their tier; everyone else comes in as Member.
//   Diamond / Gold   Always get breakfast. Guests already on the list (same room) become Diamond/Gold.
//                    Rooms that are not on the list are added as ONE entry for the room, with its number of people (PAX).
//   Silver / other   Breakfast only if they are already on the list (they then stay as they are).
//
// "pax" on an entry is how many people that entry covers. A room's people = everyone counted on its entries,
// and at least one per entry (Opera lists a sharer as 0 because the main booking already counts them).
//
// Nothing here touches the screen, so the rules can be tested on their own.

import { parseRoom } from './rooms.js';
import { addDays, fmtDay, tierLabel } from './guest-import.js';

const RANK_ORDER = { MEMBER: 0, GOLD: 1, DIAMOND: 2 };
const TIER_ORDER = { OTHER: 0, SILVER: 1, GOLD: 2, DIAMOND: 3 };
const better = (a, b) => ((RANK_ORDER[b] ?? -1) > (RANK_ORDER[a] ?? -1) ? b : a);
const cap = (rank) => rank.charAt(0) + rank.slice(1).toLowerCase();
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const key = (name, room) => `${norm(name).trim().replace(/\s+/g, ' ')}|${room}`;
const wordsOf = (name, min) => norm(name).split(/[^\p{L}]+/u).filter((w) => w.length >= min);
const letters = (name) => [...norm(name).replace(/[^\p{L}]/gu, '')].sort().join('');

// The same person written differently: "Alina Mosinyan" = "MOSINYAN/ALINA", "Yu Jeongsang" = "Jeong Sang Yu",
// "Oleg Uvarov" = "Oleg Olegovich Uvarov". "Ana Mosinyan" is a different person from "Alina Mosinyan".
export function samePerson(a, b) {
  const wa = wordsOf(a, 2);
  const wb = wordsOf(b, 2);
  if (!wa.length || !wb.length) return false;
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return short.every((w) => long.includes(w)) || letters(a) === letters(b);
}
// Probably the same booking: shares a surname or another longer name word.
const sameFamily = (a, b) => samePerson(a, b) || wordsOf(a, 3).some((w) => wordsOf(b, 3).includes(w));

// ---------- people per room ----------

export function peopleByRoom(guests) {
  const rooms = new Map();
  for (const g of guests) {
    const r = rooms.get(g.room) || { sum: 0, count: 0 };
    r.sum += g.pax ?? 1;
    r.count += 1;
    rooms.set(g.room, r);
  }
  return new Map([...rooms].map(([room, r]) => [room, Math.max(r.sum, r.count)]));
}
export const totalPeople = (guests) => [...peopleByRoom(guests).values()].reduce((a, b) => a + b, 0);

// When someone types "people in this room", store it on this entry so the room adds up to that number.
export function paxForRoom(guests, room, people, exceptId = null) {
  const others = guests.filter((g) => g.room === room && g.id !== exceptId);
  const sum = others.reduce((n, g) => n + (g.pax ?? 1), 0);
  return Math.max(others.length ? 0 : 1, people - sum);
}

// ---------- dates ----------

// Breakfast is served the morning after each night: arriving today means the first breakfast is tomorrow.
function stayProblem(row, day) {
  if (!day) return null;
  if (row.arrive && row.arrive >= day) return `Arrives ${fmtDay(row.arrive)} — first breakfast ${fmtDay(addDays(row.arrive, 1))}`;
  if (row.depart && row.depart < day) return `Checked out ${fmtDay(row.depart)}`;
  return null;
}

// ---------- the merge ----------

export function mergeLists({ breakfast = null, tier = null, comp = null, existing = [], breakfastDate = null, fillMember = false } = {}) {
  const entries = [];
  const byRoom = new Map();
  const add = (e) => {
    entries.push(e);
    if (!byRoom.has(e.room)) byRoom.set(e.room, []);
    byRoom.get(e.room).push(e);
    return e;
  };
  const sumPax = (list) => list.reduce((n, e) => n + (e.pax ?? 1), 0);
  // Make sure a room counts at least n people.
  const atLeast = (room, n) => {
    const list = byRoom.get(room) || [];
    if (list.length && n > Math.max(sumPax(list), list.length)) list[0].pax = (list[0].pax ?? 1) + (n - sumPax(list));
  };

  const issues = [];   // rows that could not be used: { list, line, name, room, problem }
  const details = [];  // what happened to each tier / complimentary row
  const stats = { breakfast: 0, upgraded: 0, tierAdded: 0, tierOnList: 0, noBreakfast: 0, compAdded: 0, compOnList: 0, compLater: 0, nameDiffers: 0 };
  let rankOnly = 0;

  for (const g of existing) add({ ...g, pax: g.pax ?? 1, existing: true, was: { rank: g.rank, pax: g.pax ?? 1 }, lists: new Set() });

  // 1) The breakfast list.
  const seen = new Set(existing.map((g) => key(g.fullName, g.room)));
  for (const row of breakfast?.rows || []) {
    const problems = [];
    if (row.skipReason) problems.push(`Status: ${row.skipReason}`);
    if ((row.fullName || '').length < 2) problems.push('Missing guest name');
    const room = parseRoom(row.room);
    if (!room.ok) problems.push(row.room ? `Room ${row.room}: ${room.error}` : 'Missing room number');
    const rank = row.rank || (fillMember ? 'MEMBER' : null);
    if (room.ok && seen.has(key(row.fullName, room.room))) problems.push('Already on the list');
    if (!rank) {
      if (!problems.length) rankOnly++;
      problems.push(row.rankRaw ? `Membership “${row.rankRaw}” isn’t Diamond, Gold, Silver or Member` : 'No membership');
    }
    if (problems.length) {
      issues.push({ list: 'Breakfast list', line: row.line, name: row.fullName, room: row.room, problem: problems.join(' · ') });
      continue;
    }
    seen.add(key(row.fullName, room.room));
    add({ fullName: row.fullName, room: room.room, rank, pax: row.pax ?? 1, lists: new Set(['breakfast']) });
    stats.breakfast++;
  }

  // 2) Complimentary breakfast.
  for (const row of comp?.rows || []) {
    const room = parseRoom(row.room);
    const base = { list: 'Complimentary', line: row.line, room: row.room, name: row.fullName, label: row.tierRaw ? tierLabel(row.rank || 'OTHER', row.tierRaw) : '', pax: row.pax };
    const problems = [];
    if ((row.fullName || '').length < 2) problems.push('Missing guest name');
    if (!room.ok) problems.push(row.room ? `Room ${row.room}: ${room.error}` : 'No room number yet');
    if (problems.length) {
      issues.push({ list: 'Complimentary', line: row.line, name: row.fullName, room: row.room, problem: problems.join(' · ') });
      details.push({ ...base, result: `Not added · ${problems.join(' · ')}`, tone: 'warn' });
      continue;
    }
    const later = stayProblem(row, breakfastDate);
    if (later) {
      stats.compLater++;
      details.push({ ...base, result: `Not today · ${later}`, tone: 'muted' });
      continue;
    }
    const inRoom = byRoom.get(room.room) || [];
    const same = inRoom.find((e) => samePerson(e.fullName, row.fullName));
    const rank = row.rank || 'MEMBER';
    if (same) {
      const up = better(same.rank, rank);
      const changed = up !== same.rank;
      same.rank = up;
      same.lists.add('comp');
      stats.compOnList++;
      details.push({ ...base, result: changed ? `Already on the list · now ${cap(up)}` : 'Already on the list', tone: 'ok' });
    } else {
      add({ fullName: row.fullName, room: room.room, rank, pax: inRoom.length ? 0 : 1, lists: new Set(['comp']) });
      stats.compAdded++;
      details.push({ ...base, result: 'Added', tone: 'ok' });
    }
    atLeast(room.room, row.pax || 1);
  }

  // 3) Diamond / Gold / Silver, room by room.
  const sheet = tier ? tier.sheets[tier.pick] : null;
  const groups = new Map();
  for (const row of sheet?.rows || []) {
    const room = parseRoom(row.room);
    if (!room.ok) {
      issues.push({ list: 'Tier list', line: row.line, name: row.fullName, room: row.room, problem: row.room ? `Room ${row.room}: ${room.error}` : 'Missing room number' });
      continue;
    }
    if (!groups.has(room.room)) groups.set(room.room, []);
    groups.get(room.room).push(row);
  }
  for (const [room, rows] of groups) {
    const top = rows.reduce((a, r) => (TIER_ORDER[r.tier] > TIER_ORDER[a.tier] ? r : a));
    const pax = Math.max(...rows.map((r) => r.pax || 1));
    const names = [...new Set(rows.map((r) => r.fullName).filter(Boolean))];
    const label = tierLabel(top.tier, top.tierRaw);
    const base = { list: 'Tier list', line: rows.map((r) => r.line).join(', '), room, name: names.join(' & '), label, pax };
    const inRoom = byRoom.get(room) || [];
    if (top.tier === 'DIAMOND' || top.tier === 'GOLD') {
      if (inRoom.length) {
        let changed = 0;
        for (const e of inRoom) {
          const up = better(e.rank, top.tier);
          if (up !== e.rank) { e.rank = up; changed++; }
          e.lists.add('tier');
        }
        stats.upgraded += changed;
        stats.tierOnList++;
        atLeast(room, pax);
        const nameOk = !names.length || inRoom.some((e) => names.some((n) => sameFamily(e.fullName, n)));
        if (!nameOk) stats.nameDiffers++;
        details.push({
          ...base,
          result: (changed ? `On the list · now ${cap(top.tier)}` : 'Already on the list') + (nameOk ? '' : ` · different name on the list: ${inRoom.map((e) => e.fullName).join(', ')}`),
          tone: nameOk ? 'ok' : 'warn',
        });
      } else {
        add({ fullName: (names.join(' & ') || `Room ${room} guest`).slice(0, 100), room, rank: top.tier, pax, lists: new Set(['tier']) });
        stats.tierAdded++;
        details.push({ ...base, result: `Added · ${pax} ${pax === 1 ? 'person' : 'people'}`, tone: 'ok' });
      }
    } else if (inRoom.length) {
      for (const e of inRoom) e.lists.add('tier');
      details.push({ ...base, result: 'On the list · this tier has no free breakfast', tone: 'ok' });
    } else {
      stats.noBreakfast++;
      details.push({ ...base, result: 'Not on the breakfast list · no breakfast', tone: 'muted' });
    }
  }

  const order = { 'Tier list': 0, Complimentary: 1 };
  details.sort((a, b) => order[a.list] - order[b.list] || Number(a.room || 0) - Number(b.room || 0));
  const fresh = entries.filter((e) => !e.existing);
  const changed = entries.filter((e) => e.existing && (e.rank !== e.was.rank || (e.pax ?? 1) !== e.was.pax));
  return { entries, fresh, changed, issues, details, stats, rankOnly, people: totalPeople(entries) };
}
