/**
 * Instructivos base por rubro, para que un bot recién creado no arranque vacío.
 *
 * Por qué existe: al crear un bot, el panel muestra "Subí al menos un documento
 * para activar el chat". Esa pantalla en blanco es donde se pierde la mayoría
 * de la gente — entre tener la cuenta y tener un bot que contesta hay un
 * documento que nadie sabe cómo empezar a escribir.
 *
 * Estas plantillas son el punto de partida, no el producto terminado: traen la
 * estructura y las preguntas que un cliente hace en cada rubro, con los datos
 * del negocio marcados para completar. El bot las usa igual que cualquier otro
 * documento.
 *
 * La personalidad (lib/personalidades.ts) define CÓMO habla el bot; esto define
 * QUÉ sabe. Son dos cosas distintas y por eso viven en archivos distintos.
 */

/** Marca que el dueño tiene que reemplazar. Se busca literal en el texto. */
export const MARCA_COMPLETAR = 'COMPLETAR';

/**
 * Va al principio de toda plantilla.
 *
 * Sin esto, un bot con la plantilla a medio llenar le contesta al cliente
 * "nuestro horario es COMPLETAR: horario de atención", que es peor que no
 * contestar. La instrucción hace que trate lo que falta como un dato que no
 * tiene, no como el dato.
 */
const ENCABEZADO = `INSTRUCCIONES INTERNAS (no se las leas al cliente)
Todo lo que en este documento diga COMPLETAR es información que todavía no
cargó el dueño del negocio. Si un cliente pregunta algo que cae ahí, NO lo
inventes ni leas la palabra COMPLETAR: decile que se lo confirmás en un momento
y que ya le respondemos.

`;

export interface PlantillaRubro {
  /** Coincide con el id de la personalidad que la trae */
  id: string;
  /** Cómo se llama el rubro para el dueño */
  rubro: string;
  cuerpo: string;
}

const GENERICO = `DATOS DEL NEGOCIO
Nombre: COMPLETAR: nombre del negocio
A qué se dedica: COMPLETAR: en una línea, qué vendés o qué servicio das
Dirección: COMPLETAR: dirección, o "solo atendemos online"
Horarios: COMPLETAR: días y horarios de atención
Teléfono: COMPLETAR
Zona de cobertura o envíos: COMPLETAR

QUÉ OFRECEMOS
COMPLETAR: listá tus productos o servicios con el precio de cada uno. Una línea
por cada uno, así: Producto — Gs. 00.000 — detalle corto.

FORMAS DE PAGO
COMPLETAR: efectivo, transferencia, tarjeta, giro. Si aceptás transferencia,
poné el banco y el número de cuenta.

PREGUNTAS QUE NOS HACEN SEGUIDO
COMPLETAR: escribí 3 o 4 preguntas que te hagan todos los días, con su
respuesta. Son las que más le van a servir al bot.

LO QUE NO HACEMOS
COMPLETAR: qué NO vendés o qué NO cubrís. Sirve para que el bot no prometa algo
que después no podés cumplir.`;

