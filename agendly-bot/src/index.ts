import 'dotenv/config';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import webhook from './webhooks/whatsapp.js';
import conektaWebhook from './webhooks/conekta.js';
import { startReminderWorker } from './services/queue.js';

const app = new Hono();

// ─── Middlewares ──────────────────────────────────────────────────────────────

app.use('*', logger());
app.use('*', secureHeaders());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

// ─── Rutas ────────────────────────────────────────────────────────────────────

app.route('/webhook/whatsapp', webhook);
app.route('/webhook/conekta', conektaWebhook);

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: 'Not found' }, 404));

// ─── Inicio del servidor ──────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3000);

startReminderWorker();
console.log(`[server] Agendly Bot corriendo en http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
