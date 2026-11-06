// Semillas de la Biblioteca del Estudio TikTok: contenido base que SIEMPRE está disponible
// (aunque biblioteca/*.json no exista). Lo que el usuario edita u oculta se guarda en biblioteca/<colección>.json.
// Marcadores (se rellenan al usarlos con el catálogo y el perfil reales; nunca escribas precios aquí):
//   {producto} {Producto} {corto} {el_producto} {El_producto} {lo} {Lo} {PRODUCTO} {precio} {PRECIO}
//   {para} {guardar} {compartir} {dm} {cta} {CTA} {ciudad} {marca} {web} {cotizar} {generador} {whatsapp} {catalogo} {tema} {TEMA}
import { GUIONES } from './tiktok_semillas_guiones.js';

const gan = (n, texto, pantalla, fotograma, formula, pilar, ocasion = 'general', tags = [], nota = '') =>
  ({ id: `gan-b${String(n).padStart(2, '0')}`, texto, pantalla, fotograma, formula, pilar, ocasion, tags, nota, fuente: 'semilla' });

export const GANCHOS = [
  gan(1, 'Comenta tu nombre y te lo hago en 3D.', 'COMENTA TU NOMBRE', 'Tú con un llavero con nombre en la mano, mirando a cámara', 'T1', 'historia', 'general', ['serie']),
  gan(2, 'Esto salió así de la impresora: {producto}.', '{PRODUCTO}', '{El_producto} terminado en tu mano, a 20 cm del lente', 'T1', 'mira-como'),
  gan(3, 'Escucha esto.', 'SUBE EL VOLUMEN', 'Macro de la boquilla imprimiendo, con el sonido de los motores', 'T2', 'mira-como', 'general', ['asmr']),
  gan(4, '{Producto} por {precio}.', '{PRODUCTO} {PRECIO}', '{El_producto} terminado junto al precio escrito a mano', 'T3', 'util'),
  gan(5, '¿Adivinas qué es antes de que termine?', '¿QUÉ ES?', 'Timelapse a media impresión, sin pistas de lo que es', 'T4', 'mira-como'),
  gan(6, 'Nadie adivina qué sale de aquí.', 'NADIE ADIVINA', 'Timelapse de las primeras capas, sin pistas', 'T4', 'mira-como'),
  gan(7, '¿Te tocó amigo secreto y no sabes qué regalar?', 'AMIGO SECRETO RESUELTO', 'Tú mirando a cámara con {el_producto} en la mano', 'T5', 'util', 'amigo-secreto', ['navidad']),
  gan(8, 'Deja de regalar lo mismo de siempre.', 'REGALA ALGO CON NOMBRE', 'Tú con {el_producto} en la mano, señalándolo', 'T6', 'util'),
  gan(9, 'Me escribieron por TikTok pidiendo {producto}… y esto pasó.', 'UN PEDIDO REAL', 'Tú en el taller con la impresora trabajando detrás', 'T8', 'historia', 'general', [], 'Solo con un pedido que pasó de verdad.'),
  gan(10, 'Así diseño {producto} en un minuto.', 'EN 1 MINUTO', 'Pantalla de Relieve3D o Bambu Studio con el diseño a medio hacer', 'T9', 'ensena'),
  gan(11, 'Guarda esto para {para}.', 'GUÁRDALO', '{El_producto} terminado sobre la mesa, con luz cálida', 'T5', 'util'),
  gan(12, 'Si sigues sin regalo para {para}, esto es para ti.', '¿SIGUES SIN REGALO?', 'Tú señalando {el_producto} en la mesa', 'T5', 'util', 'general', ['navidad']),
  gan(13, 'Tres regalos con nombre que puedes pedir hoy.', '3 REGALOS CON NOMBRE', 'Los 3 productos en la mesa, con tus manos', 'T7', 'util', 'general', ['lista']),
  gan(14, 'Lo que nadie te dice de los regalos personalizados.', 'LO QUE NADIE TE DICE', 'Tú a cámara con un diseño en la pantalla detrás', 'T6', 'ensena'),
  gan(15, 'Este es el regalo que nadie espera… y todos guardan.', 'EL QUE TODOS GUARDAN', '{El_producto} en una cajita abierta', 'T6', 'util'),
  gan(16, 'El regalo más pedido de esta semana en el taller.', 'LO MÁS PEDIDO', 'Varios pedidos listos sobre la mesa del taller', 'T8', 'historia', 'general', [], 'Úsalo solo si de verdad es lo más pedido.'),
  gan(17, 'POV: llegas a la novena con un detalle para cada uno.', 'DETALLES PARA LA NOVENA', 'Una bandeja con varios llaveros con nombre', 'T5', 'util', 'novena', ['navidad']),
  gan(18, 'POV: tu amigo secreto abre esto.', 'AMIGO SECRETO', 'Manos abriendo una cajita con {el_producto}', 'T5', 'util', 'amigo-secreto', ['navidad']),
  gan(19, 'Así se ve un regalo que la profe sí va a usar.', 'PARA LA PROFE', '{El_producto} con el nombre de la profe en un escritorio', 'T6', 'util', 'profe'),
  gan(20, 'Tu nombre, capa por capa.', 'TU NOMBRE EN 3D', 'Timelapse de un nombre creciendo en la placa', 'T1', 'mira-como'),
  gan(21, 'De la pantalla a tu mano en unas horas.', 'DE LA PANTALLA A TU MANO', 'Pantalla con el diseño y, al lado, la pieza terminada', 'T1', 'ensena'),
  gan(22, 'Esto es lo que pasa cuando me escribes tu nombre.', 'ESCRÍBEME TU NOMBRE', 'El celular con un comentario y la impresora detrás', 'T1', 'historia', 'general', ['serie']),
  gan(23, 'Antes de fabricar, te muestro el diseño. Mira.', 'PRIMERO EL DISEÑO', 'El diseño en la pantalla junto a la pieza terminada', 'T9', 'ensena'),
  gan(24, 'Mi puerta antes y después de {precio}.', 'ANTES Y DESPUÉS', 'El después: la puerta ya decorada', 'T1', 'util', 'hogar', ['antes y después']),
  gan(25, '¿Tu casa todavía no parece de Navidad?', 'TU CASA EN NAVIDAD', '{El_producto} ya puesto en la casa', 'T5', 'util', 'hogar', ['navidad']),
  gan(26, 'Deja de decorar con lo mismo de siempre.', 'DECORA CON ALGO TUYO', '{El_producto} ya puesto en la casa', 'T6', 'util', 'hogar'),
  gan(27, '¿Tu empresa todavía no tiene los regalos de fin de año?', 'REGALOS PARA TU EMPRESA', 'Varias piezas con un logo, en fila', 'T5', 'tendencia-promo', 'empresas'),
  gan(28, 'Si tienes empresa, deja de regalar agendas.', 'REGALA CON TU LOGO', 'Tú con una pieza con logo en la mano', 'T6', 'tendencia-promo', 'empresas'),
  gan(29, 'Tu logo, en el escritorio de cada cliente.', 'TU LOGO EN 3D', 'Un escritorio con una pieza con logo', 'T1', 'tendencia-promo', 'empresas'),
  gan(30, '¿Grabas videos y tu micrófono no dice quién eres?', 'TU LOGO EN CÁMARA', 'Tú hablando con un micrófono inalámbrico con logo', 'T5', 'tendencia-promo', 'creadores'),
  gan(31, 'El micrófono que ves en todos los videos… con tu logo.', 'MICRÓFONO CON TU LOGO', 'Primer plano del micrófono con logo', 'T1', 'tendencia-promo', 'creadores'),
  gan(32, 'Para tu pareja: sus dos nombres en un solo detalle.', 'PARA TU PAREJA', 'Un llavero con dos nombres en tu mano', 'T5', 'util', 'pareja'),
  gan(33, '¿Qué le regalas a quien lo tiene todo? Algo con su nombre.', 'LO TIENE TODO', 'Tú mostrando {el_producto} a cámara', 'T5', 'util'),
  gan(34, 'Así se ve un pedido antes de salir para toda Colombia.', 'LISTO PARA ENVIAR', 'Una caja abierta con el pedido envuelto', 'T8', 'historia'),
  gan(35, 'El sonido más satisfactorio del taller.', 'SUBE EL VOLUMEN', 'Macro de la placa doblándose y la pieza saltando', 'T2', 'mira-como', 'general', ['asmr']),
  gan(36, 'Mira cómo nace {producto}.', 'MIRA CÓMO NACE', 'Timelapse: la primera capa sobre la placa', 'T1', 'mira-como'),
  gan(37, 'Horas de impresión en segundos.', 'HORAS EN SEGUNDOS', 'Timelapse acelerado de toda la impresión', 'T1', 'mira-como', 'general', ['timelapse']),
  gan(38, 'Encaja perfecto a la primera.', 'ENCAJA PERFECTO', 'Macro de dos piezas encajando con un clic', 'T1', 'mira-como', 'general', ['satisfying']),
  gan(39, 'Si ves esto, ya tienes el regalo resuelto.', 'REGALO RESUELTO', '{El_producto} en tu mano, con luz de Navidad detrás', 'T6', 'util', 'general', ['navidad']),
  gan(40, 'Tú escribes el nombre, la impresora hace el resto.', 'TÚ ESCRIBES EL NOMBRE', 'Teclado escribiendo un nombre y la impresora empezando', 'T1', 'ensena'),
  gan(41, 'Guarda esta lista de regalos con nombre para esta Navidad.', 'GUARDA ESTA LISTA', 'Los 3 productos en fila, el más barato adelante', 'T7', 'util', 'general', ['lista', 'navidad']),
  gan(42, '¿Todavía estás a tiempo para Navidad? Te digo hasta cuándo.', '¿ESTOY A TIEMPO?', 'Tú con el calendario de diciembre detrás', 'T6', 'tendencia-promo', 'general', ['navidad', 'urgencia'], 'Solo con la fecha límite real de pedidos (campaña §8).'),
  gan(43, 'Un regalo que no se compra en ningún centro comercial.', 'NO ESTÁ EN NINGUNA TIENDA', '{El_producto} con su nombre, en primer plano', 'T6', 'util'),
  gan(44, 'Le puse el nombre de mi mamá… y mira cómo quedó.', 'PARA MAMÁ', 'Tú con {el_producto} con un nombre, sonriendo', 'T1', 'historia'),
  gan(45, 'Mientras duermes, la impresora trabaja en tu regalo.', 'MIENTRAS DUERMES', 'La impresora en la oscuridad con la luz de la cámara', 'T1', 'mira-como'),
  gan(46, 'Diseña tu llavero gratis antes de pedirlo.', 'DISÉÑALO GRATIS', 'Pantalla del generador de llaveros de la web', 'T9', 'ensena'),
  // Plantillas de tendencia (T10): {tema} sale de Tendencias (Google Trends Colombia, Creative Center) o lo escribes tú.
  gan(47, '{tema}… pero en impresión 3D.', '{TEMA} EN 3D', 'Tu pieza inspirada en el tema, saliendo de la placa', 'T10', 'tendencia-promo', 'general', ['tendencia']),
  gan(48, 'Todos hablan de {tema}. Esto fue lo que salió del taller.', '{TEMA}', 'Tú a cámara con la pieza detrás', 'T10', 'tendencia-promo', 'general', ['tendencia']),
  gan(49, 'Si llegaste por {tema}, quédate a ver esto.', '¿VIENES POR {TEMA}?', 'Timelapse de la pieza a media impresión', 'T10', 'tendencia-promo', 'general', ['tendencia']),
  gan(50, '{tema}, versión taller de impresión 3D.', '{TEMA} VERSIÓN 3D', 'La pieza terminada en tu mano', 'T10', 'tendencia-promo', 'general', ['tendencia']),
  gan(51, 'Mientras todos ven {tema}, mi impresora hace esto.', 'MIENTRAS TANTO…', 'La impresora trabajando, tú mirando el celular', 'T10', 'tendencia-promo', 'general', ['tendencia']),
  gan(52, '¿{tema}? Mejor mira lo que salió de la impresora.', '¿{TEMA}?', 'La pieza saliendo de la placa', 'T10', 'tendencia-promo', 'general', ['tendencia']),
];