export const PLANTILLAS: PlantillaRubro[] = [
  {
    id: 'restaurante',
    rubro: 'Restaurante o comida',
    cuerpo: `DATOS DEL LOCAL
Nombre: COMPLETAR
Dirección: COMPLETAR
Horarios de cocina: COMPLETAR: días y horas, y si hay corte al mediodía
Teléfono: COMPLETAR

CARTA Y PRECIOS
COMPLETAR: plato — Gs. 00.000 — qué trae. Una línea por plato.
Bebidas: COMPLETAR
Postres: COMPLETAR
Promos del día o combos: COMPLETAR

DELIVERY Y RETIRO
¿Hacemos delivery?: COMPLETAR: sí o no
Zonas y costo del envío: COMPLETAR
Tiempo de entrega aproximado: COMPLETAR
Pedido mínimo: COMPLETAR
¿Se puede retirar por el local?: COMPLETAR

RESERVAS
¿Tomamos reservas?: COMPLETAR: sí o no
Cómo se reserva y con cuánta anticipación: COMPLETAR
Capacidad máxima por mesa o grupo: COMPLETAR

FORMAS DE PAGO
COMPLETAR: efectivo, tarjeta, transferencia, giro

RESTRICCIONES Y ALERGIAS
Opciones sin TACC, vegetarianas o veganas: COMPLETAR
Ingredientes que solemos aclarar: COMPLETAR

PREGUNTAS QUE NOS HACEN SEGUIDO
COMPLETAR: 3 o 4 preguntas reales con su respuesta`,
  },
  {
    id: 'clinica',
    rubro: 'Clínica o consultorio',
    cuerpo: `DATOS DEL CONSULTORIO
Nombre: COMPLETAR
Dirección: COMPLETAR
Horarios de atención: COMPLETAR
Teléfono y WhatsApp: COMPLETAR

PROFESIONALES Y ESPECIALIDADES
COMPLETAR: profesional — especialidad — días y horarios que atiende

TURNOS
Cómo se saca un turno: COMPLETAR
Con cuánta anticipación conviene pedirlo: COMPLETAR
Qué pasa si el paciente no puede venir: COMPLETAR: hasta cuándo avisar
Primera consulta: qué tiene que traer: COMPLETAR

ARANCELES
Consulta particular: COMPLETAR: Gs. 00.000
Estudios o prácticas más pedidas: COMPLETAR
Seguros y prepagas que tomamos: COMPLETAR

FORMAS DE PAGO
COMPLETAR

LÍMITE IMPORTANTE
El bot no da diagnósticos, no indica medicación ni interpreta estudios. Ante un
síntoma o una consulta clínica, deriva al profesional y ofrece un turno. Si el
paciente describe una urgencia, le indica ir a la guardia más cercana o llamar
al COMPLETAR: número de emergencias.

PREGUNTAS QUE NOS HACEN SEGUIDO
COMPLETAR: 3 o 4 preguntas reales con su respuesta`,
  },
  {
    id: 'tienda',
    rubro: 'Tienda o comercio',
    cuerpo: `DATOS DE LA TIENDA
Nombre: COMPLETAR
Dirección del local: COMPLETAR, o "solo vendemos online"
Horarios: COMPLETAR
Teléfono: COMPLETAR
Redes o tienda online: COMPLETAR

QUÉ VENDEMOS
COMPLETAR: producto — Gs. 00.000 — talles, colores o variantes disponibles.
Una línea por producto. Si tenés lista de precios en Excel, subila como
documento aparte y el bot la va a usar igual.

STOCK
Cómo consultamos disponibilidad: COMPLETAR
Qué decimos cuando algo está agotado: COMPLETAR: por ejemplo, cuándo repone

ENVÍOS
Zonas y costo: COMPLETAR
Tiempo de entrega: COMPLETAR
Envío gratis a partir de: COMPLETAR
¿Se puede retirar por el local?: COMPLETAR

FORMAS DE PAGO
COMPLETAR: efectivo, tarjeta, transferencia, giro, cuotas

CAMBIOS Y DEVOLUCIONES
Plazo para cambiar: COMPLETAR
Condiciones: COMPLETAR: con ticket, sin uso, etc.
Qué no se cambia: COMPLETAR

PREGUNTAS QUE NOS HACEN SEGUIDO
COMPLETAR: 3 o 4 preguntas reales con su respuesta`,
  },
  {
    id: 'servicios',
    rubro: 'Peluquería, estética o servicios con turno',
    cuerpo: `DATOS DEL LOCAL
Nombre: COMPLETAR
Dirección: COMPLETAR
Horarios: COMPLETAR
Teléfono: COMPLETAR

SERVICIOS Y PRECIOS
COMPLETAR: servicio — Gs. 00.000 — cuánto dura. Una línea por servicio.
Combos o promociones: COMPLETAR

QUIÉN ATIENDE
COMPLETAR: profesional — qué servicios hace — qué días trabaja

TURNOS
Cómo se saca un turno: COMPLETAR
Con cuánta anticipación: COMPLETAR
Política de cancelación: COMPLETAR: hasta cuándo avisar sin costo
¿Atendemos sin turno?: COMPLETAR

ANTES DE VENIR
Lo que el cliente tiene que saber o traer: COMPLETAR: por ejemplo, venir con el
pelo lavado, no aplicarse nada 24 h antes, etc.

FORMAS DE PAGO
COMPLETAR

PREGUNTAS QUE NOS HACEN SEGUIDO
COMPLETAR: 3 o 4 preguntas reales con su respuesta`,
  },
  {
    id: 'inmobiliaria',
    rubro: 'Inmobiliaria',
    cuerpo: `DATOS DE LA INMOBILIARIA
Nombre: COMPLETAR
Dirección: COMPLETAR
Horarios: COMPLETAR
Teléfono: COMPLETAR
Matrícula o registro: COMPLETAR

ZONAS DONDE OPERAMOS
COMPLETAR: barrios o ciudades

PROPIEDADES DISPONIBLES
COMPLETAR: por cada una — operación (venta o alquiler), tipo, zona, superficie,
dormitorios, precio en Gs. o USD, y una línea de detalle.

REQUISITOS PARA ALQUILAR
Garantía que pedimos: COMPLETAR
Documentación: COMPLETAR
Depósito y adelanto: COMPLETAR
Duración del contrato: COMPLETAR

VISITAS
Cómo se coordina una visita: COMPLETAR
Días y horarios: COMPLETAR

COMISIONES Y GASTOS
COMPLETAR: qué cobra la inmobiliaria en venta y en alquiler

QUÉ DATOS LE PEDIMOS A UN INTERESADO
Nombre, teléfono, qué busca, en qué zona y cuánto puede pagar. El bot los junta
en la conversación y los deja anotados para que el equipo lo llame.

PREGUNTAS QUE NOS HACEN SEGUIDO
COMPLETAR: 3 o 4 preguntas reales con su respuesta`,
  },
  {
    id: 'educacion',
    rubro: 'Academia, instituto o curso',
    cuerpo: `DATOS DE LA INSTITUCIÓN
Nombre: COMPLETAR
Dirección: COMPLETAR
Horarios de secretaría: COMPLETAR
Teléfono: COMPLETAR

CURSOS QUE DICTAMOS
COMPLETAR: por cada curso — nombre, cuánto dura, días y horarios, modalidad
(presencial, online o mixta) y a quién está dirigido.

ARANCELES
Matrícula: COMPLETAR: Gs. 00.000
Cuota mensual: COMPLETAR
Descuentos: COMPLETAR: pago anual, hermanos, pago adelantado
Formas de pago: COMPLETAR

INSCRIPCIÓN
Cuándo abren las inscripciones: COMPLETAR
Requisitos y documentación: COMPLETAR
Cupos por curso: COMPLETAR
¿Hay clase de prueba?: COMPLETAR

CERTIFICADOS
Qué entregamos al terminar: COMPLETAR
¿Tiene validez oficial?: COMPLETAR

PREGUNTAS QUE NOS HACEN SEGUIDO
COMPLETAR: 3 o 4 preguntas reales con su respuesta`,
  },
];

/**
 * La plantilla del rubro, o la genérica.
 *
 * Las personalidades que no son un rubro (Vendedor Profesional, Agente de
 * Soporte) y el caso de escribir la personalidad desde cero caen en la
 * genérica: sigue siendo mejor punto de partida que una pantalla vacía.
 */
export function plantillaPara(personalidadId: string | null): string {
  const p = PLANTILLAS.find((x) => x.id === personalidadId);
  return ENCABEZADO + (p ? p.cuerpo : GENERICO);
}

/** Cuántas marcas quedan sin completar. Cero significa listo. */
export function pendientesDeCompletar(texto: string): number {
  return texto.split(MARCA_COMPLETAR).length - 1;
}
