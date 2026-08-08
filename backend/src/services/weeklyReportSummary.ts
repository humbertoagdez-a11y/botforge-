/**
 * Resumen ejecutivo del informe semanal.
 *
 * Texto en prosa armado con REGLAS sobre los numeros reales, no con el modelo
 * de IA. Tres motivos por los que esto no debe pasar nunca por Anthropic:
 * un informe por bot por semana es un costo recurrente que crece con la base
 * de clientes; el modelo puede alucinar una cifra que contradiga la tabla que
 * esta tres centimetros mas abajo; y el resultado no seria reproducible, asi
 * que dos exports del mismo informe dirian cosas distintas.
 *
 * La variedad sale de combinar bloques: un titular elegido por la señal
 * dominante, mas frases de volumen, satisfaccion, deuda de conocimiento y
 * cierre, cada una con sus propias variantes. No es una frase fija con
 * numeros insertados.
 */

/** NPS en BotForge es escala 1 a 5 (ver classifySentiment en nps.ts) */
const NPS_MAX = 5;
const NPS_EXCELENTE = 4.5;
const NPS_BUENO = 4.0;
const NPS_REGULAR = 3.5;

/** Porcentaje de respuestas del bot que fueron "no sé" */
const FRICCION_ALTA = 0.15;
const FRICCION_MEDIA = 0.07;

/** Cambio de volumen que ya no es ruido */
const VARIACION_RELEVANTE = 0.15;

export type TonoResumen = 'positivo' | 'neutral' | 'alerta';

export interface ResumenEjecutivo {
  /** Frases en orden de lectura. El render las une o las apila. */
  parrafos: string[];
  tono: TonoResumen;
  /** Etiqueta corta para el encabezado del bloque */
  titulo: string;
}

export interface SeñalesResumen {
  conversaciones: number;
  mensajes: number;
  /** null si no hay semana anterior con la que comparar */
  conversacionesPrevias: number | null;
  nps: number | null;
  npsRespuestas: number;
  npsPrevio: number | null;
  /** Respuestas del bot en las que admitió no saber */
  sinResponder: number;
  /** Total de respuestas del bot, para sacar la proporción */
  respuestasBot: number;
  /** Preguntas distintas que quedaron sin respuesta */
  preguntasSinResponder: number;
}

function pct(actual: number, previo: number): number {
  if (previo === 0) return actual > 0 ? 1 : 0;
  return (actual - previo) / previo;
}

function porcentajeTexto(x: number): string {
  return `${Math.round(Math.abs(x) * 100)}%`;
}

function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/**
 * Arma el resumen ejecutivo de un bot. Determinista: los mismos números
 * producen siempre el mismo texto.
 */
