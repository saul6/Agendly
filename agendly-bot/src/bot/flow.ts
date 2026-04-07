import {
  getConversation,
  upsertConversation,
  getServices,
  getServiceById,
  getStaffForService,
  getAvailableSlots,
  createAppointment,
  getAppointmentsByPhone,
  cancelAppointment,
  getBusinessById,
  storePaymentLink,
} from '../services/supabase.js';
import { sendText, sendList, sendButtons } from '../services/whatsapp.js';
import { createPaymentLink } from '../services/payments.js';
import {
  STATES,
  BUTTON_IDS,
  ERROR_MESSAGES,
} from './states.js';
import type {
  IncomingEvent,
  ConversationContext,
  FlowState,
} from '../types/index.js';

// ─── Máquina de estados ───────────────────────────────────────────────────────

export async function handleFixedFlow(
  event: IncomingEvent,
  currentState: FlowState,
  context: ConversationContext
): Promise<void> {
  const { businessId, customerPhone, customerName, messageText, interactiveId, phoneNumberId } = event;
  const normalized = messageText.toLowerCase().trim();
  const replyId = interactiveId ?? normalized;

  // Comando global: volver al menú
  if (['menu', 'menú', '0', 'inicio'].includes(normalized)) {
    await sendGreeting(phoneNumberId, customerPhone, customerName, businessId);
    await upsertConversation(businessId, customerPhone, STATES.GREETING, {});
    return;
  }

  switch (currentState) {
    case STATES.IDLE:
    case STATES.GREETING:
    case STATES.BOOKING_CONFIRMED:
      await handleGreeting(event, context);
      break;

    case STATES.SELECT_SERVICE:
      await handleSelectService(event, context);
      break;

    case STATES.SELECT_STAFF:
      await handleSelectStaff(event, context);
      break;

    case STATES.SELECT_DATE:
      await handleSelectDate(event, context);
      break;

    case STATES.SELECT_TIME:
      await handleSelectTime(event, context);
      break;

    case STATES.CONFIRM_BOOKING:
      await handleConfirmBooking(event, context);
      break;

    case STATES.AWAITING_PAYMENT:
      // El pago se verifica via webhook de Conekta, no aquí
      await sendText(phoneNumberId, customerPhone,
        'Aún esperamos la confirmación de tu pago. Cuando se procese, recibirás tu confirmación de cita. 🙏');
      break;

    case STATES.CANCEL_CONFIRM:
      await handleCancelConfirm(event, context);
      break;

    case STATES.RESCHEDULE_DATE:
      await handleRescheduleDate(event, context);
      break;

    case STATES.RESCHEDULE_TIME:
      await handleRescheduleTime(event, context);
      break;

    default:
      await sendGreeting(phoneNumberId, customerPhone, customerName, businessId);
      await upsertConversation(businessId, customerPhone, STATES.GREETING, {});
  }
}

// ─── Handlers por estado ──────────────────────────────────────────────────────

