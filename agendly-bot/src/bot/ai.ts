import Anthropic from '@anthropic-ai/sdk';
import {
  getConversation,
  upsertConversation,
  getBusinessById,
  getServices,
  logAiUsage,
} from '../services/supabase.js';
import { sendText } from '../services/whatsapp.js';
import { STATES, ERROR_MESSAGES } from './states.js';
import type {
  IncomingEvent,
  ConversationContext,
  FlowState,
  AiMessage,
} from '../types/index.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = 'claude-haiku-4-5-20251001'; // Modelo económico para excepciones
const MAX_TOKENS = 512;
const MAX_AI_TURNS = 5; // Después de N turnos, redirigir al flujo fijo

// ─── Handler de excepciones con IA ───────────────────────────────────────────

export async function handleAI(
  event: IncomingEvent,
  currentState: FlowState,
  context: ConversationContext
): Promise<void> {
  const { businessId, customerPhone, customerName, messageText, phoneNumberId } = event;

  // Limitar uso de IA: máximo N turnos consecutivos
  const history = context.ai_history ?? [];
  if (history.length >= MAX_AI_TURNS * 2) {
    await sendText(phoneNumberId, customerPhone,
      'Para continuar, usa una de las opciones del menú. Escribe *menu* en cualquier momento.');
    await upsertConversation(businessId, customerPhone, STATES.GREETING, { ...context, ai_history: [] });
    return;
  }

  const business = await getBusinessById(businessId);
  const services = await getServices(businessId);

  const systemPrompt = buildSystemPrompt(
    business?.name ?? 'el negocio',
    services.map((s) => {
      const parts = [
        s.price ? `$${s.price}` : 'precio a convenir',
        s.duration_minutes ? `${s.duration_minutes} min` : null,
      ].filter(Boolean).join(', ')
      return `${s.name} (${parts})`
    }).join(', ')
  );

  const updatedHistory: AiMessage[] = [
    ...history,
    { role: 'user', content: messageText },
  ];

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: updatedHistory.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const assistantText =
      response.content[0]?.type === 'text' ? response.content[0].text : '';

    if (!assistantText) {
      await sendText(phoneNumberId, customerPhone, ERROR_MESSAGES.GENERIC);
      return;
    }

    await sendText(phoneNumberId, customerPhone, assistantText);

    // Guardar historial y registrar uso
    await upsertConversation(businessId, customerPhone, STATES.AI_EXCEPTION, {
      ...context,
      ai_history: [
        ...updatedHistory,
        { role: 'assistant', content: assistantText },
      ],
    });

    await logAiUsage({
      business_id: businessId,
      customer_phone: customerPhone,
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      model: MODEL,
      reason: 'exception',
    });
  } catch (err) {
    console.error('[ai] Error llamando a Claude:', err);
    await sendText(phoneNumberId, customerPhone, ERROR_MESSAGES.GENERIC);
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(businessName: string, servicesStr: string): string {
  return `Eres el asistente de WhatsApp de "${businessName}". Tu único rol es responder dudas breves sobre los servicios, precios y políticas del negocio.

Servicios disponibles: ${servicesStr || 'consultar directamente'}

Reglas estrictas:
- Responde en español, de forma amable y concisa (máximo 3 oraciones).
- NO hagas reservas ni modifiques citas — para eso dile al cliente que escriba "agendar" o "menu".
- Si la pregunta no está relacionada con el negocio, redirige amablemente al menú.
- Nunca inventes información que no tengas.
- Si no sabes la respuesta, di: "Para más información, te recomiendo contactar directamente con nosotros."`;
}
