const shared = {
  widthMM: ['width', 'Mide el diseño de izquierda a derecha. La altura se adapta al cambiar el ancho para mantener las proporciones.'],
  procColors: ['color', 'Limita la cantidad de colores de la imagen al vectorizarla. Activa Auto para conservar los colores detectados.'],
  procColorsAuto: ['color', 'Usa la cantidad de colores detectada en la imagen. Desactívalo para elegir tú cuántos separar.'],
  procDetail: ['image', 'Controla el detalle que conserva el contorno. Compara las curvas y los rasgos pequeños en la vista previa tras aplicar la vectorización.'],
  procSmooth: ['edge', 'Redondea los quiebres pequeños del contorno. Un suavizado alto reduce puntas y escalones de la imagen.'],
  procMinArea: ['image', 'Descarta motas y regiones de pocos píxeles. Al subirlo pueden desaparecer detalles pequeños del logo.'],
  procBg: ['image', 'Decide si el fondo forma parte del diseño. Quitar fondo deja la figura que se vectoriza y se convierte en pieza.'],
  procTol: ['image', 'Define cuánto se pueden parecer otros colores al fondo para quitarlos. Sube el ajuste si queda un halo del fondo.'],
  procRes: ['image', 'Cambia el tamaño en píxeles usado para vectorizar. Una resolución mayor conserva más detalles y tarda más en procesar.'],
  'kc.finish': ['finish', 'Plano deja la cara de color al ras de la base. Editable permite dar una altura distinta a cada zona del diseño.'],
  'base.shape': ['shape', 'Cambia el contorno de la base. Silueta sigue el diseño. Las demás formas crean una placa con su propio ancho y alto.'],
  'base.margin': ['margin', 'Añade material alrededor del contorno del diseño. Sube el valor para que el borde de la base sobresalga más.'],
  'base.thickness': ['thickness', 'Es el espesor de la base debajo del diseño, medido en el canto.'],
  'base.weld': ['fit', 'Conecta en la base las letras o elementos vecinos que quedarían como piezas separadas.'],
  'ring.style': ['shape', 'La argolla redonda recibe un anillo. La ranura alargada deja pasar una cinta o cordón plano.'],
  'ring.pos': ['move', 'Elige en qué borde se coloca la argolla. En Manual puedes fijarla directamente arrastrando sobre el diseño.'],
  'ring.outer': ['diameter', 'Mide el tamaño exterior de la argolla. Si dejas fijo el agujero, aumentarlo engrosa la pared alrededor.'],
  'ring.inner': ['diameter', 'Mide el paso libre para el anillo. Con el mismo diámetro exterior, un agujero más grande deja menos pared.'],
  'ring.snap': ['fit', 'Mantiene la unión de la argolla sobre el borde de la pieza al ubicarla.'],
  'nfc.depth': ['depth', 'Es el espesor previsto para el chip o el bolsillo que lo aloja. Debe dejar espacio para el chip dentro del cuerpo.'],
  'pencil.value': ['diameter', 'Ajusta la abertura por donde entra el lápiz o pitillo. Comprueba la medida del objeto real.'],
  'magnets.depth': ['depth', 'Determina cuánto entra el imán en su bolsillo, desde la abertura trasera hasta el fondo.'],
  'magnets.spacing': ['spacing', 'Mueve los centros de los imanes entre sí. Sube el valor para alejarlos uno del otro.'],
  'holes.inset': ['margin', 'Distancia desde el borde de la pieza hacia el centro de sus agujeros de montaje.'],
  'sticks.length': ['height', 'Longitud del palito que queda por debajo del diseño para clavarlo en la torta.'],
  'cutter.wall': ['thickness', 'Espesor de la pared que entra en la masa. La pestaña superior tiene su propio grosor.'],
  'cutter.offset': ['margin', 'Desplaza el filo respecto al contorno del diseño para agrandar o reducir la forma que se corta.'],
  'logo.mode': ['finish', 'Relieve sobresale de la cara. Liso incrusta los colores al ras. Grabado hunde la imagen en el material.'],
  'logo.dx': ['move', 'Un valor positivo mueve el logo a la derecha. Uno negativo lo mueve a la izquierda.'],
  'logo.dy': ['move', 'Un valor positivo mueve el logo hacia arriba. Uno negativo lo mueve hacia abajo.'],
  'text.dx': ['move', 'Un valor positivo mueve el texto a la derecha. Uno negativo lo mueve a la izquierda.'],
  'text.dy': ['move', 'Un valor positivo mueve el texto hacia arriba. Uno negativo lo mueve hacia abajo.'],
};