export function construirResumen(s: SeñalesResumen): ResumenEjecutivo {
  const parrafos: string[] = [];

  // ── Sin actividad ─────────────────────────────────────────────────────────
  // Un bot que venía recibiendo consultas y se fue a cero no es lo mismo que
  // uno recién creado: lo primero casi siempre es el WhatsApp desconectado, y
  // tratarlo como "todavía no arrancaste" haría que el dueño no lo mire.
  if (s.conversaciones === 0 && s.mensajes === 0) {
    const veniaFuncionando = (s.conversacionesPrevias ?? 0) > 0;
    return veniaFuncionando
      ? {
          titulo: 'Tu bot dejó de recibir consultas',
          tono: 'alerta',
          parrafos: [
            `La semana pasada tu bot atendió ${plural(s.conversacionesPrevias!, 'conversación', 'conversaciones')} y esta semana ninguna. Una caída así de golpe casi siempre es un problema de conexión, no de demanda.`,
            'Revisá que el número de WhatsApp siga vinculado y que el bot figure como activo. Si está todo bien, escribile vos mismo para confirmar que responde.',
          ],
        }
      : {
          titulo: 'Semana sin movimiento',
          tono: 'neutral',
          parrafos: [
            'Esta semana nadie escribió a tu bot. Si esperabas consultas, revisá que el número de WhatsApp esté conectado y que el bot figure como activo.',
            'Si recién lo estás poniendo en marcha, es normal: el informe empieza a mostrar tendencias en cuanto lleguen las primeras conversaciones.',
          ],
        };
  }

  const primeraSemana = s.conversacionesPrevias === null;
  const deltaConv = primeraSemana ? 0 : pct(s.conversaciones, s.conversacionesPrevias!);
  const creció = !primeraSemana && deltaConv >= VARIACION_RELEVANTE;
  const cayó = !primeraSemana && deltaConv <= -VARIACION_RELEVANTE;

  const friccion = s.respuestasBot > 0 ? s.sinResponder / s.respuestasBot : 0;
  const friccionAlta = friccion >= FRICCION_ALTA;
  const friccionMedia = friccion >= FRICCION_MEDIA && !friccionAlta;

  const hayNps = s.nps !== null && s.npsRespuestas > 0;
  const deltaNps = hayNps && s.npsPrevio !== null ? s.nps! - s.npsPrevio : null;
  const npsSubió = deltaNps !== null && deltaNps >= 0.3;
  const npsBajó = deltaNps !== null && deltaNps <= -0.3;
  const npsBueno = hayNps && s.nps! >= NPS_BUENO;
  const npsMalo = hayNps && s.nps! < NPS_REGULAR;

  // ── Titular: la señal dominante manda ─────────────────────────────────────
  // El orden importa. Primero lo que exige acción (satisfacción cayendo,
  // fricción alta), después lo bueno. Un titular celebratorio arriba de un
  // problema real hace que el dueño no lea el resto.
  let titulo: string;
  let tono: TonoResumen;

  if (npsMalo) {
    titulo = 'Tus clientes no están conformes';
    tono = 'alerta';
    parrafos.push(
      `La satisfacción promedio fue de ${s.nps!.toFixed(1)} sobre ${NPS_MAX}, por debajo de lo aceptable. Es lo primero que conviene mirar esta semana: revisá los comentarios que dejaron y qué conversaciones terminaron mal.`,
    );
  } else if (friccionAlta) {
    titulo = 'Tu bot se queda corto seguido';
    tono = 'alerta';
    parrafos.push(
      `${porcentajeTexto(friccion)} de las respuestas de tu bot fueron para decir que no sabía algo. Cada una de esas es un cliente que se queda esperando o que te termina escribiendo a vos.`,
    );
  } else if (creció && (npsSubió || npsBueno) && !friccionMedia) {
    titulo = 'Muy buena semana';
    tono = 'positivo';
    parrafos.push(
      `Creciste ${porcentajeTexto(deltaConv)} en conversaciones y tus clientes siguen conformes. Tu bot está absorbiendo más consultas sin que la calidad baje.`,
    );
  } else if (creció && friccionMedia) {
    titulo = 'Creciste, pero se nota la falta de datos';
    tono = 'neutral';
    parrafos.push(
      `Las conversaciones subieron ${porcentajeTexto(deltaConv)}, y con más volumen empezaron a aparecer preguntas que tu bot todavía no sabe contestar.`,
    );
  } else if (cayó) {
    titulo = 'Bajó la actividad';
    tono = 'neutral';
    parrafos.push(
      `Te escribieron ${porcentajeTexto(deltaConv)} menos que la semana pasada. Puede ser estacional, pero si esperabas el mismo movimiento vale la pena revisar que el canal de WhatsApp siga funcionando.`,
    );
  } else if (npsBajó) {
    titulo = 'La satisfacción viene bajando';
    tono = 'alerta';
    parrafos.push(
      `El promedio de satisfacción cayó ${Math.abs(deltaNps!).toFixed(1)} puntos respecto de la semana pasada. Todavía no es grave, pero es la señal que conviene no dejar pasar dos semanas seguidas.`,
    );
  } else if (primeraSemana) {
    titulo = 'Primer informe de tu bot';
    tono = 'neutral';
    parrafos.push(
      `Esta es la primera semana medida, así que todavía no hay con qué compararla. Desde el próximo lunes vas a ver acá si estás creciendo o aflojando.`,
    );
  } else if (npsSubió) {
    titulo = 'Tus clientes están más conformes';
    tono = 'positivo';
    parrafos.push(
      `La satisfacción subió ${deltaNps!.toFixed(1)} puntos respecto de la semana pasada. Lo que sea que cambiaste, está funcionando.`,
    );
  } else {
    titulo = 'Semana estable';
    tono = 'neutral';
    parrafos.push(
      'El movimiento se mantuvo parecido al de la semana pasada, sin cambios bruscos en volumen ni en satisfacción.',
    );
  }

  // ── Volumen, con los números concretos ────────────────────────────────────
  const vol = `Tu bot atendió ${plural(s.conversaciones, 'conversación', 'conversaciones')} e intercambió ${plural(s.mensajes, 'mensaje', 'mensajes')}`;
  if (primeraSemana) {
    parrafos.push(`${vol}.`);
  } else if (creció || cayó) {
    parrafos.push(
      `${vol}, contra ${s.conversacionesPrevias} ${s.conversacionesPrevias === 1 ? 'conversación' : 'conversaciones'} de la semana anterior.`,
    );
  } else {
    parrafos.push(`${vol}, en línea con la semana anterior.`);
  }

  // ── Satisfacción, solo si alguien respondió la encuesta ───────────────────
  if (hayNps) {
    const base = `${plural(s.npsRespuestas, 'cliente calificó', 'clientes calificaron')} la atención, con un promedio de ${s.nps!.toFixed(1)} sobre ${NPS_MAX}`;
    if (s.nps! >= NPS_EXCELENTE) {
      parrafos.push(`${base}: es una calificación muy alta.`);
    } else if (npsBueno) {
      parrafos.push(`${base}, un nivel sano.`);
    } else if (!npsMalo) {
      parrafos.push(`${base}. Hay margen para mejorar.`);
    } else {
      parrafos.push(`${base}.`);
    }
  } else if (s.conversaciones >= 5) {
    // Solo se sugiere activar NPS si hubo volumen suficiente para que sirva
    parrafos.push(
      'Todavía no tenés respuestas de satisfacción esta semana. Activando la encuesta automática vas a saber qué opinan tus clientes sin tener que preguntarles vos.',
    );
  }

  // ── Deuda de conocimiento y cierre accionable ─────────────────────────────
  if (s.preguntasSinResponder > 0) {
    // La concordancia se arma entera, no con un plural pegado al número: un
    // "Quedaron 1 pregunta ... listadas ... Cargarlas" en un documento que el
    // cliente puede reenviar se lee como descuido del producto.
    const una = s.preguntasSinResponder === 1;
    parrafos.push(
      una
        ? 'Quedó 1 pregunta que tu bot no supo responder, listada más abajo. Cargarla es la mejora más rápida que podés hacerle esta semana.'
        : `Quedaron ${s.preguntasSinResponder} preguntas que tu bot no supo responder, listadas más abajo. Cargarlas es la mejora más rápida que podés hacerle esta semana.`,
    );
  } else if (s.sinResponder === 0 && s.mensajes > 0) {
    parrafos.push('Tu bot respondió todo lo que le preguntaron, sin derivar ninguna consulta.');
  }

  return { titulo, tono, parrafos };
}

