import * as E from './engine.js';
import { summary, onThisDay } from './wiki.js';
import { VAPID_PUBLIC_KEY } from './config.js';

const STORE = 'curio-state';
const view = document.getElementById('view');
let state = load();

// ── Persistence ──
function load() {
  const base = E.defaultState();
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s?.v === 1) return { ...base, ...s, settings: { ...base.settings, ...s.settings } };
  } catch {}
  return base;
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {}
  writeMeta();
  updateHeader();
}

// The service worker can't read localStorage, so leave it a teaser and the streak in Cache Storage.
async function writeMeta() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('curio-meta');
    const put = (name, data) => cache.put(new URL(name, location.href), new Response(JSON.stringify(data),
      { headers: { 'Content-Type': 'application/json' } }));
    if (state.plan) {
      const { ref } = state.plan;
      const teaser = ref.kind === 'curated'
        ? E.teaserFor(E.byId.get(ref.id))
        : { title: '📜 On this day in history', body: 'Something happened on this date, centuries ago. Come and find out what.' };
      await put('teaser.json', { date: state.plan.date, ...teaser });
    }
    const lastDone = [...state.log].reverse().find(e => e.done)?.date || null;
    await put('status.json', { streak: E.streaks(state).current, lastDone });
  } catch {}
}

// ── Tiny DOM helper ──
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}
const paras = (text, cls) => text.split(/\n+/).map(t => h('p', { class: cls }, t));
const fmtDate = (key, opts = { weekday: 'long', day: 'numeric', month: 'long' }) =>
  E.parseKey(key).toLocaleDateString('en-GB', opts);

// ── Building today's entries ──
async function materialize(date, ref, bonus) {
  const entry = { date, ref, done: false, choice: null, correct: null, bonus };
  if (ref.kind === 'otd') {
    try {
      const item = await onThisDay(date, ref.type);
      if (item) return { ...entry, ref: { kind: 'otd' }, item };
    } catch {}
    entry.ref = { kind: 'curated', id: E.pickCurated(state, 'history', ref.type) };
  }
  return entry;
}

let pendingToday = null;
function ensureToday() {
  return (pendingToday ??= (async () => {
    const today = E.dateKey();
    let entry = state.log.find(e => e.date === today && !e.bonus);
    if (!entry) {
      const ref = state.plan?.date === today ? state.plan.ref : E.pickRef(state, today);
      entry = await materialize(today, ref, false);
      state.log.push(entry);
      E.markSeen(state, entry);
    }
    const tomorrow = E.addDays(today, 1);
    if (state.plan?.date !== tomorrow) state.plan = { date: tomorrow, ref: E.pickRef(state, tomorrow) };
    save();
    return entry;
  })().finally(() => { pendingToday = null; }));
}

