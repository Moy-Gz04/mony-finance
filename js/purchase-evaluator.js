/* ==================================================================
   NEXUSFIN · PURCHASE EVALUATOR
   ------------------------------------------------------------------
   Motor de decisión "¿es una compra inteligente?" — AISLADO del resto
   de la app a propósito. No toca el DOM, no conoce colores ni CSS,
   no importa nada de state.js. Solo recibe datos (categoría,
   respuestas y, opcionalmente, contexto de saldo) y regresa datos.

   Esto es lo único que necesitas tocar para "entrenar" o afinar el
   algoritmo:
     - Ajustar el texto/score de cada opción.
     - Ajustar el "weight" (peso) de una pregunta dentro de su categoría.
     - Ajustar los umbrales de RESULT_THRESHOLDS.
     - Agregar/quitar categorías en CATEGORY_QUESTIONS.
     - Ajustar cómo se califica el impacto en el saldo en
       evaluateImpactoSaldo().

   API pública (window.PurchaseEvaluator):
     - getQuestions(categoryId)                    -> array de preguntas a mostrar
     - evaluate(categoryId, answers, context)       -> { score, label, tone, breakdown, impactoSaldo }
     - evaluateImpactoSaldo(saldoActual, monto)     -> factor automático (no se le pregunta al usuario)
     - CATEGORIES, BASE_QUESTIONS, CATEGORY_QUESTIONS, RESULT_THRESHOLDS

   Cada pregunta tiene la forma:
     {
       id: 'clave_unica',
       text: '¿Pregunta al usuario?',
       type: 'stars' | 'options',
       weight: 1,                 // importancia relativa (por defecto 1)
       options: [ { label:'...', score: 1-5 }, ... ]   // solo si type==='options'
     }

   evaluate() recibe:
     - answers = { [question.id]: score(1-5) }
     - context (opcional) = { saldoActual: number, monto: number }
       Si se manda, el motor agrega automáticamente un factor extra
       ("impacto en tu saldo de hoy") sin necesidad de preguntárselo
       al usuario — se calcula solo comparando el monto de la compra
       contra el dinero disponible en ese momento.
   ================================================================== */