const cta = (n, voz, pantalla, caption, objetivo) => ({ id: `cta-b${String(n).padStart(2, '0')}`, voz, pantalla, caption, objetivo, fuente: 'semilla' });

export const CTAS = [
  cta(1, 'Comenta tu nombre y el próximo video es el tuyo.', 'COMENTA TU NOMBRE', 'Comenta tu nombre y el próximo video es el tuyo 👇', 'comentarios'),
  cta(2, 'Escríbeme {dm} por DM y te mando el diseño antes de fabricar.', 'ESCRÍBEME {dm}', 'Escríbeme {dm} por DM y te mando el diseño antes de fabricar 📩', 'dms'),
  cta(3, 'Guárdalo para {guardar}.', 'GUÁRDALO', 'Guárdalo para {guardar} 📌', 'guardados'),
  cta(4, 'Envíaselo a {compartir}.', 'ENVÍASELO', 'Envíaselo a {compartir} 🎁', 'compartidos'),
  cta(5, 'Y así, otra vez desde el principio…', 'MÍRALO OTRA VEZ', 'Míralo otra vez: el final conecta con el inicio 🔁', 'completar'),
  cta(6, 'Comenta qué quieres que imprima mañana.', '¿QUÉ IMPRIMO?', 'Comenta qué quieres que imprima mañana 👇', 'comentarios'),
  cta(7, 'Dime en los comentarios para quién sería el tuyo.', '¿PARA QUIÉN?', '¿Para quién sería el tuyo? Te leo 👇', 'comentarios'),
  cta(8, '¿Cuál escoges: el uno, el dos o el tres? Te leo en los comentarios.', '¿1, 2 O 3?', '¿Cuál escoges: 1, 2 o 3? 👇', 'comentarios'),
  cta(9, 'Diseña el tuyo gratis: te dejo la página en el comentario fijado.', 'DISÉÑALO GRATIS', 'Diseña el tuyo gratis en {generador} ✨', 'guardados'),
  cta(10, 'Escríbeme EMPRESA por DM y te cotizo con tu logo.', 'ESCRÍBEME EMPRESA', 'Escríbeme EMPRESA por DM y te cotizo con tu logo 📩', 'dms'),
  cta(11, 'Escríbeme {dm} por DM y te paso todos los precios.', 'ESCRÍBEME {dm}', 'Escríbeme {dm} por DM y te paso todos los precios 📩', 'dms'),
  cta(12, 'Pídelo con tiempo: te mostramos el diseño antes de fabricar.', 'PÍDELO CON TIEMPO', 'Pídelo con tiempo: cotiza en {cotizar} 📩', 'dms'),
  cta(13, 'Mándale este video a quien siempre deja los regalos para el final.', 'ENVÍASELO', 'Mándaselo a quien siempre deja los regalos para el final 🎁', 'compartidos'),
  cta(14, 'Guárdalo para cuando te toque el amigo secreto.', 'GUÁRDALO', 'Guárdalo para tu amigo secreto 📌', 'guardados'),
  cta(15, 'Comenta MICRO y te muestro cómo quedaría con tu logo.', 'COMENTA MICRO', 'Comenta MICRO y te muestro cómo quedaría con tu logo 🎙️', 'comentarios'),
];

