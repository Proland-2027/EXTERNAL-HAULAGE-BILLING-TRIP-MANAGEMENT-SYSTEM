/* calendar.js — working-day calendar (08:00–17:00, 1 h break, 480 productive minutes). */
'use strict';

function toDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function fmt(d) { return d.toISOString().slice(0, 10); }
function addDays(s, n) { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); }
function today() { return fmt(new Date()); }

/** overrides: Map(date -> {working, minutes}); workingWeekdays: array of 0..6 (0 = Sunday) */
function makeCalendar({ overrides = new Map(), workingWeekdays = [1, 2, 3, 4, 5], minutesPerDay = 480 } = {}) {
  const weekdaySet = new Set(workingWeekdays);
  function minutes(date) {
    const o = overrides.get(date);
    if (o) return o.working ? (o.minutes || minutesPerDay) : 0;
    return weekdaySet.has(toDate(date).getUTCDay()) ? minutesPerDay : 0;
  }
  const isWorking = (date) => minutes(date) > 0;
  function nextWorking(date) { let d = date; let guard = 0; while (!isWorking(d) && guard++ < 400) d = addDays(d, 1); return d; }
  function addWorking(date, n) { let d = nextWorking(date); let left = n; while (left > 0) { d = nextWorking(addDays(d, 1)); left--; } return d; }
  function workingDaysBetween(a, b) { if (!a || !b) return null; let n = 0; let d = a; const sign = a <= b ? 1 : -1; const [from, to] = sign > 0 ? [a, b] : [b, a]; d = from; while (d < to) { d = addDays(d, 1); if (isWorking(d)) n++; } return sign * n; }
  function* iterate(start, maxDays) { let d = start; let n = 0; while (n < maxDays) { if (isWorking(d)) { yield d; n++; } d = addDays(d, 1); } }
  return { minutes, isWorking, nextWorking, addWorking, workingDaysBetween, iterate, minutesPerDay };
}

module.exports = { makeCalendar, addDays, today, fmt, toDate };
