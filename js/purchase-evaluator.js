/* ==================================================================
   NEXUSFIN · PURCHASE EVALUATOR (v3)
   ------------------------------------------------------------------
   Motor de decisión "¿es una compra inteligente?" — AISLADO del resto
   de la app a propósito. No toca el DOM, no conoce colores ni CSS,
   no importa nada de state.js. Solo recibe datos y regresa datos.

   NOVEDAD DE ESTA VERSIÓN: catálogo de SUBTIPOS por producto.
   Antes, todo lo de "Alimentos" hacía las mismas 3 preguntas, sin
   importar si compraste una paleta o la despensa del mes. Ahora se
   detectan palabras clave de lo que escribiste en "¿Qué compraste?"
   para elegir un set de preguntas mucho más específico:
     "paleta"        -> preguntas de antojos/dulces
     "iPhone 15"      -> preguntas de celular
     "pasta dental"   -> preguntas de cuidado personal
     "laptop Dell"    -> preguntas de computadora
   Si no se detecta ningún subtipo conocido, se usan las 3 preguntas
   genéricas de la categoría (como antes) — nunca se queda sin
   preguntas.

   Esto es lo único que necesitas tocar para "entrenar" el algoritmo:
     - Agregar/quitar palabras clave o subtipos en SUBTYPE_QUESTIONS.
     - Ajustar texto/score/weight de cualquier pregunta.
     - Ajustar los umbrales de RESULT_THRESHOLDS o nivelCompra().
     - Ajustar los factores automáticos al final del archivo.

   API pública (window.PurchaseEvaluator):
     - getQuestions(categoryId, context)      -> preguntas a mostrar
     - evaluate(categoryId, answers, context) -> resultado completo
     - detectarSubtipo(categoryId, descripcion) -> subtipo detectado o null
     - nivelCompra(monto, saldoActual)        -> 'chica' | 'mediana' | 'grande'

   context (todos opcionales, cada uno activa su propia parte):
     {
       descripcion,                            -> detecta el subtipo de producto
       saldoActual, monto,                     -> impacto en saldo + tamaño del cuestionario
       presupuestoUsado, presupuestoMeta,      -> impacto en presupuesto mensual de la categoría
       deudasProximasTotal,                    -> deudas por vencer pronto
       arrepentimiento: { pct, total } | null  -> historial de esa categoría
     }
   ================================================================== */