const has = (n, nombre, tags, para) => ({ id: `has-b${String(n).padStart(2, '0')}`, nombre, tags, para, fuente: 'semilla' });

export const HASHTAGS = [
  has(1, 'Amigo secreto', ['#amigosecreto', '#regalosdenavidad', '#regalopersonalizado', '#colombia', '#pabonitas'], 'Videos de regalo para el amigo secreto (nov-dic)'),
  has(2, 'Bucaramanga local', ['#bucaramanga', '#santander', '#regalosbucaramanga', '#emprendimientocolombiano', '#pabonitas'], 'Para que te encuentren en tu ciudad'),
  has(3, 'Impresión 3D (descubrimiento)', ['#impresion3d', '#3dprinting', '#bambulab', '#satisfying', '#pabonitas'], 'Timelapses y revelaciones para curiosos del 3D'),
  has(4, 'Timelapse', ['#timelapse', '#3dprintingtimelapse', '#bambulab', '#impresion3d', '#pabonitas'], 'Formato F3: timelapse + revelación'),
  has(5, 'Decoración navideña', ['#decoracionnavideña', '#navidad', '#hogar', '#antesydespues', '#pabonitas'], 'Antes/después de la puerta o la casa'),
  has(6, 'Empresas', ['#regalosempresariales', '#detallescorporativos', '#logo3d', '#emprendedores', '#pabonitas'], 'Regalos con logo por cantidad'),
  has(7, 'Creadores', ['#creadoresdecontenido', '#microfono', '#setup', '#tiktokcolombia', '#pabonitas'], 'Micrófono viral con logo'),
  has(8, 'Profe', ['#regaloparaprofesora', '#findeaño', '#profes', '#regalospersonalizados', '#pabonitas'], 'Fin de año escolar'),
  has(9, 'Pareja', ['#regaloparanovio', '#regaloparanovia', '#detallesespeciales', '#regalopersonalizado', '#pabonitas'], 'Llaveros con dos nombres, charms'),
  has(10, 'Novena', ['#novenadeaguinaldos', '#navidadcolombiana', '#detallesnavideños', '#regalos', '#pabonitas'], 'Detalles para repartir (16-24 dic)'),
  has(11, 'Black Friday (solo con oferta real)', ['#blackfriday', '#blackfridaycolombia', '#regalos', '#impresion3d', '#pabonitas'], 'Solo si tienes una oferta de verdad: nunca inventes descuentos'),
  has(12, 'Emprendimiento', ['#emprendimiento', '#hechoencolombia', '#negociopropio', '#taller', '#pabonitas'], 'Historia del taller y detrás de cámaras'),
];

