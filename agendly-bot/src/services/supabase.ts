import { createClient } from '@supabase/supabase-js';
import {
  getConversationFromRedis,
  setConversationInRedis,
} from './redis.js';
import type {
  Business,
  Service,
  Staff,
  Slot,
  Appointment,
  Conversation,
  ConversationContext,
  FlowState,
  AiUsage,
} from '../types/index.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default supabase;

// ─── Businesses ───────────────────────────────────────────────────────────────

export async function getBusinessByPhone(waNumber: string): Promise<Business | null> {
  const { data } = await supabase
    .from('businesses')
    .select('*')
    .eq('whatsapp_number', waNumber)
    .single();
  return data;
}

export async function getBusinessById(id: string): Promise<Business | null> {
  const { data } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', id)
    .single();
  return data;
}

// ─── Services ─────────────────────────────────────────────────────────────────

export async function getServiceById(serviceId: string): Promise<Service | null> {
  const { data } = await supabase
    .from('services')
    .select('*')
    .eq('id', serviceId)
    .single();
  return data;
}

export async function getServices(businessId: string): Promise<Service[]> {
  const { data } = await supabase
    .from('services')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('name');
  return data ?? [];
}

// ─── Staff ────────────────────────────────────────────────────────────────────

export async function getStaffForService(
  businessId: string,
  serviceId: string
): Promise<Staff[]> {
  const { data } = await supabase
    .from('staff_services')
    .select('staff:staff_id(*)')
    .eq('service_id', serviceId);

  if (!data) return [];

  return (data as any[])
    .map((row) => row.staff)
    .filter((s) => s?.is_active);
}

// ─── Slots ────────────────────────────────────────────────────────────────────

export async function getAvailableSlots(
  businessId: string,
  staffId: string | undefined,
  date: string // YYYY-MM-DD
): Promise<Slot[]> {
  let query = supabase
    .from('slots')
    .select('*, staff:staff_id(business_id)')
    .eq('is_available', true)
    .gte('start_time', `${date}T00:00:00`)
    .lt('start_time', `${date}T23:59:59`)
    .order('start_time');

  if (staffId) {
    query = query.eq('staff_id', staffId);
  }

  const { data } = await query;
  if (!data) return [];

  // Filtrar por business_id via join
  return (data as any[]).filter((s) => s.staff?.business_id === businessId);
}

// ─── Appointments ─────────────────────────────────────────────────────────────

export async function createAppointment(
  payload: Omit<Appointment, 'id' | 'created_at' | 'updated_at' | 'notes' | 'payment_link' | 'reminder_sent'>
): Promise<Appointment> {
  const { data, error } = await supabase
    .from('appointments')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function cancelAppointment(appointmentId: string): Promise<void> {
  await supabase
    .from('appointments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', appointmentId);
}

export async function getAppointmentsByPhone(
  businessId: string,
  customerPhone: string
): Promise<Appointment[]> {
  const { data } = await supabase
    .from('appointments')
    .select('*')
    .eq('business_id', businessId)
    .eq('customer_phone', customerPhone)
    .in('status', ['confirmed', 'pending'])
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function getAppointmentById(appointmentId: string): Promise<Appointment | null> {
  const { data } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();
  return data;
}

export async function storePaymentLink(
  appointmentId: string,
  paymentLink: string
): Promise<void> {
  await supabase
    .from('appointments')
    .update({ payment_link: paymentLink, updated_at: new Date().toISOString() })
    .eq('id', appointmentId);
}

export async function markAppointmentPaid(
  appointmentId: string,
  paymentLink: string
): Promise<void> {
  await supabase
    .from('appointments')
    .update({
      payment_status: 'paid',
      payment_link: paymentLink,
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId);
}

export async function markReminderSent(appointmentId: string): Promise<void> {
  await supabase
    .from('appointments')
    .update({ reminder_sent: true, updated_at: new Date().toISOString() })
    .eq('id', appointmentId);
}

// ─── Recordatorios (cron) ─────────────────────────────────────────────────────

export interface AppointmentReminder {
  id: string;
  customer_phone: string;
  slot_start_time: string;
  phone_number_id: string | null;
}

export async function getAppointmentsDueForReminder(): Promise<AppointmentReminder[]> {
  // Buscar citas confirmadas sin recordatorio cuyo slot está entre 45min y 25h en el futuro
  const now = new Date();
  const windowStart = new Date(now.getTime() + 45 * 60 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('appointments')
    .select(`
      id,
      customer_phone,
      slots (start_time),
      businesses (phone_number_id)
    `)
    .eq('status', 'confirmed')
    .eq('reminder_sent', false);

  if (!data) return [];

  return (data as any[])
    .filter((a) => {
      const startTime: string | undefined = a.slots?.start_time;
      return startTime && startTime >= windowStart && startTime <= windowEnd;
    })
    .map((a) => ({
      id: a.id,
      customer_phone: a.customer_phone,
      slot_start_time: a.slots.start_time,
      phone_number_id: a.businesses?.phone_number_id ?? null,
    }));
}

export async function updateAppointmentPayment(
  appointmentId: string,
  paymentStatus: 'paid' | 'failed',
  paymentLink?: string
): Promise<void> {
  await supabase
    .from('appointments')
    .update({
      payment_status: paymentStatus,
      payment_link: paymentLink,
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId);
}

// ─── Conversations ────────────────────────────────────────────────────────────

export async function getConversation(
  businessId: string,
  customerPhone: string
): Promise<Conversation | null> {
  // Intenta Redis primero (1-3ms), cae a Supabase si no está en caché (20-80ms)
  const cached = await getConversationFromRedis(businessId, customerPhone);
  if (cached) {
    return {
      id: '',
      business_id: businessId,
      customer_phone: customerPhone,
      state: cached.state,
      context: cached.context,
      last_message_at: '',
      created_at: '',
    } satisfies Conversation;
  }

  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('business_id', businessId)
    .eq('customer_phone', customerPhone)
    .single();

  if (data) {
    // Calentar el caché para la próxima vez
    await setConversationInRedis(businessId, customerPhone, data.state, data.context);
  }

  return data;
}

export async function upsertConversation(
  businessId: string,
  customerPhone: string,
  state: FlowState,
  context: ConversationContext
): Promise<void> {
  // Escribir en Redis (rápido) y Supabase (persistente) en paralelo
  await Promise.all([
    setConversationInRedis(businessId, customerPhone, state, context),
    supabase.from('conversations').upsert(
      {
        business_id: businessId,
        customer_phone: customerPhone,
        state,
        context,
        last_message_at: new Date().toISOString(),
      },
      { onConflict: 'business_id,customer_phone' }
    ),
  ]);
}

// ─── AI Usage ─────────────────────────────────────────────────────────────────

export async function logAiUsage(
  payload: Omit<AiUsage, 'id' | 'created_at'>
): Promise<void> {
  await supabase.from('ai_usage').insert(payload);
}
