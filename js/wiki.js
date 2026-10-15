// Wikipedia: page summaries (image + link) and "On this day" events before 1500.
import { eraOf, formatYear, rng } from './engine.js';

const API = 'https://en.wikipedia.org/api/rest_v1';
const SUMMARY_TTL = 30 * 86400000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function cacheGet(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && Date.now() - v.t < SUMMARY_TTL ? v.data : null;
  } catch { return null; }
}
function cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch {}
}

// Ask for a sharper image than the default ~330px thumbnail. Wikimedia only serves
// standard widths (330, 500, 960, …) and never larger than the original.
function upscale(thumb, original) {
  if (!thumb?.source) return null;
  const width = [960, 500].find(w => (original?.width || 0) >= w && w > (thumb.width || 0));
  return width ? thumb.source.replace(/\/\d+px-/, `/${width}px-`) : thumb.source;
}

export async function summary(title) {
  if (!title) return null;
  const key = 'wiki:' + title;
  const cached = cacheGet(key);
  if (cached) return cached;
  const res = await fetch(`${API}/page/summary/${encodeURIComponent(title)}`);
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  const j = await res.json();
  const data = {
    title: j.title,
    image: upscale(j.thumbnail, j.originalimage),
    fallback: j.thumbnail?.source || null,
    url: j.content_urls?.mobile?.page || j.content_urls?.desktop?.page,
  };
  cacheSet(key, data);
  return data;
}

// Build a fact or quiz from Wikipedia's "On this day" events for a date, limited to ≤ 1500.
export async function onThisDay(key, type) {
  const [, m, d] = key.split('-');
  const res = await fetch(`${API}/feed/onthisday/all/${m}/${d}`);
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  const j = await res.json();
  const seen = new Set();
  const events = [...(j.selected || []), ...(j.events || [])]
    .filter(e => Number.isInteger(e.year) && e.year <= 1500 && !seen.has(e.text) && seen.add(e.text));
  if (!events.length) return null;

  const r = rng('otd:' + key);
  const ev = events[Math.floor(r() * events.length)];
  const page = ev.pages?.find(p => p.thumbnail) || ev.pages?.[0];
  const dateLabel = `${Number(d)} ${MONTHS[Number(m) - 1]}`;
  const base = {
    id: `otd-${key}`,
    topic: 'history',
    cat: eraOf(ev.year),
    level: null,
    source: 'Wikipedia · On this day',
    wiki: page?.titles?.canonical,
    image: upscale(page?.thumbnail, page?.originalimage),
    fallback: page?.thumbnail?.source || null,
    url: page?.content_urls?.mobile?.page,
  };

  if (type === 'quiz') {
    const options = yearOptions(ev.year, r);
    return {
      ...base, type: 'quiz',
      question: `On ${dateLabel}, in which year did this happen?\n“${ev.text}”`,
      options: options.map(formatYear),
      answer: options.indexOf(ev.year),
      explain: page?.extract || '',
    };
  }
  return {
    ...base, type: 'fact',
    title: `On this day in ${formatYear(ev.year)}`,
    text: ev.text + (page?.extract ? `\n\n${page.extract}` : ''),
  };
}

// The real year plus three plausible distractors, shuffled.
function yearOptions(year, r) {
  const spread = year < 0 ? 300 : year < 1000 ? 120 : 60;
  const opts = new Set([year]);
  while (opts.size < 4) {
    let y = year + Math.round((r() * 2 - 1) * spread);
    if (y === 0) y = 1;
    if (Math.abs(y - year) >= spread / 8) opts.add(y);
  }
  const list = [...opts];
  for (let i = list.length - 1; i > 0; i--) {
    const k = Math.floor(r() * (i + 1));
    [list[i], list[k]] = [list[k], list[i]];
  }
  return list;
}
