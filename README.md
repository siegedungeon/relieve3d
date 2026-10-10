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
| Marcador de lápiz | Nombre con funda para lápiz redondo, hexagonal o triangular (calibre, largo, ancho del nombre, borde/silueta, fuentes del equipo) |
| Logo para micrófono | **Cuerpo completo** del mic flag (cuadrado, estrella, corazón, círculo, hexágono) con bordes redondeados, hueco inferior para el micrófono + ranura del clip (DJI, Hollyland, chinos verticales), aros laterales opcionales y el logo encima. El logo/cuerpo se mueve con el asa ✥ morada, se rota y el botón **Centrar hueco** ajusta el hueco para paredes uniformes. También puedes **cargar tu propio cuerpo STL** (queda guardado en la biblioteca) |
| Logo / figura en relieve | Cualquier imagen a modelo multicolor por capas |
| Imán de nevera | Figura con bolsillo oculto para imán |
| Cake topper 3D | Texto impreso con palitos para torta o cupcake |
| Topper de pitillo / Stanley | Figura con funda que encaja en el pitillo |
| Placa para mascota | Nombre + teléfono con argolla para collar |
| Letrero / placa | Placa con agujeros o imanes |
| Cortador de galletas | Filo y pestaña a partir de la silueta + sello/marcador interior con el diseño en relieve (impreso al lado, holgura 0,6 mm, espejado para que la galleta salga al derecho) |

Los módulos de texto usan las fuentes más populares y las instaladas en el equipo, con contorno/bordeado opcional.

**Diseño 2D**:
- **Preparar logo**: vectoriza, quita fondo, reduce a 3–4 colores, engrosa colores finos, reorganiza elementos (mover/escalar/rotar/ocultar), añade borde y silueta de separación. **Engrosar por elemento** (slogans/letras finas): mantiene estilo y posición, separa letras y renglones para que no se peguen, conserva huecos (o, a, e), botón *Ajustar al trazo deseado* (p.ej. 1.2 mm) y *Reacomodar al engrosar* empuja los demás elementos. Tip: si el logo tiene base blanca, pon ese color en *Quitar* y baja *Agrupar partes* (~0.3 mm) para separar el slogan. Exporta SVG/PNG, guarda el proyecto `.r3s` para revisión del cliente o **Pasa a 3D** (llavero, micrófono, imán…).
- **Cake topper láser**: letras engrosadas y soldadas en **una sola pieza** (sin letras sueltas ni huecos pequeños), puentes automáticos, palitos según tamaño de torta, doble capa opcional. Exporta **SVG de corte** para CorelDRAW.
- **Hablador acrílico**: despiece completo de un hablador/señalizador de mesa para corte láser (acrílico blanco y negro con espesores configurables, p. ej. 4 mm y 3 mm). A partir de un mockup genera:
  - panel negro con **techo asimétrico** (aleros y pendientes configurables) que abraza el ícono con un borde negro, más angosto que la base; **calibres respetados en cada unión**: pestañas del largo del espesor de la base negra, ranuras = espesor de la pieza que entra + holgura (4 mm el frente blanco, 3 mm panel/laterales/soportes negros), laterales del porta tarjetas que cubren el canto del frente; soportes traseros y porta tarjetas opcional con laterales por fuera del frente;
  - ícono superior (caja abierta con tapa, tarjeta y corazón, desplazable en horizontal, o **logo vectorizado desde imagen**), título y subtítulo en letras sueltas (o título soldado en una pieza) con ancho exacto del subtítulo;
  - 1 a 3 **placas QR**; con 2 placas se parten en la V del ícono y cada una tiene su propia inclinación (enlace, texto, color o **degradado** e **ícono central** WhatsApp/Instagram con corrección H, QR del mayor tamaño que cabe) y **hueco para tag NFC** detrás de la placa elegida;
  - **plantilla de pegado** con ventanas para ubicar cada pieza, archivo de **impresión UV** y vista de **ensamble**.

  Todo sale en curvas Bézier suaves (sin escalones, picos ni trazos finos, con control automático), acomodado en láminas y exportado como **SVG para CorelDRAW** (línea roja de 0,01 mm). Los proyectos se guardan como `.r3h`.

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
npm run dist       # genera el instalador en dist/
```

Estructura: `main.js` (proceso Electron), `preload.js`, `src/core/` (procesamiento de imagen, geometría y exportadores, sin dependencias del DOM), `src/view2d.js`, `src/viewer3d.js`, `src/app.js` (interfaz).
