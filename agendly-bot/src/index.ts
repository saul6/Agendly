import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import webhook from './webhooks/whatsapp.js';
import conektaWebhook from './webhooks/conekta.js';
import { startReminderWorker } from './services/queue.js';

console.log('ENV CHECK:', {
  SUPABASE_URL: process.env.SUPABASE_URL ? 'OK' : 'MISSING',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'OK' : 'MISSING',
  META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN ? 'OK' : 'MISSING',
  PORT: process.env.PORT,
});

const app = new Hono();

// ─── Middlewares ──────────────────────────────────────────────────────────────

app.use('*', logger());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

// ─── Rutas ────────────────────────────────────────────────────────────────────

app.route('/webhook/whatsapp', webhook);
app.route('/webhook/conekta', conektaWebhook);

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: 'Not found' }, 404));

// ─── Inicio del servidor ──────────────────────────────────────────────────────

startReminderWorker();

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT) || 8080,
  hostname: '0.0.0.0',
}, (info) => {
  console.log(`[server] Agendly Bot corriendo en http://${info.address}:${info.port}`);
});