const byModule = {
  nameTree: {
    maxHeight: ['height', 'Límite vertical desde abajo del tronco hasta la punta del remate. El árbol puede quedar más bajo para respetar el ancho.'],
    maxWidth: ['width', 'Límite de lado a lado de la pieza más ancha del árbol. Las letras mantienen su proporción.'],
    bottomDepth: ['thickness', 'Grosor del árbol a la altura del tronco. Un apoyo más profundo le da más estabilidad hacia delante y hacia atrás.'],
    topDepth: ['thickness', 'Grosor en la punta del remate. Pon el mismo valor que abajo para un canto recto o uno menor para afinarlo.'],
    bedFace: ['finish', 'La textura de la cama queda en la cara elegida. Selecciona Frente para que se vea al leer los nombres.'],
    order: ['option', 'Automático pone los nombres largos abajo. Mi listado empieza abajo con el primer nombre tal como lo escribiste.'],
    trunk: ['shape', 'Elige un bloque liso o texto en el tramo de apoyo debajo de los nombres.'],
    shape: ['shape', 'Cambia la figura que corona el árbol. La aplicación añade el encaje con la última pieza.'],
    bedWidth: ['width', 'Ancho útil de la cama de tu impresora. Se usa al acomodar las piezas en cada placa.'],
    bedHeight: ['height', 'Largo útil de la cama de tu impresora. Puede cambiar cuántas piezas caben por placa.'],
  },
  canopener: {
    preset: ['fit', 'Cambia cómo se une el llavero al anillo, hilo o cinta. Algunos enganches van dentro de la figura y otros sobresalen.'],
    notch: ['depth', 'Abre una muesca inferior en el centro de la ranura para dar acceso a la pestaña.'],
    'border.enabled': ['depth', 'Rebaja el centro y deja un marco alrededor. Si hace falta, aumenta el grosor del cuerpo para sostener la abertura.'],
    'border.depth': ['depth', 'Mide cuánto baja el centro de la figura respecto al marco exterior.'],
    'attachment.wall': ['wall', 'Mide el material que se conserva alrededor del agujero del llavero. Aumentarla refuerza el borde y ocupa más espacio.'],
  },
  clicker: {
    background: ['image', 'Controla si el fondo entra en la silueta de la tapa. Automático intenta distinguirlo de la figura.'],
    relief: ['layer', 'Distancia que sobresalen los colores sobre la cara de la tapa.'],
    stemClearance: ['fit', 'Ajusta el juego entre la cruz de la tapa y el vástago del interruptor MX. Más holgura permite meter y sacar la tapa con menos presión.'],
    mountClearance: ['fit', 'Ajusta el juego entre el cuerpo del interruptor MX y su abertura de montaje. Se suma a los 14 mm nominales.'],
  },
  keyring3mf: {
    itemIndex: ['shape', 'Elige cuál de los objetos de la placa recibe la argolla. Las demás piezas conservan su ubicación y medidas.'],
    side: ['move', 'Coloca la argolla en el lado elegido del objeto en la vista superior.'],
  },
  phonestand: {
    size: ['scale', 'Adapta el soporte al grosor del celular con forro. La opción grande también alarga la pata de apoyo.'],
    variant: ['shape', 'El modelo Estándar incluye una barra detrás de la bisagra. El Corto ocupa menos espacio y funciona mejor con el celular acostado.'],
    amt: ['angle', 'Gira la pata en la vista previa, desde cerrada hasta abierta sobre el tope.'],
  },
  colorsplit: {
    mode: ['finish', 'Define cómo se separan los colores. Tallado conserva las medidas exteriores. Las capas y envolventes añaden material sobre el original.'],
    explode: ['spacing', 'Separa visualmente las piezas para ver cómo se ensamblan. El ajuste es solo para la vista.'],
  },
  coloring: {
    mode: ['image', 'Ilustración busca líneas limpias sin sombras. Zonas de color genera contornos en los límites entre regiones de la imagen.'],
    dpi: ['image', 'Píxeles por pulgada del PNG. 300 ppp genera más píxeles para el mismo tamaño físico que 150 ppp.'],
    paper: ['width', 'Define el formato físico de la hoja al exportar. Personalizado permite indicar el tamaño de tu papel.'],
    brush: ['diameter', 'Cambia el diámetro del trazo de la goma o el lápiz sobre el papel.'],
  },
  laser: {
    width: ['width', 'Mide el material de lado a lado en la vista superior. El ancho útil se reduce por el margen de la lámina.'],
    height: ['height', 'Mide la lámina de arriba abajo en la vista superior. El margen también se descuenta de esta medida.'],
    gap: ['spacing', 'Distancia libre mínima entre dos contornos. Auméntala para dejar más material entre piezas.'],
    angleStep: ['angle', 'Define qué orientaciones se prueban al distribuir. Pasos menores dan más opciones de giro y aumentan el trabajo de búsqueda.'],
    mode: ['quantity', 'Llenar busca aprovechar el área de una lámina. Cantidades exactas intenta acomodar lo que indicas para cada diseño.'],
  },
  hablador: {
    source: ['image', 'Paramétrico construye el frente con las medidas del formulario. Desde mockup toma el frente de la imagen que cargues.'],
    clearance: ['fit', 'Se suma al calibre de la lámina para calcular el ancho de la ranura. Un valor negativo aprieta el encaje.'],
    'sheet.gap': ['spacing', 'Distancia entre contornos al acomodar las piezas cortadas en la lámina.'],
  },
  tiktok: {
    python: ['option', 'Indica qué instalación de Python ejecutará las herramientas de voz, montaje y revisión.'],
    objetivo: ['chart', 'Elige la acción que esperas de quien ve el video. El plan usa esta elección para proponer el cierre.'],
    formula: ['option', 'Elige una estructura para los primeros segundos del guion. Cambia cómo se presenta la idea al empezar el video.'],
    ocasion: ['calendar', 'Define la ocasión o el público al que va dirigido el video.'],
    fechaPlan: ['calendar', 'Programa el día y la hora que aparecerán en el plan de publicaciones.'],
    horas_desde_publicacion: ['time', 'Marca cuánto tiempo ha pasado desde que publicaste al registrar las métricas.'],
    tiempo_medio_s: ['time', 'Promedio de segundos que las personas vieron del video, según las estadísticas de TikTok.'],
    vio_completo_pct: ['percent', 'Porcentaje de reproducciones en las que se vio el video hasta el final.'],
  },
  inbox: {
    notify: ['toggle', 'Muestra un aviso de Windows cuando llega un mensaje y Relieve3D está en segundo plano.'],
    tags: ['option', 'Separa las etiquetas con comas para clasificar la conversación y recuperarla más rápido.'],
    note: ['text', 'Guarda contexto privado para tu equipo dentro de la conversación.'],
  },
  quote: {
    'print.mode': ['quantity', 'Indica si el tiempo y los gramos del laminador son por unidad o por una placa completa. El cálculo se escala desde esa base.'],
    'print.minutes': ['time', 'Usa los minutos de impresión que indica el laminador para una unidad o para la placa, según la base que elegiste.'],
    'materials.#.grams': ['weight', 'Gramos de filamento que indica el laminador para la unidad o placa seleccionada. Se convierten a costo con el precio por kilo.'],
    'materials.#.kgCost': ['money', 'Precio de un kilo de filamento. En la cotización puedes dejar el campo vacío para usar el precio de catálogo.'],
    'printers.#.hourlyRate': ['money', 'Costo por cada hora de máquina. La tarifa se aplica al tiempo de impresión utilizado por la cotización.'],
    'printers.#.kw': ['layer', 'Potencia promedio durante la impresión. Las horas de máquina y esta potencia determinan el consumo eléctrico en kWh.'],
    quantity: ['quantity', 'Piezas solicitadas por el cliente. El cálculo reparte los costos de placa o de pedido entre esa cantidad.'],
    effectiveAt: ['calendar', 'Fecha a partir de la cual se usa esta versión de costos para cotizaciones nuevas.'],
    markup: ['percent', 'Aumento aplicado sobre el costo. Un costo de 10.000 COP con un markup de 30 % da 13.000 COP antes de impuestos y comisiones.'],
    minimumMargin: ['percent', 'Porcentaje mínimo del precio de venta sin IVA que debe quedar después de cubrir costos y comisiones.'],
    purgePercent: ['percent', 'Reserva de material para purgas. Se suma a los gramos de filamento cuando no vienen incluidos en el peso del laminador.'],
    supportPercent: ['percent', 'Reserva de material para soportes. Se aplica si los gramos de entrada todavía dejan fuera los soportes.'],
    wastePercent: ['percent', 'Reserva independiente para la pérdida de material durante el proceso.'],
    roundTo: ['money', 'Escalón al que se redondea el precio hacia arriba. Con un escalón de 100 COP, 12.350 sube a 12.400 COP.'],
    vatPercent: ['percent', 'Porcentaje de IVA que se calcula sobre la base imponible de la cotización.'],
    feePercent: ['percent', 'Comisión variable que se cobra por el medio de pago. Se calcula sobre el monto definido en esta sección.'],
  },
};