const ide = (n, idea, pilar, formula, objetivo, formato, temporada, nota = '') =>
  ({ id: `ide-b${String(n).padStart(2, '0')}`, idea, pilar, formula, objetivo, formato, temporada, nota, fuente: 'semilla' });

export const IDEAS = [
  ide(1, 'Serie "Comenta tu nombre": cada video responde un comentario con su llavero', 'historia', 'T1', 'comentarios', 'F1', 'siempre'),
  ide(2, 'Timelapse de un nombre decorativo con revelación al final', 'mira-como', 'T4', 'comentarios', 'F3', 'siempre'),
  ide(3, 'Tres regalos para el amigo secreto con su precio', 'util', 'T7', 'guardados', 'F4', 'navidad'),
  ide(4, 'Antes/después de la puerta con la funda navideña', 'util', 'T1', 'compartidos', 'F5', 'navidad'),
  ide(5, 'Cómo se diseña un llavero en Relieve3D en un minuto', 'ensena', 'T9', 'guardados', 'F1', 'siempre'),
  ide(6, 'Empacando pedidos para toda Colombia (detrás de cámaras)', 'historia', 'T8', 'comentarios', 'F1', 'navidad', 'Solo con pedidos reales y sin datos del cliente'),
  ide(7, 'El micrófono viral con el logo de otro creador (respuesta a su video)', 'tendencia-promo', 'T1', 'dms', 'F1', 'siempre'),
  ide(8, 'Detalles para repartir en la novena: llaveros por cantidad', 'util', 'T5', 'guardados', 'F1', 'navidad'),
  ide(9, 'Regalo para la profe: soporte para celular con su nombre', 'util', 'T6', 'compartidos', 'F1', 'fin de año escolar'),
  ide(10, 'El sonido de la placa al despegar la pieza (ASMR)', 'mira-como', 'T2', 'completar', 'F3', 'siempre'),
  ide(11, '¿Adivinas qué es? Figura decorativa a media impresión', 'mira-como', 'T4', 'comentarios', 'F3', 'siempre'),
  ide(12, 'Escritorio antes y después con el organizador', 'util', 'T1', 'guardados', 'F5', 'siempre'),
  ide(13, 'Nombre decorativo para la puerta del cuarto de un niño', 'util', 'T1', 'guardados', 'F1', 'siempre'),
  ide(14, 'Lo más pedido de la semana (lista real)', 'historia', 'T7', 'comentarios', 'F4', 'siempre', 'Solo con los productos que más te pidieron'),
  ide(15, 'El error al pedir un regalo personalizado: no ver el diseño antes', 'ensena', 'T6', 'guardados', 'F1', 'siempre'),
  ide(16, 'Llavero con dos nombres para la pareja (charms)', 'util', 'T5', 'compartidos', 'F1', 'amor y amistad'),
  ide(17, 'Regalos con logo para la fiesta de fin de año de la empresa', 'tendencia-promo', 'T6', 'dms', 'F1', 'navidad'),
  ide(18, 'Tú decides qué imprimo mañana (comentarios)', 'historia', 'T4', 'comentarios', 'F3', 'siempre'),
  ide(19, 'Horas de impresión en segundos: pieza de la colección HOME', 'mira-como', 'T1', 'completar', 'F3', 'siempre'),
  ide(20, 'Diseña tu llavero gratis en la web y nosotros lo imprimimos', 'util', 'T6', 'guardados', 'F1', 'siempre'),
  ide(21, 'Lápices con nombre para el regreso a clases', 'util', 'T5', 'guardados', 'F1', 'regreso a clases'),
  ide(22, 'Faroles o adornos con velas LED para el Día de las velitas', 'tendencia-promo', 'T1', 'compartidos', 'F1', 'velitas', 'Solo velas LED cerca de piezas impresas'),
  ide(23, 'Respuesta con video a la pregunta más repetida en DM', 'historia', 'T8', 'comentarios', 'F1', 'siempre'),
  ide(24, 'Un pedido de principio a fin: del mensaje al envío', 'historia', 'T8', 'dms', 'F1', 'siempre', 'Pide permiso al cliente antes de mostrar su pedido'),
  ide(25, 'Regalo para mamá con su nombre (Día de la Madre)', 'util', 'T5', 'compartidos', 'F1', 'día de la madre'),
];