async function addBonus() {
  const today = E.dateKey();
  const entry = await materialize(today, E.pickRef(state, today, { bonus: true }), true);
  state.log.push(entry);
  E.markSeen(state, entry);
  save();
  await renderToday();
  view.querySelector('.card:last-of-type')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleFav(id) {
  const i = state.favorites.indexOf(id);
  i < 0 ? state.favorites.push(id) : state.favorites.splice(i, 1);
  save();
}

// ── Card ──
function card(entry, { onDone } = {}) {
  const item = E.itemOf(entry);
  if (!item) return h('article', { class: 'card' }, h('div', { class: 'card-body' }, h('p', {}, 'This item is no longer available.')));
  const today = E.dateKey();

  const img = h('img', { alt: '', decoding: 'async' });
  const figure = h('figure', { class: 'card-img', hidden: true }, img, h('figcaption', {}, 'Image: Wikipedia'));
  const readMore = h('a', { class: 'btn ghost', target: '_blank', rel: 'noopener', hidden: true }, 'Read more on Wikipedia ↗');
  // For quizzes, the picture and link would give the answer away, so they appear only after answering.
  let revealed = item.type === 'fact' || entry.choice != null;
  const media = { image: null, fallback: null, url: null };
  img.onload = () => { figure.hidden = false; };
  img.onerror = () => { if (media.fallback && img.src !== media.fallback) img.src = media.fallback; };
  const showMedia = () => {
    if (!revealed) return;
    if (media.image && !img.src) img.src = media.image;
    if (media.url) { readMore.href = media.url; readMore.hidden = false; }
  };
  (async () => {
    let data = item.image || item.url ? { image: item.image, fallback: item.fallback, url: item.url } : null;
    if ((!data?.image || !data?.url) && item.wiki) {
      try {
        const s = await summary(item.wiki);
        data = data?.image ? { ...data, url: data.url || s.url } : { ...s, url: data?.url || s.url };
      } catch {}
    }
    Object.assign(media, data || {});
    showMedia();
  })();

  const meta = h('div', { class: 'meta' },
    h('span', { class: `chip ${item.topic}` }, `${E.CAT_EMOJI[item.cat] || ''} ${item.cat}`),
    entry.bonus && h('span', { class: 'chip bonus' }, 'Bonus'),
    item.level
      ? h('span', { class: 'dots', title: `Difficulty ${item.level} of 5`, 'aria-label': `Difficulty ${item.level} of 5` },
          '●'.repeat(item.level) + '○'.repeat(E.MAX_LEVEL - item.level))
      : h('span', { class: 'src' }, item.source));

  const body = h('div', { class: 'card-body' }, meta);

  if (item.type === 'fact') {
    body.append(h('h2', {}, item.title), ...paras(item.text));
    if (!entry.done && entry.date === today) { entry.done = true; save(); onDone?.(); }
  } else {
    body.append(h('h2', { class: 'quiz-label' }, '🧠 Quiz'), ...paras(item.question, 'question'));
    const options = h('div', { class: 'options' });
    const explain = h('div', { class: 'explain', hidden: true });
    const reveal = () => {
      [...options.children].forEach((b, i) => {
        b.disabled = true;
        if (i === item.answer) b.classList.add('correct');
        else if (i === entry.choice) b.classList.add('wrong');
      });
      explain.className = `explain ${entry.correct ? 'ok' : 'no'}`;
      explain.replaceChildren(
        h('strong', {}, entry.correct ? '✓ Correct!' : `✗ Not quite. The answer is: ${item.options[item.answer]}`),
        ...(item.explain ? paras(item.explain) : []));
      explain.hidden = false;
      revealed = true;
      showMedia();
    };
    item.options.forEach((label, i) => options.append(h('button', {
      class: 'option',
      onclick: () => {
        if (entry.choice != null) return;
        entry.choice = i;
        entry.correct = i === item.answer;
        if (entry.date === today) entry.done = true;
        save();
        reveal();
        onDone?.();
      },
    }, label)));
    body.append(options, explain);
    if (entry.choice != null) reveal();
  }

  const isFav = () => state.favorites.includes(item.id);
  const favBtn = h('button', {
    class: 'btn icon fav', 'aria-pressed': String(isFav()), 'aria-label': 'Favourite',
    onclick: () => { toggleFav(item.id); favBtn.setAttribute('aria-pressed', String(isFav())); favBtn.textContent = isFav() ? '★' : '☆'; },
  }, isFav() ? '★' : '☆');
  body.append(h('div', { class: 'actions' }, readMore, favBtn));

  return h('article', { class: `card ${item.topic}` }, figure, body);
}

// ── Views ──
async function renderToday() {
  if (!view.querySelector('.today')) view.replaceChildren(h('p', { class: 'loading' }, 'Finding today\'s curio…'));
  const main = await ensureToday();
  const today = E.dateKey();
  const { level, auto } = E.levelInfo(state);
  const manual = state.settings.difficulty !== 'auto';

  const more = h('button', { class: 'btn primary more', hidden: !main.done, onclick: e => { e.target.disabled = true; addBonus(); } },
    '＋ One more curio');
  const onDone = () => { more.hidden = !main.done; };

  view.replaceChildren(h('div', { class: 'today' },
    h('div', { class: 'today-head' },
      h('p', { class: 'date' }, fmtDate(today)),
      h('p', { class: 'level-note' }, `Level ${level}${manual ? ' (manual)' : ''} · ${'●'.repeat(level)}${'○'.repeat(E.MAX_LEVEL - level)}`)),
    state.log.filter(e => e.date === today).map(e => card(e, e === main ? { onDone } : {})),
    more,
    !manual && auto < E.MAX_LEVEL && h('p', { class: 'hint' }, 'Difficulty rises as you keep your streak and answer quizzes well.')));
}

let archiveFilter = 'all';
function renderArchive() {
  const filters = { all: 'All', nature: '🌿 Nature', history: '🏛️ History', quiz: '🧠 Quizzes', fav: '★ Favourites' };
  const match = ({ item }) => archiveFilter === 'all' ? true
    : archiveFilter === 'quiz' ? item.type === 'quiz'
    : archiveFilter === 'fav' ? state.favorites.includes(item.id)
    : item.topic === archiveFilter;
  const rows = state.log
    .map((entry, i) => ({ entry, i, item: E.itemOf(entry) }))
    .filter(x => x.item && match(x))
    .reverse();

  const list = h('div', { class: 'archive-list' });
  let month = null;
  for (const { entry, i, item } of rows) {
    const m = fmtDate(entry.date, { month: 'long', year: 'numeric' });
    if (m !== month) { list.append(h('h3', { class: 'month' }, m)); month = m; }
    const status = item.type === 'quiz'
      ? (entry.choice == null ? h('span', { class: 'status open' }, '?') : h('span', { class: `status ${entry.correct ? 'ok' : 'no'}` }, entry.correct ? '✓' : '✗'))
      : null;
    list.append(h('a', { class: 'row', href: `#/entry/${i}` },
      h('span', { class: 'row-date' }, fmtDate(entry.date, { day: 'numeric', month: 'short' })),
      h('span', { class: 'row-emoji', 'aria-hidden': 'true' }, E.CAT_EMOJI[item.cat] || '✨'),
      h('span', { class: 'row-title' }, item.type === 'quiz' ? item.question.split('\n')[0] : item.title),
      state.favorites.includes(item.id) && h('span', { class: 'row-fav' }, '★'),
      status));
  }

  view.replaceChildren(h('div', { class: 'archive' },
    h('h2', { class: 'view-title' }, 'Archive'),
    h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter' },
      Object.entries(filters).map(([k, label]) => h('button', {
        class: 'chip filter', 'aria-pressed': String(k === archiveFilter),
        onclick: () => { archiveFilter = k; renderArchive(); },
      }, label))),
    rows.length ? list : h('p', { class: 'empty' }, state.log.length ? 'Nothing here yet for this filter.' : 'Your past curios will appear here.')));
}

