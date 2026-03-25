import type { FlowState } from '../types/index.js';

// ─── Constantes de estados ────────────────────────────────────────────────────

export const STATES = {
  IDLE: 'IDLE',
  GREETING: 'GREETING',
  SELECT_SERVICE: 'SELECT_SERVICE',
  SELECT_STAFF: 'SELECT_STAFF',
  SELECT_DATE: 'SELECT_DATE',
  SELECT_TIME: 'SELECT_TIME',
  CONFIRM_BOOKING: 'CONFIRM_BOOKING',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  CANCEL_CONFIRM: 'CANCEL_CONFIRM',
  RESCHEDULE_DATE: 'RESCHEDULE_DATE',
  RESCHEDULE_TIME: 'RESCHEDULE_TIME',
  AI_EXCEPTION: 'AI_EXCEPTION',
} as const satisfies Record<string, FlowState>;

// ─── Palabras clave que activan el flujo fijo ─────────────────────────────────

export const BOOKING_TRIGGERS = [
  'agendar',
  'cita',
  'reservar',
  'appointment',
  'book',
  'quiero',
  'necesito',
  'hola',
  'buenas',
  'buenos',
  'hi',
  'hello',
];

export const CANCEL_TRIGGERS = [
  'cancelar',
  'cancel',
  'borrar',
  'eliminar cita',
];

export const RESCHEDULE_TRIGGERS = [
  'reagendar',
  'cambiar cita',
  'mover cita',
  'reschedule',
];

export const MENU_TRIGGERS = [
  'menu',
  'menú',
  'opciones',
  'inicio',
  'start',
  '0',
];

// ─── IDs de botones interactivos ──────────────────────────────────────────────

export const BUTTON_IDS = {
  CONFIRM_YES: 'confirm_yes',
  CONFIRM_NO: 'confirm_no',
  CANCEL_YES: 'cancel_yes',
  CANCEL_NO: 'cancel_no',
  BOOK_NEW: 'book_new',
  MY_APPOINTMENTS: 'my_appointments',
  HELP: 'help',
} as const;

// ─── Transiciones válidas por estado ─────────────────────────────────────────
//  Útil para validar que el usuario no llega a un estado imposible.

export const VALID_TRANSITIONS: Record<FlowState, FlowState[]> = {
  IDLE: ['GREETING'],
  GREETING: ['SELECT_SERVICE', 'CANCEL_CONFIRM', 'RESCHEDULE_DATE', 'AI_EXCEPTION'],
  SELECT_SERVICE: ['SELECT_STAFF', 'SELECT_DATE', 'AI_EXCEPTION'],
  SELECT_STAFF: ['SELECT_DATE', 'AI_EXCEPTION'],
  SELECT_DATE: ['SELECT_TIME', 'AI_EXCEPTION'],
  SELECT_TIME: ['CONFIRM_BOOKING', 'AI_EXCEPTION'],
  CONFIRM_BOOKING: ['AWAITING_PAYMENT', 'BOOKING_CONFIRMED', 'SELECT_SERVICE'],
  AWAITING_PAYMENT: ['BOOKING_CONFIRMED', 'SELECT_SERVICE'],
  BOOKING_CONFIRMED: ['IDLE'],
  CANCEL_CONFIRM: ['IDLE', 'GREETING'],
  RESCHEDULE_DATE: ['RESCHEDULE_TIME'],
  RESCHEDULE_TIME: ['CONFIRM_BOOKING'],
  AI_EXCEPTION: ['GREETING', 'SELECT_SERVICE', 'IDLE'],
};

// ─── Mensajes de error genéricos ──────────────────────────────────────────────

export const ERROR_MESSAGES = {
  GENERIC: 'Lo siento, ocurrió un error. Por favor intenta de nuevo o escribe *menu* para volver al inicio.',
  NO_BUSINESS: 'Este número no está registrado en Agendly. Contacta a soporte.',
  NO_SLOTS: 'No hay horarios disponibles para la fecha seleccionada. Por favor elige otra fecha.',
  NO_SERVICES: 'Este negocio no tiene servicios disponibles en este momento.',
  PAYMENT_FAILED: 'No se pudo generar el link de pago. Por favor intenta de nuevo.',
  BOOKING_FAILED: 'No se pudo confirmar tu cita. Por favor intenta de nuevo.',
} as const;
