import { getConversation, upsertConversation } from '../services/supabase.js';
import { handleFixedFlow } from './flow.js';
import { handleAI } from './ai.js';
import {
  BOOKING_TRIGGERS,
  CANCEL_TRIGGERS,
  RESCHEDULE_TRIGGERS,
  MENU_TRIGGERS,
  STATES,
} from './states.js';
import type { IncomingEvent, RouterDecision } from '../types/index.js';

// ─── Punto de entrada: clasifica y despacha ───────────────────────────────────

export async function routeMessage(event: IncomingEvent): Promise<void> {
  const conversation = await getConversation(event.businessId, event.customerPhone);

  const currentState = conversation?.state ?? STATES.IDLE;
  const context = conversation?.context ?? {};

  const decision = classifyMessage(event.messageText, event.interactiveId, currentState);

  console.log(`[router] ${event.customerPhone} | state=${currentState} | decision=${decision} | msg="${event.messageText}"`);

  if (decision === 'fixed_flow') {
    await handleFixedFlow(event, currentState, context);
  } else {
    await handleAI(event, currentState, context);
  }
}

// ─── Clasificador ─────────────────────────────────────────────────────────────

export function classifyMessage(
  text: string,
  interactiveId: string | undefined,
  currentState: string
): RouterDecision {
  // Los botones/listas siempre van al flujo fijo
  if (interactiveId) return 'fixed_flow';

  const normalized = text.toLowerCase().trim();

  // Si ya está en un estado activo del flujo, continuar ahí
  const activeFlowStates = [
    STATES.SELECT_SERVICE,
    STATES.SELECT_STAFF,
    STATES.SELECT_DATE,
    STATES.SELECT_TIME,
    STATES.CONFIRM_BOOKING,
    STATES.AWAITING_PAYMENT,
    STATES.CANCEL_CONFIRM,
    STATES.RESCHEDULE_DATE,
    STATES.RESCHEDULE_TIME,
  ];

  if (activeFlowStates.includes(currentState as any)) return 'fixed_flow';

  // Palabras clave que activan flujos fijos
  const fixedKeywords = [
    ...BOOKING_TRIGGERS,
    ...CANCEL_TRIGGERS,
    ...RESCHEDULE_TRIGGERS,
    ...MENU_TRIGGERS,
  ];

  if (fixedKeywords.some((kw) => normalized.includes(kw))) return 'fixed_flow';

  // Si está en AI_EXCEPTION, seguir con IA
  if (currentState === STATES.AI_EXCEPTION) return 'ai_exception';

  // Cualquier mensaje corto y estructurado → flujo fijo (números, opciones)
  if (/^\d+$/.test(normalized) || normalized.length < 4) return 'fixed_flow';

  // Preguntas, texto libre → IA
  return 'ai_exception';
}