function renderEntry(index) {
  const entry = state.log[index];
  if (!entry) { location.hash = '#/archive'; return; }
  view.replaceChildren(h('div', { class: 'entry' },
    h('a', { class: 'back', href: '#/archive' }, '← Archive'),
    h('p', { class: 'date' }, fmtDate(entry.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
    card(entry)));
}

function renderStats() {
  const s = E.streaks(state);
  const st = E.stats(state);
  const { level, auto, accuracy } = E.levelInfo(state);
  const tile = (emoji, value, label) => h('div', { class: 'tile' },
    h('span', { class: 'tile-emoji', 'aria-hidden': 'true' }, emoji), h('strong', {}, value), h('span', {}, label));

  const difficulty = h('select', {
    id: 'difficulty',
    onchange: e => { state.settings.difficulty = e.target.value; save(); renderStats(); },
  },
    h('option', { value: 'auto' }, `Automatic (now level ${auto})`),
    [1, 2, 3, 4, 5].map(n => h('option', { value: String(n) }, `Level ${n}`)));
  difficulty.value = state.settings.difficulty;

  view.replaceChildren(h('div', { class: 'stats' },
    h('h2', { class: 'view-title' }, 'Your stats'),
    h('div', { class: 'tiles' },
      tile('🔥', s.current, 'day streak'),
      tile('🏆', s.best, 'best streak'),
      tile('📚', st.explored, 'curios explored'),
      tile('🧠', st.quizzes ? `${Math.round(100 * st.correct / st.quizzes)}%` : '–', `quiz score (${st.correct}/${st.quizzes})`),
      tile('🎚️', level, 'current level'),
      tile('🗂️', st.unseen, `of ${st.total} still unseen`)),
    h('section', { class: 'panel' },
      h('h3', {}, 'Difficulty'),
      h('label', { for: 'difficulty' }, 'Level of new curios'),
      difficulty,
      h('p', { class: 'hint' }, `Automatic mode goes up one level every 14 days you play, and adjusts to your recent quiz accuracy${accuracy != null ? ` (now ${Math.round(accuracy * 100)}%)` : ''}.`)),
    notificationsPanel(),
    dataPanel()));
}

// ── Notifications ──
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function notificationsPanel() {
  const out = h('div', { class: 'push-out' });
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const say = (...nodes) => out.replaceChildren(...nodes);

  const showSubscription = sub => {
    const json = JSON.stringify(sub);
    const box = h('textarea', { readonly: true, rows: 5, 'aria-label': 'Push subscription' });
    box.value = json;
    say(
      h('p', {}, '✓ Notifications are on for this device. Paste the text below into the ', h('code', {}, 'PUSH_SUBSCRIPTION'), ' secret of your GitHub repository (see README):'),
      box,
      h('button', { class: 'btn ghost', onclick: async e => {
        try { await navigator.clipboard.writeText(json); e.target.textContent = 'Copied ✓'; }
        catch { box.select(); e.target.textContent = 'Select & copy manually'; }
      } }, 'Copy'));
  };

  const enable = async () => {
    try {
      if (await Notification.requestPermission() !== 'granted') {
        return say(h('p', {}, 'Notifications are blocked. Allow them in your browser\'s site settings and try again.'));
      }
      const reg = await navigator.serviceWorker.ready;
      const key = urlB64ToUint8Array(VAPID_PUBLIC_KEY);
      let sub = await reg.pushManager.getSubscription();
      if (sub && sub.options?.applicationServerKey &&
          btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))) !== btoa(String.fromCharCode(...key))) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      showSubscription(sub);
    } catch (err) {
      say(h('p', {}, `Could not enable notifications: ${err.message}`));
    }
  };

  const preview = async () => {
    const reg = await navigator.serviceWorker.ready;
    if (Notification.permission !== 'granted') return enable();
    await writeMeta();
    const res = await (await caches.open('curio-meta')).match(new URL('teaser.json', location.href));
    const t = res ? await res.json() : { title: '✨ Your daily curio is ready', body: 'Test notification' };
    reg.showNotification(t.title, { body: `${t.body}\n(preview of tomorrow)`, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'curio-preview' });
  };

  if (supported && Notification.permission === 'granted') {
    navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(sub => sub && showSubscription(sub));
  }

  return h('section', { class: 'panel' },
    h('h3', {}, 'Daily notification'),
    supported
      ? [h('p', { class: 'hint' }, 'A GitHub Action sends a push every morning. The notification shows a teaser of that day\'s curio.'),
         h('div', { class: 'btn-row' },
           h('button', { class: 'btn primary', onclick: enable }, Notification.permission === 'granted' ? 'Show subscription' : 'Enable notifications'),
           h('button', { class: 'btn ghost', onclick: preview }, 'Preview')),
         out]
      : h('p', { class: 'hint' }, 'Push notifications are not supported here. On Android, open the app in Chrome and install it to your home screen.'));
}

