import { Hono } from 'hono';
import { z } from 'zod';
import { getBusinessByPhone } from '../services/supabase.js';
import { routeMessage } from '../bot/router.js';
import type { IncomingEvent, WhatsAppIncomingMessage } from '../types/index.js';

const webhook = new Hono();

// ─── Verificación de webhook (GET) ────────────────────────────────────────────

webhook.get('/', (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('[webhook] Verificación exitosa');
    return c.text(challenge ?? '', 200);
  }

  return c.text('Forbidden', 403);
});

// ─── Recepción de mensajes (POST) ─────────────────────────────────────────────

webhook.post('/', async (c) => {
  let body: WhatsAppIncomingMessage;

  try {
    body = await c.req.json<WhatsAppIncomingMessage>();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Meta espera 200 inmediato aunque el procesamiento tarde
  c.executionCtx?.waitUntil(processWebhook(body).catch(console.error));

  return c.json({ status: 'ok' }, 200);
});

// ─── Procesamiento asíncrono ──────────────────────────────────────────────────

async function processWebhook(body: WhatsAppIncomingMessage): Promise<void> {
  if (body.object !== 'whatsapp_business_account') return;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;

      const value = change.value;
      const messages = value.messages ?? [];
      const contacts = value.contacts ?? [];
      const phoneNumberId = value.metadata.phone_number_id;
      const businessWaNumber = value.metadata.display_phone_number;

      // Ignorar statusus (delivered, read, etc.)
      if (messages.length === 0) continue;

      // Buscar negocio por número de WhatsApp
      const business = await getBusinessByPhone(businessWaNumber);
      if (!business) {
        console.warn(`[webhook] Negocio no encontrado para número: ${businessWaNumber}`);
        continue;
      }

      for (const msg of messages) {
        // Solo procesar mensajes de texto e interactivos
        if (!['text', 'interactive'].includes(msg.type)) continue;

        const contact = contacts.find((c) => c.wa_id === msg.from);
        const customerName = contact?.profile.name ?? '';

        let messageText = '';
        let interactiveId: string | undefined;

        if (msg.type === 'text') {
          messageText = msg.text?.body ?? '';
        } else if (msg.type === 'interactive') {
          const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
          interactiveId = reply?.id;
          messageText = reply?.title ?? '';
        }

        if (!messageText && !interactiveId) continue;

        const event: IncomingEvent = {
          businessId: business.id,
          customerPhone: msg.from,
          customerName,
          messageText,
          messageType: msg.type,
          interactiveId,
          phoneNumberId,
        };

        await routeMessage(event);
      }
    }
  }
}

// ─── Esquema de validación (para futuras pruebas) ─────────────────────────────

export const webhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.record(z.unknown()),
        })
      ),
    })
  ),
});

export default webhook;