const res = (n, nombre, texto, cuando) => ({ id: `res-b${String(n).padStart(2, '0')}`, nombre, texto, cuando, fuente: 'semilla' });

export const RESPUESTAS = [
  res(1, 'Precios', '¡Hola! Gracias por escribir a {marca}. Algunos precios: {catalogo}. ¿Qué te gustaría, con qué nombre y para cuándo? Te mostramos el diseño antes de fabricar.', 'Cuando preguntan "¿precio?"'),
  res(2, 'Cómo pedir', 'Es muy fácil: 1) me dices producto, nombre(s), colores y fecha; 2) te mando el diseño para que lo apruebes; 3) lo hacemos a mano en nuestro taller; 4) lo enviamos a toda Colombia. También puedes cotizar en {cotizar}.', 'Cuando preguntan cómo se pide'),
  res(3, 'Diseño previo', 'Antes de fabricar te mando el diseño por aquí para que revises el nombre, la letra y los colores. Solo cuando me dices que sí, lo fabricamos.', 'Cuando dudan si va a quedar bien'),
  res(4, 'Envíos', 'Enviamos a toda Colombia desde {ciudad}. Envío a tu ciudad: [DATO costo y tiempo]. Para que llegue antes del 24 de diciembre, pide a más tardar el [FECHA LÍMITE].', 'Cuando preguntan por el envío'),
  res(5, 'Empresas', '¡Claro! Hacemos piezas con tu logo por cantidad. Mándame cuántas unidades, tu logo (PNG o vector) y la fecha de entrega, y te cotizo con el diseño previo.', 'Empresas y emprendedores'),
  res(6, 'Micrófono con logo', '¡Sí lo hacemos! Dime qué micrófono usas, mándame tu logo (PNG) y la forma de la base (cuadrada, corazón o estrella). Te muestro el diseño y te lo cotizo gratis.', 'Creadores que preguntan por el micrófono'),
  res(7, 'Respuesta a "comenta tu nombre"', '¡Listo, [NOMBRE]! Tu nombre sale en uno de los próximos videos. Si lo quieres de verdad, escríbeme por DM y te mando el diseño.', 'Comentarios de la serie de nombres'),
  res(8, 'Medios de pago', 'Puedes pagar por [DATO medios de pago]. Te mando el diseño primero y, cuando lo apruebes, te paso los datos.', 'Cuando preguntan cómo pagar'),
  res(9, 'Tiempo de entrega', 'Lo fabricamos en [DATO días de producción] después de que apruebes el diseño, y el envío a tu ciudad tarda [DATO días de envío].', 'Cuando preguntan cuánto se demora'),
  res(10, 'Gracias por tu pedido', '¡Gracias por confiar en {marca}! Cuando lo recibas, me encantaría ver una foto o un video; si me das permiso, lo comparto en TikTok.', 'Al entregar un pedido'),
];