async function handleGreeting(event: IncomingEvent, context: ConversationContext): Promise<void> {
  const { businessId, customerPhone, customerName, phoneNumberId, interactiveId, messageText } = event;
  const normalized = messageText.toLowerCase().trim();
  const replyId = interactiveId ?? normalized;

  if (replyId === BUTTON_IDS.BOOK_NEW ||
    ['agendar', 'cita', 'reservar', '1'].includes(normalized)) {
    // Mostrar servicios
    const services = await getServices(businessId);
    if (!services.length) {
      await sendText(phoneNumberId, customerPhone, ERROR_MESSAGES.NO_SERVICES);
      return;
    }

    await sendList(phoneNumberId, customerPhone, {
      header: 'Nuestros servicios',
      body: '¿Qué servicio deseas agendar?',
      footer: 'Selecciona una opción',
      buttonText: 'Ver servicios',
      sections: [
        {
          title: 'Servicios disponibles',
          rows: services.map((s) => ({
            id: `service_${s.id}`,
            title: s.name,
            description: [
              s.price ? `$${s.price}` : null,
              s.duration_minutes ? `${s.duration_minutes} min` : null,
            ].filter(Boolean).join(' · '),
          })),
        },
      ],
    });

    await upsertConversation(businessId, customerPhone, STATES.SELECT_SERVICE, context);
    return;
  }

  if (replyId === BUTTON_IDS.MY_APPOINTMENTS ||
      ['2', '3'].includes(normalized) ||
      normalized.includes('cancelar') ||
      normalized.includes('reagendar')) {
    const appointments = await getAppointmentsByPhone(businessId, customerPhone);
    const upcoming = appointments.filter(
      (a) => a.status === 'confirmed' && new Date(a.slot_id) > new Date()
    );

    if (!upcoming.length) {
      await sendText(phoneNumberId, customerPhone, 'No tienes citas próximas agendadas.');
      await sendGreeting(phoneNumberId, customerPhone, customerName, businessId);
      return;
    }

    // Por simplicidad mostramos la primera cita activa
    const apt = upcoming[0];
    await sendText(
      phoneNumberId,
      customerPhone,
      `Tu próxima cita:\n📅 Cita #${apt.id.slice(-6).toUpperCase()}\nEstado: ${apt.status}\n\n¿Qué deseas hacer?\n1️⃣ Cancelar esta cita\n2️⃣ Agendar una nueva cita\n\nO escribe *menu* para volver al inicio.`,
    );

    await upsertConversation(businessId, customerPhone, STATES.CANCEL_CONFIRM, {
      ...context,
      pending_appointment_id: apt.id,
    });
    return;
  }

  if (normalized === '4' || normalized.includes('precio') || normalized.includes('informaci')) {
    const services = await getServices(businessId);
    if (!services.length) {
      await sendText(phoneNumberId, customerPhone, ERROR_MESSAGES.NO_SERVICES);
      await sendGreeting(phoneNumberId, customerPhone, customerName, businessId);
      return;
    }
    const lines = services.map((s) => {
      const price = s.price ? `$${s.price}` : 'Consultar precio';
      const duration = s.duration_minutes ? ` · ${s.duration_minutes} min` : '';
      return `• *${s.name}*: ${price}${duration}`;
    }).join('\n');
    await sendText(
      phoneNumberId,
      customerPhone,
      `📋 *Servicios y precios:*\n\n${lines}\n\nEscribe *1* para agendar o *menu* para volver al inicio.`,
    );
    await upsertConversation(businessId, customerPhone, STATES.GREETING, {});
    return;
  }

  // Default: mostrar menú de bienvenida
  await sendGreeting(phoneNumberId, customerPhone, customerName, businessId);
  await upsertConversation(businessId, customerPhone, STATES.GREETING, {});
}

async function handleSelectService(event: IncomingEvent, context: ConversationContext): Promise<void> {
  const { businessId, customerPhone, phoneNumberId, interactiveId } = event;

  if (!interactiveId?.startsWith('service_')) {
    await sendText(phoneNumberId, customerPhone, 'Por favor selecciona un servicio de la lista. 👆');
    return;
  }

  const serviceId = interactiveId.replace('service_', '');
  const staffList = await getStaffForService(businessId, serviceId);

  if (!staffList.length) {
    // Sin staff específico → ir directo a fecha
    await sendDatePicker(phoneNumberId, customerPhone);
    await upsertConversation(businessId, customerPhone, STATES.SELECT_DATE, {
      ...context,
      selected_service_id: serviceId,
    });
    return;
  }

  await sendList(phoneNumberId, customerPhone, {
    header: 'Especialista',
    body: '¿Con quién deseas agendar?',
    footer: 'Selecciona o escribe "cualquiera"',
    buttonText: 'Ver especialistas',
    sections: [
      {
        title: 'Disponibles',
        rows: [
          { id: 'staff_any', title: 'Cualquiera disponible', description: '' },
          ...staffList.map((s) => ({ id: `staff_${s.id}`, title: s.name, description: '' })),
        ],
      },
    ],
  });

  await upsertConversation(businessId, customerPhone, STATES.SELECT_STAFF, {
    ...context,
    selected_service_id: serviceId,
  });
}

async function handleSelectStaff(event: IncomingEvent, context: ConversationContext): Promise<void> {
  const { businessId, customerPhone, phoneNumberId, interactiveId, messageText } = event;

  const staffId = interactiveId?.startsWith('staff_') && interactiveId !== 'staff_any'
    ? interactiveId.replace('staff_', '')
    : undefined;

  await sendDatePicker(phoneNumberId, customerPhone);
  await upsertConversation(businessId, customerPhone, STATES.SELECT_DATE, {
    ...context,
    selected_staff_id: staffId,
  });
}

