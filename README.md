# Daily Curio 🐚

A small installable web app (PWA) that gives you a daily fact or quiz about **nature** (animals, plants, ecosystems) or **history** (from deep time and the dinosaurs to the end of the Middle Ages), with a push notification each morning.

- Over 1,000 hand-written facts and quizzes, each rated difficulty 1–5
- Some history days use Wikipedia's *On this day* events from before 1500, either as a fact or as a "guess the year" quiz
- Images and "read more" links from Wikipedia
- A difficulty curve: one level up every 14 days you play, adjusted by your recent quiz accuracy (or set it manually)
- Streaks, an archive with filters, favourites, stats, and JSON backup/restore
- Works offline once loaded; no build step, no framework

## Run locally

```sh
npm install
npm run serve        # http://localhost:8765
npm test             # simulates 150 days of use
```

## Put it on your phone

The service worker and push notifications need HTTPS, so host it on **GitHub Pages**:

1. Create a **public** GitHub repo (Pages on private repos needs a paid plan) and push this folder.
2. Repo → *Settings → Pages* → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. On Android, open `https://<you>.github.io/<repo>/` in **Chrome** → ⋮ menu → *Add to Home screen* / *Install app*.

## Daily push notification

A GitHub Action (`.github/workflows/daily-push.yml`) sends a Web Push every day at 07:00 UTC. The app's service worker turns it into a notification with a teaser of that day's curio, for example *"🏰 Today's quiz · Middle Ages — Who won the Battle of Hastings in 1066?"*.

One-time setup:

1. In the installed app, go to **Stats → Daily notification → Enable notifications**, then tap **Copy**.
2. In the repo, go to *Settings → Secrets and variables → Actions* and add these secrets:

   | Secret | Value |
   |---|---|
   | `PUSH_SUBSCRIPTION` | the text you copied from the app |
   | `VAPID_PUBLIC_KEY` | `publicKey` from `push/vapid-keys.json` |
   | `VAPID_PRIVATE_KEY` | `privateKey` from `push/vapid-keys.json` |
   | `VAPID_SUBJECT` *(optional)* | `mailto:you@example.com` |

3. Go to *Actions → Daily curio push → Run workflow* to test it straight away.

Notes:
- `push/vapid-keys.json` is git-ignored. Keep the private key secret. If you regenerate the keys (`npx web-push generate-vapid-keys --json`), update `js/config.js` and re-enable notifications in the app.
- To change the time, edit the `cron` line (it is in UTC). GitHub's scheduled runs can be a few minutes to an hour late.
- If you reinstall the app or clear its data, the subscription changes. The Action will then fail with a "subscription expired" message, and GitHub emails you about the failed run. Copy the new subscription into the secret.
- GitHub pauses scheduled workflows after 60 days without repo activity. The workflow re-enables itself on every run to prevent this.

## How it works

| File | Role |
|---|---|
| `js/content.js`, `js/content/` | The curated facts and quizzes (the original set, plus one file per category) |
| `js/engine.js` | Daily picking (seeded per date), difficulty curve and streaks; pure logic, tested in Node |
| `js/wiki.js` | Wikipedia summaries (image and link) and *On this day* events |
| `js/app.js` | UI: Today / Archive / Stats views, and notification setup |
| `sw.js` | Offline caching, image caching, and push → notification |
| `push/send.mjs` | Sends the daily push (used by the Action) |

Each time you open the app, it already picks **tomorrow's** curio and stores a teaser where the service worker can read it. That is how the morning notification can show the actual question. Your progress lives in `localStorage` on the device; use **Export backup** now and then.

## Adding content

Add items to the file for their category in `js/content/` (for example `middle-ages.js`):

```js
fact('ma116', 3, 'Sutton_Hoo', 'A ship in a mound', '…'),
quiz('ma117', 2, 'Sutton_Hoo', '…?', ['Correct answer', 'Wrong', 'Wrong', 'Wrong'], 0, '…'),
```

The arguments are `id, level, wiki, title, text` for a fact and `id, level, wiki, question, options, answer, explanation` for a quiz. You can write the correct answer first: options are shuffled with a seed from the id, so the order is stable across devices. Ids are stored in your history, so never reuse or rename one, and don't edit the options of a published quiz. `wiki` is the English Wikipedia page title, used for the picture and the "read more" link.

Categories: `Animals`, `Plants & fungi`, `Ecosystems`, `Deep time`, `Prehistory`, `Antiquity`, `Middle Ages`. Run `npm test` afterwards. When you change files the app caches, bump `VERSION` in `sw.js` so phones pick up the new version.

## Ideas for later

Accounts and sync across devices, AI-generated extra questions, spaced repetition for quizzes you got wrong, a "deep dive" mode per era.
