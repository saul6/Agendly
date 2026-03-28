// ─── Enums / constantes ───────────────────────────────────────────────────────

export type FlowState =
  | 'IDLE'
  | 'GREETING'
  | 'SELECT_SERVICE'
  | 'SELECT_STAFF'
  | 'SELECT_DATE'
  | 'SELECT_TIME'
  | 'CONFIRM_BOOKING'
  | 'AWAITING_PAYMENT'
  | 'BOOKING_CONFIRMED'
  | 'CANCEL_CONFIRM'
  | 'RESCHEDULE_DATE'
  | 'RESCHEDULE_TIME'
  | 'AI_EXCEPTION';

export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

// ─── Supabase row types ───────────────────────────────────────────────────────

export interface Business {
  id: string;
  whatsapp_number: string;
  name: string;
  timezone: string;
  booking_advance_hours: number;
  cancellation_hours: number;
  requires_payment: boolean;
  welcome_message: string | null;
  phone_number_id: string | null;
  created_at: string;
}

export interface Service {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  duration_minutes: number | null;
  price: number | null;
  is_active: boolean;
}

export interface Staff {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  is_active: boolean;
}

export interface Slot {
  id: string;
  staff_id: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

export interface Appointment {
  id: string;
  business_id: string;
  service_id: string;
  staff_id: string;
  slot_id: string;
  customer_phone: string;
  customer_name: string | null;
  status: AppointmentStatus;
  payment_status: PaymentStatus;
  payment_link: string | null;
  notes: string | null;
  reminder_sent: boolean;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  business_id: string;
  customer_phone: string;
  state: FlowState;
  context: ConversationContext;
  last_message_at: string;
  created_at: string;
}

export interface AiUsage {
  id: string;
  business_id: string;
  customer_phone: string;
  tokens_in: number;
  tokens_out: number;
  model: string;
  reason: string;
  created_at: string;
}

// ─── Flujo / contexto ─────────────────────────────────────────────────────────

export interface ConversationContext {
  selected_service_id?: string;
  selected_staff_id?: string;
  selected_date?: string;       // YYYY-MM-DD
  selected_slot_id?: string;
  appointment_id?: string;
  customer_name?: string;
  pending_appointment_id?: string; // para cancelar/reagendar
  ai_history?: AiMessage[];
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── WhatsApp / Meta ──────────────────────────────────────────────────────────

export interface WhatsAppIncomingMessage {
  object: string;
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  value: WhatsAppValue;
  field: string;
}

export interface WhatsAppValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

export interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'image' | 'audio' | 'document' | 'location';
  text?: { body: string };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
}

export interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export type RouterDecision = 'fixed_flow' | 'ai_exception';

export interface IncomingEvent {
  businessId: string;
  customerPhone: string;
  customerName: string;
  messageText: string;
  messageType: WhatsAppMessage['type'];
  interactiveId?: string;       // button/list reply id
  phoneNumberId: string;        // Meta phone_number_id para enviar
}
