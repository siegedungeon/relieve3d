# Relieve3D

Programa de escritorio (Windows) para convertir una imagen (logo, nombre, dibujo) en un **modelo 3D por capas de color**, listo para imprimir en 3D (llaveros, letreros, toppers, imanes…).

## Instalar

Descarga y ejecuta `Relieve3D Setup X.Y.Z.exe` desde los Releases de GitHub (o `dist\` si lo compilas localmente) y sigue el asistente. Se crea un acceso directo en el escritorio.

## Actualizaciones automáticas

La app instalada revisa `https://github.com/siegedungeon/relieve3d/releases` al abrirse
(y cada 4 horas mientras sigue abierta), descarga la versión nueva en segundo plano y
avisa en la barra inferior cuando está lista: un clic reinicia e instala. No requiere
token en el cliente porque el repositorio/releases son públicos.

### Publicar una versión nueva

```powershell
npm version patch   # o minor/major: sube la versión en package.json y crea el tag vX.Y.Z
git push --follow-tags
```

Al subir un tag `vX.Y.Z`, el workflow `.github/workflows/release.yml` compila el
instalador y lo publica como GitHub Release junto a los metadatos que
`electron-updater` necesita (`latest.yml`). No hace falta ejecutar `npm run dist`
a mano salvo para probar localmente.

## Módulos

Al abrir aparece una **pantalla de inicio** para elegir qué crear (botón **Inicio** para volver). Todas las medidas están en **milímetros**.

**Modelos 3D** (exportan 3MF multicolor para Bambu Lab, STL único/por color, OBJ y SVG):

| Módulo | Qué hace |
|---|---|
| Llavero | Módulo completo para marcas y merchandising (ver abajo) |
| Marcador de lápiz | Nombre en relieve con **canal horizontal dentro de la base**, calibre redondo/hexagonal/triangular y adorno al final (cinta, corazón o estrella). Conserva los montajes antiguos con funda exterior |
| Logo para micrófono | **Cuerpo completo** del mic flag (cuadrado, estrella, corazón, círculo, hexágono) con bordes redondeados, hueco inferior para el micrófono + ranura del clip (DJI, Hollyland, chinos verticales), aros laterales opcionales y el logo encima. El logo/cuerpo se mueve con el asa ✥ morada, se rota y el botón **Centrar hueco** ajusta el hueco para paredes uniformes. También puedes **cargar tu propio cuerpo STL** (queda guardado en la biblioteca) |
| Logo / figura en relieve | Cualquier imagen a modelo multicolor por capas |
| Imán de nevera | Figura con bolsillo oculto para imán |
| Cake topper 3D | Texto impreso con palitos para torta o cupcake |
| Topper de pitillo / Stanley | Figura con funda que encaja en el pitillo |
| Placa para mascota | Nombre + teléfono con argolla para collar |
| Letrero / placa | Placa con agujeros o imanes |
| Cortador de galletas | Filo y pestaña a partir de la silueta + sello/marcador interior con el diseño en relieve (impreso al lado, holgura 0,6 mm, espejado para que la galleta salga al derecho) |
| Separar colores 3D | Abre un **3MF multicolor** (p. ej. de MakerWorld) y lo divide en **piezas de un solo color** para imprimir sin cambios de filamento y pegar (ver abajo) |

Los módulos de texto usan las fuentes más populares y las instaladas en el equipo, con contorno/bordeado opcional.

**Matemasie** está incluida en «Fuente → Gruesas (recomendadas para 3D)», también en los selectores de grabado y diseño 2D. Es la versión Regular (400) de Adam Yeo, obtenida de [Google Fonts](https://github.com/google/fonts/tree/main/ofl/matemasie); funciona sin conexión ni instalación en Windows. Se distribuye con su licencia SIL OFL 1.1 en `src\fonts\Matemasie-OFL.txt`.

**Diseño 2D**:
- **Preparar logo**: vectoriza, quita fondo, reduce a 3–4 colores, engrosa colores finos, reorganiza elementos (mover/escalar/rotar/ocultar), añade borde y silueta de separación. **Engrosar por elemento** (slogans/letras finas): mantiene estilo y posición, separa letras y renglones para que no se peguen, conserva huecos (o, a, e), botón *Ajustar al trazo deseado* (p.ej. 1.2 mm) y *Reacomodar al engrosar* empuja los demás elementos. Tip: si el logo tiene base blanca, pon ese color en *Quitar* y baja *Agrupar partes* (~0.3 mm) para separar el slogan. Exporta SVG/PNG, guarda el proyecto `.r3s` para revisión del cliente o **Pasa a 3D** (llavero, micrófono, imán…).
- **Láminas para colorear**: imagen a contornos negros sólidos sobre blanco, limpieza ajustable, goma, borrado por zona y lápiz negro; exportación PNG, SVG y PDF y proyectos `.r3c` (ver abajo).
- **Cake topper láser**: letras engrosadas y soldadas en **una sola pieza** (sin letras sueltas ni huecos pequeños), puentes automáticos, palitos según tamaño de torta, doble capa opcional. Exporta **SVG de corte** para CorelDRAW.
- **Hablador acrílico**: despiece completo de un hablador/señalizador de mesa para corte láser (acrílico blanco y negro con espesores configurables, p. ej. 4 mm y 3 mm). A partir de un mockup genera:
  - panel negro con **techo asimétrico** (aleros y pendientes configurables) que abraza el ícono con un borde negro, más angosto que la base; **calibres respetados en cada unión**: pestañas del largo del espesor de la base negra, ranuras a presión = calibre de la pieza que entra − 0,2 mm (ajustable: lámina de 3 mm → ranura de 2,8 mm, de 4 mm → 3,8 mm), laterales del porta tarjetas que cubren el canto del frente; soportes traseros y porta tarjetas opcional con laterales por fuera del frente;
  - ícono superior (caja abierta con tapa, tarjeta y corazón, desplazable en horizontal, o **logo vectorizado desde imagen**), título y subtítulo en letras sueltas (o título soldado en una pieza) con ancho exacto del subtítulo;
  - 1 a 3 **placas QR**; con 2 placas se parten en la V del ícono y cada una tiene su propia inclinación (enlace, texto, color o **degradado** e **ícono central** WhatsApp/Instagram con corrección H, QR del mayor tamaño que cabe) y **hueco para tag NFC** detrás de la placa elegida;
  - **plantilla de pegado** con ventanas para ubicar cada pieza, archivo de **impresión UV** y vista de **ensamble**.

  - **Desde mockup** (🪄 *Generar desde mockup*): con solo una **vista FRONTAL recta** (sin perspectiva, fondo liso, base visible abajo, colores reales, ≥ 1500 px de alto) calca el panel, cada pieza blanca, los QR (redibujados reales y escaneables, con su color o degradado), los textos impresos y el porta tarjetas. Las **medidas objetivo** (alto total, largo/frente, ancho/fondo), los **calibres y colores** de cada lámina y la estructura (base, ranuras, soportes, porta tarjetas) salen del formulario; no hacen falta vistas laterales ni superior.
  - **Láminas de corte**: tamaño de la lámina de cada material (p. ej. negro 450 × 300, blanco 120 × 300), separación entre piezas (2 mm) y margen del borde. Las piezas se acomodan por su **forma real** (las letras pequeñas entran en los huecos de las grandes, rotaciones de 90°) dejando el sobrante en un solo retazo; la barra de estado muestra el % aprovechado.

  Todo sale en curvas Bézier suaves (sin escalones, picos ni trazos finos, con control automático), acomodado en láminas y exportado como **SVG para CorelDRAW** (línea roja de 0,01 mm, página del tamaño de la lámina). Los proyectos se guardan como `.r3h` (incluyen el mockup).

### Láminas para colorear

En **Inicio → Diseño 2D → Láminas para colorear**, abre una imagen o pulsa **Probar ejemplo**. La conversión es local, sin IA ni envío de imágenes a servicios externos. Funciona mejor con ilustraciones; las fotos pueden requerir más limpieza. Conserva el diseño original: no inventa adornos ni redibuja semánticamente los personajes.

- **Ilustración sin sombras** es el modo inicial para dibujos: comienza con 16 colores de análisis, convierte los trazos oscuros y los marcos de color estrechos en una sola línea negra y deja blancos los rellenos. **Quitar sombras (0–120)** une tonos del mismo color y limpia sombras neutras del fondo sin confundirlas con mejillas u otros detalles de distinto tono; 0 desactiva esta simplificación. Los detalles muy cercanos en color aún pueden necesitar ajustar la tolerancia o la goma. **Zonas de color** conserva el método anterior de separar cada zona; los proyectos antiguos se abren en ese modo.
- **Generar / actualizar** aplica los parámetros: cantidad de colores, contraste mínimo entre zonas, detalle mínimo en mm, área mínima de motas en mm², suavizado y grosor negro (0.6 mm inicialmente). Los controles de detalle actúan antes de dibujar los contornos, no adelgazando indiscriminadamente la línea final.
- **Conservar trazos originales** evita duplicar los bordes de líneas estrechas oscuras y, en modo ilustración, también de marcos de color; las áreas oscuras grandes quedan vacías por dentro. **Limpiar fondo claro** blanquea fondos claros conectados al borde, incluidos dameros grises incrustados. Ajusta su tolerancia o desactívalo si elimina detalles pálidos que quieras conservar.
- **Goma** borra líneas; **Borrar zona / elemento** elimina todo dentro del rectángulo arrastrado; **Lápiz negro** permite cerrar o añadir trazos. La rueda hace zoom y el botón derecho desplaza la vista. Las ediciones se conservan al recalcular; **deshacer/rehacer** recupera tanto ediciones como parámetros.
- **Página** ofrece A4, Carta, tamaño personalizado, orientación y margen. El dibujo se centra sin deformarlo. **PNG** es blanco/negro puro, opaco, con dimensiones y metadatos de 150/300 ppp; **SVG** usa un trazado vectorial compuesto con huecos blancos; **PDF** contiene una página vectorial por imagen, lista para imprimir al 100%. No añade textos ni marcas.
- Guarda el **`.r3c`** para conservar la imagen, los parámetros y las ediciones. Se puede reabrir desde el módulo, desde Inicio o arrastrándolo a la aplicación. Mientras haya parámetros pendientes, errores o una conversión activa, no se puede guardar/exportar una vista desactualizada. Salir del módulo cancela el cálculo pendiente sin perder el trabajo.

Regresiones: `node test\coloring.test.mjs` mide limpieza, contornos únicos, zonas blancas anidadas y formatos; `node test\coloring-illustration.test.mjs` cubre marcos de color, ojos, sombras y compatibilidad anterior; `node test\e2e\run.mjs coloring` recorre ambos modos, importación, edición real con ratón, deshacer/rehacer, guardado/reapertura de proyectos nuevos y antiguos, cancelación y exportación de los tres formatos.

### Marcadores de lápiz con nombre

El montaje **Dentro de la base del nombre** reproduce la construcción de una base gruesa con el lápiz atravesándola de extremo a extremo, no un tubo pegado debajo. Parte de «Linda» en Fredoka, letras fucsias, cinta rosa de concientización y base blanca. Todo es editable.

- **Texto y adorno**: nombre, fuente, grosor, colores independientes, alto del adorno y separación. El ancho en «Tamaño» incluye el nombre y el adorno; el margen de la base se añade por fuera. Los tamaños del adorno y del borde se conservan en mm al cambiar el ancho.
- **Proporción horizontal (%)**: 100% conserva las letras originales. Reduce este porcentaje (mínimo 25%) para mantener letras altas en nombres largos sin alargar el modelo; permite hasta 200%. Solo cambia la proporción de las letras, no la cinta ni el calibre del canal. El engrosado y el borde siguen midiendo lo indicado en mm. Se guarda en el `.r3d` y admite deshacer/rehacer. Evita reducir proporcionalmente todo el nombre si las letras quedan más bajas que el refuerzo del canal: la base perdería su contorno y parecería una barra.
- **Niveles**: espesor de base en «Base / silueta» y alturas de letras y adorno en «Canal para lápiz». Estos dos relieves se conservan al cambiar nombre, fuente o colores. También puedes editar piezas/niveles en los grupos; mantén elevación **0** para que apoyen en la base.
- **Calibre**: el canal final es **medida + holgura**. La referencia inicial es redonda, **7.8 mm finales**, base de **12 mm** y relieve de **1.4 mm**. Para hexágonos se mide entre caras; también se puede introducir la circunferencia. La pared mínima debe caber arriba y abajo; una combinación imposible bloquea la exportación en vez de quitar silenciosamente la base.
- La base sigue la silueta y se refuerza entre letras con extremos redondeados para mantener el canal cerrado lateralmente. «Desplazar eje» mueve el canal hacia arriba/abajo en el plano del nombre (positivo hacia arriba). El modo integrado usa el color de la base, siempre atraviesa ambos extremos y no combina accesorios como imanes, NFC o argolla; las fundas exterior y de punta mantienen sus opciones anteriores.
- Guarda el **`.r3d`** para seguir personalizando. El **3MF** mantiene los colores ensamblados; el **STL único** fusiona base y relieves en un sólido. SVG representa la vista superior, no el agujero horizontal. Los STL por color son volúmenes del modelo multicolor, no piezas con encajes para armar por separado.

**Impresión**: apoya la cara plana inferior sobre la cama y revisa el techo del canal en el laminador (puentes/soportes según impresora y material). El calibre es geométrico: imprime una muestra para ajustar la holgura a tu lápiz antes de hacer un lote; no se ha validado un ajuste físico universal.

Regresiones: `node test\pencil.test.mjs` comprueba sólidos, calibre y paredes; `node test\e2e\run.mjs pencil` recorre edición, guardado/reapertura y verifica los archivos 3MF/STL reales.

### Módulo Llavero (marcas y empresas)

- **Partes del logo**: detecta automáticamente ícono, nombre, eslogan y detalles. Marca cuáles salen (p. ej. solo el ícono, sin eslogan), cambia el tamaño de cada parte (%) y elige entre **alternativas de ubicación** con miniatura: como el logo, sin eslogan, solo ícono, solo nombre, ícono arriba + nombre, ícono + nombre en fila. «Volver al logo original» deshace la recomposición.
- **3 versiones de producto** con un clic:
  - **Sencillo**: 2 colores, base 1.8 mm, relieve 0.8 mm (el más económico).
  - **Medio**: 3 colores, base 2.6 mm, relieve 1.2 mm y borde elevado de color.
  - **Premium**: 4 colores, base 3.4 mm biselada, contorno metálico (dorado/plata) y alturas escalonadas por nivel.
  Los colores se reducen desde los originales del logo y se nombran con el PLA Basic de Bambu Lab más parecido («🎨 Ajustar a colores Bambu» cambia el tono exacto).
- **Argolla**: «📍 Ubicar con el mouse» muestra la argolla en vivo pegada al borde más cercano mientras mueves el mouse; clic para fijarla, **Alt** para ubicarla libre, también se puede arrastrar. Estilo redondo o **ranura para cordón/lanyard**.
- **Acabados**: borde elevado, contorno de acento, canto biselado, **chip NFC oculto** (bolsillo + pausa automática en el 3MF para insertar el chip en Bambu Studio) y **texto grabado atrás** (nombre del empleado, web).
- **Marca / empresas**: **código QR** en el frente (avisa si queda muy pequeño para escanear), **nombres en lote** (un 3MF por empleado, atrás o al frente), **peso estimado en gramos** para cotizar y **hoja de propuesta PNG** con las 3 versiones lado a lado para enviar al cliente.

### Módulo Separar colores 3D

Convierte un modelo pintado por colores (3MF de Bambu Studio/MakerWorld, objetos por color o pintura por triángulo) en piezas monocolor que encajan a presión. Evita impresiones de 30+ horas por purgas.

- El color **base** (el de mayor área, cambiable) queda como **cuerpo** con cavidades; los colores que son volúmenes propios (p. ej. un moño) salen como **piezas sólidas**; los colores pintados en la superficie salen como **cascarones curvos** (grosor configurable, 1.6 mm por defecto) que se incrustan en el cuerpo.
- **Modo Tallado** (por defecto, recomendado): cada color se **talla hacia dentro** del modelo en una capa de *Grosor del color tallado* (1.2 mm por defecto), sin agrandar la figura. Las paredes entre colores se calculan con campos de distancia y van inclinadas 10° (`carveDraft`) para facilitar el montaje; la holgura y la limpieza de detalles pueden modificar las fronteras de color. Se busca mantener la base conectada, pero el resultado depende de la geometría: revisa los avisos y el laminado antes de imprimir.
- **Precisión de las costuras** (Tallado): cerca de la superficie, la separación se vuelve a calcular sobre los triángulos originales, en lugar de interpolar solamente la rejilla. En las aristas se usa la bisectriz de las caras sin prolongarla indiscriminadamente más allá de sus extremos. Esto reduce la ondulación sin aumentar la resolución de toda la rejilla. Las uniones complejas, los núcleos y los encajes internos mantienen su construcción anterior; si el refinamiento cambia la conectividad de la base o introduce túneles, se conservan los cortes originales y se avisa. No suaviza los dientes que ya tenga la pintura original ni recupera los detalles descartados por ser demasiado pequeños.
- **Paredes finas y puntas** (Tallado): una zona pintada demasiado delgada para separarse de la cara opuesta pasa a un solo color (gana el base o, entre otros dos, el de mayor área). Un **borde afinado unido a una zona gruesa del mismo color** se conserva: no se cambia de color triángulo por triángulo, lo que producía mordiscos blancos y terminaciones dentadas. Para reconocer ese apoyo se exige una superficie gruesa de al menos `(2 × (pared mínima + holgura))²` dentro de la misma zona conectada; no sirve otra pieza separada del mismo color. Es un criterio geométrico, no una garantía de resistencia: los bordes conservados pueden necesitar soportes.
- **Detalles pequeños** (Tallado): los trazos de menos de 0.6 mm (`carveMinWidth`) pasan al color vecino sin unir zonas que solo se tocan en una esquina. La limpieza distingue un trazo estrecho de los triángulos estrechos que forman el borde de una zona ancha: una triangulación desigual no debe producir mordiscos en esa zona. Las piezas de color de menos de 1.5 mm³ (`carveMinPiece`), o que solo saldrían en mitades más chicas, no se imprimen: su hueco no se talla y la base queda **entera** allí. Los avisos indican los cambios. Los volúmenes propios de un solo color (p. ej. un moño) se rellenan con su color.
- **Montaje** (Tallado): cada pieza de color sale recta en la dirección de su cara visible y se comprueba que **nada de la base** quede delante en esa dirección (una bufanda que, al salir recta por el cuello, chocaría con la cabeza); si queda trabada se corta en dos donde su cara gira de lado y, si una mitad sigue trabada, se prueban cortes en los otros ejes (los mitones de un muñeco salen como una placa frontal y un arco trasero). Si ningún corte la deja libre del todo, gana el corte menos trabado y nunca uno que deje un **anillo alrededor de la base**, que no podría salir (la mano de un muñeco se abre por donde entra el brazo, en una mitad delantera y otra trasera). Otras piezas de color delante no cuentan, porque se colocan después (el lazo de un moño va antes que su nudo). Los anillos y bufandas de un color se cortan en piezas sin agujeros que entran deslizando. Las **articulaciones print-in-place** (piezas trabadas entre sí con holgura, como cadenas o patas articuladas) y los **huecos cerrados** se conservan: esas piezas de la base se imprimen juntas tal como están en el modelo (se avisa).
- **Modo Base + covers**: el color base queda en **una sola pieza entera** (sin mitades) con rebajes poco profundos; cada zona de otro color sale como un **cover**: una tapa delgada (hasta 1.6 mm) que copia la superficie, con bordes de curva suave (sin sierra) y calza en su rebaje para pegarse. Al armar, la figura queda igual al modelo original. Las zonas que envuelven el modelo se dividen con un **plano vertical recto en el centro de cada objeto** (un cover delante y otro detrás), así la unión queda como una costura limpia. Las puntas de las franjas quedan afiladas y los bordes de los covers pueden meterse como máximo 0.8 mm bajo una pieza sólida (moño). No se crean covers en paredes delgadas de caras paralelas (la pintura pasaría al otro lado), pero en filos en cuña el cover llega hasta la punta (sin muescas blancas); la pintura enterrada dentro del modelo se ignora, y donde un cover atravesaría una superficie de otro color (p. ej. una franja que llega a una pared en ángulo rasante) se recorta con **un solo corte suave** que sigue el borde del color y devuelve ese trozo a la base (antes se cortaba triángulo por triángulo y quedaban dientes de sierra); ese corte es una lámina de solo 0.35 mm bajo la superficie ajena (y nunca más de la mitad del espesor local: en una aleta delgada, pintada de un lado y blanca del otro, el corte va por el medio y la cara pintada no pierde una franja blanca), así en los filos la base deja apenas una línea fina sobre la cara pintada; el trozo recortado vuelve a la base sin unirlo a ella (la base se rehace como modelo menos los rebajes no recortados), porque esa unión dejaba miles de triángulos degenerados y el visor se congelaba en «Piezas sólidas 85 %», y donde la pintura llega a una pared (un soporte pegado sobre una bola) el borde del cover es una curva suave a 0.25 mm de la pared, calculada en el espacio y no sobre las astillas de la unión de la malla; las migajas de color de menos de 20 mm³ quedan del color base. Los colores con volumen propio (moño) **ya no flotan**: su interior pasa a ser un **núcleo del color base fundido a la base** (el moño crece de la cabeza blanca, y un **puente** del color base rellena el hueco de hasta 12 mm entre su parte trasera y la base, para que quede pegado en una cara amplia) y el color sale como **un solo cover** (no se parte en mitades) de 1.6 mm (`solidDepth`; más delgado deja ver el núcleo blanco bajo el nudo) que se desliza sobre ese núcleo y se pega. Solo donde la parte de atrás queda a la vista se agregan covers traseros delgados que entran desde atrás; la unión con el cover principal queda en la silueta. Ningún cover queda trabado: el núcleo llega hasta la superficie (sin películas de color debajo, que además serían imposibles de imprimir), así que cada cover sale recto en su dirección. La cara interior de los covers ya no se dobla en filos y curvas cerradas, por eso no quedan picos en sus bordes; además el fondo de cada rebaje (y la cara interior de su cover) se **suaviza sobre toda la zona** (espesor y normales), así una malla irregular o con triángulos astilla no deja picos ni dientes en la base, y cada cover se construye **dentro de su propio rebaje** (mismas normales y 0.05 mm menos profundo en cada punto) para que calcen exacto sin compartir volumen con la base; ya no se intersecta con el rebaje, porque esa operación entre paredes casi coincidentes dejaba láminas de volumen cero y asas (agujeros y motas de base en la impresión). Las islas sin color de menos de 2 mm² dentro de un cover (`pinhole`, un vértice suelto en una unión) se cierran: no quedan agujeros con un pelo de base atravesando el cover. El núcleo de los moños se talla desde un campo de distancia suavizado: su contorno sigue la forma de la pieza, sin escalones del vóxel. Las piezas sólidas que no se ahuecan (una bufanda) tienen su propio hueco en la base (antes se solapaban con ella) y, si quedarían trabadas, se cortan en piezas sin agujeros que entran deslizando.
- Modo **Capa exterior (experimental)**: el modelo original **no se corta**: queda entero como base y cada color es una capa de grosor constante (*Grosor capa exterior*, 1.2 mm por defecto) que se pega **por fuera**. Las fronteras entre colores son paredes rectas (bisectriz entre las zonas pintadas, calculada con campos de distancia), sin cuñas ni puntas. Contras: el modelo crece ese grosor por cada lado (los agujeros se cierran el doble) y tarda unos minutos.
- **Esculpido exterior**: reconstruye un núcleo y una envolvente exterior mayor, y redibuja las fronteras de color con un suavizado configurable (0.6 mm por defecto). Redondea también la geometría; no conserva exactamente el original. El crecimiento exterior predeterminado es de aproximadamente 1.2 mm por lado y puede estrechar agujeros hasta unos 2.4 mm. Los volúmenes originales casi monocolor pueden conservar su interior en ese color. Abre pequeños rebajes con el volumen barrido durante la inserción, sin recortar las caras de color; comprueba un orden de montaje y lo incluye en la lista y en las instrucciones exportadas. Rechaza resultados que bloquearían otras piezas, añadirían agujeros/componentes a la base o exigirían quitar más del 0.5 % de su volumen (máximo 100 mm³). **Sigue el orden indicado y el recorrido inverso de Despiece**; revisa las medidas funcionales, los bordes finos y los soportes en el laminador. Es una comprobación geométrica, no una prueba física ni una garantía para cualquier figura. No sustituye al modo Tallado si necesitas conservar las dimensiones.
- **Acabado de los bordes** (Esculpido): el bisel y la holgura se prolongan a través de la envolvente antes del recorte exterior. Esto reduce los dientes de rejilla en las uniones con el color base, también en caras inclinadas, sin ocultarlos mediante el sombreado del visor.
- Modo **Incrustaciones** (selector *Modo*): el modo anterior de piezas profundas que se encajan, con estas opciones:
- **Corte frente / atrás** (incrustaciones): un plano vertical por la silueta del modelo (donde las franjas cambian de cara) parte el cuerpo en **2 mitades**. Cada zona de color sale como **una pieza grande por lado** que entra **recta** desde delante o desde atrás. Se verifica columna por columna que nada del cuerpo trabe la salida de cada pieza (pliegues, ganchos en bordes rasantes, paredes de huecos interiores): lo que trabaría pasa al cuerpo. Las puntas de franja que apenas cruzan el corte y las migajas no se imprimen (quedan del color base) y se informan en los avisos.
- Las mitades se imprimen apoyadas en la **cara plana del corte** (sin soportes); se pegan las piezas de color en cada mitad y al final se pegan las dos mitades. Desactivando *Cortar en mitades frente / atrás* se vuelve al modo de cascarones curvos con más piezas.
- Sin el corte, cada color se divide en **pocas piezas grandes**: solo se corta donde la superficie gira más de lo que permite una inserción recta (*Curvatura por pieza*), con costuras suaves y sin dientes. Holgura de encaje 0.15 mm.
- Cada incrustación lleva su **número grabado** en la cara oculta (las muy pequeñas no; se ubican con el mapa).
- **Imprimir** los cascarones con la **cara de color hacia arriba** y **soportes de árbol solo en la cama** bajo la cara oculta; las placas ya salen orientadas así.
- Exporta un 3MF y un STL por color (placas acomodadas en la cama), el **3MF de ensamble de referencia**, el **mapa de armado** PNG (frente y atrás) e instrucciones.
- En Esculpido, la malla se limpia con una tolerancia geométrica de 0.005 mm antes de preparar las placas: evita que aristas microscópicas se conviertan en restos sueltos al escribir STL. El 3MF conserva las coordenadas sin redondearlas a cuatro decimales.
- **Limpieza de la malla** (todos los modos): la unión de los objetos y cascarones del modelo deja restos planos de volumen cero; antes de separar se quedan solo los sólidos y huecos de más de 0.5 mm³ y se juntan **sin operaciones booleanas**, conservando de qué objeto y triángulo viene cada cara (la pintura se mantiene). Antes esos restos se restaban y se multiplicaban: los rebajes de covers salían rotos y la separación terminaba en «memory access out of bounds» o cerraba la app.
- **Si el motor 3D falla** con un modelo en un modo (sin memoria o `Aborted()`), se avisa y el motor se reinicia solo: se puede probar otro modo sin cerrar la app (antes, tras un fallo, todos los modos fallaban hasta reiniciarla).
- Límites: las franjas que envuelven esferas no pueden salir en una sola pieza (quedarían trabadas); si una pieza de color tiene la base delante en todas las direcciones o la rodea, se avisa; si solo la roza en un borde (menos del 5 % de su silueta) o encaja ajustada, se avisa que puede necesitar presión; en pliegues ocultos muy cerrados puede perderse ~2 % del color, que se retoca con pintura.

## Flujo de trabajo (modelos 3D)

1. **Abrir imagen** (o arrastrarla a la ventana). Ideal: PNG con fondo transparente y colores planos. Si el fondo es blanco/sólido se quita automáticamente.
2. El programa detecta los colores, separa cada **pieza** (zona continua de un color) y la vectoriza.
3. **Selecciona** piezas: clic, Shift+clic, arrastrar un rectángulo, o desde los grupos de la izquierda (*Por color*, *Por nivel*, *Mis grupos*, *Piezas*). También se puede hacer clic en la vista 3D.
4. Ajusta **altura**, **elevación**, **filamento** o excluye piezas en el panel *Selección*. En cada fila de grupo puedes escribir la altura para todo el grupo de una vez.
5. Revisa el resultado en la **vista previa 3D** (gira, haz zoom, vista superior y vista explosionada por color).
6. **Exportar**: 3MF multicolor (Bambu Studio / OrcaSlicer / PrusaSlicer), STL por color, STL único, OBJ+MTL o SVG (para Corel/Illustrator/Inkscape).

### Otras funciones
- **Filamentos**: renombrar, cambiar color, añadir/eliminar, y reasignar colores detectados (p. ej. unir dos tonos parecidos en un solo filamento).
- **Base / contorno**: placa automática alrededor del diseño con margen y grosor configurables.
- **Argolla de llavero**: tamaño configurable, se coloca con un clic en el lienzo.
- **Tamaño real**: el ancho en mm escala todo el modelo.
- **Deshacer / Rehacer** (Ctrl+Z / Ctrl+Y) y **proyectos** `.r3d` (Ctrl+S) que guardan imagen y ajustes.
- Vectorización ajustable: nº de colores (auto o manual), detalle, suavizado, limpieza de motas, **quitar líneas finas** (contornos finos, halos y astillas de 1–3 px que al imprimir quedaban como pestañas sueltas; Auto / ≤ 2–8 px / No), tolerancia de fondo y resolución.
- Vectorización de precisión sub-píxel: las imágenes pequeñas se re-muestrean (bicúbico), los colores se agrupan en espacio Lab sin halos de antialias, se conservan líneas finas y los contornos se suavizan preservando esquinas con ajuste de rectas por mínimos cuadrados (sin escalones). `test/accuracy.test.mjs` mide el error contra formas analíticas (~0.1 px).
- **Huecos de letras (a, e, o, 4…)**: los huecos internos del color del fondo se detectan y se mantienen abiertos (antes podían desaparecer al limpiar). **Agrandar huecos** (por defecto 0.8 mm, según el ancho del diseño) abre los huecos más pequeños hasta ese diámetro dejando al menos 0.6 mm de pared, para que no se cierren al imprimir. En *Preparar logo*, **Agrandar huecos pequeños a (mm)** hace lo mismo y además evita que *Engrosar todo* / el engrosado por color tapen los huecos (se reducen como máximo a la mitad). Los huecos blancos de letras sobre una cara blanca (p. ej. texto negro sobre fondo blanco dentro del logo) también se protegen y agrandan, y el bordeado ya no los rellena. Aunque se fuerce el número de colores, los colores casi idénticos (dos blancos) se fusionan para no "picar" las letras.

### Atajos
| Tecla | Acción |
|---|---|
| Ctrl+O / Ctrl+S | Abrir imagen / Guardar proyecto |
| Ctrl+Z / Ctrl+Y | Deshacer / Rehacer |
| Ctrl+A / Esc | Seleccionar todo / Quitar selección |
| Ctrl+G | Crear grupo con la selección |
| + / − | Subir / bajar altura 0.2 mm |
| Supr | Excluir piezas seleccionadas |
| F | Ajustar vista 2D |
| V / H / Espacio | Herramienta seleccionar / mover / mover temporal |

## Desarrollo

```powershell
npm install        # instala dependencias (y copia complementos de Three.js a src/vendor)
npm start          # ejecuta la app
npm test           # pruebas del pipeline y de mallas cerradas (watertight)
npm run test:e2e   # flujo completo en la app real: separar colores 3D, logo y hablador
npm run dist       # genera el instalador en dist/
```

Cada error corregido queda cubierto por una prueba en `test/` (falla con el código anterior). Las pruebas E2E (`test/e2e/`) abren la app, recorren el módulo entero y exportan; capturas y archivos quedan en `test/out/e2e/`. Para probar un archivo propio: `node test/e2e/run.mjs colorsplit "C:\ruta\modelo.3mf"` (o `logo imagen.png`, `hablador mockup.png`).

Comparación de modos (separar colores 3D): `node test/tools/bench.mjs --models="C:\ruta\a.3mf|fx:figure" --modes=carve,covers --out=test/out/bench --force` separa cada modelo en cada modo y mide piezas inválidas, agujeros/asas (genus), volumen faltante/sobrante, solapes, superficie de menos de 0.4/0.8 mm, error de color y piezas trabadas (`bench.md`).

Comparación original vs resultado (separar colores 3D): `node test/tools/compare.mjs "C:\ruta\modelo.3mf"` separa el modelo, lo renderiza desde 14 vistas (incluidas 4 rasantes `under_f`, `under_b`, `over_b`, `over_f` que muestran las uniones entre piezas) junto al original y reporta el % de superficie visible que difiere, con recortes PNG de cada zona en `test/out/compare/`. Los bordes de color que coinciden con una arista viva (borde inferior, borde de un orificio) se respetan exactos: la cubierta llega hasta la arista. También verifica el **encaje**: cada cover de una pieza sólida (moño) debe salir 10 mm en su dirección sin chocar con la base (`fit` en la salida y en `report.json`). `node test/tools/pieces.mjs test/out/compare/parts.json salida.png [--only=0,7] [--views=front,back,top]` dibuja cada pieza sola para revisar sus bordes (`--cell=1800` para más resolución; una vista también puede ser una dirección `x;y;z`, p. ej. `--views=0.7;-1;0`).
Estructura: `main.js` (proceso Electron), `preload.js`, `src/core/` (procesamiento de imagen, geometría y exportadores, sin dependencias del DOM), `src/view2d.js`, `src/viewer3d.js`, `src/app.js` (interfaz).