(function (root) {

  /* ----------------------------------------------------------------
     0) UTILIDAD: normalizar texto para comparar palabras clave sin
     que importen acentos/mayúsculas ("Paleta" === "paleta" === "PALETA")
     ---------------------------------------------------------------- */
  function normalizar(txt) {
    return String(txt || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /* ----------------------------------------------------------------
     1) PREGUNTAS BASE — se muestran para CUALQUIER categoría
     ---------------------------------------------------------------- */
  const BASE_QUESTIONS = [
    { id: 'deseo', text: 'Siendo bien honesto contigo mismo, ¿qué tanto se te antoja comprarlo ahorita?', type: 'stars', weight: 1 },
    { id: 'tamano_gasto', text: 'Viendo cómo tienes tus finanzas hoy, ¿qué tanto te pega este gasto?', type: 'options', weight: 1.2,
      options: [
        { label: 'Ni lo resiento, es una cantidad chica para mí', score: 5 },
        { label: 'Se siente, pero lo puedo absorber sin problema', score: 3 },
        { label: 'Me pega fuerte, es un gasto grande para mí', score: 1 }
      ] },
    { id: 'impacto_ahorro', text: '¿Comprarlo te va a obligar a tocar tus metas de ahorro o tu fondo de emergencia?', type: 'options', weight: 1.2,
      options: [
        { label: 'Para nada, tengo el dinero aparte de eso', score: 5 },
        { label: 'Un poquito, pero no los vacío', score: 3 },
        { label: 'Sí, tendría que sacarlo de ahí', score: 1 }
      ] }
  ];

  /* ----------------------------------------------------------------
     2) PREGUNTAS GENÉRICAS POR CATEGORÍA — se usan como respaldo si
     no se detecta ningún subtipo específico en la descripción.
     ---------------------------------------------------------------- */
  const CATEGORY_QUESTIONS = {
    alimentos: [
      { id: 'alim_tipo', text: '¿Es para tu despensa/consumo esencial o es un antojo?', type: 'options', weight: 1,
        options: [{ label: 'Es parte de mi despensa habitual', score: 5 }, { label: 'Es un antojo ocasional', score: 3 }, { label: 'Podría prepararlo en casa más barato', score: 2 }] },
      { id: 'alim_stock', text: '¿Ya tienes suficiente comida en casa ahora mismo?', type: 'options', weight: 1,
        options: [{ label: 'No, se me acabó o está por acabarse', score: 5 }, { label: 'Sí, tengo otras opciones disponibles', score: 2 }] },
      { id: 'alim_frecuencia', text: '¿Con qué frecuencia compras esto normalmente?', type: 'options', weight: 0.8,
        options: [{ label: 'Es parte de mi rutina semanal', score: 5 }, { label: 'De vez en cuando', score: 3 }, { label: 'Es la primera vez que lo compro', score: 2 }] }
    ],
    ropa: [
      { id: 'ropa_similar', text: '¿Ya tienes algo similar en tu clóset?', type: 'options', weight: 1.3,
        options: [{ label: 'No tengo nada parecido', score: 5 }, { label: 'Sí, pero está gastado', score: 4 }, { label: 'Sí, y está en buen estado', score: 1 }] },
      { id: 'ropa_ocasion', text: '¿Para qué lo necesitas?', type: 'options', weight: 1,
        options: [{ label: 'Uso diario o de trabajo', score: 5 }, { label: 'Tengo una ocasión especial próxima', score: 4 }, { label: 'Solo me gustó', score: 2 }] },
      { id: 'ropa_combina', text: '¿Combina bien con lo que ya tienes?', type: 'options', weight: 0.8,
        options: [{ label: 'Sí, le voy a sacar mucho provecho', score: 5 }, { label: 'Más o menos', score: 3 }, { label: 'No estoy seguro todavía', score: 2 }] }
    ],
    entretenimiento: [
      { id: 'entret_frecuencia', text: '¿Qué tan seguido crees que lo disfrutarás?', type: 'options', weight: 1.2,
        options: [{ label: 'Frecuentemente', score: 5 }, { label: 'De vez en cuando', score: 3 }, { label: 'Fue un impulso del momento', score: 1 }] },
      { id: 'entret_duplicado', text: '¿Ya pagas por algo similar?', type: 'options', weight: 1,
        options: [{ label: 'No, esto es distinto', score: 5 }, { label: 'Sí, se traslapa con algo que ya tengo', score: 1 }] },
      { id: 'entret_alternativa', text: '¿Existe una opción gratuita o más barata igual de satisfactoria?', type: 'options', weight: 0.8,
        options: [{ label: 'No, esto es especial', score: 5 }, { label: 'Sí, hay opciones más baratas', score: 2 }] }
    ],
    tecnologia: [
      { id: 'tech_necesidad', text: '¿Tu dispositivo actual ya no cumple tus necesidades?', type: 'options', weight: 1.3,
        options: [{ label: 'Sí, ya falla o quedó obsoleto', score: 5 }, { label: 'Funciona bien, solo quiero el nuevo', score: 1 }] },
      { id: 'tech_uso', text: '¿Lo usarás para trabajo/estudio o por gusto?', type: 'options', weight: 1,
        options: [{ label: 'Trabajo o estudio', score: 5 }, { label: 'Solo por gusto', score: 2 }] },
      { id: 'tech_investigacion', text: '¿Ya comparaste precios, modelos o reseñas?', type: 'options', weight: 0.8,
        options: [{ label: 'Sí, comparé bien', score: 5 }, { label: 'No, solo lo vi', score: 2 }] }
    ],
    pareja: [
      { id: 'pareja_ocasion', text: '¿Es para una ocasión especial?', type: 'options', weight: 1,
        options: [{ label: 'Sí, hay una fecha importante', score: 5 }, { label: 'No, es un detalle espontáneo', score: 3 }] },
      { id: 'pareja_presupuesto', text: '¿Está dentro del presupuesto que ya tenías planeado?', type: 'options', weight: 1.2,
        options: [{ label: 'Sí, ya lo tenía contemplado', score: 5 }, { label: 'No, es un gasto extra', score: 2 }] },
      { id: 'pareja_significado', text: '¿Qué tanto crees que esto fortalece la relación?', type: 'options', weight: 0.9,
        options: [{ label: 'Mucho', score: 5 }, { label: 'Es bonito, pero no esencial', score: 3 }, { label: 'Poco, más por quedar bien', score: 2 }] }
    ],
    transporte: [
      { id: 'transporte_necesidad', text: '¿Es indispensable para moverte a trabajo/escuela?', type: 'options', weight: 1.3,
        options: [{ label: 'Sí, lo necesito', score: 5 }, { label: 'Es más por comodidad', score: 2 }] },
      { id: 'transporte_alternativa', text: '¿Hay una alternativa más económica disponible?', type: 'options', weight: 1,
        options: [{ label: 'No, esta es la mejor opción', score: 5 }, { label: 'Sí, existen opciones más baratas', score: 2 }] },
      { id: 'transporte_frecuencia', text: '¿Qué tan seguido lo vas a necesitar?', type: 'options', weight: 0.8,
        options: [{ label: 'A diario', score: 5 }, { label: 'Ocasionalmente', score: 3 }, { label: 'Solo esta vez', score: 2 }] }
    ],
    salud: [
      { id: 'salud_recomendado', text: '¿Te lo recomendó o recetó un profesional de la salud?', type: 'options', weight: 1.4,
        options: [{ label: 'Sí, me lo indicó un profesional', score: 5 }, { label: 'No, es autocuidado', score: 4 }, { label: 'No, es opcional o estético', score: 2 }] },
      { id: 'salud_urgencia', text: '¿Qué tan urgente es?', type: 'options', weight: 1.2,
        options: [{ label: 'Urgente', score: 5 }, { label: 'Puede esperar', score: 3 }, { label: 'No es urgente', score: 1 }] },
      { id: 'salud_consecuencia', text: '¿Qué pasa si no lo compras ahora?', type: 'options', weight: 1,
        options: [{ label: 'Mi salud podría empeorar', score: 5 }, { label: 'Sigo igual por ahora', score: 3 }, { label: 'Nada cambia', score: 1 }] }
    ],
    hogar: [
      { id: 'hogar_reemplazo', text: '¿Reemplaza algo roto o que ya no funciona?', type: 'options', weight: 1.1,
        options: [{ label: 'Sí, lo actual ya no sirve', score: 5 }, { label: 'No, es una mejora', score: 3 }] },
      { id: 'hogar_beneficio', text: '¿Beneficia a todos en casa o solo a ti?', type: 'options', weight: 0.9,
        options: [{ label: 'A todos en casa', score: 5 }, { label: 'Principalmente a mí', score: 3 }] },
      { id: 'hogar_uso', text: '¿Qué tan seguido se usará?', type: 'options', weight: 0.9,
        options: [{ label: 'Todos los días', score: 5 }, { label: 'A veces', score: 3 }, { label: 'Rara vez', score: 1 }] }
    ],
    otros: [
      { id: 'otros_tipo', text: '¿Lo considerarías una necesidad o un capricho?', type: 'options', weight: 1,
        options: [{ label: 'Es una necesidad real', score: 5 }, { label: 'Es más un capricho', score: 2 }] },
      { id: 'otros_espera', text: 'Si esperaras una semana, ¿lo seguirías queriendo igual?', type: 'options', weight: 1.1,
        options: [{ label: 'Sí, seguro que sí', score: 5 }, { label: 'No estoy seguro', score: 2 }] },
      { id: 'otros_alternativa', text: '¿Hay una opción más barata o gratuita?', type: 'options', weight: 0.8,
        options: [{ label: 'No, esta es la mejor opción', score: 5 }, { label: 'Sí, existen alternativas', score: 2 }] }
    ]
  };

  /* ----------------------------------------------------------------
     3) CATÁLOGO DE SUBTIPOS — palabras clave + preguntas a la medida
     de ese tipo de producto específico. Se detecta por coincidencia
     de texto contra lo que escribiste en "¿Qué compraste?".
     ---------------------------------------------------------------- */
  const SUBTYPE_QUESTIONS = {

    alimentos: [
      { keywords: ['paleta', 'dulce', 'dulces', 'chocolate', 'chicle', 'caramelo', 'golosina', 'helado', 'nieve', 'gomita'],
        questions: [
          { id: 'sub_dulce_repeticion', text: '¿Es un antojo de hoy nada más, o de esos que se repiten seguido?', type: 'options', weight: 1,
            options: [{ label: 'Fue un antojo de hoy nada más', score: 5 }, { label: 'Se me antoja seguido, ya es costumbre', score: 3 }, { label: 'Ya perdí la cuenta de cuántas veces por semana', score: 1 }] },
          { id: 'sub_dulce_compartir', text: '¿Lo vas a compartir o es nada más para ti?', type: 'options', weight: 0.8,
            options: [{ label: 'Lo voy a compartir', score: 5 }, { label: 'Es nada más para mí', score: 3 }] },
          { id: 'sub_dulce_motivo', text: 'Si lo piensas bien, ¿es más por antojo real o por aburrimiento/estrés del momento?', type: 'options', weight: 1,
            options: [{ label: 'Antojo real, se me antojó de verdad', score: 4 }, { label: 'Sinceramente es más por aburrimiento o estrés', score: 2 }] }
        ] },
      { keywords: ['restaurante', 'tacos', 'pizza', 'hamburguesa', 'sushi', 'mcdonalds', 'burger', 'kfc', 'dominos', 'comida rapida', 'antojitos'],
        questions: [
          { id: 'sub_comida_habia', text: '¿Tenías comida ya lista en casa, o de plano no había nada?', type: 'options', weight: 1.1,
            options: [{ label: 'No había nada, tocaba resolver', score: 5 }, { label: 'Había algo, pero se me antojó salir', score: 3 }, { label: 'Sí había comida hecha en casa', score: 1 }] },
          { id: 'sub_comida_ocasion', text: '¿Es una salida especial o más bien rutina entre semana?', type: 'options', weight: 0.9,
            options: [{ label: 'Es algo especial', score: 5 }, { label: 'Es más rutina', score: 3 }] },
          { id: 'sub_comida_compania', text: '¿Vas a comer solo o acompañado?', type: 'options', weight: 0.7,
            options: [{ label: 'Voy acompañado, es un momento social', score: 5 }, { label: 'Como solo', score: 3 }] }
        ] },
      { keywords: ['cafe', 'starbucks', 'frappe', 'latte', 'capuchino', 'espresso'],
        questions: [
          { id: 'sub_cafe_rutina', text: '¿Es tu café de todos los días o algo extra hoy?', type: 'options', weight: 0.9,
            options: [{ label: 'Es mi rutina diaria', score: 4 }, { label: 'Es un extra especial hoy', score: 3 }] },
          { id: 'sub_cafe_casa', text: '¿Podrías prepararlo en casa por mucho menos?', type: 'options', weight: 1,
            options: [{ label: 'Sí, fácilmente', score: 2 }, { label: 'No realmente, no tengo cómo', score: 5 }] },
          { id: 'sub_cafe_frecuencia', text: '¿Cuántas veces a la semana haces este gasto?', type: 'options', weight: 1,
            options: [{ label: 'Casi todos los días', score: 1 }, { label: 'Un par de veces a la semana', score: 3 }, { label: 'Rara vez', score: 5 }] }
        ] },
      { keywords: ['super', 'supermercado', 'despensa', 'walmart', 'soriana', 'chedraui', 'mercado', 'costco'],
        questions: [
          { id: 'sub_super_planeada', text: '¿Es tu surtido normal de la quincena/mes, o una compra extra?', type: 'options', weight: 1,
            options: [{ label: 'Es mi surtido normal', score: 5 }, { label: 'Es una compra extra fuera de lo planeado', score: 3 }] },
          { id: 'sub_super_revisaste', text: '¿Ya revisaste que no tuvieras esto mismo en casa?', type: 'options', weight: 0.8,
            options: [{ label: 'Sí, ya lo revisé, se necesita', score: 5 }, { label: 'No estoy seguro, puede que ya tenga', score: 2 }] },
          { id: 'sub_super_oferta', text: '¿Aprovechaste alguna oferta o promoción?', type: 'options', weight: 0.7,
            options: [{ label: 'Sí, estaba en oferta', score: 5 }, { label: 'No, precio normal', score: 3 }] }
        ] }
    ],

    ropa: [
      { keywords: ['tenis', 'zapatos', 'botas', 'sneakers', 'huaraches', 'sandalias'],
        questions: [
          { id: 'sub_calzado_estado', text: '¿Los que ya tienes están gastados/rotos, o siguen sirviendo bien?', type: 'options', weight: 1.2,
            options: [{ label: 'Los míos ya están destrozados', score: 5 }, { label: 'Siguen sirviendo, pero quiero otros', score: 2 }] },
          { id: 'sub_calzado_uso', text: '¿Es para uso diario o para una ocasión específica?', type: 'options', weight: 1,
            options: [{ label: 'Uso diario, les voy a dar vuelo', score: 5 }, { label: 'Ocasión específica', score: 4 }, { label: 'Solo me gustaron', score: 2 }] },
          { id: 'sub_calzado_probado', text: '¿Ya te los probaste y calzan bien?', type: 'options', weight: 0.8,
            options: [{ label: 'Sí, ya me quedan perfecto', score: 5 }, { label: 'Los compré sin probar / talla incierta', score: 2 }] }
        ] },
      { keywords: ['camisa', 'traje', 'uniforme', 'blazer', 'corbata', 'formal'],
        questions: [
          { id: 'sub_formal_indispensable', text: '¿Es indispensable para tu trabajo/evento, o es opcional?', type: 'options', weight: 1.2,
            options: [{ label: 'Es indispensable, lo necesito sí o sí', score: 5 }, { label: 'Es opcional, mejoraría mi imagen', score: 3 }] },
          { id: 'sub_formal_alternativa', text: '¿Tienes algo similar que puedas usar mientras tanto?', type: 'options', weight: 1,
            options: [{ label: 'No tengo nada parecido', score: 5 }, { label: 'Sí tengo algo que puedo usar', score: 2 }] },
          { id: 'sub_formal_rotacion', text: '¿Es una prenda que vas a rotar seguido?', type: 'options', weight: 0.8,
            options: [{ label: 'Sí, la voy a usar muy seguido', score: 5 }, { label: 'Solo para ocasiones puntuales', score: 3 }] }
        ] },
      { keywords: ['playera', 'pantalon', 'sudadera', 'short', 'blusa', 'vestido', 'jeans', 'falda'],
        questions: [
          { id: 'sub_casual_similar', text: '¿Ya tienes piezas parecidas en el clóset?', type: 'options', weight: 1.2,
            options: [{ label: 'No tengo nada así', score: 5 }, { label: 'Tengo algo parecido pero gastado', score: 4 }, { label: 'Tengo varias parecidas', score: 1 }] },
          { id: 'sub_casual_combina', text: '¿Combina con al menos 2-3 cosas que ya tienes?', type: 'options', weight: 1,
            options: [{ label: 'Sí, le voy a sacar provecho', score: 5 }, { label: 'No estoy seguro', score: 2 }] },
          { id: 'sub_casual_planeada', text: '¿Fue una compra planeada o la viste y la compraste en el momento?', type: 'options', weight: 0.8,
            options: [{ label: 'La tenía en mente hace tiempo', score: 5 }, { label: 'La vi y la compré en el momento', score: 2 }] }
        ] },
      { keywords: ['reloj', 'lentes', 'gorra', 'cinturon', 'bolsa', 'mochila', 'accesorio'],
        questions: [
          { id: 'sub_acc_reemplazo', text: '¿Es para reemplazar uno que se rompió/perdió, o es un extra?', type: 'options', weight: 1.1,
            options: [{ label: 'Reemplaza uno que ya no sirve', score: 5 }, { label: 'Es un extra, el otro sigue bien', score: 2 }] },
          { id: 'sub_acc_uso', text: '¿Lo vas a usar seguido o es más ocasional?', type: 'options', weight: 0.9,
            options: [{ label: 'Todos los días', score: 5 }, { label: 'De vez en cuando', score: 3 }] },
          { id: 'sub_acc_comparaste', text: '¿Ya viste el precio en otro lado para comparar?', type: 'options', weight: 0.8,
            options: [{ label: 'Sí, ya comparé', score: 5 }, { label: 'No, es el primero que vi', score: 2 }] }
        ] }
    ],

    entretenimiento: [
      { keywords: ['juego', 'videojuego', 'steam', 'playstation', 'xbox', 'nintendo', 'ps5', 'ps4'],
        questions: [
          { id: 'sub_vg_espera', text: '¿Es un juego que llevas tiempo esperando, o fue impulso al verlo?', type: 'options', weight: 1.1,
            options: [{ label: 'Lo tenía en la mira hace tiempo', score: 5 }, { label: 'Lo vi y lo quise ya', score: 2 }] },
          { id: 'sub_vg_horas', text: '¿Calculas que le vas a meter muchas horas?', type: 'options', weight: 1,
            options: [{ label: 'Sí, le voy a dar bastante uso', score: 5 }, { label: 'Probablemente lo juegue poco', score: 2 }] },
          { id: 'sub_vg_oferta', text: '¿Está en oferta o a precio completo?', type: 'options', weight: 0.7,
            options: [{ label: 'Está en oferta', score: 5 }, { label: 'Precio completo', score: 3 }] }
        ] },
      { keywords: ['netflix', 'spotify', 'disney', 'hbo', 'suscripcion', 'prime video', 'max', 'crunchyroll'],
        questions: [
          { id: 'sub_stream_duplicado', text: '¿Ya tienes otra suscripción parecida activa?', type: 'options', weight: 1.2,
            options: [{ label: 'No, esta es distinta a lo que ya pago', score: 5 }, { label: 'Sí, se me empalma con otra', score: 1 }] },
          { id: 'sub_stream_compartida', text: '¿La vas a compartir con alguien más para bajar el costo?', type: 'options', weight: 0.8,
            options: [{ label: 'Sí, la comparto', score: 5 }, { label: 'La pago yo solo', score: 3 }] },
          { id: 'sub_stream_uso_real', text: 'Sinceramente, ¿le dedicas tiempo real a este tipo de contenido?', type: 'options', weight: 1,
            options: [{ label: 'Sí, le dedico tiempo seguido', score: 5 }, { label: 'La verdad casi no la uso', score: 1 }] }
        ] },
      { keywords: ['cine', 'boleto', 'concierto', 'evento', 'teatro', 'festival'],
        questions: [
          { id: 'sub_evento_unico', text: '¿Es algo que pasa una vez (concierto, estreno), o algo que puedes hacer cuando quieras?', type: 'options', weight: 1.1,
            options: [{ label: 'Es único, no se va a repetir pronto', score: 5 }, { label: 'Puedo hacerlo cuando quiera', score: 3 }] },
          { id: 'sub_evento_compania', text: '¿Vas acompañado o vas a estar solo?', type: 'options', weight: 0.7,
            options: [{ label: 'Voy acompañado', score: 5 }, { label: 'Voy solo', score: 4 }] },
          { id: 'sub_evento_promo', text: '¿Ya viste si hay alguna promoción o descuento disponible?', type: 'options', weight: 0.8,
            options: [{ label: 'Sí, ya lo revisé', score: 5 }, { label: 'No, precio normal', score: 3 }] }
        ] },
      { keywords: ['bar', 'antro', 'fiesta', 'cerveza', 'copas', 'alcohol'],
        questions: [
          { id: 'sub_salida_especial', text: '¿Es una salida especial o un plan de rutina de fin de semana?', type: 'options', weight: 0.9,
            options: [{ label: 'Es algo especial', score: 4 }, { label: 'Es rutina de cada fin de semana', score: 2 }] },
          { id: 'sub_salida_limite', text: '¿Ya tienes un límite de cuánto vas a gastar en la noche?', type: 'options', weight: 1.1,
            options: [{ label: 'Sí, ya me puse un límite', score: 5 }, { label: 'No, voy a ver cómo se da', score: 2 }] },
          { id: 'sub_salida_repetido', text: '¿Esta salida se suma a otras que ya tuviste esta semana?', type: 'options', weight: 1,
            options: [{ label: 'Es la única en la semana', score: 5 }, { label: 'Ya van varias esta semana', score: 1 }] }
        ] }
    ],

    tecnologia: [
      { keywords: ['celular', 'iphone', 'samsung', 'telefono', 'smartphone', 'xiaomi', 'motorola'],
        questions: [
          { id: 'sub_cel_estado', text: '¿Tu celular actual ya no te sirve (batería, roto, lento), o sigue funcionando bien?', type: 'options', weight: 1.3,
            options: [{ label: 'Ya no me sirve de verdad', score: 5 }, { label: 'Funciona bien, solo quiero el nuevo', score: 1 }] },
          { id: 'sub_cel_comparaste', text: '¿Ya comparaste modelos y precios en distintas tiendas?', type: 'options', weight: 0.9,
            options: [{ label: 'Sí, comparé bien', score: 5 }, { label: 'No, vi uno y lo quise', score: 2 }] },
          { id: 'sub_cel_meses', text: 'Si es a meses, ¿ya revisaste que el pago mensual no te ahogue?', type: 'options', weight: 1.1,
            options: [{ label: 'De contado, o a meses que ya tengo contemplados', score: 5 }, { label: 'A meses, pero no he revisado bien cómo me afecta', score: 2 }] }
        ] },
      { keywords: ['laptop', 'computadora', 'pc', 'mac', 'macbook', 'notebook'],
        questions: [
          { id: 'sub_lap_uso', text: '¿La necesitas para trabajar/estudiar, o es más para uso personal/gusto?', type: 'options', weight: 1.2,
            options: [{ label: 'La necesito para trabajo o escuela', score: 5 }, { label: 'Es más por gusto o entretenimiento', score: 2 }] },
          { id: 'sub_lap_actual', text: '¿Tu equipo actual ya no da el ancho para lo que necesitas?', type: 'options', weight: 1.3,
            options: [{ label: 'Ya no da el ancho, se queda corto', score: 5 }, { label: 'Todavía funciona, solo quiero algo mejor', score: 1 }] },
          { id: 'sub_lap_investigacion', text: '¿Ya revisaste reseñas o comparaste specs contra el precio?', type: 'options', weight: 0.8,
            options: [{ label: 'Sí, investigué bien', score: 5 }, { label: 'No, me fui por lo primero que vi', score: 2 }] }
        ] },
      { keywords: ['audifonos', 'cargador', 'funda', 'mouse', 'teclado', 'cable', 'power bank'],
        questions: [
          { id: 'sub_accTech_motivo', text: '¿Es porque el anterior se rompió/perdió, o quieres uno mejor?', type: 'options', weight: 1,
            options: [{ label: 'El anterior ya no sirve', score: 5 }, { label: 'El anterior funciona, quiero uno mejor', score: 3 }] },
          { id: 'sub_accTech_compatible', text: '¿Es compatible al 100% con lo que ya tienes?', type: 'options', weight: 1,
            options: [{ label: 'Sí, ya confirmé que es compatible', score: 5 }, { label: 'No estoy 100% seguro', score: 2 }] },
          { id: 'sub_accTech_uso', text: '¿Le vas a dar uso diario?', type: 'options', weight: 0.8,
            options: [{ label: 'Sí, todos los días', score: 5 }, { label: 'De vez en cuando', score: 3 }] }
        ] },
      { keywords: ['television', 'tv', 'pantalla', 'consola', 'bocina', 'smartwatch', 'tablet'],
        questions: [
          { id: 'sub_electro_reemplazo', text: '¿Reemplaza uno que ya no funciona, o sería un segundo/extra?', type: 'options', weight: 1.1,
            options: [{ label: 'Reemplaza uno descompuesto', score: 5 }, { label: 'Sería un extra', score: 2 }] },
          { id: 'sub_electro_familia', text: '¿Todos en casa lo van a usar, o es solo para ti?', type: 'options', weight: 0.9,
            options: [{ label: 'Todos en casa', score: 5 }, { label: 'Solo yo', score: 3 }] },
          { id: 'sub_electro_temporada', text: '¿Ya esperaste a alguna temporada de descuentos (Buen Fin, Hot Sale)?', type: 'options', weight: 0.8,
            options: [{ label: 'Sí, aproveché descuento', score: 5 }, { label: 'No, precio normal', score: 3 }] }
        ] }
    ],

    pareja: [
      { keywords: ['regalo', 'detalle', 'sorpresa'],
        questions: [
          { id: 'sub_regalo_fecha', text: '¿Hay una fecha especial detrás (cumpleaños, aniversario), o es sin motivo?', type: 'options', weight: 1,
            options: [{ label: 'Hay fecha especial', score: 5 }, { label: 'Es sin motivo particular', score: 3 }] },
          { id: 'sub_regalo_seguro', text: '¿Sabes que de verdad le va a gustar, o es más una apuesta?', type: 'options', weight: 1,
            options: [{ label: 'Sé que le va a encantar', score: 5 }, { label: 'Es más una apuesta, no estoy seguro', score: 2 }] },
          { id: 'sub_regalo_presupuestado', text: '¿Ya tenías contemplado este gasto en tu presupuesto del mes?', type: 'options', weight: 1.1,
            options: [{ label: 'Sí, ya lo tenía pensado', score: 5 }, { label: 'No, es un gasto extra', score: 2 }] }
        ] },
      { keywords: ['cena', 'date', 'salida romantica', 'restaurante pareja'],
        questions: [
          { id: 'sub_cena_ocasion', text: '¿Es una ocasión especial o una cita más de rutina?', type: 'options', weight: 0.9,
            options: [{ label: 'Ocasión especial', score: 4 }, { label: 'Rutina normal', score: 3 }] },
          { id: 'sub_cena_precio', text: '¿Ya revisaste el menú/precio antes de ir, o vas a ciegas?', type: 'options', weight: 1,
            options: [{ label: 'Ya revisé precios', score: 5 }, { label: 'Voy sin saber cuánto va a costar', score: 2 }] },
          { id: 'sub_cena_repetido', text: '¿Este gasto se suma a otras salidas que ya tuvieron esta semana?', type: 'options', weight: 1,
            options: [{ label: 'Es la única salida así en la semana', score: 5 }, { label: 'Ya van varias esta semana', score: 2 }] }
        ] },
      { keywords: ['flores', 'chocolates pareja', 'peluche', 'tarjeta'],
        questions: [
          { id: 'sub_detalle_espontaneo', text: '¿Es un gesto espontáneo, o sientes que "tienes que" hacerlo?', type: 'options', weight: 1,
            options: [{ label: 'Es espontáneo, nace de mí', score: 5 }, { label: 'Siento que tengo que hacerlo', score: 2 }] },
          { id: 'sub_detalle_proporcion', text: '¿El monto es parecido a lo que sueles gastar en detalles así?', type: 'options', weight: 0.9,
            options: [{ label: 'Sí, está en línea con lo normal', score: 5 }, { label: 'Es más de lo que suelo gastar', score: 3 }] },
          { id: 'sub_detalle_frecuencia', text: '¿Cuántos detalles como este le has dado en el último mes?', type: 'options', weight: 1,
            options: [{ label: 'Es el primero en un rato', score: 5 }, { label: 'Ya van varios este mes', score: 2 }] }
        ] }
    ],

    transporte: [
      { keywords: ['gasolina', 'combustible', 'gas auto'],
        questions: [
          { id: 'sub_gas_normal', text: '¿Es tu carga normal de la semana, o llenaste antes de tiempo?', type: 'options', weight: 1,
            options: [{ label: 'Es mi carga normal', score: 5 }, { label: 'Llené antes de lo normal, sin razón clara', score: 3 }] },
          { id: 'sub_gas_motivo', text: '¿Es para tu uso diario o para un viaje/plan extra?', type: 'options', weight: 0.9,
            options: [{ label: 'Es para mi uso diario', score: 5 }, { label: 'Es para un viaje o plan extra', score: 4 }] },
          { id: 'sub_gas_precio', text: '¿Comparaste precios entre gasolineras cercanas?', type: 'options', weight: 0.6,
            options: [{ label: 'Voy siempre a la misma, precio conocido', score: 4 }, { label: 'No comparé, la primera que vi', score: 3 }] }
        ] },
      { keywords: ['uber', 'taxi', 'didi', 'cabify'],
        questions: [
          { id: 'sub_uber_alternativa', text: '¿Había otra opción más barata disponible (camión, metro, caminar)?', type: 'options', weight: 1.2,
            options: [{ label: 'No, esta era la única opción razonable', score: 5 }, { label: 'Sí había otra opción más barata', score: 2 }] },
          { id: 'sub_uber_motivo', text: '¿Es por necesidad (prisa, seguridad, sin transporte) o por comodidad?', type: 'options', weight: 1,
            options: [{ label: 'Por necesidad real', score: 5 }, { label: 'Por comodidad nada más', score: 3 }] },
          { id: 'sub_uber_frecuencia', text: '¿Cuántos viajes así llevas esta semana?', type: 'options', weight: 1,
            options: [{ label: 'Es de los pocos que he pedido', score: 5 }, { label: 'Ya llevo varios esta semana', score: 2 }] }
        ] },
      { keywords: ['llantas', 'taller', 'refacciones', 'aceite auto', 'servicio auto', 'mecanico'],
        questions: [
          { id: 'sub_taller_urgente', text: '¿Es mantenimiento preventivo o ya se descompuso algo?', type: 'options', weight: 1.1,
            options: [{ label: 'Ya se descompuso, es urgente', score: 5 }, { label: 'Es preventivo, para adelantarme', score: 4 }] },
          { id: 'sub_taller_cotizo', text: '¿Ya pediste otra cotización para comparar?', type: 'options', weight: 0.9,
            options: [{ label: 'Sí, comparé precios', score: 5 }, { label: 'No, es el primer taller que vi', score: 2 }] },
          { id: 'sub_taller_seguridad', text: '¿Posponerlo pondría en riesgo tu seguridad al manejar?', type: 'options', weight: 1.2,
            options: [{ label: 'Sí, es un tema de seguridad', score: 5 }, { label: 'No, puede esperar un poco más', score: 2 }] }
        ] }
    ],

    salud: [
      { keywords: ['medicina', 'medicamento', 'pastillas', 'farmacia', 'antibiotico'],
        questions: [
          { id: 'sub_med_receta', text: '¿Te lo recetó un médico, o lo compras por tu cuenta?', type: 'options', weight: 1.3,
            options: [{ label: 'Me lo recetaron', score: 5 }, { label: 'Lo compro por mi cuenta', score: 4 }] },
          { id: 'sub_med_urgente', text: '¿Es urgente tomarlo ya, o puede esperar a comprarlo en un lugar más barato?', type: 'options', weight: 1,
            options: [{ label: 'Es urgente', score: 5 }, { label: 'Puedo esperar y comparar precio', score: 3 }] },
          { id: 'sub_med_comparaste', text: '¿Ya revisaste si tu farmacia de siempre lo tiene más barato?', type: 'options', weight: 0.7,
            options: [{ label: 'Sí, ya comparé', score: 5 }, { label: 'No, lo compré en la primera que encontré', score: 3 }] }
        ] },
      { keywords: ['doctor', 'consulta', 'dentista', 'especialista', 'hospital'],
        questions: [
          { id: 'sub_doc_motivo', text: '¿Es un chequeo preventivo, o porque algo te está molestando?', type: 'options', weight: 1.1,
            options: [{ label: 'Algo me está molestando, necesito revisión', score: 5 }, { label: 'Es preventivo, chequeo de rutina', score: 4 }] },
          { id: 'sub_doc_opciones', text: '¿Buscaste opciones (seguro, clínica pública) antes de ir a consulta privada?', type: 'options', weight: 0.9,
            options: [{ label: 'Ya revisé mis opciones, esta es la mejor', score: 5 }, { label: 'No revisé alternativas', score: 3 }] },
          { id: 'sub_doc_posponer', text: '¿Posponerlo empeoraría lo que tienes?', type: 'options', weight: 1.2,
            options: [{ label: 'Sí, podría empeorar', score: 5 }, { label: 'No, puede esperar un poco', score: 3 }] }
        ] },
      { keywords: ['gym', 'gimnasio', 'proteina', 'suplemento', 'mensualidad gym'],
        questions: [
          { id: 'sub_gym_constancia', text: '¿Ya tienes la constancia de ir seguido, o sería empezar de cero otra vez?', type: 'options', weight: 1.2,
            options: [{ label: 'Ya tengo el hábito, voy seguido', score: 5 }, { label: 'Sería retomarlo, ya van varios intentos', score: 2 }] },
          { id: 'sub_gym_comparaste', text: '¿Comparaste el costo contra otras opciones (parques, rutinas en casa)?', type: 'options', weight: 0.8,
            options: [{ label: 'Sí, y esta sigue siendo mi mejor opción', score: 4 }, { label: 'No comparé', score: 3 }] },
          { id: 'sub_gym_sostenible', text: '¿Es un gasto que vas a poder sostener los próximos meses?', type: 'options', weight: 1.1,
            options: [{ label: 'Sí, cabe cómodo en mi presupuesto', score: 5 }, { label: 'No estoy seguro de poder sostenerlo', score: 2 }] }
        ] },
      { keywords: ['pasta de dientes', 'pasta dental', 'shampoo', 'jabon', 'desodorante', 'rastrillo', 'crema dental'],
        questions: [
          { id: 'sub_higiene_acababa', text: '¿Es de tus productos de uso diario que ya se te estaba acabando?', type: 'options', weight: 1,
            options: [{ label: 'Sí, ya se me estaba acabando', score: 5 }, { label: 'No, todavía tenía, quise probar otro', score: 3 }] },
          { id: 'sub_higiene_marca', text: '¿Es la marca de siempre, o estás probando algo nuevo?', type: 'options', weight: 0.7,
            options: [{ label: 'Es lo de siempre, ya sé que me funciona', score: 5 }, { label: 'Es nuevo, a ver qué tal', score: 3 }] },
          { id: 'sub_higiene_precio', text: '¿El precio es parecido a lo que siempre pagas por esto?', type: 'options', weight: 0.8,
            options: [{ label: 'Sí, precio normal', score: 5 }, { label: 'Es más caro de lo usual', score: 2 }] }
        ] }
    ],

    hogar: [
      { keywords: ['mueble', 'sillon', 'mesa', 'cama', 'silla', 'escritorio', 'ropero'],
        questions: [
          { id: 'sub_mueble_reemplazo', text: '¿Reemplaza uno roto/muy gastado, o es una pieza nueva que quieres sumar?', type: 'options', weight: 1.1,
            options: [{ label: 'Reemplaza uno que ya no sirve', score: 5 }, { label: 'Es una pieza nueva, no reemplaza nada', score: 3 }] },
          { id: 'sub_mueble_espacio', text: '¿Ya mediste el espacio para asegurarte que cabe bien?', type: 'options', weight: 0.9,
            options: [{ label: 'Sí, ya medí', score: 5 }, { label: 'No he medido todavía', score: 2 }] },
          { id: 'sub_mueble_uso', text: '¿Es algo que vas a usar a diario en casa?', type: 'options', weight: 0.9,
            options: [{ label: 'Sí, uso diario', score: 5 }, { label: 'Uso ocasional', score: 3 }] }
        ] },
      { keywords: ['refrigerador', 'lavadora', 'microondas', 'licuadora', 'estufa', 'horno'],
        questions: [
          { id: 'sub_electroHogar_descompuesto', text: '¿El que tienes ya se descompuso, o sigue funcionando?', type: 'options', weight: 1.2,
            options: [{ label: 'Ya se descompuso, es necesario', score: 5 }, { label: 'Sigue funcionando, quiero uno mejor', score: 2 }] },
          { id: 'sub_electroHogar_comparaste', text: '¿Comparaste precios y marcas antes de decidir?', type: 'options', weight: 0.9,
            options: [{ label: 'Sí, comparé bien', score: 5 }, { label: 'No, elegí el primero que vi', score: 2 }] },
          { id: 'sub_electroHogar_familia', text: '¿Todos en casa se benefician de esto, o es solo para ti?', type: 'options', weight: 0.9,
            options: [{ label: 'Todos en casa', score: 5 }, { label: 'Solo para mí', score: 3 }] }
        ] },
      { keywords: ['decoracion', 'cuadro', 'planta', 'cortina', 'tapete', 'adorno'],
        questions: [
          { id: 'sub_decor_lugar', text: '¿Ya sabes exactamente dónde va a quedar, o lo compraste sin plan?', type: 'options', weight: 0.9,
            options: [{ label: 'Ya sé exactamente dónde va', score: 5 }, { label: 'Lo compré sin tener claro dónde', score: 2 }] },
          { id: 'sub_decor_durable', text: '¿Es algo que te va a durar años, o es más de temporada/moda?', type: 'options', weight: 0.8,
            options: [{ label: 'Es durable, le va a dar años', score: 5 }, { label: 'Es más de temporada/moda', score: 3 }] },
          { id: 'sub_decor_combina', text: '¿Combina con lo que ya tienes en casa?', type: 'options', weight: 0.8,
            options: [{ label: 'Sí, combina bien', score: 5 }, { label: 'No estoy seguro', score: 2 }] }
        ] },
      { keywords: ['limpieza', 'detergente', 'papel higienico', 'jabon trastes', 'cloro', 'suavizante'],
        questions: [
          { id: 'sub_limpieza_acababa', text: '¿Ya se te estaba acabando, o compraste por si acaso?', type: 'options', weight: 1,
            options: [{ label: 'Ya se estaba acabando', score: 5 }, { label: 'Fue por si acaso, todavía tenía', score: 3 }] },
          { id: 'sub_limpieza_oferta', text: '¿Aprovechaste alguna oferta o paquete más grande que sale más barato?', type: 'options', weight: 0.7,
            options: [{ label: 'Sí, aproveché oferta/paquete', score: 5 }, { label: 'No, precio normal', score: 3 }] },
          { id: 'sub_limpieza_marca', text: '¿Es de tu marca de siempre?', type: 'options', weight: 0.6,
            options: [{ label: 'Sí, la de siempre', score: 5 }, { label: 'Probé una nueva', score: 3 }] }
        ] }
    ]
  };

  /* ----------------------------------------------------------------
     4) PREGUNTAS PROFUNDAS — solo para compras grandes
     ---------------------------------------------------------------- */
  const DEEP_QUESTIONS = [
    { id: 'deep_comparaste', text: 'Para algo de este tamaño, ¿ya comparaste precios u opciones antes de decidirte?', type: 'options', weight: 1.1,
      options: [{ label: 'Sí, comparé bien mis opciones', score: 5 }, { label: 'Comparé un poco, no a fondo', score: 3 }, { label: 'No, es la primera opción que vi', score: 1 }] },
    { id: 'deep_explicarias', text: 'Si tuvieras que explicarle a alguien de confianza por qué vas a hacer este gasto, ¿qué tan convincente te sentirías?', type: 'options', weight: 1.2,
      options: [{ label: 'Muy convincente, tiene toda la lógica', score: 5 }, { label: 'Más o menos, tendría que justificarlo', score: 3 }, { label: 'La verdad no muy convincente', score: 1 }] }
  ];

  /* ----------------------------------------------------------------
     5) UMBRALES DE RESULTADO
     ---------------------------------------------------------------- */
  const RESULT_THRESHOLDS = [
    { min: 4.5, label: 'Compra muy inteligente', tone: 'excellent' },
    { min: 3.5, label: 'Buena decisión', tone: 'good' },
    { min: 2.5, label: 'Piénsalo bien antes de comprar', tone: 'warn' },
    { min: 1.5, label: 'Compra poco recomendable', tone: 'bad' },
    { min: 0, label: 'Mejor evítala si puedes', tone: 'avoid' }
  ];

  /* ----------------------------------------------------------------
     6) DETECCIÓN DE SUBTIPO — busca palabras clave en la descripción
     ---------------------------------------------------------------- */
  function detectarSubtipo(categoryId, descripcion) {
    const subtipos = SUBTYPE_QUESTIONS[categoryId];
    if (!subtipos || !descripcion) return null;
    const texto = normalizar(descripcion);
    for (let i = 0; i < subtipos.length; i++) {
      const st = subtipos[i];
      for (let j = 0; j < st.keywords.length; j++) {
        if (texto.indexOf(st.keywords[j]) !== -1) return st;
      }
    }
    return null;
  }

  /* ----------------------------------------------------------------
     7) TAMAÑO DE LA COMPRA — relativo a TU saldo, define cuántas
     preguntas se hacen.
     ---------------------------------------------------------------- */
  function nivelCompra(monto, saldoActual) {
    if (monto == null) return 'mediana';
    if (!saldoActual || saldoActual <= 0) return 'grande';
    const pct = monto / saldoActual;
    if (pct < 0.05) return 'chica';
    if (pct < 0.20) return 'mediana';
    return 'grande';
  }

  /* ----------------------------------------------------------------
     8) FACTORES AUTOMÁTICOS
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

  function evaluateImpactoPresupuesto(presupuestoUsado, presupuestoMeta, monto) {
    if (presupuestoMeta == null || presupuestoMeta <= 0 || monto == null) return null;
    const usadoConEsta = (presupuestoUsado || 0) + monto;
    const pct = usadoConEsta / presupuestoMeta;
    let score, nivel;
    if (pct > 1.15) { score = 1; nivel = 'muy_excedido'; }
    else if (pct > 1) { score = 1.5; nivel = 'excedido'; }
    else if (pct > 0.9) { score = 2.5; nivel = 'al_limite'; }
    else if (pct > 0.7) { score = 3.5; nivel = 'moderado'; }
    else { score = 5; nivel = 'comodo'; }
    return { score: score, nivel: nivel, usadoConEsta: usadoConEsta, meta: presupuestoMeta, weight: 1.25 };
  }

  function evaluateDeudasProximas(deudasProximasTotalMonto, saldoActual, monto) {
    if (!deudasProximasTotalMonto || deudasProximasTotalMonto <= 0) return null;
    if (saldoActual == null || monto == null) return null;
    const disponibleDespues = saldoActual - monto;
    let score, nivel;
    if (disponibleDespues < deudasProximasTotalMonto) {
      score = 1; nivel = 'compromete_pago';
    } else {
      const colchon = disponibleDespues - deudasProximasTotalMonto;
      const pctColchon = saldoActual > 0 ? colchon / saldoActual : 0;
      if (pctColchon < 0.10) { score = 2.5; nivel = 'justo'; }
      else { score = 4.5; nivel = 'cubierto'; }
    }
    return { score: score, nivel: nivel, deudasProximasTotal: deudasProximasTotalMonto, weight: 1.2 };
  }

  function evaluateArrepentimiento(arrepentimiento) {
    if (!arrepentimiento || arrepentimiento.total < 3) return null;
    const pct = arrepentimiento.pct;
    let score, nivel;
    if (pct >= 0.5) { score = 1.5; nivel = 'alto'; }
    else if (pct >= 0.3) { score = 3; nivel = 'moderado'; }
    else { score = 5; nivel = 'bajo'; }
    return { score: score, nivel: nivel, pct: pct, total: arrepentimiento.total, weight: 1 };
  }

  /* ----------------------------------------------------------------
     9) FUNCIONES PÚBLICAS
     ---------------------------------------------------------------- */
  function getQuestions(categoryId, context) {
    const subtipo = context && context.descripcion ? detectarSubtipo(categoryId, context.descripcion) : null;
    const specific = subtipo ? subtipo.questions : (CATEGORY_QUESTIONS[categoryId] || CATEGORY_QUESTIONS.otros);
    const nivel = (context && context.monto != null) ? nivelCompra(context.monto, context.saldoActual) : 'mediana';

    if (nivel === 'chica') return [BASE_QUESTIONS[0], specific[0]];
    if (nivel === 'grande') return BASE_QUESTIONS.concat(specific).concat(DEEP_QUESTIONS);
    return BASE_QUESTIONS.concat(specific);
  }

  function evaluate(categoryId, answers, context) {
    context = context || {};
    const questions = getQuestions(categoryId, context);
    const breakdown = [];
    let weightedSum = 0;
    let weightTotal = 0;

    questions.forEach(function (q) {
      const score = answers[q.id];
      if (score == null) return;
      const w = q.weight || 1;
      weightedSum += score * w;
      weightTotal += w;
      let respuesta = null;
      if (q.type === 'stars') {
        respuesta = score.toFixed(1) + '★';
      } else if (q.type === 'options') {
        const opt = q.options.find(function (o) { return o.score === score; });
        respuesta = opt ? opt.label : null;
      }
      breakdown.push({ id: q.id, text: q.text, score: score, weight: w, respuesta: respuesta });
    });

    const factores = {};

    if (context.saldoActual != null && context.monto != null) {
      const f = evaluateImpactoSaldo(context.saldoActual, context.monto);
      if (f) { weightedSum += f.score * f.weight; weightTotal += f.weight; breakdown.push({ id: '_impacto_saldo', text: 'Qué tanto te aprieta este gasto con el saldo que tienes ahora', score: f.score, weight: f.weight, respuesta: 'Tu saldo quedaría en un nivel ' + f.nivel.replace(/_/g, ' ') }); factores.impactoSaldo = f; }
    }
    if (context.presupuestoMeta != null && context.monto != null) {
      const f = evaluateImpactoPresupuesto(context.presupuestoUsado, context.presupuestoMeta, context.monto);
      if (f) { weightedSum += f.score * f.weight; weightTotal += f.weight; breakdown.push({ id: '_impacto_presupuesto', text: 'Qué tanto compromete tu presupuesto del mes en esta categoría', score: f.score, weight: f.weight, respuesta: 'Tu presupuesto del mes queda ' + f.nivel.replace(/_/g, ' ') }); factores.impactoPresupuesto = f; }
    }
    if (context.deudasProximasTotal != null) {
      const f = evaluateDeudasProximas(context.deudasProximasTotal, context.saldoActual, context.monto);
      if (f) { weightedSum += f.score * f.weight; weightTotal += f.weight; breakdown.push({ id: '_deudas_proximas', text: 'Si comprarlo compromete pagar tus deudas próximas a vencer', score: f.score, weight: f.weight, respuesta: f.nivel === 'compromete_pago' ? 'Sí lo compromete' : 'No lo compromete' }); factores.deudasProximas = f; }
    }
    if (context.arrepentimiento) {
      const f = evaluateArrepentimiento(context.arrepentimiento);
      if (f) { weightedSum += f.score * f.weight; weightTotal += f.weight; breakdown.push({ id: '_arrepentimiento', text: 'Tu historial real con compras de esta categoría', score: f.score, weight: f.weight, respuesta: Math.round(f.pct * 100) + '% de arrepentimiento en ' + f.total + ' compras' }); factores.arrepentimiento = f; }
    }

    if (weightTotal === 0) return null;

    const rawAvg = weightedSum / weightTotal;
    const score = Math.round(rawAvg * 10) / 10;
    const result = RESULT_THRESHOLDS.find(function (t) { return score >= t.min; }) || RESULT_THRESHOLDS[RESULT_THRESHOLDS.length - 1];

    return {
      score: score,
      label: result.label,
      tone: result.tone,
      breakdown: breakdown,
      factores: factores,
      impactoSaldo: factores.impactoSaldo || null
    };
  }

  const PurchaseEvaluator = {
    BASE_QUESTIONS: BASE_QUESTIONS,
    CATEGORY_QUESTIONS: CATEGORY_QUESTIONS,
    SUBTYPE_QUESTIONS: SUBTYPE_QUESTIONS,
    DEEP_QUESTIONS: DEEP_QUESTIONS,
    RESULT_THRESHOLDS: RESULT_THRESHOLDS,
    getQuestions: getQuestions,
    evaluate: evaluate,
    detectarSubtipo: detectarSubtipo,
    nivelCompra: nivelCompra,
    evaluateImpactoSaldo: evaluateImpactoSaldo,
    evaluateImpactoPresupuesto: evaluateImpactoPresupuesto,
    evaluateDeudasProximas: evaluateDeudasProximas,
    evaluateArrepentimiento: evaluateArrepentimiento
  };

  root.PurchaseEvaluator = PurchaseEvaluator;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PurchaseEvaluator;
  }

})(typeof window !== 'undefined' ? window : globalThis);