// ── Data ──
function dataPanel() {
  const fileInput = h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async e => {
    try {
      const s = JSON.parse(await e.target.files[0].text());
      if (s?.v !== 1 || !Array.isArray(s.log)) throw new Error('not a Daily Curio backup');
      state = { ...E.defaultState(), ...s };
      save();
      renderStats();
      alert('Backup restored.');
    } catch (err) { alert(`Import failed: ${err.message}`); }
  } });
  const exportData = () => {
    const a = h('a', {
      href: URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })),
      download: `daily-curio-backup-${E.dateKey()}.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const reset = () => {
    if (!confirm('Erase your streak, archive and favourites? This cannot be undone.')) return;
    state = E.defaultState();
    save();
    location.hash = '#/today';
  };
  return h('section', { class: 'panel' },
    h('h3', {}, 'Your data'),
    h('p', { class: 'hint' }, 'Everything is stored on this device only. Make a backup now and then.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost', onclick: exportData }, 'Export backup'),
      h('button', { class: 'btn ghost', onclick: () => fileInput.click() }, 'Import backup'),
      h('button', { class: 'btn danger', onclick: reset }, 'Reset')),
    fileInput);
}

// ── Shell ──
function updateHeader() {
  const { current, doneToday } = E.streaks(state);
  const el = document.getElementById('streak');
  el.textContent = `🔥 ${current}`;
  el.classList.toggle('pending', !doneToday);
  el.title = doneToday ? `${current}-day streak` : 'Do today\'s curio to keep your streak';
}

function route() {
  const [, name = 'today', arg] = location.hash.split('/');
  for (const a of document.querySelectorAll('.tabs a')) {
    const active = a.dataset.tab === (name === 'entry' ? 'archive' : name);
    a.classList.toggle('active', active);
    active ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  }
  if (name === 'archive') renderArchive();
  else if (name === 'entry') renderEntry(Number(arg));
  else if (name === 'stats') renderStats();
  else renderToday();
  window.scrollTo(0, 0);
}

let shownDay = E.dateKey();
function refreshIfNewDay() {
  if (E.dateKey() !== shownDay) { shownDay = E.dateKey(); route(); }
}

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateHeader(); refreshIfNewDay(); } });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'refresh') refreshIfNewDay(); });
}
navigator.storage?.persist?.().catch(() => {});

updateHeader();
route();
