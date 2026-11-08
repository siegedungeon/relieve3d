# Relieve3D

Programa de escritorio (Windows) para convertir una imagen (logo, nombre, dibujo) en un **modelo 3D por capas de color**, listo para imprimir en 3D (llaveros, letreros, toppers, imanes…).

## Instalar

Descarga y ejecuta `Relieve3D Setup X.Y.Z.exe` desde los Releases de GitHub (o `dist\` si lo compilas localmente) y sigue el asistente. Se crea un acceso directo en el escritorio.

Para actualizar en silencio una instalación existente, por ejemplo con un instalador compilado en local, cierra Relieve3D y ejecuta `& "dist\Relieve3D Setup X.Y.Z.exe" --updated /S /currentuser`. Sin `--updated`, el desinstalador de la versión anterior quita Relieve3D de la barra de tareas. Con `--updated` se conservan el ancla y los accesos directos, igual que en una actualización automática.

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

Al abrir aparece una **pantalla de inicio** para elegir qué crear (botón **Inicio** para volver). Las medidas de los modelos están en **milímetros**.

El selector **Tema → Claro / Oscuro**, en la barra superior, está disponible en Inicio y en todos los módulos. La elección se recuerda al cerrar y volver a abrir la aplicación; una instalación sin preferencia empieza en claro. Cambia la interfaz y el fondo de trabajo 2D, no los colores de los diseños, filamentos, hojas de impresión ni archivos exportados.

Regresión del tema: `npm run test:theme` verifica persistencia, navegación, contraste, teclado, el cotizador estrecho y exportaciones idénticas. Para recorrer todos los flujos existentes en oscuro: `$env:E2E_THEME='dark'; npm run test:e2e`. Cada prueba utiliza un perfil aislado y no cambia tu preferencia.

**Modelos 3D** (exportan 3MF multicolor para Bambu Lab, STL único/por color, OBJ y SVG):

| Módulo | Qué hace |
|---|---|
| Llavero | Módulo completo para marcas y merchandising (ver abajo) |
| Árbol navideño de nombres | Estilo del modelo de referencia: tronco con año o texto, nombres entre barras finas y estrella, corazón, círculo o silueta propia. Escala uniforme dentro del alto/ancho máximo; grosor que se afina por igual delante y detrás para que quede vertical y estable; guías ocultas invisibles por delante y por detrás. Proyectos `.r3t`, vista armada y placas monocolor con STL por pieza |
| Soporte celular llavero | Llavero que se abre en **soporte para el celular** (bisagra impresa armada, sin soportes) con la forma de arriba a elegir (corazón, ratón estilo Mickey, flor, estrella… o **tu propia silueta**), el logo o marca del cliente, texto y, opcionales, **chip NFC** y **abre latas** (ver abajo) |
| Nombres para lápices / lapiceros | Genera un listado completo: **Matemasie blanca sobre base morada, sin figuras**, canal horizontal de **7.9 mm** y máximo **75 × 19 × 13 mm** por nombre. Guarda proyectos editables, 3MF a dos colores, STL unidos y placas Bambu A1. Conserva la edición individual, los adornos opcionales y los montajes anteriores |
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

En **Árbol navideño de nombres**, escribe de 1 a 20 nombres (uno por renglón). Sigue el estilo del modelo de referencia: cada nombre va entre dos barras finas y es tan ancho como el triángulo del árbol a su altura; el tronco lleva el año u otro texto (o es liso) y la figura de la cima conserva su proporción aunque haya muchos nombres. Por defecto se respeta tu listado de abajo hacia arriba; el orden automático coloca los más largos abajo para letras más grandes. Los acentos quedan calados en la barra superior, así cada palabra es una sola pieza. Cada nombre conserva las proporciones de la fuente y el árbol completo, incluido tronco y remate, cabe dentro de ambos límites. Los grosores inferior y superior son independientes y se reparten por igual delante y detrás: el árbol queda vertical, sin inclinarse hacia atrás. El resumen indica cuántos grados aguanta antes de volcar, y si la base es delgada para la altura se sugiere el grosor inferior adecuado. Las letras se separan solas para que entre ellas queden al menos 0,8 mm al imprimir (más si el trazo mínimo es mayor), y cada nombre tiene un tamaño mínimo legible según su fuente para que no se cierren los huecos de A, R y O, las ranuras de E, M y N ni los pasos de G y S (por ejemplo, FAMILIA en Bebas Neue necesita letras de al menos 8,8 mm). Si un nombre o encaje quedaría más pequeño, no se exporta una pieza ilegible o frágil: el aviso dice qué nombre falla y qué tamaño necesita, y ofrece botones para aplicar el alto/ancho máximo que sí cabe o el orden automático.

**Placas por color** crea una carpeta nueva con el proyecto, STL numerados, instrucciones de montaje, un 3MF de referencia armado y un 3MF por placa. Las placas de 256 × 256 mm usan el perfil monocolor Bambu A1 instalado; otras medidas salen en 3MF estándar. No requieren AMS: cada pieza se imprime acostada sobre su espalda, sin soportes. Las uniones tienen guías trapezoidales ocultas dentro del grosor, que no se ven por delante ni por detrás: monta bajando cada pieza en vertical sobre la anterior, con las caras alineadas. La holgura predeterminada es **0,2 mm por lado**: prueba una pareja antes del lote, pues el ajuste físico depende de la calibración y del material. Regresión del módulo: `npm run test:nametree`.

Con Bambu Studio instalado en Windows, `npm run test:nametree:print` genera árboles de 2 y 7 nombres (con guías en ambos sentidos), guarda las placas nativas y comprueba su G-code real sin soportes ni torre de purga.

En **Nombres para lápices / lapiceros**, pega un nombre por renglón y pulsa **Generar listado completo**. También acepta comas y punto y coma. Conserva mayúsculas, espacios y copias repetidas; recuerda el listado al reiniciar. Cada ejecución crea una carpeta nueva sin sobrescribir lotes anteriores. Ajusta los nombres largos solo horizontalmente, sin modificar el calibre del canal. Si no caben todos en una placa, crea más placas con separación de 3 mm y espacio reservado para la torre de purga. Los colores indican los filamentos que debes cargar; los STL son monocromos. Revisa los puentes del canal y el ajuste físico del lapicero antes de imprimir.

Las placas usan los perfiles A1 de **Bambu Studio instalado** en `Program Files\Bambu Studio` o `AppData\Local\Programs\Bambu Studio`. Se resuelven sus herencias y plantillas locales para conservar los comandos reales de la impresora y el cambio de filamento, sin depender de un proyecto de ejemplo ni distribuir perfiles ajenos. Si falta el perfil, se muestra el error antes de crear archivos. Regresión completa: `npm run test:pencil-batch`.

Los selectores de **Fuente** muestran el nombre de cada tipografía y una **vista previa con tu propio texto**, antes de aplicarla. Incluyen búsqueda por nombre, categorías y navegación con flechas; **Enter** elige y **Esc** cancela sin cambiar el diseño. Están disponibles en el texto 3D (incluidos llaveros y marcadores), el grabado trasero, los textos y elementos del estudio 2D/cake topper láser, y el título, subtítulo y textos QR del hablador. Las fuentes se cargan localmente al mostrarlas; las vistas previas respetan el grosor y la cursiva del texto cuando corresponda.

El texto 3D y el texto fuente del estudio 2D se generan directamente a la resolución de trabajo, conservando el antialias para obtener contornos más precisos. El bordeado crece desde las letras rellenas, con grosor uniforme en milímetros incluso al comprimirlas, evitando las perforaciones que podían producir los trazos superpuestos de fuentes cursivas. Se conservan las aberturas propias de las letras y el agujero de la argolla. `node test\e2e\run.mjs text-quality` comprueba precisión de contornos, mallas cerradas, guardado y exportaciones.

**Matemasie** está incluida en «Fuente → Gruesas (recomendadas para 3D)», también en los selectores de grabado y diseño 2D. Es la versión Regular (400) de Adam Yeo, obtenida de [Google Fonts](https://github.com/google/fonts/tree/main/ofl/matemasie); funciona sin conexión ni instalación en Windows. Se distribuye con su licencia SIL OFL 1.1 en `src\fonts\Matemasie-OFL.txt`.

**Diseño 2D**:
- **Distribución para corte láser**: importa figuras SVG a escala real, conserva grupos, vincula complementos (por ejemplo, un anillo de dos círculos por figura) y acomoda juegos completos en una lámina. Guarda proyectos `.r3l` y exporta SVG 1:1; también recibe el diseño completo del estudio 2D mediante **Distribuir en lámina**.
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

**Contenido y redes**: **Estudio TikTok · Pabonitas** prepara cada video de TikTok, desde el guion hasta la medición (ver abajo).

### Distribución para corte láser

En **Inicio → Diseño 2D → Distribución para corte láser**, importa uno o varios SVG.
Se conservan curvas, colores, detalles y escala. La lista permite elegir las piezas,
editar nombres y cantidades, y agrupar elementos del mismo archivo conservando su
posición relativa. Para un anillo, agrupa sus dos círculos y marca el grupo como
**Complemento**; después asígnalo a las figuras con la proporción correspondiente.
El anillo se cuenta una vez aunque tenga dos contornos. También puedes importar todo
el archivo como una sola pieza. El envío desde el estudio 2D incluye el diseño completo,
no modifica el original y no cambia su escala.

Configura la lámina (inicialmente **480 × 400 mm**), margen, separación y paso angular.
**Cantidades exactas** informa lo que no cabe, sin crear otras láminas; **Llenar una
lámina** busca la mayor cantidad de juegos completos, con equilibrio entre diseños
activado inicialmente. La búsqueda es local y funciona en un Web Worker: compara
órdenes y giros, recoloca parte de las soluciones y conserva la mejor distribución
válida. Puedes cancelar y aplicar el mejor resultado disponible. El tiempo configura
la búsqueda; la preparación y comprobación geométrica pueden añadir unos segundos.
No se promete un máximo matemático. El límite es 250 figuras / 1000 piezas y
100 plantillas, con láminas de hasta 3000 mm por lado.

**Aplicar mejor resultado** sustituye la distribución con deshacer/rehacer. Puedes
arrastrar piezas o editar X, Y y giro; cualquier conflicto se resalta y bloquea la
exportación. **Revisar todas las piezas** comprueba todas las parejas, los márgenes
y las proporciones. El motor busca con máscaras, pero decide si el resultado es
exportable mediante distancias vectoriales, con una reserva geométrica de 0,02 mm
y una cota conservadora del grosor de los trazos, incluidos sus ingletes. Los trazos
finos se realzan únicamente en pantalla; el SVG conserva sus grosores originales.
Los complementos se pueden alojar entre figuras, pero no dentro de sus huecos.
**No aplica compensación de kerf**: configúrala una sola vez en tu software de corte.

Guarda y reabre `.r3l` para mantener fuentes vectoriales, asociaciones, configuración
y posiciones. Exporta SVG con dimensiones físicas y grupos, sin etiquetas ni guías
de interfaz en las trayectorias de corte. Los archivos sin unidades requieren elegir
explícitamente mm, cm o píxeles a 96 ppp. No se admiten CDR/DXF, imágenes incrustadas,
texto vivo, filtros, recortes, transparencias de grupo, referencias externas ni
trayectorias sin una silueta cerrada que las contenga: convierte esos elementos a
curvas o exporta un SVG compatible desde tu editor. Los errores no se reparan ni
descartan silenciosamente.

`npm run test:laser` ejecuta regresiones y el flujo completo en Electron:
importar, agrupar, asociar, optimizar, revisar, corregir con deshacer/rehacer,
guardar/reabrir y exportar/reimportar; también comprueba cancelación, unidades,
la lámina de seis diseños y el envío desde el estudio 2D. El caso anterior de Corel
(38 figuras y 38 anillos) es una referencia de esas geometrías, no un conteo fijo
ni una garantía para otros diseños.

### Cotizador 3D · Pabonitas

En **Inicio → Producción y negocio → Cotizador 3D · Pabonitas**, cotiza a partir de los datos reales del laminador. Es un módulo local independiente: entrar y salir no sustituye el diseño 3D abierto. No calcula el tiempo de impresión a partir de la malla ni envía datos a servicios externos.

**La entrada principal es Rápida:** escribe **horas/minutos y gramos**, dejando cantidad 1 o indicando más piezas. Aparecen inmediatamente costo, precio sugerido y utilidad estimada; **no pide cliente, contacto, fechas ni condiciones comerciales**, y no obliga a guardar. Selecciona si son datos por unidad o de una placa completa: en este último caso el consumo se cobra una sola vez y se reparte entre las piezas.

La rápida comienza sin mediciones inventadas y **sin acabado, anillo ni empaque añadidos**. Usa material, tarifa de máquina, purgas, reglas de precio e impuestos de tu configuración vigente. Los desplegables opcionales permiten añadir esos extras, cambiar tarifas o probar otro precio. Por ejemplo, 43 min y 10 g, con los valores iniciales y sin extras, dan costo $2.262,17 y precio sugerido $4.000. **Guardar cálculo** conserva un borrador sin cliente. **Continuar con cotización completa** traslada el mismo cálculo sin cambiar sus costos; solo entonces completas cliente y documentos comerciales. Varias máquinas, materiales o tandas parciales se editan en la completa, sin simplificar ni descartar su información al volver a Rápida.

| Sección | Contenido |
|---|---|
| Rápida | Tiempo, gramos y cantidad; costo y precio instantáneos, extras opcionales y guardado sin cliente |
| Cotización completa | Cliente, producto, cantidad, tiempo y gramos; impresoras, actividades de trabajo, accesorios, empaque, extras y riesgos. Resumen inmediato con costo unitario/total, utilidad estimada y margen |
| Precios por volumen | Tabla para 1, 20, 50, 100, 130, 200 y la cantidad actual, con costos recalculados, venta, utilidad y margen; selección de cantidad |
| Escenarios | Económico, competitivo, recomendado y premium, con estrategias y porcentajes visibles y editables |
| Comparar | Original frente a optimizado: material, horas, costos, utilidad, capacidad potencial y fecha. Por defecto mantiene el mismo precio de venta; la recomendación requiere confirmar calidad |
| Producción | Tandas completas/parciales, asignación por impresora, horas acumuladas/calendario, material por color y bobinas faltantes |
| Historial | Borradores, versiones emitidas, estados, búsqueda/filtros, duplicación, referencia de pedido local y registro de costos reales |
| Análisis | Cotizado, aceptado, conversión, utilidad estimada, productos, clientes, máquinas y estimado contra real |
| Configuración | Marca/logo, materiales/proveedores, impresoras, impuestos, comisiones, valores iniciales, reglas comerciales y vigencia versionada |

**Valores iniciales editables:** COP; PLA $90.000/kg ($90/g); máquina $1.750/h; purgas/reserva 12%; preparación/acabado **$5.000 por unidad**; empaque $500 por unidad; anillos $900 o $2.000; markup 55%; margen mínimo 20%; redondeo hacia arriba a $500; IVA y comisión 0%. Acabado, anillo y empaque son opcionales en Rápida; la plantilla de una nueva cotización completa mantiene esos cargos iniciales. No son tarifas comerciales garantizadas. Los precios mayoristas parten de descuentos propuestos de 0/3/5/8/10/12% en los tramos 1–9/10–29/30–49/50–99/100–199/200+, todos editables. El redondeo puede hacer que dos tramos terminen al mismo precio.

**Flujo:** elige **UNA UNIDAD** o **UNA TANDA / PLACA COMPLETA** antes de ingresar minutos y gramos. Puedes convertir días, horas y minutos con el control desplegable. Añade cada material/color, marca si ya incluye purgas/soportes y define capacidad/unidades por tanda. En una tanda parcial introduce la medición real o conserva la aproximación proporcional, siempre identificada como tal. En mano de obra elige importe fijo o minutos por tarifa/h y aplicación por unidad, pedido o tanda. **No cambies $5.000 a “Por pedido” solo para mejorar el margen si el acabado realmente se hace en cada pieza.**

Los anillos son accesorios eliminables; puedes añadir imanes, cadenas, tornillos u otros componentes con cantidad, costo y merma propios. Empaque y costos adicionales admiten alcances independientes. Materiales y máquinas permiten una tarifa específica del pedido; un campo vacío usa el catálogo. Guardar otra configuración no modifica una cotización abierta: **Actualizar a costos vigentes** es una acción explícita y conserva los importes específicos ya ingresados para mano de obra, accesorios y empaque.

#### Cálculos y supuestos

El dominio usa `decimal.js` con precisión de 40 dígitos; recibe decimales sin separadores de miles, trabaja en minutos/gramos/COP y conserva precisión antes de presentar dinero con dos decimales.

```text
material base = gramos del pedido × precio/kg / 1000
material normal = base + purgas no incluidas + soportes no incluidos + merma independiente
reserva de fallos = costo repetible × [1 / (1 - porcentaje de fallo) - 1]
máquina = horas de impresión asignadas × tarifa de la impresora
mano de obra = importe × alcance, o minutos × alcance / 60 × tarifa laboral
accesorio = cantidad × alcance × costo × (1 + merma)
costo productivo = material + máquina + trabajo + accesorios + empaque + extras + reservas
```

La tarifa de máquina es **integrada o por componentes**, nunca ambas: electricidad (`kW × COP/kWh`), depreciación y mantenimiento. La reserva de fallos repite material e impresión, no vuelve a cobrar automáticamente todos los accesorios ni las actividades; añade reprocesamiento laboral explícito cuando corresponda. El porcentaje histórico es ingresado por el operador, no inferido de estadísticas inexistentes. Contingencia es un concepto adicional, no otro nombre para las purgas.

Sin comisiones, **markup** significa `costo × (1 + recargo)` y **margen** significa `costo / (1 - margen)`. Con `C` como costo productivo, `F` comisión fija y `f` comisión efectiva sobre venta sin IVA, el motor usa:

```text
venta neta por markup m = (C + F) × (1 + m) / [1 - f × (1 + m)]
venta neta por margen g = (C + F) / (1 - g - f)
comisión efectiva f = comisión % × (1 + IVA), si también se cobra sobre el IVA
utilidad estimada = venta sin IVA - costo productivo - comisiones
margen = utilidad / venta sin IVA
markup efectivo = utilidad / (costo productivo + comisiones)
```

Los descuentos automáticos respetan el margen/precio mínimo antes del redondeo comercial. Un precio manual es el precio negociado final: **no recibe otra vez el descuento mayorista**; sí admite descuento adicional explícito. Se permite simular pérdidas, pero no emitir por debajo del mínimo. Cantidad × precio unitario mostrado reconcilia con la venta; el IVA queda fuera de la utilidad. El anticipo es un porcentaje del total del cliente. Los cargos fijos y variables se identifican en **Ver todos los cargos**.

La utilidad es **estimada del pedido, no ganancia neta del negocio**. “Equilibrio” indica cuántas unidades de ese lote debes vender para recuperar su costo, no el punto de equilibrio de toda la empresa. El capital a financiar excluye comisiones de cobro y extras marcados sin desembolso; una tarifa integrada puede contener depreciación. Si ingresas trabajo a precio fijo sin duración, no se inventan horas laborales para calcular rentabilidad/hora.

La planificación reparte tandas entre hasta 100 máquinas según disponibilidad inicial y factor de tiempo explícito. Acumula horas de máquina, pero las horas calendario consideran el paralelismo. Usa operación continua, capacidad de placa común compatible con todas las seleccionadas y preparación/retiro por tanda; no incorpora festivos, turnos, transporte ni competencia con otros pedidos. Horas de trabajo y reserva de reimpresión se muestran aparte, **no están incluidas en la fecha de impresión**. La entrega comercial se ingresa expresamente o queda “Por confirmar con producción”.

Inventario es referencial por material: suma colores para no reutilizar el mismo saldo dos veces, muestra kg y bobinas a comprar, pero no descuenta ni reserva existencias. La optimización compara dos configuraciones; los gramos originales editables corresponden al primer color, dejando los demás iguales.

#### Documentos, versiones y almacenamiento

**Guardar borrador** conserva el trabajo editable. **Emitir / marcar enviada** crea una versión inmutable con entrada, resultados y configuración completa; no envía mensajes. Desde esa versión puedes previsualizar, exportar **PDF A4**, **PNG vertical**, **PNG compacto**, **HTML imprimible** o copiar texto. Una lista explícita de campos comerciales excluye costos, utilidad, fórmulas y notas internas. Los cambios pendientes bloquean exportar una versión distinta de la que estás editando.

Abre `v1`, `v2`, etc. para consultar el resultado guardado sin recalcularlo. Aceptar bloquea la edición; duplica para otro pedido, con fechas renovadas y configuración vigente. “Convertida” crea una referencia local vinculada a la versión aceptada, **no un sistema completo de pedidos**. Análisis cuenta cada cotización una vez y considera aceptada/convertida como venta comprometida, no como dinero recaudado. Los costos reales se registran manualmente y no alteran la versión emitida.

Los datos están en `quotations\quotations-v1.json` dentro de `app.getPath('userData')` de Electron (normalmente bajo `%APPDATA%`). El esquema nuevo es **versión 1**, sin migraciones destructivas ni cambios en proyectos 3D. Se crea al primer guardado; usa reemplazo atómico, bloqueo de escritura entre instancias y revisiones contra cambios concurrentes. Un historial corrupto genera error y no se reemplaza silenciosamente. El actor registrado es el usuario local del sistema operativo.

Para respaldar, cierra la aplicación y copia `quotations-v1.json` a una ubicación segura. Si un cierre inesperado dejó `quotations-write.lock`, cierra **todas** las instancias antes de eliminar únicamente ese bloqueo; nunca borres el JSON para resolverlo. No se eliminan bloqueos automáticamente porque podría haber otra instancia escribiendo.

**Alcance actual:** aplicación local de un operador, con interfaz adaptable a ventanas estrechas. No incluye despliegue web/móvil, autenticación y permisos por rol, sincronización, facturación fiscal, envío automático, integración transaccional de clientes/productos/pedidos/inventario ni planificación por turnos. Esos servicios no existen en la arquitectura actual y no se simulan como si estuvieran integrados.

#### Arquitectura y regresiones

| Archivos | Responsabilidad |
|---|---|
| `src\core\quotation.js` | Motor decimal, validación, producción, precios, escenarios, comparación y análisis |
| `src\core\quote_document.js` | Modelo comercial público y documentos HTML/texto |
| `src\main\quote_store.cjs`, `quote_export.cjs` | Persistencia versionada y exportación nativa Electron |
| `main.js`, `preload.js` | Servicios IPC restringidos a la ventana principal |
| `src\quote_ui.js`, `src\quote.css` | Interfaz independiente; navegación en `app.js`, `modules.js` e `index.html` |
| `test\quotation.test.mjs`, `test\quote_store.test.mjs` | Casos históricos, límites, decimales, impuestos, privacidad, versiones y concurrencia |
| `test\e2e\quote.e2e.cjs` | Flujo completo en Electron, archivos reales, reinicio y vista estrecha, con almacenamiento de prueba aislado |

```powershell
npm run test:quote
node test\e2e\run.mjs quote
node test\e2e\run.mjs pencil
```

`npm test` incluye las regresiones financieras sin reemplazar las geométricas; `npm run test:e2e` incluye el cotizador en el recorrido de todos los módulos. Capturas y documentos de prueba se guardan en `test\out\e2e\quote`, sin usar el historial real.

### Láminas para colorear

En **Inicio → Diseño 2D → Láminas para colorear**, abre una imagen o pulsa **Probar ejemplo**. La conversión es local, sin IA ni envío de imágenes a servicios externos. Funciona mejor con ilustraciones; las fotos pueden requerir más limpieza. Conserva el diseño original: no inventa adornos ni redibuja semánticamente los personajes.

- **Ilustración sin sombras** es el modo inicial para dibujos: comienza con 16 colores de análisis, convierte los trazos oscuros y los marcos de color estrechos en una sola línea negra y deja blancos los rellenos. **Quitar sombras (0–120)** une tonos del mismo color y limpia sombras neutras del fondo sin confundirlas con mejillas u otros detalles de distinto tono; 0 desactiva esta simplificación. Los detalles muy cercanos en color aún pueden necesitar ajustar la tolerancia o la goma. **Zonas de color** conserva el método anterior de separar cada zona; los proyectos antiguos se abren en ese modo.
- **Generar / actualizar** aplica los parámetros: cantidad de colores, contraste mínimo entre zonas, detalle mínimo en mm, área mínima de motas en mm², suavizado de zonas y grosor negro (0.6 mm inicialmente). Los controles de detalle actúan antes de dibujar los contornos, no adelgazando indiscriminadamente la línea final.
- **Pulir curvas (mm)** elimina escalones del contorno y ajusta curvas Bézier reales: comienza en 0.6 mm, admite 0–1.2 mm y adapta el radio a los contornos pequeños o estrechos. Es distinto del **Suavizado de zonas (0–4)**, que limpia la segmentación del color. La vista ampliada, SVG, PDF y PNG comparten esas curvas; no se limita a difuminar una imagen. El cálculo se hace en un worker, también al borrar o dibujar. 0 conserva el acabado anterior; los proyectos antiguos sin este ajuste se abren en 0, sin cambiar su apariencia.
- **Conservar trazos originales** evita duplicar los bordes de líneas estrechas oscuras y, en modo ilustración, también de marcos de color; las áreas oscuras grandes quedan vacías por dentro. **Limpiar fondo claro** blanquea fondos claros conectados al borde, incluidos dameros grises incrustados. Ajusta su tolerancia o desactívalo si elimina detalles pálidos que quieras conservar.
- **Goma** borra líneas; **Borrar zona / elemento** elimina todo dentro del rectángulo arrastrado; **Lápiz negro** permite cerrar o añadir trazos. La rueda hace zoom y el botón derecho desplaza la vista. Las ediciones se conservan al recalcular; **deshacer/rehacer** recupera tanto ediciones como parámetros.
- **Adornos opcionales → Sorpréndeme** crea una composición nueva cada vez, con recursos vectoriales propios: ramos, ramitas, flores, estrellas, lunas, planetas, mariposas, corazones y círculos. Elige **Flores, plantas y estrellas**, **Espacio**, **Corazones y mariposas** o **Mixto infantil**, sin deducir el estilo de los personajes. Empieza desactivado en cada imagen nueva. Al activarlo reserva espacio reduciendo el dibujo proporcionalmente, conserva sus detalles y ajusta el grosor negro al tamaño final. La colocación automática protege la silueta, los personajes y los interiores blancos, como el centro de un cartel; si no cabe toda la cantidad, lo indica en vez de tapar el dibujo.
- **Agregar un recurso** permite elegirlo y colocarlo con un clic en la página. **Seleccionar / mover adorno** permite arrastrarlo, cambiar tamaño y giro o quitarlo con el botón o Supr. Los adornos son una capa aparte: la goma y el lápiz siguen editando el dibujo original. La colocación manual es libre, dentro de los márgenes. Desactivar los adornos conserva su composición; **Sorpréndeme**, cambiar temática o cantidad la recompone. Deshacer/rehacer recupera también las sorpresas y los ajustes manuales. La composición guardada no vuelve a sortearse al reabrir ni al exportar.
- **Página** ofrece A4, Carta, tamaño personalizado, orientación y margen. El dibujo se centra sin deformarlo. **PNG** es blanco/negro puro, opaco, con dimensiones y metadatos de 150/300 ppp; **SVG** usa un trazado vectorial compuesto con huecos blancos; **PDF** contiene una página vectorial por imagen, lista para imprimir al 100%. No añade textos ni marcas. El PNG sigue teniendo píxeles al ampliarlo mucho; usa SVG o PDF para escalar sin pixelación.
- Guarda el **`.r3c`** para conservar la imagen, los parámetros y las ediciones. Se puede reabrir desde el módulo, desde Inicio o arrastrándolo a la aplicación. Los proyectos con adornos usan la versión 2 del formato para que las aplicaciones anteriores no los abran perdiendo silenciosamente esa capa; los proyectos anteriores siguen siendo compatibles y no adquieren adornos automáticamente. Mientras haya parámetros pendientes, errores o una conversión activa, no se puede guardar/exportar una vista desactualizada. Salir del módulo cancela el cálculo pendiente sin perder el trabajo.

Regresiones: `node test\coloring.test.mjs` mide limpieza, contornos únicos, zonas blancas anidadas y formatos; `node test\coloring-illustration.test.mjs` cubre marcos de color, ojos, sombras y compatibilidad anterior; `node test\coloring-curves.test.mjs` mide suavidad, continuidad tangente, desviación geométrica, trazos finos, puntos, huecos y borrado. `node test\coloring-decorations.test.mjs` cubre activación voluntaria, semillas, variedad, conservación de detalles, márgenes y recursos vectoriales. `node test\e2e\run.mjs coloring` recorre el editor original completo; `node test\e2e\run.mjs coloring-decorations` recorre activación, sorpresas, inserción y movimiento reales, tamaño/giro, borrado, papel, historial, proyectos y exportación, comprobando la coincidencia de la vista con el PNG y que los adornos no cubran el dibujo.

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

### Módulo Soporte celular llavero

Llavero que se abre y sostiene el celular. Tiene una **pata en bisagra** que se despliega y queda firme sobre su tope; el celular se apoya en ella a unos **60°**, con el borde de abajo dentro de una ranura en V. Cerrada, la pata entra en su hueco con un **clic** y no se abre en el bolsillo. Todo **se imprime armado** (print-in-place), sin soportes ni piezas para pegar: el cuerpo acostado y la pata parada sobre sus pasadores cónicos a 45°.

- **Tamaño**:
  - *Pequeño*: 11 mm de grueso, para celulares de hasta 11,6 mm con forro.
  - *Grande*: 12 mm de grueso y pata más larga, para celulares de hasta 12,7 mm con forro.
- **Modelo**:
  - *Estándar*: con una barra detrás de la bisagra; sostiene el celular parado y acostado.
  - *Corto*: la forma va justo detrás de la bisagra; es más pequeño y se usa con el celular acostado.
- **Forma de arriba**: corazón, ratón (estilo Mickey), osito, gatito, flor, estrella, nube, corona, círculo, clásico o **Tu silueta** (sube una imagen con la forma que quieras). Cada botón muestra el contorno real de esa forma. *Tamaño de la forma* va de 70 a 140 %.
- **Logo o marca del cliente**: arrástralo a la ventana o usa **🖼️ Logo** (PNG, JPG o **SVG**, con fondo liso o transparente). Un SVG se dibuja nítido al tamaño máximo, aunque solo traiga `viewBox` o medidas en mm. Puede ir en la forma de arriba o en la barra, con tamaño y posición ajustables, y se acomoda solo sin tocar el agujero de la argolla. En el modelo corto, logo y texto van juntos arriba.
- **🎨 Colores del logo** (como en los llaveros): el logo se separa en sus colores (*Colores a detectar*: automático o de 1 a 6). Cada color es una pieza con su propio filamento, y en su fila puedes:
  - cambiar el color del filamento;
  - poner *Color del cuerpo* (sale del filamento del cuerpo: un color menos);
  - *Quitar* esa parte del logo;
  - en relieve, darle su propio alto (vacío = el alto del relieve).
- **Texto o nombre** opcional, en la barra o junto al logo, con su **color** (↺ vuelve al color de acento) y, en relieve, su **alto**.
- **Acabado** del logo, el texto y la señal 📶:
  - *En relieve*: sobresale el alto que elijas (0,4–3 mm).
  - **Liso multicolor (tipo llavero)**: todos los colores quedan a ras en las últimas capas, como los llaveros impresos. *Profundidad del color* en capas de 0,2 mm; con **0,2 mm todos los colores van en una sola capa**: lo más nítido para logos pequeños o con líneas finas, y nada se engancha. Un color que sea el del cuerpo queda simplemente del cuerpo.
  - *Grabado*: hundido en el cuerpo, sin filamentos extra (en *Colores del logo* eliges qué colores se graban).
  - **Trazo mínimo** (*Avanzado*, 0,3–1,2 mm; 0,5 por defecto para boquilla de 0,4): las líneas, puntas y puntos más delgados se engruesan desde su centro para que salgan en la impresión, con el borde liso. Los detalles muy juntos (rayitas junto a un contorno, el punto de una i) quedan separados por una línea fina en vez de fundirse en una mancha. *Resultado* avisa cuánto del dibujo se engrosó. Las motas sueltas se quitan.
  - Elige el color del cuerpo y el de acento. La pata también puede ir en el color de acento. Si el diseño pasa de 4 filamentos (un AMS), *Resultado* lo avisa: junta capas en un mismo color o quita alguna.
- **Extras** (cada uno se activa o desactiva):
  - **📶 Chip NFC** para un sticker NTAG213/215 redondo (diámetro y grosor editables). En la vista, el chip se ve **en dorado a través del cuerpo**.
    - *Dónde*: en *Automático* va debajo del logo (el cliente toca el logo con el celular); también puede ir lo más arriba posible en la forma o cerca de la bisagra.
    - **Sellado con pausa** (por defecto y recomendado): solo un bolsillo interno, **sin bandeja ni ranura lateral**. El 3MF trae una **pausa antes de la tapa** («Inserta el chip NFC en el bolsillo y continúa»): coloca el chip plano, sin que sobresalga, y continúa para sellarlo. Una vez tapado no se puede cambiar el chip. Abre el 3MF como proyecto en Bambu Studio, conservando la configuración de la pausa (no solo la geometría); selecciona tu impresora y comprueba la pausa en la vista previa antes de imprimir.
    - **Bandeja tipo SIM** (opcional): se conserva para quienes necesitan cambiar el chip y para proyectos que ya la eligieron. La bandeja se imprime aparte y entra de lado hasta el clic, sin pausa. *Ranura por el lado*: automático (lejos del abre latas), derecho o izquierdo.
    - Si nada lo tapa, lleva encima la **señal 📶** (sin contacto) para saber dónde tocar. Se hace igual que el logo y en el color de acento.
    - Si el chip no cabe, la forma de arriba **se alarga sola** y *Resultado* dice cuánto.
  - **🥫 Abre latas**: ranura en el borde derecho o izquierdo, girada si el borde es curvo. Mete la pestaña de la lata y haz palanca. Si no hay un borde libre, la forma también se alarga sola.
  - **🔑 Agujero para la argolla** arriba en la forma, Ø5 mm por defecto (editable de 3 a 8), con **chaflán de 0,6 mm** en las dos caras para verlo y meter la argolla con facilidad. Si el diámetro pedido no cabe en una forma angosta, queda el más grande que quepa (mínimo Ø4) y *Resultado* lo dice.
- **Muesca para abrir**: un rebaje redondo en el borde de adelante, justo bajo la punta de la pata cerrada (unos 13 mm de ancho y 3,3 mm libres debajo). Mete la uña o la yema ahí y levanta la pata, sin pelear con el clic.
- **Medidas**: ancho (30–46 mm) y holgura de la bisagra. En *Avanzado*: clic de cierre (0–0,6 mm; 0 = sin clic), radio del pasador y pared de la argolla. Un valor fuera de rango se ajusta al salir del campo.
- **Resultado** muestra:
  - medidas cerrado y al imprimir, peso y filamentos (con sus colores);
  - ángulo y grosor máximo del celular, y estabilidad (vertical y horizontal);
  - bisagra, clic, muesca para abrir, argolla, NFC (dónde tocar, por qué lado entra la bandeja o a qué altura va la pausa), abre latas y acabado;
  - soportes: ninguno, y los puentes que hace la impresora (ranura del abre latas, ranura de la bandeja o tapa del bolsillo NFC);
  - piezas del 3MF y avisos.
- **Vistas**: *Como se imprime*, *Abierto con celular* (con un celular de referencia), *Cerrado (llavero)* y *Vista de arriba*. Si eliges bandeja, aparece al lado al imprimir y dentro de su ranura en las otras vistas. El deslizador *Mover la pata* y **▶ Animar** muestran el giro de la bisagra.
- **Exportar**:
  - **3MF** para Bambu Studio y OrcaSlicer: un filamento por color, el soporte como un objeto y la pausa NFC nativa antes de cerrar el bolsillo; no incluye el chip como pieza imprimible. Solo si eliges bandeja, esta sale como objeto aparte sin pausa. Cada objeto lleva los **soportes apagados** y las caras que miran hacia abajo vienen **pintadas como bloqueo de soportes**;
  - **STL** único: un solo color; no lleva la pausa ni ajustes de impresión. Desactiva los soportes y añade la pausa manualmente antes de la tapa, a la altura que muestra *Resultado*. Para conservar la pausa usa **3MF**;
  - **📸 Foto**: PNG para enviar al cliente;
  - **💾 Guardar proyecto** `.r3p`: medidas, colores del logo, logo y silueta. Se reabre con **📂 Abrir** o arrastrándolo a la ventana. Abre proyectos de versiones anteriores: los de la 1.17 conservan su forma, logo, texto y extras, y la bisagra se rehace con los valores por defecto; el acabado «incrustado» de la 1.19 pasa a *Liso multicolor*.

**Impresión**: PLA, capas de 0,2 mm, **sin soportes**, tal como sale. Con NFC sellado, coloca el chip durante la pausa y continúa para cerrar la tapa; el bolsillo no se rellena con soportes. La ranura del abre latas se imprime como puente de 16 mm; la de la bandeja opcional, de unos 29 mm. Al terminar, mueve la pata con cuidado hacia adelante y hacia atrás para soltarla, y dóblala hasta que haga clic. Para abrirla, levanta la punta desde la muesca del frente. Imprime primero una pieza de prueba y ajusta a tu impresora:
- *Holgura de la bisagra*: 0,3 mm por defecto. Si la pata sale pegada, súbela a 0,4; si queda floja, bájala a 0,25. La misma holgura (entre 0,25 y 0,45) se usa para la bandeja NFC.
- *Clic de cierre*: 0,3 mm por defecto. Si cuesta cerrarla, bájalo; si se abre sola, súbelo (hasta 0,6).
- *Logos pequeños*: usa *Liso multicolor* a 0,2 mm y, si tu boquilla es de 0,4 mm, deja el trazo mínimo en 0,5 o más.

**Licencia y créditos**: el mecanismo (pata en bisagra con tope, clic y ranura en V) se inspira en «Small smartphone stand – print in place design» de mgm86 (MakerWorld), y su versión «Profile - Standard + NFC + Can Opener». Esos archivos tienen una licencia estándar de archivo digital, solo para uso personal; la licencia comercial la vende su autor. Relieve3D **no usa ni incluye su malla**: la geometría se genera desde cero con medidas propias. «Mickey» es una marca de Disney, por eso el módulo ofrece una cabeza de ratón genérica. No uses personajes ni marcas de terceros sin permiso.

Regresiones:
- `node test\phonestand.test.mjs` cubre:
  - tamaños, modelos y formas;
  - la bisagra: giro libre, tope, clic y celular apoyado;
  - impresión sin voladizos;
  - el NFC (bandeja tipo SIM con su ranura, clic y muesca; pausa; lugar, señal 📶 y alargue) y el abre latas;
  - los colores del logo (capas, color del cuerpo, quitar, altos; ningún color se pierde al sumar el texto), el acabado liso en capas enteras, el grabado y el trazo mínimo (bordes lisos, rayitas que no se funden con el contorno);
  - las piezas y objetos del 3MF, la migración desde 1.17 y 1.19 y el proyecto.
- `node test\e2e\run.mjs phonestand` recorre el flujo completo en la app (también un logo SVG) y verifica las exportaciones reales.
- `node test\phonestand_bambu.mjs` requiere Bambu Studio instalado en Windows. Lamina con A1, PLA y capas de 0,2 mm, forzando los soportes del perfil: compara un control sin protección, solo ajustes por objeto, solo bloqueos pintados y la exportación de la app. Exige soportes en el control, ninguno en los otros tres y trayectorias de puente en ambos techos. Para el NFC sellado, lamina una copia con el perfil seleccionado de A1: exige un único `M400 U1` real con el bolsillo abierto, antes de extruir la tapa, y ningún soporte. Conserva los 3MF originales y preparados para el laminador, G-code, logs e informe en `test\out\phonestand-bambu`. Esto comprueba el laminado por CLI, no sustituye revisar la vista previa ni la pieza física de prueba.

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

### Estudio TikTok · Pabonitas

Se abre en **Inicio → Contenido y redes**. Trabaja sobre la carpeta del plan TikTok (por defecto `Documentos\TikTok-Impresion3D`): lee el perfil, los precios, la voz de marca, los hashtags, la campaña y los registros CSV. No inventa precios: un producto sin precio en `estrategia/perfil-cuenta.md` sale como «cotiza gratis», con un aviso.

Relieve3D escribe los guiones, prompts y captions, crea el kit de cada video y monta el video con tu voz. **Grabar, publicar y responder lo haces tú**: cada paso indica **dónde** hacerlo (Relieve3D, Bambu Studio, CapCut, la app de TikTok, TikTok Studio, Creative Center o ChatGPT/Copilot/Gemini) y trae un botón **Copiar** con el texto exacto para pegar.

| Pestaña | Contenido |
|---|---|
| Hoy | Fase de la campaña, indicadores (publicados, vistas, consultas, ventas), videos de hoy y siguientes, siguiente hueco libre del calendario y pendientes de medir |
| Kit del video | Los pasos del video en 7 fases: preparar, grabar, pasar al PC, montar, publicar, responder y medir. El estado de cada paso sale de los archivos reales de la carpeta (clips, voz, animatic, registro). Incluye **Guardar kit.md** y el selector de estado |
| Crear guion | Producto, ocasión, objetivo, fórmula de hook, formato y fecha. Genera escenas grabables, teleprompter, texto en pantalla, caption con el precio real, hashtags y comentario fijado, y avisa si hay frases prohibidas o precios fuera del catálogo. Sugiere ganchos de la biblioteca y ganchos con temas en tendencia, guiones base, ideas y cierres (**Usar** los pone en el borrador con los datos reales). **Crear video** genera `videos/VNNN-…` con `guion.md`, `video.json` y `kit.md`, y lo agenda en `registro/videos.csv` |
| Biblioteca | 7 colecciones que siempre están disponibles: 52 ganchos, 30 guiones base, 15 llamados a la acción, 12 sets de hashtags, 25 ideas de videos, 10 respuestas rápidas y 13 sonidos. Buscar, **Usar en Crear guion**, copiar, ocultar y **Exportar (JSON)**. **Pedir más a la IA** copia un prompt (pedir N nuevos o mejorar los que ves) y abre ChatGPT, Copilot o Gemini. En **Pegar lo que respondió la IA** pegas la respuesta y **Revisar** muestra, antes de guardar, los nuevos, los actualizados por id, los repetidos y los rechazados con su motivo. **Guardar en la biblioteca** la deja en `biblioteca/<colección>.json` |
| Tendencias | **Actualizar todo** lee las fuentes directamente (sin IA) y guarda cada dato con su enlace y su hora en `tendencias/<fecha>/`. Incluye fechas comerciales de Colombia con cuándo empezar a publicar, el ranking de tus fórmulas según tus métricas y la lectura de hashtags del Creative Center |
| Prompts IA | 10 prompts con el contexto de la marca: mejorar guion, hooks, caption/SEO, respuestas con video, adaptar tendencia o sonido, ideas para la semana, diagnóstico, fondo de portada, DM/WhatsApp y tareas largas con Copilot CLI. Cada uno dice dónde pegarlo. La respuesta de la IA al guion (N bloques separados por `\|` o numerados) se aplica al borrador |
| Responder y medir | Métricas a las 24 h, 72 h y 7 días (`registro/metricas.csv`) con diagnóstico frente a tu mediana, y pedidos atribuidos a cada video (`registro/pedidos-tiktok.csv`) |
| Configuración | Carpeta del espacio, Python y documentos encontrados |

**Montar** usa `herramientas\tiktok3d.py` del espacio y muestra su salida en vivo (botón **Ocultar/Mostrar**):

- `voz` genera la voz guía (edge-tts) o transcribe tu voz grabada.
- `video` crea el animatic con tarjetas para los clips que faltan, o el video final cuando ya están grabados.
- `revisar` saca fotogramas de control.
- `estado` y `panel` actualizan el registro y el panel HTML del plan.

Solo se ejecutan esos comandos, con rutas dentro de `videos/`.

Los CSV no guardan datos de clientes: se rechazan teléfonos y @usuarios. Las celdas que empiezan por `=`, `+`, `-` o `@` se escriben como texto. Se aceptan números con formato colombiano (`1.234`, `6,5`).

**Biblioteca**: la base viene dentro de Relieve3D; lo tuyo se guarda en `biblioteca/<colección>.json` del espacio (`{ "items": [...], "ocultos": [...] }`). Si importas un elemento con el id de uno base (`gan-b01`…), lo reemplaza y se marca «Base editada»; **Volver a la base** descarta tu versión, y ocultarlo no la borra. Los ids nuevos son `gan-001`, `gui-001`, `cta-001`, `has-001`, `ide-001`, `res-001` y `son-001`. El archivo guarda el último número usado (`ultimo`), así que un id borrado no se reutiliza y reimportar una exportación vieja no pisa otro elemento. Se aceptan hasta 500 elementos por importación: JSON (también dentro de un bloque de código) o una lista simple. Se rechazan datos de contacto (teléfonos, correos, @usuarios), personajes o marcas registradas, precios fuera del catálogo, descuentos o envíos gratis inventados, frases prohibidas y marcadores desconocidos. Antes de guardar se deja la versión anterior en `biblioteca/.anterior/` (si el archivo estaba dañado o escrito a mano con otra forma, se respalda aparte con fecha, `<colección>.danado-<fecha>.json`, y la app pide confirmar antes de reemplazarlo) y la importación queda anotada en la bitácora del día.

**Fuentes de Tendencias** (verificables, cada dato con enlace):

- Google Trends · Colombia (RSS `trends.google.com/trending/rss?geo=CO`): lo más buscado en las últimas horas, con noticias. **Gancho con esto** solo aparece en temas seguros: descarta política, tragedias, violencia, delitos, economía, salud y religión (también según los titulares).
- Reddit r/BambuLab y r/3Dprinting (RSS del top de la semana): ideas de piezas virales; **Guardar como idea** las pasa a la biblioteca.
- TikTok Creative Center · hashtags: **Abrir Creative Center** abre una ventana con su propia sesión. **Capturar lo que se ve**, o pegar el texto de la página y pulsar **Leer hashtags pegados**, extrae los hashtags. Si la región no es Colombia, avisa antes de guardarlos como set.
- Fechas comerciales de Colombia (Black Friday, Cyber Monday, Velitas, Novena, prima de diciembre, Nochebuena, Año Nuevo, Día de la Madre, Amor y Amistad…), calculadas sin internet.
- Tus métricas: ranking de fórmulas de hook por compartidos + guardados cada 100 vistas.

Límites: ninguna página pública publica «los ganchos ganadores de hoy». Por eso los ganchos se arman con la biblioteca más el tema en tendencia y se ordenan con tus métricas. Sin iniciar sesión, el Creative Center solo muestra el top 3 de Estados Unidos y no muestra la pestaña de música. Printables y MakerWorld no tienen API pública. Reddit limita las consultas seguidas: si responde 429, espera unos minutos.

Requisitos: el espacio TikTok con `herramientas\tiktok3d.py` y Python 3 (con `edge-tts` para la voz guía). Para el montaje, ffmpeg también debe estar instalado.

### Accesos locales (solo en este equipo)

Sirven para abrir desde Relieve3D páginas HTML tuyas (una guía, apuntes, un catálogo) sin que viajen con la app. La sección **Inicio → Solo en este equipo** solo aparece si existe `%APPDATA%\relieve3d\accesos-locales.json`:

```json
{
  "accesos": [
    {
      "id": "mi-guia",
      "titulo": "Mi guía",
      "descripcion": "Apuntes para repasar",
      "icono": "📘",
      "archivo": "C:\\Users\\yo\\Documents\\MiGuia\\guia.html"
    }
  ]
}
```

- **Campos.** `titulo`, `id` y `archivo` son obligatorios.
  - `id`: minúsculas, números y guiones, hasta 40 caracteres, sin repetir.
  - `archivo`: ruta completa a un `.html` o `.htm`. Nunca se abren otros tipos de archivo.
  - Se muestran hasta 30 accesos. Las entradas mal escritas se saltan y la sección dice por qué.
- **Abrir** la muestra en una ventana aparte y aislada.
  - La página no tiene acceso a Node ni a Relieve3D, ni al micrófono o la cámara, y no puede abrir otros archivos locales.
  - Lo que guarda (progreso, `localStorage`) se conserva al cerrar la app y queda separado del navegador.
  - Los enlaces `http(s)` se abren en el navegador. Las descargas preguntan dónde guardar.
  - Atajos: Alt+← / Alt+→ (atrás / adelante), F5 (recargar), Ctrl + / − / 0 (zoom), F11 (pantalla completa).
  - Pulsar **Abrir** otra vez trae al frente la misma ventana.
- **Abrir en el navegador** usa el navegador predeterminado. Úsalo si la página necesita dictado por voz, que no funciona dentro de la app.
- Si el archivo se movió o se borró, la tarjeta sale atenuada. La sección se actualiza al volver a la ventana de Relieve3D.
- **Nada de esto se publica.** La lista vive en tu perfil de Windows, no en el repositorio ni en el instalador. La versión web de Relieve3D tampoco la ve: el puente `window.r3dLocal` está fuera de `window.api` y la web no lo expone.

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

Estudio TikTok: `npm run test:tiktok` (unitarias, con datos de `test/fixtures/tiktok/`) y `node test/e2e/run.mjs tiktok`.

Soporte celular llavero: `node test/phonestand.test.mjs` (incluida en `npm test`) y `node test/e2e/run.mjs phonestand`.

Accesos locales: `npm run test:local` (incluida en `npm test`) y `node test/e2e/run.mjs local-links`.

- El E2E prepara su propia guía y su configuración con `R3D_LOCAL_LINKS_CONFIG`, que solo se respeta en modo prueba (con `R3D_TEST_FILE`).
- `R3D_LOCAL_LINKS_NO_OPEN` registra los enlaces externos y **Abrir en el navegador** en lugar de abrirlos.
- Las pruebas E2E usan el perfil real (`%APPDATA%\relieve3d`). Por eso, al terminar, `run.mjs` borra la partición de la guía de prueba (`Partitions\local-e2e-…`) y, si no puede, marca la prueba como fallida.
- También comprueba que una ventana con solo `window.api`, como la versión web, no muestra la sección.

El E2E copia el espacio real (`R3D_TIKTOK_E2E_SRC` o `Documentos\TikTok-Impresion3D`) en `test/out/e2e/tiktok/` y recorre el flujo completo sobre la copia: kit, guion, prompts, crear video, voz guía, animatic, revisar, publicar, métricas, pedido, panel, biblioteca (importar 50 ganchos, exportar, ocultar, volver a la base), tendencias en vivo y un segundo video creado desde un guion base. Al final comprueba que el original no cambió. Necesita Python, ffmpeg e internet para edge-tts y Google Trends.

Variables de entorno:

- `R3D_TIKTOK_DIR` fija la carpeta.
- `R3D_TIKTOK_TODAY` fija la fecha.
- `R3D_TIKTOK_NO_OPEN` registra los enlaces y carpetas en lugar de abrirlos.

Comparación de modos (separar colores 3D): `node test/tools/bench.mjs --models="C:\ruta\a.3mf|fx:figure" --modes=carve,covers --out=test/out/bench --force` separa cada modelo en cada modo y mide piezas inválidas, agujeros/asas (genus), volumen faltante/sobrante, solapes, superficie de menos de 0.4/0.8 mm, error de color y piezas trabadas (`bench.md`).

Comparación original vs resultado (separar colores 3D): `node test/tools/compare.mjs "C:\ruta\modelo.3mf"` separa el modelo, lo renderiza desde 14 vistas (incluidas 4 rasantes `under_f`, `under_b`, `over_b`, `over_f` que muestran las uniones entre piezas) junto al original y reporta el % de superficie visible que difiere, con recortes PNG de cada zona en `test/out/compare/`. Los bordes de color que coinciden con una arista viva (borde inferior, borde de un orificio) se respetan exactos: la cubierta llega hasta la arista. También verifica el **encaje**: cada cover de una pieza sólida (moño) debe salir 10 mm en su dirección sin chocar con la base (`fit` en la salida y en `report.json`). `node test/tools/pieces.mjs test/out/compare/parts.json salida.png [--only=0,7] [--views=front,back,top]` dibuja cada pieza sola para revisar sus bordes (`--cell=1800` para más resolución; una vista también puede ser una dirección `x;y;z`, p. ej. `--views=0.7;-1;0`).
Estructura: `main.js` (proceso Electron), `preload.js`, `src/core/` (procesamiento de imagen, geometría y exportadores, sin dependencias del DOM), `src/view2d.js`, `src/viewer3d.js`, `src/app.js` (interfaz).