async function handleSelectDate(event: IncomingEvent, context: ConversationContext): Promise<void> {
  const { businessId, customerPhone, phoneNumberId, messageText } = event;

  const dateRegex = /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/;
  const match = messageText.match(dateRegex);

  if (!match) {
    await sendText(phoneNumberId, customerPhone,
      'Por favor escribe la fecha en formato DD/MM, por ejemplo: *15/04*');
    return;
  }

  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  const year = match[3] ? (match[3].length === 2 ? `20${match[3]}` : match[3]) : new Date().getFullYear().toString();
  const dateStr = `${year}-${month}-${day}`;

  const slots = await getAvailableSlots(
    businessId,
    context.selected_staff_id,
    dateStr
  );

  if (!slots.length) {
    await sendText(phoneNumberId, customerPhone, ERROR_MESSAGES.NO_SLOTS);
    await sendDatePicker(phoneNumberId, customerPhone);
    return;
  }

  await sendList(phoneNumberId, customerPhone, {
    header: `Horarios para el ${day}/${month}`,
    body: '¿A qué hora prefieres tu cita?',
    footer: 'Selecciona un horario',
    buttonText: 'Ver horarios',
    sections: [
      {
        title: 'Disponibles',
        rows: slots.slice(0, 10).map((s) => ({
          id: `slot_${s.id}`,
          title: formatTime(s.start_time),
          description: `hasta ${formatTime(s.end_time)}`,
        })),
      },
    ],
  });

  await upsertConversation(businessId, customerPhone, STATES.SELECT_TIME, {
    ...context,
    selected_date: dateStr,
  });
}

async function handleSelectTime(event: IncomingEvent, context: ConversationContext): Promise<void> {
  const { businessId, customerPhone, phoneNumberId, interactiveId } = event;

  if (!interactiveId?.startsWith('slot_')) {
    await sendText(phoneNumberId, customerPhone, 'Por favor selecciona un horario de la lista. 👆');
    return;
  }

  const slotId = interactiveId.replace('slot_', '');

  await sendButtons(phoneNumberId, customerPhone, {
    body: `¿Confirmamos tu cita?\n\n📅 Fecha: ${context.selected_date}\n⏰ Horario seleccionado\n\n¿Todo correcto?`,
    buttons: [
      { id: BUTTON_IDS.CONFIRM_YES, title: 'Confirmar ✓' },
      { id: BUTTON_IDS.CONFIRM_NO, title: 'Cambiar' },
    ],
  });

  await upsertConversation(businessId, customerPhone, STATES.CONFIRM_BOOKING, {
    ...context,
    selected_slot_id: slotId,
  });
}

