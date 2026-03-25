// WhatsApp Cloud API — Meta

const WA_API_VERSION = 'v20.0';
const WA_BASE_URL = `https://graph.facebook.com/${WA_API_VERSION}`;

interface ListSection {
  title: string;
  rows: { id: string; title: string; description?: string }[];
}

interface SendListOptions {
  header: string;
  body: string;
  footer?: string;
  buttonText: string;
  sections: ListSection[];
}

interface SendButtonsOptions {
  body: string;
  buttons: { id: string; title: string }[];
  header?: string;
  footer?: string;
}

// ─── Envío base ───────────────────────────────────────────────────────────────

async function sendMessage(phoneNumberId: string, payload: object): Promise<void> {
  const url = `${WA_BASE_URL}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[whatsapp] Error enviando mensaje: ${res.status} ${err}`);
    throw new Error(`WhatsApp API error: ${res.status}`);
  }
}

// ─── Texto simple ─────────────────────────────────────────────────────────────

export async function sendText(
  phoneNumberId: string,
  to: string,
  text: string
): Promise<void> {
  await sendMessage(phoneNumberId, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  });
}

// ─── Lista interactiva ────────────────────────────────────────────────────────

export async function sendList(
  phoneNumberId: string,
  to: string,
  options: SendListOptions
): Promise<void> {
  await sendMessage(phoneNumberId, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: options.header },
      body: { text: options.body },
      ...(options.footer && { footer: { text: options.footer } }),
      action: {
        button: options.buttonText,
        sections: options.sections,
      },
    },
  });
}

// ─── Botones de respuesta rápida ──────────────────────────────────────────────

export async function sendButtons(
  phoneNumberId: string,
  to: string,
  options: SendButtonsOptions
): Promise<void> {
  await sendMessage(phoneNumberId, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(options.header && { header: { type: 'text', text: options.header } }),
      body: { text: options.body },
      ...(options.footer && { footer: { text: options.footer } }),
      action: {
        buttons: options.buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) }, // Max 20 chars
        })),
      },
    },
  });
}

// ─── Marcar como leído ────────────────────────────────────────────────────────

export async function markAsRead(
  phoneNumberId: string,
  messageId: string
): Promise<void> {
  await sendMessage(phoneNumberId, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}
