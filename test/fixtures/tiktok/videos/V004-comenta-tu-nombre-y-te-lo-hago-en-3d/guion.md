---
id: V004
titulo: "Comenta tu nombre y te lo hago en 3D"
estado: guion            # idea | guion | grabado | editado | listo | publicado | medido
pilar: historia        # mira-como | util | ensena | historia | tendencia-promo
formula: T1    # T1..T10 (ver skill tiktok-marketing/references/hook-formulas.md)
objetivo: comentarios
duracion_objetivo_s: 20
fecha_creado: 2026-11-03
fecha_plan: 2026-11-06T18:30
fecha_publicado:
url:
campana: navidad-2026
idea: I031
---

# V004 · Comenta tu nombre y te lo hago en 3D

> Campaña de Navidad 2026 (`estrategia/campana-navidad-2026.md`) · Publicación: **vie 6-nov · 18:30**
> Con **tu cara y tu voz**. La voz IA del animatic (`salida/V004-animatic.mp4`) es solo una guía de ritmo.

## 1. Idea en una frase
> Un llavero con nombre ($10.000) se vuelve una serie: cada comentario con un nombre es material para el próximo video.

## 2. Hook (0-3 s): las 3 capas disparan a la vez
| Capa | Contenido |
|---|---|
| Frase hablada | "Comenta tu nombre y te lo hago en 3D." |
| Texto en pantalla | TU NOMBRE EN 3D |
| Primer fotograma | Tu cara + el llavero con TU nombre girando en tu mano, a 20 cm del lente |

## 3. Texto para decir a cámara (teleprompter)
> Léelo **de corrido en una sola toma** mirando al lente (teleprompter de CapCut o similar), con energía y sonriendo.
> Si te equivocas, haz una pausa de 2 s y repite la frase entera. Puedes improvisar: los subtítulos salen de lo que digas.
> Cada número es un bloque = una escena. Está igual en `video.json → voz.texto`, separado con `|`.

1. Comenta tu nombre y te lo hago en 3D.
2. Así: escribo el nombre y elijo los colores.
3. La impresora lo construye capa por capa…
4. …y sale así, listo para tus llaves o tu maleta.
5. Llavero con tu nombre: 10 mil pesos. Perfecto para el amigo secreto.
6. Comenta tu nombre y el próximo video es el tuyo.

## 4. Guion por escenas
| Escena | Visual / toma (archivo) | Voz (bloque) | Texto en pantalla | Sonido |
|---|---|---|---|---|
| 1 | **CARA** `clips/cara.mp4`: Primer plano: tú con el llavero con tu nombre en la mano, cerca del lente | Comenta tu nombre y te lo hago en 3D. | TU NOMBRE EN 3D | pop |
| 2 | **B-ROLL** `clips/diseno.mp4`: Grabación de pantalla: escribes el nombre en Bambu Studio (o en el generador de pabonitas.co) y eliges colores | Así: escribo el nombre y elijo los colores. | · | whoosh |
| 3 | **TIMELAPSE** `clips/timelapse.mp4`: Timelapse Bambu del llavero creciendo capa por capa | La impresora lo construye capa por capa… | CAPA POR CAPA | · |
| 4 | **B-ROLL** `clips/despegar.mp4`: Macro: doblas la placa y sale el llavero (que se oiga el crack) | …y sale así, listo para tus llaves o tu maleta. | · | sonido del clip |
| 5 | **CARA** `clips/cara.mp4`: Tú con tres llaveros de nombres distintos en abanico | Llavero con tu nombre: 10 mil pesos. Perfecto para el amigo secreto. | LLAVERO CON NOMBRE $10.000 | ding |
| 6 | **CARA** `clips/cara.mp4`: Tú señalando hacia abajo (a los comentarios), sonriendo | Comenta tu nombre y el próximo video es el tuyo. | COMENTA TU NOMBRE | pop |

Cierre en bucle: la última frase conecta con la primera.

