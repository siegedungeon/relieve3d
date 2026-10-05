# Relieve3D

Programa de escritorio (Windows) para convertir una imagen (logo, nombre, dibujo) en un **modelo 3D por capas de color**, listo para imprimir en 3D (llaveros, letreros, toppers, imanes…).

## Instalar

Ejecuta `dist\Relieve3D Setup 1.0.0.exe` y sigue el asistente. Se crea un acceso directo en el escritorio.

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

## Flujo de trabajo

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
- Vectorización ajustable: nº de colores (auto o manual), detalle, suavizado, limpieza de motas, tolerancia de fondo y resolución.

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
