# Decisiones clave

Por qué el código es como es. Cada entrada tiene el problema real que la
motivó, reconstruido del historial de git y del código, no de memoria.

**Leé esto antes de "arreglar" algo que parece raro.** Varias de estas cosas
parecen redundantes hasta que se entiende qué bug evitan.

---

## 1. `effectivePlan()` en vez de `user.plan`

**Qué**: para saber qué puede hacer un usuario, nunca se lee `user.plan`
directo. Se pasa por `effectivePlan(user)` en `middleware/planLimits.ts`.

**Por qué**: un plan pago vencido debe valer FREE **desde el segundo en que
vence**. El cron que degrada planes corre una vez al día, a las 03:00. Sin este
chequeo en tiempo real, alguien con el plan vencido seguiría usando WhatsApp y
el cupo del plan pago hasta la próxima corrida — hasta 24 horas gratis.

**El bug que se encontró** (auditoría del 2026-08-15): el asistente de
plataforma leía `LIMITS[user.plan]` en cuatro herramientas. Era un desvío para
seguir usando los límites de un plan que ya no se paga: un PRO vencido podía
pedirle al asistente crear 5 bots o subir 50 documentos. Corregido en
`assistantDashboard.ts` (`upload_instructivo_text`, `get_account_stats`,
`create_new_bot`, `scrape_website`) y en `dailySummary.ts`.

**Regla**: si escribís `LIMITS[` seguido de algo que no salió de
`effectivePlan()`, es un bug.

---

## 2. Prompt caching: qué va en el bloque estable y qué no

**Qué**: el prompt de los dos agentes está partido en dos bloques. El
**estable** lleva `cache_control: ephemeral`; el **variable** va después y sin
marcar.

| Agente | Bloque estable (cacheado) | Bloque variable |
|---|---|---|
| Tipo A (plataforma) | `PLATFORM_STATIC_PROMPT` — idéntico para todos los usuarios | Nombre del usuario y contexto de sus bots |
| Tipo B (tenant) | Nombre, personalidad, idioma, reglas de calidad y **la lista de imágenes** | Los fragmentos que trajo el RAG para ese mensaje |

**Por qué el orden importa**: Anthropic cachea por prefijo (tools → system →
messages). Si algo que cambia en cada mensaje va **antes** del corte, el prefijo
nunca coincide y el caché no acierta jamás.

**El bug original**: se cacheaba el prompt entero, RAG incluido. Como el RAG
cambia en cada mensaje, el caché no acertaba nunca y **solo se pagaba el 25% de
recargo por escritura**. Era costo puro sin beneficio. Corregido en
`perf: prompt caching en asistente de plataforma y bot tenant` (2026-07-27).

**Por qué las imágenes van en el bloque estable**: cambian por bot pero son
idénticas en todos los mensajes de ese bot, que es exactamente la condición para
que el caché sirva. Se invalidan cuando el dueño sube o borra una imagen — que
es cuando debe pasar.

**Las herramientas también se cachean**: el `cache_control` va en la **última**
herramienta de la lista, lo que marca el corte de todo el bloque de
definiciones. La lista se arma por bot con `buildTenantTools()`, y
`derivar_a_humano` va siempre al final para que el punto de corte no se mueva.

**Dato medido (2026-08-15)**: el prefijo cacheable del bot tenant es de ~566
tokens (sin imágenes) a ~924 (con 5), y el mínimo de Anthropic en Sonnet es
1024. Por debajo de eso **no cachea** — no cobra recargo, simplemente no ahorra.
El asistente de plataforma sí califica (~1783 tokens). No se "arregló" porque la
única forma sería inflar el prompt con relleno. La verdad está en los logs
`[cache] tenant — creados/leidos/sin cachear` de producción.

---

## 3. Un solo motor para el bot tenant

**Qué**: WhatsApp, el Chat de prueba y el widget entran todos por
`runTenantTurn()`.

**Por qué**: el Chat de prueba existe para que el dueño valide su bot antes de
conectarlo. Si responde distinto que WhatsApp, el dueño aprueba un
comportamiento que sus clientes nunca van a recibir.

