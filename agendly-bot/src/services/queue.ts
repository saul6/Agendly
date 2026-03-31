import { sendText } from './whatsapp.js';
import { getAppointmentsDueForReminder, markReminderSent } from './supabase.js';

const POLL_INTERVAL_MS = 60_000; // 1 minuto

// Ventana 24h: entre 23h y 25h antes de la cita
const WINDOW_24H_MIN = 23 * 60 * 60 * 1000;
const WINDOW_24H_MAX = 25 * 60 * 60 * 1000;

// Ventana 1h: entre 45min y 75min antes de la cita
const WINDOW_1H_MIN = 45 * 60 * 1000;
const WINDOW_1H_MAX = 75 * 60 * 1000;

// ─── Worker de recordatorios ──────────────────────────────────────────────────

export function startReminderWorker(): NodeJS.Timeout {
  console.log('[queue] Worker de recordatorios iniciado (cron cada 60s)');
  void processReminders();
  return setInterval(() => void processReminders(), POLL_INTERVAL_MS);
}

async function processReminders(): Promise<void> {
  try {
    const appointments = await getAppointmentsDueForReminder();
    if (!appointments.length) return;

    const now = Date.now();

    for (const apt of appointments) {
      if (!apt.phone_number_id) {
        console.warn(`[queue] Cita ${apt.id} sin phone_number_id en business — recordatorio omitido`);
        continue;
      }

      const startMs = new Date(apt.slot_start_time).getTime();
      const diff = startMs - now;
      const hora = formatTime(apt.slot_start_time);

      let message: string | null = null;

      if (diff >= WINDOW_24H_MIN && diff <= WINDOW_24H_MAX) {
        message =
          `⏰ Hola ${apt.customer_name}, te recordamos tu cita *mañana a las ${hora}* ` +
          `para *${apt.service_name}* en ${apt.business_name}. ` +
          `Escribe *cancelar* si no puedes asistir.`;
      } else if (diff >= WINDOW_1H_MIN && diff <= WINDOW_1H_MAX) {
        message =
          `⏰ Hola ${apt.customer_name}, tu cita es *en 1 hora (${hora})* ` +
          `para *${apt.service_name}* en ${apt.business_name}. ¡Te esperamos!`;
      }

      if (message) {
        await sendText(apt.phone_number_id, apt.customer_phone, message);
        await markReminderSent(apt.id);
        console.log(`[queue] Recordatorio enviado para cita ${apt.id}`);
      }
    }
  } catch (err) {
    console.error('[queue] Error procesando recordatorios:', err);
  }
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Mexico_City',
  });
}