const son = (n, nombre, tipo, uso, donde, url = '') => ({ id: `son-b${String(n).padStart(2, '0')}`, nombre, tipo, uso, donde, url, fuente: 'semilla' });

export const SONIDOS = [
  son(1, 'Sonido en tendencia de la semana', 'tendencia', 'Fórmula T10: el momento del sonido con tu producto. Volumen bajo (5-10 %) si hablas encima', 'App de TikTok → Para ti → toca el disco del video → Agregar a Favoritos. Revisa también Tendencias → Creative Center'),
  son(2, 'Biblioteca comercial de TikTok', 'comercial', 'Música segura para cuentas de empresa y para anuncios', 'App de TikTok → Agregar sonido → (cuenta de empresa: solo verás la biblioteca comercial)'),
  son(3, 'Motores de tu impresora Bambu', 'original', 'Fórmula T2 "Escucha esto": graba el sonido real cerca de la impresora', 'Tu celular a 10 cm de la impresora, sin música'),
  son(4, 'Crack de la placa al despegar', 'original', 'El momento más satisfactorio: súbelo y no le pongas música encima', 'Graba el despegue en macro con el audio original'),
  son(5, 'Villancico instrumental libre de derechos', 'comercial', 'Fondo navideño suave bajo tu voz (5-10 %)', 'Biblioteca de audio de YouTube (filtra "Atribución no obligatoria")', 'https://studio.youtube.com'),
  son(6, 'Música navideña de Pixabay', 'comercial', 'Fondo para timelapses navideños', 'Pixabay Music: búsqueda "christmas" (licencia de uso libre de Pixabay)', 'https://pixabay.com/music/search/christmas/'),
  son(7, 'Pop', 'sfx', 'Cuando aparece el producto o el texto en pantalla', 'audio/sfx/pop.wav (python herramientas\\tiktok3d.py sfx los regenera)'),
  son(8, 'Whoosh', 'sfx', 'Transiciones rápidas entre escenas', 'audio/sfx/whoosh.wav'),
  son(9, 'Ding', 'sfx', 'Cuando aparece el precio', 'audio/sfx/ding.wav'),
  son(10, 'Riser', 'sfx', 'Tensión antes de la revelación (empieza 2 s antes)', 'audio/sfx/riser.wav'),
  son(11, 'Click', 'sfx', 'Al pasar de un producto a otro o cuando algo encaja', 'audio/sfx/click.wav'),
  son(12, 'Boom', 'sfx', 'Impacto en la revelación final', 'audio/sfx/boom.wav'),
  son(13, 'Tu voz original (sin música)', 'original', 'Videos de "comenta tu nombre" y respuestas: se entiende mejor', 'Grabación con micrófono de solapa'),
];

export const SEMILLAS = {
  ganchos: GANCHOS,
  guiones: GUIONES,
  ctas: CTAS,
  hashtags: HASHTAGS,
  ideas: IDEAS,
  respuestas: RESPUESTAS,
  sonidos: SONIDOS,
};