**El bug** (`fix: paridad total entre Chat de prueba y WhatsApp real`,
2026-08-15): el Chat de prueba corría por `ragStream` → `streamBotResponse`, que
llamaba a Anthropic **sin el parámetro `tools`**. El bot no podía buscar en
documentos, mandar fotos ni derivar a un humano — todo lo cual sí hacía en
WhatsApp. Existía un endpoint correcto con herramientas, pero **ningún
componente lo llamaba**: la versión buena estaba muerta y la rota era la que
corría.

Se eliminó el motor duplicado (`generateBotResponse`, `streamBotResponse`,
`ragChat`, `ragStream`) y se le agregó streaming opcional al loop real. Es el
mismo loop: solo cambia si la ronda se pide con `messages.stream` o
`messages.create`.

**Verificado**: las tres rutas producen una request a Anthropic con el **mismo
sha256**.

**Regla**: si un canal necesita comportarse distinto, va como parámetro de
`runTenantTurn()`. Nunca como una segunda implementación.

---

## 4. El Chat de prueba tiene su propio cupo

**Qué**: probar el bot descuenta de `testMsgsThisMonth`/`testMsgsToday`, no de
`messagesUsedThisMonth`.

**Por qué**: antes descontaba del mismo contador que los clientes reales. Un
usuario Free con 100 mensajes que probaba 30 veces se quedaba con 70 para
vender. El dueño probando su propio bot no le puede comer los mensajes que
necesita para atender.

Igual lleva tope (doble: mensual y diario), porque cada prueba es una llamada a
Anthropic que se paga.

**El widget público sí cuenta como cliente real**: va embebido en el sitio del
negocio y habla con clientes de verdad.

---

## 5. Límites de documentos e imágenes

**Dónde se aplica cada uno** — un límite declarado en `planLimits.ts` que no se
chequea en su endpoint es un bug de negocio, no un detalle:

| Límite | Dónde se aplica |
|---|---|
| `bots` | `checkBotLimit` (POST /bots) y `create_new_bot` del asistente |
| `docsPerBot` | `checkDocLimit` (POST documentos), `knowledge.ts`, y las herramientas `upload_instructivo_text` y `scrape_website` |
| `imagesPerBot` | `routes/images.ts` POST |
| `monthlyMessages` | `assertMessageLimit` en `inboundMessage.ts` y `public.ts` |
| `whatsapp` | `checkWhatsAppAccess` |
| `nps` | PATCH `/bots/:id` al activar `npsEnabled` |
| `weeklyReports` / `consolidatedReports` | `routes/reports.ts` |
| cupos de asistente y prueba | `checkCupoDoble()` |

**Por qué el de imágenes importa**: cada imagen vive en Cloudinary y se lista en
el prompt del bot. Sin tope, un solo bot podría inflar su propio prompt y el
almacenamiento sin límite.

**Nota**: `agregar_conocimiento` (el botón "Agregar esta información" del
informe) y la herramienta del asistente comparten una sola implementación en
`services/knowledge.ts`, justamente para que el chequeo de límite no se
desincronice entre las dos entradas.

---

## 6. PRO recibe informes de TODOS sus bots

**Qué se decidió**: los informes semanales se limitan por **profundidad**, no
por cantidad de bots. PRO recibe el informe individual de cada bot activo;
Agencia agrega el **consolidado** que los compara entre sí.

**Qué había antes**: PRO recibía el informe de un solo bot (el primero creado).

**Por qué se cambió** (`feat: reportes de todos los bots + consolidado de
agencia`, 2026-08-08): cobrarle Profesional a alguien con 3 bots y mandarle el
informe de uno solo se siente una estafa, y la queja cuesta más que el informe
extra. El diferencial de Agencia pasó a ser el consolidado, que solo tiene
sentido cuando se manejan varios bots a la vez.

**Consecuencia de diseño**: `ConsolidatedReport` cuelga del **usuario**, no de
un bot, y es un modelo aparte de `WeeklyReport`. Tres razones: el contenido
tiene otra forma (rankings entre bots, no detalle de uno), borrar un bot no debe
borrar la comparación histórica, y un `botId` nullable rompería el índice único
porque Postgres considera distintos a todos los NULL.

**El consolidado no se genera con un solo bot**: comparar un bot contra sí mismo
es el informe individual otra vez con otra portada.

---

## 7. Cero llamadas a IA en los informes semanales

**Qué**: todo el contenido del informe —incluido el resumen ejecutivo en
prosa— sale de queries y reglas. `weeklyReportSummary.ts` arma el texto
combinando plantillas según los números.

