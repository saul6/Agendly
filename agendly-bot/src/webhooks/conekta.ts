import { Hono } from 'hono';
import { verifyConektaWebhookSignature } from '../services/payments.js';
import {
  getAppointmentById,
  markAppointmentPaid,
  getBusinessById,
  upsertConversation,
} from '../services/supabase.js';
import { sendText } from '../services/whatsapp.js';
import { STATES } from '../bot/states.js';

const conekta = new Hono();

conekta.post('/', async (c) => {
  // Verificar firma de Conekta
  const rawBody = await c.req.text();
  const signature = c.req.header('Digest') ?? '';
  const secret = process.env.CONEKTA_WEBHOOK_SECRET ?? '';

  if (secret && !verifyConektaWebhookSignature(rawBody, signature, secret)) {
    console.warn('[conekta] Firma inválida — webhook rechazado');
    return c.json({ error: 'Invalid signature' }, 401);
  }

  let payload: ConektaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ConektaWebhookPayload;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Solo procesar pagos completados
  if (payload.type !== 'order.paid') {
    return c.json({ status: 'ignored' }, 200);
  }

  const order = payload.data?.object;
  const appointmentId = order?.metadata?.appointment_id;
  const checkoutUrl = order?.checkout?.url ?? '';

  if (!appointmentId) {
    console.warn('[conekta] Webhook sin appointment_id en metadata');
    return c.json({ error: 'Missing appointment_id' }, 400);
  }

  // Procesar en background para responder rápido a Conekta
  c.executionCtx?.waitUntil(processPayment(appointmentId, checkoutUrl).catch(console.error));

  return c.json({ status: 'ok' }, 200);
});

async function processPayment(appointmentId: string, paymentLink: string): Promise<void> {
  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) {
    console.error(`[conekta] Cita no encontrada: ${appointmentId}`);
    return;
  }

  if (appointment.payment_status === 'paid') {
    console.log(`[conekta] Cita ${appointmentId} ya estaba marcada como pagada`);
    return;
  }

  // Actualizar estado de pago
  await markAppointmentPaid(appointmentId, paymentLink);

  // Enviar confirmación por WhatsApp al cliente
  const business = await getBusinessById(appointment.business_id);
  if (!business?.phone_number_id) {
    console.warn(`[conekta] Business ${appointment.business_id} sin phone_number_id — no se puede notificar`);
    return;
  }

  const folio = appointment.id.slice(-6).toUpperCase();
  await sendText(
    business.phone_number_id,
    appointment.customer_phone,
    `✅ *¡Pago confirmado!*\n\n🆔 Folio: #${folio}\n\nTu cita está completamente reservada. ¡Te esperamos! 🙌`
  );

  // Actualizar estado de conversación a confirmado
  await upsertConversation(
    appointment.business_id,
    appointment.customer_phone,
    STATES.BOOKING_CONFIRMED,
    {}
  );

  console.log(`[conekta] Pago procesado para cita ${appointmentId}`);
}

// ─── Tipos Conekta ────────────────────────────────────────────────────────────

interface ConektaWebhookPayload {
  type: string;
  data?: {
    object?: {
      id: string;
      metadata?: Record<string, string>;
      checkout?: { url: string };
    };
  };
}

export default conekta;
