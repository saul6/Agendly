// Conekta — generación de links de pago

interface ConektaOrderPayload {
  currency: string;
  customer_info: {
    name: string;
    phone: string;
    email?: string;
  };
  line_items: {
    name: string;
    unit_price: number; // centavos
    quantity: number;
  }[];
  checkout: {
    type: 'Integration';
    allowed_payment_methods: string[];
    expires_at?: number; // unix timestamp
  };
  metadata?: Record<string, string>;
}

interface ConektaOrderResponse {
  id: string;
  checkout: {
    id: string;
    url: string;
  };
}

// ─── Crear liga de pago ───────────────────────────────────────────────────────

export async function createPaymentLink(params: {
  appointmentId: string;
  serviceName: string;
  priceInCents: number;
  customerName: string;
  customerPhone: string;
  expiresInHours?: number;
}): Promise<string> {
  const {
    appointmentId,
    serviceName,
    priceInCents,
    customerName,
    customerPhone,
    expiresInHours = 24,
  } = params;

  const expiresAt = Math.floor(Date.now() / 1000) + expiresInHours * 3600;

  const payload: ConektaOrderPayload = {
    currency: 'MXN',
    customer_info: {
      name: customerName || 'Cliente',
      phone: customerPhone,
    },
    line_items: [
      {
        name: serviceName,
        unit_price: priceInCents,
        quantity: 1,
      },
    ],
    checkout: {
      type: 'Integration',
      allowed_payment_methods: ['card', 'cash', 'bank_transfer'],
      expires_at: expiresAt,
    },
    metadata: {
      appointment_id: appointmentId,
    },
  };

  const res = await fetch('https://api.conekta.io/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.conekta-v2.1.0+json',
      Authorization: `Basic ${Buffer.from(process.env.CONEKTA_API_KEY! + ':').toString('base64')}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[payments] Error Conekta:', res.status, err);
    throw new Error(`Conekta error: ${res.status}`);
  }

  const data = await res.json() as ConektaOrderResponse;
  return data.checkout.url;
}

// ─── Verificar pago (webhook de Conekta) ─────────────────────────────────────

export function verifyConektaWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const crypto = require('crypto');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}