## 5. Lista de tomas (sesión de grabación)
- [ ] `clips/cara.mp4`: **toma continua a cámara** leyendo el texto de la sección 3 completo (se usa en las escenas 1, 5, 6; en el resto suena tu voz sobre el b-roll). Vertical, ojos al lente, luz de frente, micrófono de solapa si tienes
- [ ] `clips/diseno.mp4`: Grabación de pantalla: escribes el nombre en Bambu Studio (o en el generador de pabonitas.co) y eliges colores (escena 2, 3-5 s)
- [ ] `clips/timelapse.mp4`: timelapse de Bambu (Studio/Handy → descargar). Escena 3; se acelera solo para caber en su escena (`velocidad: auto`)
- [ ] `clips/despegar.mp4`: Macro: doblas la placa y sale el llavero (que se oiga el crack) (escena 4, 3-5 s) · con sonido ambiente (déjalo grabar 2 s más)
- Nota: Ten listos 3 llaveros: el de tu nombre y dos nombres comunes (por ejemplo María y Andrés).
- Nota: `diseno.mp4`: graba la pantalla con Win + Alt + R (Xbox Game Bar) o con el celular vertical apuntando al monitor.

## 6. Montaje
1. Guarda los clips en `clips/` **con estos nombres exactos**. Lo que aún no exista sale como tarjeta guía.
2. `python herramientas\tiktok3d.py voz videos\V004-comenta-tu-nombre-y-te-lo-hago-en-3d` → transcribe tu voz y muestra dónde empieza cada escena.
3. `python herramientas\tiktok3d.py video videos\V004-comenta-tu-nombre-y-te-lo-hago-en-3d` → `salida\V004-final.mp4` (o `-animatic` con la lista de lo que falta).
4. `python herramientas\tiktok3d.py revisar videos\V004-comenta-tu-nombre-y-te-lo-hago-en-3d\salida\V004-final.mp4` y mira los fotogramas.

## 7. Audio
- Voz: **la tuya** (`clips/cara.mp4`). Efectos de `audio/sfx` ya puestos por escena en `video.json`.
- Música dentro del archivo: ninguna. Añade un sonido en tendencia **en la app** al publicar (5-15 % bajo la voz).

## 8. Publicación
Caption:
```
Llavero con tu nombre en 3D por $10.000 🎄
Lo diseñamos, te mostramos cómo queda y lo fabricamos en nuestro taller de Bucaramanga. Envíos a toda Colombia.
Comenta tu nombre y el próximo video es el tuyo 👇
#regalospersonalizados #llaveropersonalizado #impresion3d #navidad #pabonitas
```
- Portada (texto): **TU NOMBRE EN 3D**
- Ajustes: público · comentarios ON · dúo/stitch ON · "Tu marca" ON · contenido IA: no (tu cara y tu voz)
- Hora: **vie 6-nov · 18:30**

## 9. Notas y reglas de este video
- **Serie de respuestas (formato F2):** de W45 a W47 responde 1-2 comentarios al día **con video** (Responder → video). 10-15 s: "¡Aquí está el tuyo, [NOMBRE]!" → timelapse corto → llavero en tu mano → "cuesta 10 mil, escríbeme si lo quieres". Elige nombres comunes o curiosos: más gente se identifica.
- "Te lo hago en 3D" = lo diseño y lo muestro en un video. No es un regalo gratis para todos. Si quieres hacer un sorteo, define antes las reglas [DATO].
- Si alguien lo quiere de verdad, pasa al DM con la respuesta rápida PRECIOS (campaña §6) y anótalo en `registro/pedidos-tiktok.csv`.
- Va fijado en el perfil (pin 1).

## 10. Resultados (`registro/metricas.csv` a las 24 h, 72 h y 7 d · consultas en `registro/pedidos-tiktok.csv`)
- Aprendizaje (1 línea, pásalo a `aprendizajes/aprendizajes.md`):
