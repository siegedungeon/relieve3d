// 30 guiones base de la Biblioteca del Estudio TikTok (siempre disponibles, aunque no exista biblioteca/guiones.json).
// Una entrada por escena: [lo que dices, texto en pantalla]. null = automático (lo arma el borrador con el catálogo).
// Escenas por formato: F1 = 6, F3 = 4, F4 = 5 (las 3 del medio son los productos), F5 = 5.
// Marcadores: {producto} {corto} {el_producto} {lo}/{Lo} {precio} {PRECIO} {PRODUCTO} {para} {ciudad} {marca} {cta} {CTA} {dm}
// Nunca escribas un precio aquí: {precio} sale de estrategia/perfil-cuenta.md §3.

const g = (id, titulo, formato, formula, pilar, objetivo, ocasion, producto, escenas, extra = {}) => ({
  id, titulo, formato, formula, pilar, objetivo, ocasion, producto,
  escenas: escenas.map((s) => (s ? { voz: s[0], texto: s[1] } : { voz: null, texto: null })),
  tags: extra.tags || [], nota: extra.nota || '', fuente: 'semilla',
});

const CTA_ENVIO = ['{Lo} enviamos a toda Colombia. {cta}', '{CTA}'];

export const GUIONES = [
  // ---------------------------------------------------------------- F1 · toma a cámara + b-roll (6 escenas)
  g('gui-b01', 'Comenta tu nombre y te lo hago en 3D', 'F1', 'T1', 'historia', 'comentarios', 'general', 'llavero', [
    ['Comenta tu nombre y te lo hago en 3D.', 'COMENTA TU NOMBRE'],
    ['Así: escribo el nombre y elijo los colores.', ''],
    ['La impresora {lo} construye capa por capa…', 'CAPA POR CAPA'],
    ['…y sale así, hecho a mano en nuestro taller.', ''],
    ['{corto}: {precio}. Te muestro el diseño antes de fabricar.', '{PRODUCTO} {PRECIO}'],
    CTA_ENVIO,
  ], { tags: ['serie', 'navidad'], nota: 'Ten listos 3 llaveros: el tuyo y dos nombres comunes.' }),
  g('gui-b02', 'Amigo secreto resuelto', 'F1', 'T5', 'util', 'guardados', 'amigo-secreto', 'llavero', [
    ['¿Te tocó amigo secreto y no sabes qué regalar?', 'AMIGO SECRETO RESUELTO'],
    ['Le pongo su nombre y los colores que le gustan.', ''],
    ['La impresora {lo} hace mientras tú sigues con tu día.', 'CON SU NOMBRE'],
    ['{Lo} despego de la placa y ya se puede regalar.', ''],
    ['{corto}: {precio}. Perfecto para el amigo secreto.', '{PRODUCTO} {PRECIO}'],
    CTA_ENVIO,
  ], { tags: ['navidad', 'amigo secreto'] }),
  g('gui-b03', 'Te muestro el diseño antes de fabricar', 'F1', 'T9', 'ensena', 'dms', 'general', 'nombre decorativo', [
    ['Antes de fabricar tu regalo, te muestro el diseño.', 'PRIMERO EL DISEÑO'],
    ['Me mandas el nombre, yo lo diseño y tú lo apruebas.', 'TÚ APRUEBAS'],
    ['Cuando me dices que sí, la impresora empieza.', 'CAPA POR CAPA'],
    ['Y sale tal cual lo aprobaste.', ''],
    ['{corto}: {precio}. Hecho a mano en nuestro taller.', '{PRODUCTO} {PRECIO}'],
    ['Enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['confianza'] }),
  g('gui-b04', 'El detalle para la profe que sí se usa', 'F1', 'T6', 'util', 'compartidos', 'profe', 'soporte', [
    ['Deja de regalarle a la profe lo mismo de siempre.', 'PARA LA PROFE'],
    ['Le pongo su nombre y el del curso.', ''],
    ['La impresora {lo} arma capa por capa.', 'CON SU NOMBRE'],
    ['Y se queda en su escritorio todo el año.', ''],
    ['{corto}: {precio}. Un detalle que sí se usa.', '{PRODUCTO} {PRECIO}'],
    CTA_ENVIO,
  ], { tags: ['fin de año', 'colegio'] }),
  g('gui-b05', 'Su nombre en la puerta del cuarto', 'F1', 'T1', 'util', 'guardados', 'general', 'nombre decorativo', [
    ['El nombre de tu hijo en la puerta del cuarto.', 'SU NOMBRE EN 3D'],
    ['Escribo el nombre y elijo la letra y los colores.', ''],
    ['Capa por capa va tomando forma.', 'MIRA CÓMO CRECE'],
    ['Y sale así, para colgar en la puerta.', ''],
    ['{corto}: {precio}. Te muestro el diseño antes de fabricar.', '{PRODUCTO} {PRECIO}'],
    ['Enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['niños', 'decoración'] }),
  g('gui-b06', 'El micrófono viral con tu logo', 'F1', 'T10', 'tendencia-promo', 'dms', 'creadores', 'micrófono', [
    ['El micrófono que ves en todos los videos… lo hacemos con tu logo.', 'TU LOGO EN CÁMARA'],
    ['Pongo tu logo y te muestro el diseño antes de fabricar.', ''],
    ['La impresora {lo} construye en tus colores.', 'EN TUS COLORES'],
    ['Se pone encima de tu micrófono inalámbrico.', ''],
    ['{corto}: te {lo} cotizo gratis. Tu marca sale en cada video.', '{PRODUCTO} · COTIZA GRATIS'],
    CTA_ENVIO,
  ], { tags: ['creadores'] }),
  g('gui-b07', 'Si tienes empresa, deja de regalar lo mismo', 'F1', 'T6', 'tendencia-promo', 'dms', 'empresas', 'logo', [
    ['Si tienes empresa, deja de regalar lo mismo.', 'REGALOS CON TU LOGO'],
    ['Me mandas tu logo y te muestro el diseño.', ''],
    ['Lo fabricamos por cantidad, capa por capa.', 'POR CANTIDAD'],
    ['Cada pieza sale con tu marca.', ''],
    ['{corto}: te {lo} cotizo gratis según la cantidad.', '{PRODUCTO} · COTIZA GRATIS'],
    ['Enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['empresas', 'fin de año'] }),
  g('gui-b08', 'Para tu pareja: sus dos nombres', 'F1', 'T5', 'util', 'compartidos', 'pareja', 'charms', [
    ['¿No sabes qué regalarle a tu pareja esta Navidad?', 'PARA TU PAREJA'],
    ['Los dos nombres y los charms que más le gusten.', ''],
    ['La impresora {lo} hace capa por capa.', 'CON SUS NOMBRES'],
    ['Y así sale de la placa.', ''],
    ['{corto}: {precio}. Para tu pareja o tu mejor amiga.', '{PRODUCTO} {PRECIO}'],
    CTA_ENVIO,
  ], { tags: ['pareja', 'amor y amistad'] }),
  g('gui-b09', 'Tu escritorio en orden por un precio real', 'F1', 'T3', 'util', 'guardados', 'general', 'organizador', [
    ['{producto} por {precio}.', '{PRODUCTO} {PRECIO}'],
    ['{Lo} diseño a la medida de lo que tienes en la mesa.', ''],
    ['La impresora {lo} arma capa por capa.', 'CAPA POR CAPA'],
    ['Y sale así de la placa.', ''],
    ['Bolígrafos, celular y cables en su sitio.', 'TODO EN SU SITIO'],
    CTA_ENVIO,
  ], { tags: ['oficina'] }),
  g('gui-b10', 'Escucha la impresora trabajar', 'F1', 'T2', 'mira-como', 'completar', 'general', 'figura', [
    ['Escucha esto.', 'SUBE EL VOLUMEN'],
    ['Así empieza: el diseño en la pantalla.', ''],
    ['Y esta es la impresora trabajando, capa por capa.', 'CAPA POR CAPA'],
    ['El sonido de la placa al despegarla… lo mejor.', ''],
    ['{corto}: {precio}. Enviamos a toda Colombia.', '{PRODUCTO} {PRECIO}'],
    ['{cta}', '{CTA}'],
  ], { tags: ['asmr', 'satisfying'] }),
  g('gui-b11', 'Lápices con nombre para el colegio', 'F1', 'T5', 'util', 'guardados', 'general', 'lápices', [
    ['¿Tus hijos pierden los lápices en el colegio?', 'NUNCA MÁS PERDIDOS'],
    ['Les pongo su nombre a cada uno.', ''],
    ['La impresora hace los nombres capa por capa.', 'CON SU NOMBRE'],
    ['Y se ponen en el lápiz en un segundo.', ''],
    ['{corto}: te {lo} cotizo gratis.', '{PRODUCTO} · COTIZA GRATIS'],
    CTA_ENVIO,
  ], { tags: ['regreso a clases'] }),
  g('gui-b12', 'Un pedido real del taller', 'F1', 'T8', 'historia', 'comentarios', 'general', '', [
    ['Me escribieron por TikTok pidiendo {producto}… y esto pasó.', 'UN PEDIDO REAL'],
    ['Primero le mostré el diseño para que lo aprobara.', ''],
    ['Después, a imprimir capa por capa.', 'CAPA POR CAPA'],
    ['Y así salió de la placa.', ''],
    ['{corto}: {precio}. Así le llegó a su casa.', '{PRODUCTO} {PRECIO}'],
    ['Enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['historia'], nota: 'Solo con un pedido que pasó de verdad (y sin datos del cliente).' }),
  g('gui-b13', 'El error al pedir un regalo personalizado', 'F1', 'T6', 'ensena', 'guardados', 'general', '', [
    ['Si vas a pedir un regalo con nombre, no cometas este error.', 'NO COMETAS ESTE ERROR'],
    ['Pide siempre ver el diseño antes de que lo fabriquen.', 'PIDE EL DISEÑO'],
    ['Así revisas el nombre, la letra y los colores.', ''],
    ['Y no te llevas sorpresas cuando llega.', ''],
    ['Nosotros siempre te lo mostramos primero. {corto}: {precio}.', '{PRODUCTO} {PRECIO}'],
    ['Enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['confianza'] }),
  g('gui-b14', 'Detalles para repartir en la novena', 'F1', 'T5', 'util', 'guardados', 'novena', 'llavero', [
    ['¿Necesitas detalles para repartir en la novena?', 'DETALLES PARA LA NOVENA'],
    ['Cada uno con un nombre distinto.', ''],
    ['La impresora los hace por tandas.', 'POR CANTIDAD'],
    ['Y salen listos para entregar.', ''],
    ['{corto}: {precio}. Ideal para repartir en la novena.', '{PRODUCTO} {PRECIO}'],
    ['Los enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['navidad', 'novena'] }),
  g('gui-b15', 'Diseña tu llavero gratis antes de pedirlo', 'F1', 'T6', 'util', 'guardados', 'general', 'llavero', [
    ['Diseña tu llavero gratis antes de pedirlo.', 'DISÉÑALO GRATIS'],
    ['Entras a pabonitas.co, escribes tu nombre y lo giras en 3D.', 'PABONITAS.CO'],
    ['Cuando te guste, nosotros lo imprimimos.', 'LO IMPRIMIMOS'],
    ['Y sale así de la placa.', ''],
    ['{corto}: {precio}. Sin registrarte para diseñarlo.', '{PRODUCTO} {PRECIO}'],
    CTA_ENVIO,
  ], { tags: ['web'] }),

  // ---------------------------------------------------------------- F3 · timelapse + revelación (4 escenas)
  g('gui-b16', '¿Adivinas qué es?', 'F3', 'T4', 'mira-como', 'comentarios', 'general', 'figura', [
    ['¿Adivinas qué es antes de que termine?', '¿QUÉ ES?'],
    ['Ya casi… mira cómo sale de la placa.', ''],
    ['¡Es {producto}! {corto}: {precio}.', '{PRODUCTO} {PRECIO}'],
    ['Enviamos a toda Colombia. Dime en los comentarios si lo adivinaste.', '¿LO ADIVINASTE?'],
  ], { tags: ['satisfying'] }),
  g('gui-b17', 'Mira cómo nace la decoración de tu casa', 'F3', 'T1', 'mira-como', 'completar', 'hogar', 'home', [
    ['Mira cómo nace {producto}.', 'MIRA CÓMO NACE'],
    ['Este es el momento más satisfactorio.', ''],
    ['Así queda en casa. {corto}: {precio}.', '{PRODUCTO} {PRECIO}'],
    ['Enviamos a toda Colombia. Y así, otra vez desde el principio…', 'MÍRALO OTRA VEZ'],
  ], { tags: ['decoración', 'satisfying'] }),
  g('gui-b18', 'Nadie adivina qué sale de aquí', 'F3', 'T4', 'mira-como', 'comentarios', 'amigo-secreto', 'llavero', [
    ['Nadie adivina qué sale de aquí.', 'NADIE ADIVINA'],
    ['Ya casi está…', ''],
    ['¡{producto}! {corto}: {precio}. Perfecto para el amigo secreto.', '{PRODUCTO} {PRECIO}'],
    CTA_ENVIO,
  ], { tags: ['navidad', 'amigo secreto'] }),
  g('gui-b19', 'Horas de impresión en segundos', 'F3', 'T1', 'mira-como', 'completar', 'general', 'figura', [
    ['Horas de impresión en unos segundos.', 'HORAS EN SEGUNDOS'],
    ['Y ahora, el crack de la placa.', ''],
    ['Aquí está: {producto}. {precio}.', '{PRODUCTO} {PRECIO}'],
    ['Enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['timelapse'] }),
  g('gui-b20', 'Así suena una impresora 3D', 'F3', 'T2', 'mira-como', 'compartidos', 'general', 'figura', [
    ['Escucha cómo suena una impresora 3D trabajando.', 'SUBE EL VOLUMEN'],
    ['Y este es el mejor sonido de todos.', ''],
    ['{producto}, hecho en nuestro taller. {precio}.', '{PRODUCTO} {PRECIO}'],
    ['Enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['asmr'] }),
  g('gui-b21', 'Tú decides qué imprimo después', 'F3', 'T4', 'historia', 'comentarios', 'general', '', [
    ['Tú decides qué imprimo después.', 'TÚ DECIDES'],
    ['Pero primero, mira lo que salió hoy.', ''],
    ['{producto}. {corto}: {precio}.', '{PRODUCTO} {PRECIO}'],
    ['Enviamos a toda Colombia. Comenta qué quieres ver impreso mañana.', '¿QUÉ IMPRIMO?'],
  ], { tags: ['serie', 'comunidad'] }),

  // ---------------------------------------------------------------- F4 · lista de 3 productos con precio (5 escenas)
  g('gui-b22', 'Tres regalos para el amigo secreto', 'F4', 'T7', 'util', 'guardados', 'amigo-secreto', 'llavero', [
    ['Tres regalos para el amigo secreto que puedes pedir hoy.', '3 REGALOS PARA EL AMIGO SECRETO'],
    null, null, null,
    ['Te mostramos el diseño antes de fabricar y enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['navidad', 'lista'] }),
  g('gui-b23', 'Tres regalos con nombre que sí parecen pensados', 'F4', 'T7', 'util', 'guardados', 'general', 'llavero', [
    ['Tres regalos con nombre que sí parecen pensados.', '3 REGALOS CON NOMBRE'],
    null, null, null,
    ['Todos hechos a mano en nuestro taller. Enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['lista'] }),
  g('gui-b24', 'Lo más pedido esta semana', 'F4', 'T7', 'historia', 'comentarios', 'general', '', [
    ['Lo más pedido esta semana en el taller.', 'LO MÁS PEDIDO'],
    null, null, null,
    ['¿Cuál pedirías tú? Enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['lista', 'historia'], nota: 'Úsalo solo con los productos que de verdad más te pidieron esa semana.' }),
  g('gui-b25', 'Tres detalles para la profe', 'F4', 'T7', 'util', 'compartidos', 'profe', '', [
    ['Tres detalles para la profe, del más sencillo al más especial.', 'PARA LA PROFE'],
    null, null, null,
    ['Enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['fin de año', 'lista'] }),

  // ---------------------------------------------------------------- F5 · antes / después (5 escenas)
  g('gui-b26', 'Mi puerta antes y después', 'F5', 'T1', 'util', 'compartidos', 'hogar', 'funda', [
    ['Mi puerta antes y después de {precio}.', 'ANTES Y DESPUÉS'],
    ['Así estaba antes…', 'ANTES'],
    ['La sublimamos con el diseño que elijas y se pone en un minuto.', ''],
    ['{corto}: {precio}. Tu casa lista para Navidad.', '{PRODUCTO} {PRECIO}'],
    CTA_ENVIO,
  ], { tags: ['navidad', 'decoración'] }),
  g('gui-b27', 'Mi escritorio antes y después', 'F5', 'T1', 'util', 'guardados', 'general', 'organizador', [
    ['Mi escritorio antes y después de {precio}.', 'ANTES Y DESPUÉS'],
    ['Así estaba antes…', 'ANTES'],
    ['{Lo} pongo y cada cosa queda en su sitio.', ''],
    ['{corto}: {precio}. Hecho a mano en nuestro taller.', '{PRODUCTO} {PRECIO}'],
    CTA_ENVIO,
  ], { tags: ['oficina'] }),
  g('gui-b28', 'Tu puerta lista para la novena', 'F5', 'T5', 'util', 'compartidos', 'novena', 'funda', [
    ['¿Tu puerta todavía no parece de Navidad?', 'TU PUERTA EN NAVIDAD'],
    ['Así estaba…', 'ANTES'],
    ['Se pone en un minuto.', ''],
    ['{corto}: {precio}. Lista para recibir a la novena.', '{PRODUCTO} {PRECIO}'],
    CTA_ENVIO,
  ], { tags: ['navidad', 'novena'] }),
  g('gui-b29', 'Un cuarto antes y después de su nombre', 'F5', 'T1', 'util', 'guardados', 'general', 'nombre decorativo', [
    ['Un cuarto antes y después de {precio}.', 'ANTES Y DESPUÉS'],
    ['Así se veía la puerta…', 'ANTES'],
    ['Pongo su nombre y cambia todo.', ''],
    ['{corto}: {precio}. Con la letra y los colores que quieras.', '{PRODUCTO} {PRECIO}'],
    CTA_ENVIO,
  ], { tags: ['niños', 'decoración'] }),
  g('gui-b30', 'Tu marca en el escritorio de tus clientes', 'F5', 'T6', 'tendencia-promo', 'dms', 'empresas', 'soporte', [
    ['Deja de regalar agendas: regala algo que se queda en el escritorio.', 'REGALO DE EMPRESA'],
    ['Así se ve un escritorio sin tu marca…', 'ANTES'],
    ['Y así con tu logo, todo el día a la vista.', ''],
    ['{corto}: {precio}. Te mostramos el diseño antes de fabricar.', '{PRODUCTO} {PRECIO}'],
    ['Enviamos a toda Colombia. {cta}', '{CTA}'],
  ], { tags: ['empresas'] }),
];
