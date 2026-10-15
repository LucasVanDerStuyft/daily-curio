// Simulates months of daily use to check picking, the difficulty curve and streaks.
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { ITEMS } from '../js/content.js';

// Content sanity
const ids = new Set();
for (const i of ITEMS) {
  assert(!ids.has(i.id), `duplicate id ${i.id}`); ids.add(i.id);
  assert(['nature', 'history'].includes(i.topic), i.id);
  assert(E.CAT_EMOJI[i.cat], `unknown cat on ${i.id}`);
  assert(i.level >= 1 && i.level <= 5, i.id);
  assert(i.wiki, `no wiki on ${i.id}`);
  if (i.type === 'quiz') {
    assert(i.question && i.explain && i.options.length >= 2, i.id);
    assert(i.answer >= 0 && i.answer < i.options.length, `bad answer on ${i.id}`);
    assert.equal(new Set(i.options).size, i.options.length, `duplicate options on ${i.id}`);
  } else {
    assert.equal(i.type, 'fact'); assert(i.title && i.text, i.id);
  }
}

// Determinism
assert.deepEqual(E.pickRef(E.defaultState(), '2026-10-15'), E.pickRef(E.defaultState(), '2026-10-15'));

// Simulate 150 days (missing day 20), answering ~75% of quizzes correctly
const state = E.defaultState();
let day = '2026-01-01';
const shown = [];
const levels = [];
for (let n = 0; n < 150; n++, day = E.addDays(day, 1)) {
  if (n === 20) continue;
  let ref = state.plan?.date === day ? state.plan.ref : E.pickRef(state, day);
  if (ref.kind === 'otd') ref = { kind: 'curated', id: E.pickCurated(state, 'history', ref.type) }; // offline fallback
  const entry = { date: day, ref, done: true, choice: null, correct: null, bonus: false };
  const item = E.itemOf(entry);
  if (item.type === 'quiz') { entry.choice = 0; entry.correct = (n % 4) !== 0; }
  state.log.push(entry); E.markSeen(state, entry);
  state.plan = { date: E.addDays(day, 1), ref: E.pickRef(state, E.addDays(day, 1)) };
  shown.push(item);
  levels.push(E.levelInfo(state).level);
}

const firstPass = shown.slice(0, ITEMS.length);
const uniqueUntilExhausted = new Set(shown.slice(0, Math.min(shown.length, ITEMS.length)).map(i => i.id)).size;
console.log('days simulated:', shown.length, '| unique in first', Math.min(shown.length, ITEMS.length), ':', uniqueUntilExhausted);
assert.equal(uniqueUntilExhausted, Math.min(shown.length, ITEMS.length), 'repeats before content was exhausted');

const avg = arr => (arr.reduce((s, i) => s + i.level, 0) / arr.length).toFixed(2);
console.log('avg item level days 1–15:', avg(shown.slice(0, 15)), '| days 40–60:', avg(shown.slice(40, 60)));
console.log('level progression (every 10 days):', levels.filter((_, i) => i % 10 === 0).join(' '));
assert(levels[0] === 1 && levels.at(-1) === 5, 'difficulty should climb from 1 to 5');
assert(shown.slice(0, 10).every(i => i.level <= 2), 'first days should be easy');

const topics = shown.reduce((m, i) => (m[i.topic] = (m[i.topic] || 0) + 1, m), {});
const types = shown.reduce((m, i) => (m[i.type] = (m[i.type] || 0) + 1, m), {});
console.log('topics:', topics, 'types:', types);

// Streaks: day 20 was skipped, so current streak = 129 days (days 21..149)
const s = E.streaks(state, E.addDays('2026-01-01', 149));
console.log('streaks:', s);
assert.equal(s.current, 129); assert.equal(s.best, 129);
assert.equal(E.streaks(state, E.addDays('2026-01-01', 150)).current, 129, 'streak survives until end of next day');
assert.equal(E.streaks(state, E.addDays('2026-01-01', 151)).current, 0);

// Years
assert.equal(E.formatYear(-44), '44 BC'); assert.equal(E.formatYear(476), 'AD 476'); assert.equal(E.formatYear(996), '996'); assert.equal(E.formatYear(1302), '1302');
console.log('All engine tests passed ✓');