async function handleConfirmBooking(event: IncomingEvent, context: ConversationContext): Promise<void> {
  const { businessId, customerPhone, customerName, phoneNumberId, interactiveId } = event;

  if (interactiveId === BUTTON_IDS.CONFIRM_NO) {
    await sendDatePicker(phoneNumberId, customerPhone);
    await upsertConversation(businessId, customerPhone, STATES.SELECT_DATE, context);
    return;
  }

  if (interactiveId !== BUTTON_IDS.CONFIRM_YES) {
    await sendText(phoneNumberId, customerPhone, 'Por favor usa los botones para confirmar. 👆');
    return;
  }

  try {
    const appointment = await createAppointment({
      business_id: businessId,
      service_id: context.selected_service_id!,
      staff_id: context.selected_staff_id ?? '',
      slot_id: context.selected_slot_id!,
      customer_phone: customerPhone,
      customer_name: customerName || context.customer_name || '',
      status: 'confirmed',
      payment_status: 'pending',
    });

    const folio = appointment.id.slice(-6).toUpperCase();

    // Fix 1: enviar link de pago si el negocio lo requiere Y el servicio tiene precio
    const business = await getBusinessById(businessId);
    const service = await getServiceById(context.selected_service_id!);
    const hasPrice = service?.price != null && service.price > 0;

    if (business?.requires_payment && hasPrice) {
      try {
        const paymentLink = await createPaymentLink({
          appointmentId: appointment.id,
          serviceName: service?.name ?? 'Servicio',
          priceInCents: Math.round((service!.price!) * 100),
          customerName: customerName || context.customer_name || 'Cliente',
          customerPhone,
        });

        await storePaymentLink(appointment.id, paymentLink);

        await sendText(phoneNumberId, customerPhone,
          `✅ *¡Cita confirmada!*\n\n🆔 Folio: #${folio}\n📅 ${context.selected_date}\n\n💳 *Completa tu pago aquí:*\n${paymentLink}\n\n_El link vence en 24 horas._`
        );
        await upsertConversation(businessId, customerPhone, STATES.AWAITING_PAYMENT, {});
      } catch (payErr) {
        console.error('[flow] Error generando link de pago:', payErr);
        // Cita ya creada — confirmar sin pago y notificar
        await sendText(phoneNumberId, customerPhone,
          `✅ *¡Cita confirmada!*\n\n🆔 Folio: #${folio}\n📅 ${context.selected_date}\n\n⚠️ No pudimos generar el link de pago. El negocio te contactará para coordinar el pago.`
        );
        await upsertConversation(businessId, customerPhone, STATES.BOOKING_CONFIRMED, {});
      }
    } else {
      // Sin precio configurado → confirmar directo sin cobro
      await sendText(phoneNumberId, customerPhone,
        `✅ *¡Cita confirmada!*\n\n🆔 Folio: #${folio}\n📅 ${context.selected_date}\n\nTe enviaremos un recordatorio. ¡Hasta pronto! 👋`
      );
      await upsertConversation(businessId, customerPhone, STATES.BOOKING_CONFIRMED, {});
    }

    // Fix 2: el cron-job en queue.ts lee reminder_sent y slot.start_time directamente
    // de la BD — no es necesario programar nada aquí.
  } catch (err) {
    console.error('[flow] Error creando cita:', err);
    await sendText(phoneNumberId, customerPhone, ERROR_MESSAGES.BOOKING_FAILED);
  }
}

async function handleCancelConfirm(event: IncomingEvent, context: ConversationContext): Promise<void> {
  const { businessId, customerPhone, phoneNumberId, interactiveId, messageText } = event;
  const normalized = messageText.toLowerCase().trim();

  if ((interactiveId === BUTTON_IDS.CANCEL_YES || normalized === '1') && context.pending_appointment_id) {
    await cancelAppointment(context.pending_appointment_id);
    await sendText(phoneNumberId, customerPhone,
      '✅ Tu cita ha sido cancelada. Si deseas agendar una nueva, escribe *1* o *agendar*.');
    await upsertConversation(businessId, customerPhone, STATES.IDLE, {});
    return;
  }

  await sendGreeting(phoneNumberId, customerPhone, event.customerName, businessId);
  await upsertConversation(businessId, customerPhone, STATES.GREETING, {});
}

async function handleRescheduleDate(event: IncomingEvent, context: ConversationContext): Promise<void> {
  // Similar a SELECT_DATE pero conservando appointment_id
  await handleSelectDate(event, context);
}

async function handleRescheduleTime(event: IncomingEvent, context: ConversationContext): Promise<void> {
  await handleSelectTime(event, context);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sendGreeting(
  phoneNumberId: string,
  to: string,
  customerName: string,
  businessId: string,
): Promise<void> {
  const business = await getBusinessById(businessId);
  const businessName = business?.name ?? 'nuestro negocio';
  const hello = customerName ? `¡Hola ${customerName}! 👋` : '¡Hola! 👋';
  await sendText(
    phoneNumberId,
    to,
    `${hello} Bienvenido/a a *${businessName}*.\n\n¿En qué te puedo ayudar?\n\n1️⃣ Agendar una cita\n2️⃣ Ver mis citas\n3️⃣ Cancelar una cita\n4️⃣ Información y precios`,
  );
}

export async function sendMenuFallback(
  phoneNumberId: string,
  to: string,
): Promise<void> {
  await sendText(
    phoneNumberId,
    to,
    'No entendí tu mensaje 😅 ¿En qué te puedo ayudar?\n\n1️⃣ Agendar una cita\n2️⃣ Ver mis citas\n3️⃣ Cancelar una cita\n4️⃣ Información y precios',
  );
}

async function sendDatePicker(phoneNumberId: string, to: string): Promise<void> {
  await sendText(
    phoneNumberId,
    to,
    '📅 ¿Qué día te gustaría? Escribe la fecha en formato *DD/MM*, por ejemplo: *15/04*\n\nO escribe *menu* para volver al inicio.'
  );
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Mexico_City',
  });
}
