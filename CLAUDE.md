# Agendly — Instrucciones para Claude Code

## Qué es este proyecto

SaaS de agendamiento por WhatsApp para pequeños negocios en México (barberías, salones,
consultorios, restaurantes). El cliente final agenda, elige servicio, hora y paga — todo
sin salir de WhatsApp.

**Empresa:** DuoMind Solutions  
**Producto:** Agendly  
**Equipo:** 2 devs  
**Mercado:** México (RESICO, Conekta, SPEI, OXXO)

---

## Stack

| Capa | Tecnología |
|------|------------|
| Servidor bot | Node.js + TypeScript + Hono |
| Canal | Meta WhatsApp Cloud API |
| Bot IA | Claude API — solo excepciones (~20% mensajes) |
| Base de datos | Supabase (PostgreSQL) |
| Estado conversación | Upstash Redis |
| Cola recordatorios | BullMQ + Upstash Redis |
| Pagos citas | Conekta (tarjeta, SPEI, OXXO) |
| Pagos suscripción | Stripe (fase 2) |
| Panel web | Next.js + shadcn/ui (repo separado) |
| Deploy bot | Railway |
| Deploy panel | Vercel |

---

## Supabase

**Project ID:** `vgtlsuoakpeimgoxclyl`  
**Region:** us-east-1  
**Migraciones aplicadas:**
- `20260324052739` — create_businesses_and_services
- `20260324052749` — create_slots_and_appointments
- `20260324052801` — create_payments_conversations_ai_usage
- `20260324052811` — enable_rls_and_policies

### Tablas MVP (9 tablas)

```
businesses       → un registro por cliente de Agendly
services         → catálogo de servicios del negocio
staff            → empleados/profesionales
staff_services   → relación muchos-a-muchos staff ↔ services
slots            → disponibilidad pre-generada por empleado y fecha
appointments     → citas agendadas
payments         → cobros procesados (Conekta/Stripe)
conversations    → estado activo de cada conversación WhatsApp
ai_usage         → monitoreo de tokens y costo Claude API por negocio
```

### Reglas de BD

- **Siempre usar `apply_migration` para cambios de schema** — nunca `execute_sql` para DDL
- Nombrar migraciones en snake_case descriptivo: `add_location_to_businesses`
- RLS activado en todas las tablas — el backend usa `service_role` key
- Las políticas de usuario (panel web) se agregan cuando llegue auth

---

## Arquitectura del bot

### Flujo híbrido — regla de oro

```
Mensaje entrante → classifyMessage() → ¿flujo fijo o IA?
                                          ↓              ↓
                                    handleFixedFlow()  handleAI()
                                    $0 de costo        ~$0.002 USD
                                    ~80% de casos      ~20% de casos
```

### Estados de conversación (`conversations.state`)

```
idle → menu → service → slot → confirm → payment → done
```

### Qué va al flujo fijo (sin costo)
- Respuestas a botones/listas interactivas de WhatsApp
- Selección numérica dentro de un estado activo
- Palabras clave de reinicio: "hola", "menú", "inicio", "cancelar"
- Confirmaciones: "sí", "confirmo", "ok", "dale", "va"

### Qué va a Claude API (costo ~$0.002 USD)
- Texto libre fuera del flujo esperado
- Preguntas sobre precios, horarios, disponibilidad
- Cambios de cita o solicitudes no contempladas en el flujo
- Máximo 5 turnos consecutivos de IA → redirige al menú

### Modelo Claude a usar
- **`claude-haiku-4-5-20251001`** — para el bot (más económico, suficiente para agendamiento)
- **NO usar Sonnet o Opus** para el bot — el costo se dispara sin beneficio real

---

## Variables de entorno

```env
# Supabase
SUPABASE_URL=https://vgtlsuoakpeimgoxclyl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=          # Settings → API → service_role

# Anthropic
ANTHROPIC_API_KEY=                  # console.anthropic.com

# Meta WhatsApp
META_WHATSAPP_TOKEN=                # token de acceso permanente de Meta
META_VERIFY_TOKEN=                  # string que defines tú para verificar webhook
META_PHONE_NUMBER_ID=               # ID del número de WhatsApp Business

# Pagos
CONEKTA_API_KEY=                    # dashboard.conekta.com

# Redis (Upstash)
UPSTASH_REDIS_URL=                  # console.upstash.com
UPSTASH_REDIS_TOKEN=

PORT=3000
NODE_ENV=development
```

---

## Convenciones de código

### TypeScript
- Strict mode activado — no usar `any`
- Interfaces en `src/types/index.ts` — no definir tipos inline en los archivos
- Async/await siempre — no callbacks ni `.then()`
- Manejo de errores con try/catch en todos los handlers de webhook