// ─── Consolidado (Agencia) ────────────────────────────────────────────────────

export interface SeñalesConsolidado {
  bots: number;
  conversaciones: number;
  conversacionesPrevias: number | null;
  mensajes: number;
  /** Promedio ponderado por cantidad de respuestas */
  nps: number | null;
  sinResponder: number;
  mejorBot: { nombre: string; nps: number } | null;
  masActivo: { nombre: string; conversaciones: number } | null;
  masDescuidado: { nombre: string; sinResponder: number } | null;
  /** Bots que no tuvieron ni una conversación */
  inactivos: string[];
}

export function construirResumenConsolidado(s: SeñalesConsolidado): ResumenEjecutivo {
  const parrafos: string[] = [];

  if (s.conversaciones === 0) {
    return {
      titulo: 'Semana sin movimiento',
      tono: 'neutral',
      parrafos: [
        `Ninguno de tus ${s.bots} bots recibió consultas esta semana. Si esperabas actividad, revisá que los números de WhatsApp sigan conectados.`,
      ],
    };
  }

  const primeraSemana = s.conversacionesPrevias === null;
  const deltaConv = primeraSemana ? 0 : pct(s.conversaciones, s.conversacionesPrevias!);
  const creció = !primeraSemana && deltaConv >= VARIACION_RELEVANTE;
  const cayó = !primeraSemana && deltaConv <= -VARIACION_RELEVANTE;

  let titulo: string;
  let tono: TonoResumen;

  if (creció) {
    titulo = 'Tu cartera está creciendo';
    tono = 'positivo';
    parrafos.push(
      `Entre tus ${s.bots} bots, las conversaciones subieron ${porcentajeTexto(deltaConv)} respecto de la semana pasada: ${s.conversaciones} en total.`,
    );
  } else if (cayó) {
    titulo = 'Bajó la actividad general';
    tono = 'neutral';
    parrafos.push(
      `Tus ${s.bots} bots atendieron ${s.conversaciones} conversaciones, ${porcentajeTexto(deltaConv)} menos que la semana anterior.`,
    );
  } else if (primeraSemana) {
    titulo = 'Primer informe consolidado';
    tono = 'neutral';
    parrafos.push(
      `Tus ${s.bots} bots atendieron ${s.conversaciones} conversaciones esta semana. Desde el próximo lunes vas a poder comparar contra este número.`,
    );
  } else {
    titulo = 'Cartera estable';
    tono = 'neutral';
    parrafos.push(
      `Tus ${s.bots} bots atendieron ${s.conversaciones} conversaciones, en línea con la semana anterior.`,
    );
  }

  if (s.masActivo) {
    parrafos.push(
      `El que más movimiento tuvo fue ${s.masActivo.nombre}, con ${plural(s.masActivo.conversaciones, 'conversación', 'conversaciones')}.`,
    );
  }

  if (s.mejorBot && s.mejorBot.nps >= NPS_BUENO) {
    parrafos.push(
      `${s.mejorBot.nombre} es el mejor calificado, con ${s.mejorBot.nps.toFixed(1)} sobre ${NPS_MAX} de satisfacción.`,
    );
  }

  if (s.masDescuidado && s.masDescuidado.sinResponder > 0) {
    parrafos.push(
      `Donde más conviene meter mano es ${s.masDescuidado.nombre}: acumuló ${plural(s.masDescuidado.sinResponder, 'consulta', 'consultas')} que no supo responder. Es el que más rápido mejora si le cargás esa información.`,
    );
    if (tono === 'positivo') tono = 'neutral';
  } else if (s.sinResponder === 0) {
    parrafos.push('Ningún bot dejó consultas sin responder esta semana.');
  }

  if (s.inactivos.length > 0) {
    const lista = s.inactivos.slice(0, 3).join(', ');
    const resto = s.inactivos.length > 3 ? ` y ${s.inactivos.length - 3} más` : '';
    parrafos.push(
      `Sin actividad esta semana: ${lista}${resto}. Si deberían estar recibiendo consultas, revisá su conexión.`,
    );
  }

  return { titulo, tono, parrafos };
}
