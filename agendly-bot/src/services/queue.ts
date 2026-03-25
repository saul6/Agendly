import { Queue, Worker } from 'bullmq';
import { Redis } from '@upstash/redis';

// ─── Conexión Redis (Upstash compatible con BullMQ via ioredis-compatible URL) ─

// BullMQ requiere ioredis. Upstash Redis HTTP client no es compatible directamente,
// por lo que usamos la URL con el adapter de conexión.
const connection = {
  host: new URL(process.env.UPSTASH_REDIS_URL ?? 'redis://localhost:6379').hostname,
  port: Number(new URL(process.env.UPSTASH_REDIS_URL ?? 'redis://localhost:6379').port) || 6379,
  password: process.env.UPSTASH_REDIS_TOKEN,
  tls: process.env.UPSTASH_REDIS_URL?.startsWith('rediss://') ? {} : undefined,
};

// ─── Queues ───────────────────────────────────────────────────────────────────

export const reminderQueue = new Queue('reminders', { connection });
export const notificationQueue = new Queue('notifications', { connection });

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export interface ReminderJobData {
  appointmentId: string;
  customerPhone: string;
  phoneNumberId: string;
  reminderType: '24h' | '1h';
  appointmentDateTime: string;
}

export interface NotificationJobData {
  type: 'booking_confirmed' | 'payment_received' | 'cancellation';
  appointmentId: string;
  staffPhone?: string;
}

// ─── Programar recordatorios para una cita ────────────────────────────────────

export async function scheduleReminders(
  appointmentId: string,
  slotStartTime: string,
): Promise<void> {
  const startMs = new Date(slotStartTime).getTime();
  const now = Date.now();

  const reminder24h = startMs - 24 * 60 * 60 * 1000;
  const reminder1h = startMs - 60 * 60 * 1000;

  if (reminder24h > now) {
    await reminderQueue.add(
      'send-reminder',
      { appointmentId, reminderType: '24h', appointmentDateTime: slotStartTime } as ReminderJobData,
      {
        delay: reminder24h - now,
        jobId: `reminder-24h-${appointmentId}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  }

  if (reminder1h > now) {
    await reminderQueue.add(
      'send-reminder',
      { appointmentId, reminderType: '1h', appointmentDateTime: slotStartTime } as ReminderJobData,
      {
        delay: reminder1h - now,
        jobId: `reminder-1h-${appointmentId}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  }
}

export async function cancelReminders(appointmentId: string): Promise<void> {
  const job24h = await reminderQueue.getJob(`reminder-24h-${appointmentId}`);
  const job1h = await reminderQueue.getJob(`reminder-1h-${appointmentId}`);
  await job24h?.remove();
  await job1h?.remove();
}

// ─── Worker de recordatorios (inicializar en index.ts) ────────────────────────

export function startReminderWorker(): Worker {
  const worker = new Worker(
    'reminders',
    async (job) => {
      const data = job.data as ReminderJobData;
      console.log(`[queue] Enviando recordatorio ${data.reminderType} para cita ${data.appointmentId}`);

      // Importación dinámica para evitar dependencia circular
      const { sendText } = await import('./whatsapp.js');
      const { getAppointmentsByPhone } = await import('./supabase.js');

      const message =
        data.reminderType === '24h'
          ? `⏰ Recordatorio: tienes una cita mañana. Escribe *menu* para ver tus citas o *cancelar* si no puedes asistir.`
          : `⏰ Tu cita es en 1 hora. ¡Te esperamos!`;

      if (data.phoneNumberId && data.customerPhone) {
        await sendText(data.phoneNumberId, data.customerPhone, message);
      }
    },
    { connection }
  );

  worker.on('failed', (job, err) => {
    console.error(`[queue] Job ${job?.id} falló:`, err);
  });

  return worker;
}
