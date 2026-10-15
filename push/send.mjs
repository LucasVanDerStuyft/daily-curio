// Sends one Web Push message to your phone. Run daily by .github/workflows/daily-push.yml.
// The service worker turns it into a notification with a teaser of today's curio.
//
// Env: PUSH_SUBSCRIPTION (JSON copied from the app), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
//      VAPID_SUBJECT (optional, mailto: or https: URL).
// Locally, falls back to push/vapid-keys.json and push/subscription.json.
import webpush from 'web-push';
import { readFileSync, existsSync } from 'node:fs';

const local = f => (existsSync(new URL(f, import.meta.url)) ? readFileSync(new URL(f, import.meta.url), 'utf8') : null);
const keys = process.env.VAPID_PRIVATE_KEY
  ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
  : JSON.parse(local('./vapid-keys.json') || '{}');
const subscription = JSON.parse(process.env.PUSH_SUBSCRIPTION || local('./subscription.json') || 'null');

if (!keys.publicKey || !keys.privateKey) throw new Error('Missing VAPID keys');
if (!subscription) throw new Error('Missing PUSH_SUBSCRIPTION — copy it from the app (Stats → Notifications)');

webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:daily-curio@users.noreply.github.com', keys.publicKey, keys.privateKey);

try {
  const res = await webpush.sendNotification(subscription, JSON.stringify({ kind: 'daily' }), { TTL: 12 * 3600, urgency: 'normal' });
  console.log('Push sent:', res.statusCode);
} catch (err) {
  if (err.statusCode === 404 || err.statusCode === 410) {
    console.error('Subscription expired. Open the app, re-enable notifications and update the PUSH_SUBSCRIPTION secret.');
  } else {
    console.error('Push failed:', err.statusCode, err.body || err.message);
  }
  process.exit(1);
}
