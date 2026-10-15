// Pure logic: no DOM, no network. Testable in Node.
import { ITEMS } from './content.js';

export const byId = new Map(ITEMS.map(i => [i.id, i]));
export const MAX_LEVEL = 5;
const DAYS_PER_LEVEL = 14;

// ── Dates (always local time, as YYYY-MM-DD) ──
export function dateKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

// ── Seeded RNG so a given day always produces the same pick ──
export function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

// ── State ──
export function defaultState() {
  return {
    v: 1,
    log: [],        // { date, ref, item?, done, choice, correct, bonus }
    favorites: [],  // item ids
    seen: {},       // item id → date first shown
    plan: null,     // { date, ref } — tomorrow's pick, made in advance for the notification
    settings: { difficulty: 'auto' },
  };
}

// ── Difficulty curve ──
// Starts at 1, rises one level per 14 days played, nudged by recent quiz accuracy.
export function levelInfo(state) {
  const daysPlayed = new Set(state.log.filter(e => e.done).map(e => e.date)).size;
  const recent = state.log.filter(e => e.choice != null).slice(-10);
  const accuracy = recent.length ? recent.filter(e => e.correct).length / recent.length : null;
  let auto = 1 + Math.floor(daysPlayed / DAYS_PER_LEVEL);
  if (recent.length >= 5) {
    if (accuracy >= 0.8) auto++;
    else if (accuracy < 0.5) auto--;
  }
  auto = Math.max(1, Math.min(MAX_LEVEL, auto));
  const manual = state.settings.difficulty;
  return { level: manual === 'auto' ? auto : Number(manual), auto, daysPlayed, accuracy };
}

// ── Picking ──
// A ref is { kind: 'curated', id } or { kind: 'otd', type } (Wikipedia "On this day", resolved online).
export function pickRef(state, key, { bonus = false } = {}) {
  const r = rng(key + (bonus ? `:bonus:${state.log.length}` : ''));
  const topic = bonus
    ? (r() < 0.5 ? 'nature' : 'history')
    : (dayNumber(key) % 2 ? 'nature' : 'history');
  const type = r() < 0.5 ? 'quiz' : 'fact';
  if (!bonus && topic === 'history' && r() < 0.3) return { kind: 'otd', type };
  return { kind: 'curated', id: pickCurated(state, topic, type, r) };
}

export function pickCurated(state, topic, type, r = Math.random) {
  const { level } = levelInfo(state);
  const reserved = new Set([state.plan?.ref?.id, ...state.log.map(e => e.ref.id)].filter(Boolean));
  const fresh = i => !state.seen[i.id] && !reserved.has(i.id);
  const filters = [
    i => i.topic === topic && i.type === type,
    i => i.topic === topic,
    () => true,
  ];
  for (const f of filters) {
    const pool = ITEMS.filter(i => f(i) && fresh(i) && i.level <= level);
    if (pool.length) return weightedPick(pool, level, r).id;
  }
  // Everything at or below the level is used up: move on to harder unseen items.
  const harder = ITEMS.filter(fresh).sort((a, b) => a.level - b.level);
  if (harder.length) return harder[0].id;
  // Everything has been seen: repeat the one shown longest ago in this topic.
  const lastShown = {};
  for (const e of state.log) if (e.ref.id) lastShown[e.ref.id] = e.date;
  const pool = ITEMS.filter(i => i.topic === topic && i.id !== state.plan?.ref?.id);
  pool.sort((a, b) => (lastShown[a.id] || '').localeCompare(lastShown[b.id] || ''));
  return pool[0].id;
}

function weightedPick(pool, level, r) {
  // Favour the current level, with some easier items mixed in.
  const w = i => (i.level === level ? 6 : i.level === level - 1 ? 3 : 1);
  const total = pool.reduce((s, i) => s + w(i), 0);
  let x = r() * total;
  for (const i of pool) if ((x -= w(i)) < 0) return i;
  return pool[pool.length - 1];
}

// ── Log helpers ──
export function itemOf(entry) {
  return entry.item || byId.get(entry.ref.id);
}

export function markSeen(state, entry) {
  if (entry.ref.kind === 'curated' && !state.seen[entry.ref.id]) state.seen[entry.ref.id] = entry.date;
}

export function streaks(state, today = dateKey()) {
  const days = new Set(state.log.filter(e => e.done).map(e => e.date));
  let current = 0;
  let k = days.has(today) ? today : addDays(today, -1);
  while (days.has(k)) { current++; k = addDays(k, -1); }
  let best = 0, run = 0, prev = null;
  for (const d of [...days].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best, doneToday: days.has(today) };
}

export function stats(state) {
  const quizzes = state.log.filter(e => e.choice != null);
  const correct = quizzes.filter(e => e.correct).length;
  return {
    explored: state.log.filter(e => e.done).length,
    quizzes: quizzes.length,
    correct,
    unseen: ITEMS.filter(i => !state.seen[i.id]).length,
    total: ITEMS.length,
  };
}

// ── Formatting ──
export const CAT_EMOJI = {
  'Animals': '🦎', 'Plants & fungi': '🍄', 'Ecosystems': '🌿',
  'Deep time': '🦕', 'Prehistory': '🪨', 'Antiquity': '🏛️', 'Middle Ages': '🏰',
};

export function eraOf(year) {
  if (year < -3000) return 'Prehistory';
  if (year < 500) return 'Antiquity';
  return 'Middle Ages';
}

export function formatYear(y) {
  return y < 0 ? `${-y} BC` : y < 500 ? `AD ${y}` : String(y);
}

export function teaserFor(item) {
  const emoji = CAT_EMOJI[item.cat] || '✨';
  return item.type === 'quiz'
    ? { title: `${emoji} Today's quiz · ${item.cat}`, body: item.question }
    : { title: `${emoji} ${item.title}`, body: `Your daily ${item.topic} fact is ready.` };
}