(function (root) {

  /* ----------------------------------------------------------------
     1) PREGUNTAS BASE — se muestran para CUALQUIER categoría
     Redactadas en tono conversacional, como si te las preguntara un
     amigo que sabe de finanzas, no un formulario.
     ---------------------------------------------------------------- */
  const BASE_QUESTIONS = [
    {
      id: 'deseo',
      text: 'Siendo bien honesto contigo mismo, ¿qué tanto se te antoja comprarlo ahorita?',
      type: 'stars',
      weight: 1
    },
    {
      id: 'tamano_gasto',
      text: 'Viendo cómo tienes tus finanzas hoy, ¿qué tanto te pega este gasto?',
      type: 'options',
      weight: 1.2,
      options: [
        { label: 'Ni lo resiento, es una cantidad chica para mí', score: 5 },
        { label: 'Se siente, pero lo puedo absorber sin problema', score: 3 },
        { label: 'Me pega fuerte, es un gasto grande para mí', score: 1 }
      ]
    },
    {
      id: 'impacto_ahorro',
      text: '¿Comprarlo te va a obligar a tocar tus metas de ahorro o tu fondo de emergencia?',
      type: 'options',
      weight: 1.2,
      options: [
        { label: 'Para nada, tengo el dinero aparte de eso', score: 5 },
        { label: 'Un poquito, pero no los vacío', score: 3 },
        { label: 'Sí, tendría que sacarlo de ahí', score: 1 }
      ]
    }
  ];

  /* ----------------------------------------------------------------
     2) PREGUNTAS ESPECÍFICAS POR CATEGORÍA
     Cada categoría agrega 3 preguntas propias, distintas entre sí,
     pensadas en el contexto real de esa compra y con un tono cercano.
     ---------------------------------------------------------------- */
  const CATEGORY_QUESTIONS = {

    alimentos: [
      {
        id: 'alim_tipo',
        text: '¿Esto es parte de tu despensa de siempre o más bien un antojo del momento?',
        type: 'options', weight: 1,
        options: [
          { label: 'Es de mi despensa habitual', score: 5 },
          { label: 'Es un antojo, de vez en cuando pasa', score: 3 },
          { label: 'Podría hacerlo en casa y me saldría más barato', score: 2 }
        ]
      },
      {
        id: 'alim_stock',
        text: '¿De verdad se te acabó, o todavía tienes algo en casa para resolver?',
        type: 'options', weight: 1,
        options: [
          { label: 'Ya se me acabó o está por acabarse', score: 5 },
          { label: 'Tengo otras opciones en casa ahorita', score: 2 }
        ]
      },
      {
        id: 'alim_frecuencia',
        text: '¿Esto lo compras seguido o es la primera vez que se te antoja?',
        type: 'options', weight: 0.8,
        options: [
          { label: 'Es parte de mi rutina de siempre', score: 5 },
          { label: 'De repente, no muy seguido', score: 3 },
          { label: 'Es la primera vez que lo compro', score: 2 }
        ]
      }
    ],

    ropa: [
      {
        id: 'ropa_similar',
        text: 'Sé honesto: ¿ya tienes algo parecido en el clóset?',
        type: 'options', weight: 1.3,
        options: [
          { label: 'No, no tengo nada así', score: 5 },
          { label: 'Tengo algo, pero ya está gastado', score: 4 },
          { label: 'Sí, y todavía está en buen estado', score: 1 }
        ]
      },
      {
        id: 'ropa_ocasion',
        text: '¿Para qué lo vas a usar realmente?',
        type: 'options', weight: 1,
        options: [
          { label: 'Para el día a día o el trabajo', score: 5 },
          { label: 'Tengo un evento especial pronto', score: 4 },
          { label: 'Solo me gustó, sin una razón clara todavía', score: 2 }
        ]
      },
      {
        id: 'ropa_combina',
        text: '¿De verdad le vas a sacar provecho con lo que ya tienes?',
        type: 'options', weight: 0.8,
        options: [
          { label: 'Sí, le voy a dar mucho uso', score: 5 },
          { label: 'Más o menos, ya veré', score: 3 },
          { label: 'La verdad no estoy seguro todavía', score: 2 }
        ]
      }
    ],

    entretenimiento: [
      {
        id: 'entret_frecuencia',
        text: 'En serio, ¿qué tanto crees que lo vas a disfrutar de verdad?',
        type: 'options', weight: 1.2,
        options: [
          { label: 'Bastante seguido, le voy a dar uso', score: 5 },
          { label: 'De vez en cuando', score: 3 },
          { label: 'Fue más un impulso del momento', score: 1 }
        ]
      },
      {
        id: 'entret_duplicado',
        text: '¿Ya pagas por algo parecido (otra suscripción o servicio similar)?',
        type: 'options', weight: 1,
        options: [
          { label: 'No, esto es distinto a lo que ya tengo', score: 5 },
          { label: 'Sí, se me empalma con algo que ya pago', score: 1 }
        ]
      },
      {
        id: 'entret_alternativa',
        text: '¿Hay alguna opción gratis o más barata que te dejaría igual de contento?',
        type: 'options', weight: 0.8,
        options: [
          { label: 'No, esto tiene algo especial', score: 5 },
          { label: 'Sí, hay opciones parecidas más baratas', score: 2 }
        ]
      }
    ],

    tecnologia: [
      {
        id: 'tech_necesidad',
        text: '¿Tu equipo actual ya no te está funcionando, o nada más quieres el nuevo?',
        type: 'options', weight: 1.3,
        options: [
          { label: 'Ya falla o quedó atrás de verdad', score: 5 },
          { label: 'Funciona bien, solo se me antojó el nuevo', score: 1 }
        ]
      },
      {
        id: 'tech_uso',
        text: '¿Lo vas a usar sobre todo para trabajar/estudiar o más por gusto?',
        type: 'options', weight: 1,
        options: [
          { label: 'Para trabajo o escuela, me hace más productivo', score: 5 },
          { label: 'Sobre todo por gusto o entretenimiento', score: 2 }
        ]
      },
      {
        id: 'tech_investigacion',
        text: '¿Ya comparaste precios y opiniones, o lo viste y quisiste comprarlo ya?',
        type: 'options', weight: 0.8,
        options: [
          { label: 'Sí, comparé bien antes de decidir', score: 5 },
          { label: 'No, lo vi y ya me quiero lanzar', score: 2 }
        ]
      }
    ],

    pareja: [
      {
        id: 'pareja_ocasion',
        text: '¿Hay alguna fecha importante detrás, o es solo un gesto espontáneo?',
        type: 'options', weight: 1,
        options: [
          { label: 'Sí, hay una fecha que se acerca', score: 5 },
          { label: 'No, es más un detalle porque sí', score: 3 }
        ]
      },
      {
        id: 'pareja_presupuesto',
        text: '¿Esto ya lo tenías contemplado en tu presupuesto del mes?',
        type: 'options', weight: 1.2,
        options: [
          { label: 'Sí, ya lo tenía pensado', score: 5 },
          { label: 'No, es un gasto extra que no esperaba', score: 2 }
        ]
      },
      {
        id: 'pareja_significado',
        text: '¿Qué tanto sientes que esto suma a la relación?',
        type: 'options', weight: 0.9,
        options: [
          { label: 'Mucho, es un gesto que de verdad importa', score: 5 },
          { label: 'Está bien, aunque no es esencial', score: 3 },
          { label: 'La verdad es más por quedar bien', score: 2 }
        ]
      }
    ],

    transporte: [
      {
        id: 'transporte_necesidad',
        text: '¿Lo necesitas de verdad para moverte a trabajar o estudiar?',
        type: 'options', weight: 1.3,
        options: [
          { label: 'Sí, lo necesito para mi día a día', score: 5 },
          { label: 'Es más por comodidad que por necesidad', score: 2 }
        ]
      },
      {
        id: 'transporte_alternativa',
        text: '¿Hay alguna alternativa más barata que también te funcione?',
        type: 'options', weight: 1,
        options: [
          { label: 'No, esta de verdad es mi mejor opción', score: 5 },
          { label: 'Sí, hay opciones más económicas', score: 2 }
        ]
      },
      {
        id: 'transporte_frecuencia',
        text: '¿Qué tan seguido lo vas a usar?',
        type: 'options', weight: 0.8,
        options: [
          { label: 'Todos los días', score: 5 },
          { label: 'De vez en cuando', score: 3 },
          { label: 'Solo por esta vez', score: 2 }
        ]
      }
    ],

    salud: [
      {
        id: 'salud_recomendado',
        text: '¿Te lo recomendó o recetó un profesional de la salud?',
        type: 'options', weight: 1.4,
        options: [
          { label: 'Sí, me lo indicó un profesional', score: 5 },
          { label: 'No, es por cuidarme o prevenir', score: 4 },
          { label: 'No, es más opcional o estético', score: 2 }
        ]
      },
      {
        id: 'salud_urgencia',
        text: '¿Qué tan urgente es esto para ti ahorita?',
        type: 'options', weight: 1.2,
        options: [
          { label: 'Bastante urgente', score: 5 },
          { label: 'Puede esperar un poco', score: 3 },
          { label: 'No es urgente en realidad', score: 1 }
        ]
      },
      {
        id: 'salud_consecuencia',
        text: '¿Qué pasa si lo dejas para después?',
        type: 'options', weight: 1,
        options: [
          { label: 'Podría afectar mi salud', score: 5 },
          { label: 'Sigo igual por un tiempo', score: 3 },
          { label: 'Prácticamente nada cambia', score: 1 }
        ]
      }
    ],

    hogar: [
      {
        id: 'hogar_reemplazo',
        text: '¿Esto reemplaza algo que ya no sirve, o es algo nuevo que quieres sumar?',
        type: 'options', weight: 1.1,
        options: [
          { label: 'Sí, lo que tengo ya no funciona', score: 5 },
          { label: 'No, es una mejora o algo extra', score: 3 }
        ]
      },
      {
        id: 'hogar_beneficio',
        text: '¿Esto lo van a disfrutar todos en casa o nada más tú?',
        type: 'options', weight: 0.9,
        options: [
          { label: 'Todos en casa le van a sacar provecho', score: 5 },
          { label: 'Sobre todo yo', score: 3 }
        ]
      },
      {
        id: 'hogar_uso',
        text: '¿Qué tanto se va a usar en el día a día de la casa?',
        type: 'options', weight: 0.9,
        options: [
          { label: 'Todos los días', score: 5 },
          { label: 'De vez en cuando', score: 3 },
          { label: 'Muy rara vez', score: 1 }
        ]
      }
    ],

    otros: [
      {
        id: 'otros_tipo',
        text: 'Piénsalo bien: ¿esto es una necesidad real o más un capricho?',
        type: 'options', weight: 1,
        options: [
          { label: 'Es algo que de verdad necesito', score: 5 },
          { label: 'Es más un capricho, si soy sincero', score: 2 }
        ]
      },
      {
        id: 'otros_espera',
        text: 'Si te esperaras una semana antes de comprarlo, ¿lo seguirías queriendo igual?',
        type: 'options', weight: 1.1,
        options: [
          { label: 'Sí, seguro que sí', score: 5 },
          { label: 'La verdad no estoy tan seguro', score: 2 }
        ]
      },
      {
        id: 'otros_alternativa',
        text: '¿Hay alguna opción más barata o gratis que resuelva lo mismo?',
        type: 'options', weight: 0.8,
        options: [
          { label: 'No, esta es de verdad la mejor opción', score: 5 },
          { label: 'Sí, hay alternativas que también funcionan', score: 2 }
        ]
      }
    ]
  };

  /* ----------------------------------------------------------------
     3) UMBRALES DE RESULTADO
     'tone' es un identificador neutro (no un color) para que la UI
     decida cómo pintarlo.
     ---------------------------------------------------------------- */
  const RESULT_THRESHOLDS = [
    { min: 4.5, label: 'Compra muy inteligente', tone: 'excellent' },
    { min: 3.5, label: 'Buena decisión', tone: 'good' },
    { min: 2.5, label: 'Piénsalo bien antes de comprar', tone: 'warn' },
    { min: 1.5, label: 'Compra poco recomendable', tone: 'bad' },
    { min: 0, label: 'Mejor evítala si puedes', tone: 'avoid' }
  ];

  /* ----------------------------------------------------------------
     4) IMPACTO EN EL SALDO — factor automático, no se le pregunta al
     usuario: se calcula solo comparando el monto de la compra contra
     su saldo disponible en este momento. Entre más cerca de cero (o
     en negativo) lo deje, más baja la calificación.
     ---------------------------------------------------------------- */
  function evaluateImpactoSaldo(saldoActual, monto) {
    if (saldoActual == null || isNaN(saldoActual) || monto == null || isNaN(monto)) return null;
    const restante = saldoActual - monto;
    const pct = saldoActual > 0 ? restante / saldoActual : (restante <= 0 ? -1 : 1);
    let score, nivel;
    if (restante <= 0) { score = 1; nivel = 'critico'; }
    else if (pct < 0.10) { score = 1.5; nivel = 'muy_bajo'; }
    else if (pct < 0.25) { score = 2.5; nivel = 'bajo'; }
    else if (pct < 0.50) { score = 3.5; nivel = 'moderado'; }
    else if (pct < 0.75) { score = 4.5; nivel = 'comodo'; }
    else { score = 5; nivel = 'muy_comodo'; }
    return { score: score, nivel: nivel, restante: restante, weight: 1.3 };
  }

  /* ----------------------------------------------------------------
     5) FUNCIONES PÚBLICAS
     ---------------------------------------------------------------- */

  // Regresa el set completo de preguntas (base + específicas) para una categoría
  function getQuestions(categoryId) {
    const specific = CATEGORY_QUESTIONS[categoryId] || CATEGORY_QUESTIONS.otros;
    return BASE_QUESTIONS.concat(specific);
  }

  // answers: { [questionId]: score (1-5) }
  // categoryId se usa solo para reconstruir el set de preguntas y sus pesos
  // context (opcional): { saldoActual, monto } — si se manda, se agrega
  // automáticamente el factor de impacto en el saldo a la calificación.
  function evaluate(categoryId, answers, context) {
    const questions = getQuestions(categoryId);
    const breakdown = [];
    let weightedSum = 0;
    let weightTotal = 0;

    questions.forEach(function (q) {
      const score = answers[q.id];
      if (score == null) return; // pregunta no respondida, se ignora
      const w = q.weight || 1;
      weightedSum += score * w;
      weightTotal += w;
      breakdown.push({ id: q.id, text: q.text, score: score, weight: w });
    });

    let impactoSaldo = null;
    if (context && context.saldoActual != null && context.monto != null) {
      impactoSaldo = evaluateImpactoSaldo(context.saldoActual, context.monto);
      if (impactoSaldo) {
        weightedSum += impactoSaldo.score * impactoSaldo.weight;
        weightTotal += impactoSaldo.weight;
        breakdown.push({
          id: '_impacto_saldo',
          text: 'Qué tanto te aprieta este gasto con el saldo que tienes ahora',
          score: impactoSaldo.score,
          weight: impactoSaldo.weight
        });
      }
    }

    if (weightTotal === 0) return null;

    const rawAvg = weightedSum / weightTotal;
    const score = Math.round(rawAvg * 10) / 10;
    const result = RESULT_THRESHOLDS.find(function (t) { return score >= t.min; }) ||
                   RESULT_THRESHOLDS[RESULT_THRESHOLDS.length - 1];

    return {
      score: score,
      label: result.label,
      tone: result.tone,
      breakdown: breakdown,
      impactoSaldo: impactoSaldo
    };
  }

  const PurchaseEvaluator = {
    BASE_QUESTIONS: BASE_QUESTIONS,
    CATEGORY_QUESTIONS: CATEGORY_QUESTIONS,
    RESULT_THRESHOLDS: RESULT_THRESHOLDS,
    getQuestions: getQuestions,
    evaluate: evaluate,
    evaluateImpactoSaldo: evaluateImpactoSaldo
  };

  // Exponer en window (navegador) y también como módulo CommonJS,
  // para poder correr scripts de prueba/entrenamiento con Node
  // (ej. node scripts/tune-evaluator.js) sin necesidad de un navegador.
  root.PurchaseEvaluator = PurchaseEvaluator;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PurchaseEvaluator;
  }

})(typeof window !== 'undefined' ? window : globalThis);