### Estructura de archivos
```
src/
├── bot/
│   ├── states.ts      # STATES enum, tipos de clasificación, transitions
│   ├── router.ts      # classifyMessage() → { type: 'fixed'|'ai', action?, value? }
│   ├── flow.ts        # handleFixedFlow() → { message, newState }
│   └── ai.ts          # handleAI() → { message, tokensUsed }
├── webhooks/
│   └── whatsapp.ts    # GET verificación + POST procesamiento con waitUntil
├── services/
│   ├── supabase.ts    # cliente + todas las queries tipadas
│   ├── whatsapp.ts    # sendText / sendList / sendButtons
│   ├── payments.ts    # Conekta createPaymentLink()
│   └── queue.ts       # BullMQ scheduleReminder() / cancelReminder()
├── types/
│   └── index.ts       # Business, Service, Staff, Slot, Appointment, Payment,
│                      # ConversationState, WhatsAppMessage
└── index.ts           # servidor Hono + worker BullMQ
```

### Nombrado
- Archivos: `camelCase.ts`
- Interfaces: `PascalCase`
- Funciones: `camelCase`
- Constantes: `UPPER_SNAKE_CASE`
- Tablas Supabase: `snake_case` (ya definidas)

### Queries Supabase
- Todas las queries van en `src/services/supabase.ts` — **nunca** hacer queries inline en el bot
- Nombrar funciones como `getAvailableSlots()`, `createAppointment()`, `upsertConversation()`
- Siempre manejar el error de Supabase: `const { data, error } = await supabase...`

---

## Decisiones de diseño importantes

### Por qué Hono y no Express
Meta requiere respuesta en menos de 15 segundos al webhook o reintenta. Hono es ~3x más
rápido que Express. Usar `c.executionCtx?.waitUntil()` para procesar el mensaje en
background y devolver 200 inmediatamente.

### Por qué slots pre-generados y no cálculo dinámico
La query del bot es `SELECT WHERE booked = false AND date = today AND business_id = X`.
Simple, rápida, con índice parcial. Generar disponibilidad dinámicamente requeriría lógica
compleja en el bot que introduce bugs. Los slots se generan semanalmente con un job de BullMQ.

### Por qué Redis para el estado de conversación
Leer estado de Supabase = 20-80ms. Leer de Redis = 1-3ms. Con mensajes entrantes
concurrentes la diferencia es crítica. TTL de 24h para limpiar conversaciones abandonadas.

### Por qué `conversations.data` es JSONB
El estado temporal de la conversación (servicio elegido, slot tentativo, nombre del cliente)
cambia con cada iteración del flujo. JSONB evita alterar el schema cada vez que el flujo
del bot evoluciona.

### El campo `reminder_sent` en appointments
BullMQ programa el recordatorio al confirmar la cita. Si el worker se reinicia, el job
persiste en Redis. Al enviarlo, marca `reminder_sent = true`. El índice parcial
`WHERE reminder_sent = false AND status = 'confirmed'` permite encontrar citas sin
recordatorio si hay que re-encolar.

---

## Flujo de pagos

```
Bot confirma cita → payments.createPaymentLink(appointment)
                 → Conekta crea orden → devuelve URL
                 → Bot envía URL por WhatsApp
                 → Cliente paga → Conekta dispara webhook a /webhooks/conekta
                 → Handler actualiza payments.status = 'paid'
                              + appointments.paid = true
                              + slots.booked = true (si no se marcó antes)
```

**Importante:** marcar `slots.booked = true` al CONFIRMAR la cita (no al pagar)
para evitar dobles reservas. El pago es opcional — el negocio puede habilitarlo o no.

---

## Recordatorios

```
Al confirmar cita → queue.scheduleReminder(appointmentId, appointmentDate - 24h)
                 → BullMQ job con delay exacto en ms
                 → Al ejecutarse: sendText(customerPhone, mensaje recordatorio)
                               + appointments.reminder_sent = true
                               + logAIUsage si se usó IA para el mensaje
```

---

## Monitoreo de costos IA

Cada llamada a Claude API registra en `ai_usage`:
```typescript
await logAIUsage({
  business_id,
  tokens_in:  response.usage.input_tokens,
  tokens_out: response.usage.output_tokens,
  cost_usd:   (tokens_in * 0.00000025) + (tokens_out * 0.00000125) // Haiku pricing
})
```

Si un negocio supera $1 USD/mes en IA → revisar su flujo fijo para optimizar.

---

## Comandos útiles

```bash
npm run dev          # desarrollo con hot reload
npm run build        # compilar TypeScript
npm run start        # producción
npm run typecheck    # verificar tipos sin compilar
```

---

## Fase 2 — No implementar todavía

Estas features van en fase 2 cuando haya clientes reales que lo pidan:

- Tabla `customers` con historial de clientes frecuentes
- Tabla `business_hours` para generar slots automáticamente desde horario recurrente
- Tabla `locations` para multi-sucursal (plan Negocio)
- Tabla `discounts` para cupones y promociones
- Tabla `messages` para historial completo de conversaciones
- Stripe Billing para suscripciones recurrentes de negocios
- Panel web Next.js (repo separado: `agendly-panel`)
- Políticas RLS por `auth.uid()` para el panel web

---

*Agendly — DuoMind Solutions · Zamora, Michoacán · México*
