import { createClient } from '@supabase/supabase-js';
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
  payload: Omit<Appointment, 'id' | 'created_at' | 'updated_at' | 'notes' | 'payment_link'>
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
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('business_id', businessId)
    .eq('customer_phone', customerPhone)
    .single();
  return data;
}

export async function upsertConversation(
  businessId: string,
  customerPhone: string,
  state: FlowState,
  context: ConversationContext
): Promise<void> {
  await supabase.from('conversations').upsert(
    {
      business_id: businessId,
      customer_phone: customerPhone,
      state,
      context,
      last_message_at: new Date().toISOString(),
    },
    { onConflict: 'business_id,customer_phone' }
  );
}

// ─── AI Usage ─────────────────────────────────────────────────────────────────

export async function logAiUsage(
  payload: Omit<AiUsage, 'id' | 'created_at'>
): Promise<void> {
  await supabase.from('ai_usage').insert(payload);
}