**Por qué**:
1. Un informe por bot por semana llamando a Anthropic es un costo recurrente que
   crece con la base de clientes.
2. El modelo puede alucinar una cifra que contradiga la tabla que está tres
   centímetros más abajo.
3. No sería reproducible: dos exports del mismo informe dirían cosas distintas.

**La variedad sale de combinar bloques**: un titular elegido por la señal
dominante, más frases de volumen, satisfacción, deuda de conocimiento y cierre.
No es una frase fija con números insertados — 8 escenarios distintos dan 8
titulares distintos.

**El orden de las reglas es deliberado**: satisfacción mala y fricción alta le
ganan al titular celebratorio. Un "Muy buena semana" arriba de un NPS de 2.9
hace que el dueño no lea el resto.

---

## 8. El PDF se dibuja con pdfkit, no con un navegador

**Qué**: los informes en PDF se arman con primitivas vectoriales de pdfkit
(`services/pdfKit.ts`), incluidos los gráficos de evolución.

**Por qué no puppeteer**: se baja un Chromium de ~300 MB y levanta un navegador
por export. En Railway eso es build lento y memoria que no hay.

**Por qué no una librería de charting**: todas dependen de `canvas`, que compila
contra Cairo y Pango — una dependencia nativa más que puede romper el build. Y
el PNG que producen se rasteriza a 72dpi y se ve borroso impreso.

Para una serie de 8 puntos, dibujar los ejes a mano son sesenta líneas y cero
riesgo.

---

## 9. Google Drive: código intacto, oculto al usuario

**Estado actual**: la integración funciona (OAuth, `services/googleDrive.ts`,
modelo `DriveConnection`, rutas en `/api/v1/drive`) pero **ningún botón ni link
la ofrece**.

**Por qué** (`feat: actualizar precios con beneficios reales + ocultar Google
Drive`, 2026-08-15): Google exige un proceso de verificación que no está
aprobado. Ofrecer el botón solo llevaba a una pantalla de permisos que falla.

**Qué se sacó**: la sección del panel del bot, el manejo del retorno OAuth, la
herramienta `send_drive_image` del asistente, y las etiquetas visibles.

**Qué quedó**: todo el backend, y `api.drive` en el cliente (sin llamadores).
La herramienta `buscar_archivos_drive` del bot tenant sigue existiendo pero
**solo se le ofrece al modelo si el bot tiene Drive activo** — como nadie puede
activarlo, se auto-oculta.

**Por qué es condicional y no eliminada**: su descripción es casi idéntica a la
de `enviar_imagen` ("fotos de productos, el menú, el catálogo"). Con las dos
presentes el modelo elegía medio al azar y gastaba una ronda para recibir "no
hay carpeta configurada".

**Lo que NO se tocó**: las páginas legales siguen describiendo Drive. Una
política de privacidad no promete un beneficio, divulga un tratamiento de datos,
y puede haber usuarios con una carpeta ya conectada.

---

## 10. El webhook de Pagopar: tres bugs, tres lecciones

Los tres se encontraron el 2026-08-15 y cada uno impedía cobrar.

### 10.1 El cuerpo no se parseaba
`fix: webhook de pagopar no reflejaba los datos reales del pago`

Pagopar es PHP y no siempre postea `application/json`. Con form-urlencoded
`express.urlencoded` dejaba `resultado` como **string**; con `text/plain` o sin
`Content-Type` el cuerpo se descartaba entero. En los tres casos el handler no
encontraba la notificación y devolvía **403** — el pago nunca se aplicaba.

**Solución**: el webhook lee el cuerpo como **texto crudo** (`express.text({type:
'*/*'})` montado antes de los parsers globales) y `extraerNotificaciones()` lo
normaliza venga como venga: JSON pelado, form-urlencoded con JSON adentro,
form-urlencoded anidado (`resultado[0][campo]=valor`, la forma por defecto de
PHP), o una notificación sin envolver en array.

**Trampa que costó una segunda pasada**: el campo `resultado` es ambiguo. Como
envoltorio trae el JSON; **dentro** de una notificación es el texto de estado
("Pedido encontrado"). La primera versión trataba cualquier string como
envoltorio y descartaba la notificación entera.