const rules = [
  [/tiempo|horas?|minutos?|duracion|segundos?/, 'time', 'Tiempo que se usa en esta etapa del cálculo o del proceso.'],
  [/fecha|vigente|publicacion programada/, 'calendar', 'Fecha que se usa para ordenar o programar este registro.'],
  [/radio|redondeo/, 'radius', 'El radio se mide desde el centro de la curva hasta el borde. Un radio mayor suaviza más la esquina.'],
  [/bisel|chaflan|canto|suavizado/, 'edge', 'Cambia el perfil del canto en la zona marcada.'],
  [/holgura|encaje|ajuste de union|tolerancia del montaje/, 'fit', 'Controla cuánto espacio queda entre las piezas al encajarlas. Más juego reduce la presión al montar.'],
  [/pared/, 'wall', 'Mide la cantidad de material entre la abertura y el borde de la pieza.'],
  [/diametro|agujero \(mm\)/, 'diameter', 'Mide el círculo de un extremo al otro pasando por su centro.'],
  [/margen|distancia al borde|borde alrededor/, 'margin', 'Mide la franja entre el contorno interior y el borde exterior.'],
  [/separacion|espaciado/, 'spacing', 'Aumenta el espacio entre los elementos indicados.'],
  [/giro|rotacion|angulo|inclinacion|pendiente/, 'angle', 'Controla la inclinación o el giro respecto a la posición inicial.'],
  [/mover|desplaz|ubicacion|posicion|^donde$|^lado$|^[xy] \(/, 'move', 'Cambia la ubicación del elemento respecto a la pieza o al área de trabajo.'],
  [/acabado|relieve.*grabado/, 'finish', 'Define el acabado de la cara. En el esquema se destaca la parte de la superficie que cambia.'],
  [/profundidad|fondo \(mm/, 'depth', 'Mide cuánto se extiende hacia dentro o hacia el fondo, desde la superficie indicada.'],
  [/grosor|calibre|espesor|pasadas? de capa/, 'thickness', 'Mide de una cara de la pieza a la otra, como se ve de canto.'],
  [/relieve|trazo|capas?\b/, 'layer', 'Ajusta las capas o el relieve del elemento indicado en esta sección.'],
  [/ancho|largo|longitud/, 'width', 'Mide el elemento entre sus dos extremos en la dirección indicada.'],
  [/alto|altura/, 'height', 'Mide desde el extremo inferior al superior del elemento indicado.'],
  [/forma|silueta/, 'shape', 'Cambia el contorno del elemento que se configura en esta sección.'],
  [/filamento|color|paleta/, 'color', 'Controla los colores del elemento o cómo se separan para producirlo.'],
  [/fondo|imagen|resolucion|limpiar|contraste|umbral|detalle/, 'image', 'Modifica lo que se conserva al procesar la imagen. Compáralo en la vista previa.'],
  [/cantidad|unidades|copias|puntas/, 'quantity', 'Número de unidades o repeticiones que se incluyen.'],
  [/peso|gramos|\(g\)/, 'weight', 'Peso de material que se utiliza en este cálculo.'],
  [/precio|costo|venta|tarifa|valor|\bcop\b/, 'money', 'Importe que se utiliza en esta parte del cálculo.'],
  [/%|porcentaje|comision|descuento/, 'percent', 'Porcentaje aplicado al valor de referencia de esta sección.'],
  [/tamano|escala/, 'scale', 'Cambia el tamaño del elemento en la vista o sobre la pieza.'],
  [/vistas|trafico|guarda(dos|r)|comentarios|seguidores/, 'chart', 'Dato que se registra para comparar el rendimiento.'],
  [/fuente|letra|texto/, 'text', 'Controla el contenido o el aspecto del texto que corresponde a esta sección.'],
];

const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function settingHelp(label, field, caption) {
  const data = field.dataset;
  const moduleId = label.closest('.studio, .quote, .laser, .tk, .ib')?.id;
  const key = data.k || data.set || data.opt || data.config || data.cfg || data.r || data.m || data.draft || data.role || data.field || data.s || data.q || data.t || field.id || field.name || '';
  const specific = byModule[moduleId]?.[key.replace(/\.\d+\./g, '.#.')] || shared[key];
  const fallback = rules.find(([match]) => match.test(fold(caption)));
  const help = label.title.trim() || label.querySelector(':scope > small')?.textContent.trim() || '';
  if (specific) return { kind: specific[0], help: specific[1], note: help && help !== specific[1] ? help : '' };
  if (field.type === 'checkbox') return { kind: 'toggle', help };
  if (field.type === 'color') return { kind: 'color', help: help || 'Cambia el color que se asigna a este elemento en la vista o al exportar.' };
  if (field.type === 'file') return { kind: 'image', help: help || 'Elige un archivo del tipo que indica este campo.' };
  if (fallback) return { kind: fallback[1], help: help || fallback[2] };
  return {
    kind: field.tagName === 'SELECT' ? 'option' : field.type.includes('date') ? 'calendar' : 'text',
    help: help || field.placeholder,
  };
}