### 10.2 La condición de pago estaba mal
`fix: webhook de pagopar no marcaba el pedido como pagado`

El chequeo era `!notif.pagado`, JavaScript crudo sobre un valor de PHP. El
defecto grave era el **inverso** del que se buscaba: el string `"false"` es
**truthy** en JavaScript, así que un pago **no realizado** se habría dado por
bueno.

**Solución**: `esPagoConfirmado()` interpreta explícitamente `true / "true" / 1 /
"1" / "si"` como pago y `false / "false" / 0 / "0" / ""` como no-pago, y loguea
cuando el campo no es interpretable.

### 10.3 No había dónde guardar el comprobante

`numeroComprobante` y `formaPago` no existían en el modelo: el dato pasaba por
el webhook y se perdía. El número de comprobante es con lo que se concilia un
cobro ante un reclamo.

### Lo que se agregó de paso

- **Logging del payload completo** (enmascarando token, documento y email del
  comprador). Sin esto no hay forma de saber qué manda Pagopar realmente.
- **Red de contención en `/consultar`**: antes calculaba si estaba pagado para
  mostrarlo y **no escribía nada**. Si el webhook no llegaba, el usuario pagaba,
  la pantalla decía "pagado" y el plan nunca se activaba. Ahora activa. Es
  idempotente (`updateMany` con `pagado: false` en el where), así que webhook y
  consulta no pueden aplicar el plan dos veces.

**Verificado end-to-end** contra Postgres real: pedido marcado, plan activado,
vencimiento a 30 días, comprobante persistido, eco correcto, y el reintento no
extiende el vencimiento.

**Nota**: la búsqueda del pedido **siempre fue por `hash_pedido`** (único en el
schema), nunca por `numero_pedido`. Si alguien sugiere que ahí estaba el
problema, no es así — confirmado con `git log -S`.

---

## 11. Otras decisiones que aparecen en el historial

| Decisión | Por qué | Commit |
|---|---|---|
| **Todos los `@types` en `dependencies`** | Railway instala con `NODE_ENV=production`, que omite devDependencies. Con los tipos ahí, el build fallaba entero | 2026-07-25 |
| **Twilio apagado, no borrado** | Kill switch por `TWILIO_WHATSAPP_ENABLED`. Se reactiva sin tocar código si Meta falla | 2026-07-25 |
| **El bot no usa `¿` ni `¡`** | Regla de estilo de la plataforma: en WhatsApp real nadie los escribe. Está en las reglas innegociables del prompt tenant | 2026-07-25 |
| **NPS en escala 1 a 5** | Por WhatsApp es más fácil que 0-10. `classifySentiment`: 5 promotor, 4 pasivo, ≤3 detractor | 2026-07-27 |
| **NPS solo por WhatsApp** | `npsDispatch` filtra `channel: 'whatsapp'`: el widget es request/response y no puede iniciar un mensaje | 2026-07-27 |
| **Verificación de email obligatoria** | El registro no devuelve tokens hasta confirmar el código de 6 dígitos (generado con `crypto.randomInt`) | 2026-07-26 |
| **Sonnet 5 como primario** | Con fallback a `claude-opus-4-8` cuando el primario devuelve `stop_reason: 'refusal'`. El SDK 0.36 no tipa `'refusal'`, hay que castear | 2026-07-19 |
| **CORS con whitelist explícita** | Nunca `*`: las requests viajan con credentials y el navegador rechaza el comodín con cookies | 2026-07-26 |
| **El `context` de un ticket lo arma el backend** | Leyendo la base, nunca el modelo, para que no pueda inventar el estado de la cuenta | 2026-07-27 |
| **`/health` expone el commit desplegado** | Railway inyecta `RAILWAY_GIT_COMMIT_SHA`. Antes, saber si un fix estaba arriba exigía mirar el dashboard y comparar a ojo | 2026-08-15 |
| **Guardas de proceso** | Desde Node 15 una promesa rechazada sin handler **termina el proceso**. Un `void algo()` que falla tiraba abajo todas las requests en vuelo | 2026-08-15 |
| **Portales de Radix con `theme-dashboard`** | `DialogContent` y `SelectContent` se renderizan en `document.body`, fuera del contenedor con el tema. Sin la clase salen en tema claro dentro del panel oscuro | 2026-08-08 / 08-15 |
