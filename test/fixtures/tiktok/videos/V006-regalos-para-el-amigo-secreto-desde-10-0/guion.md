---
id: V006
titulo: "Regalos para el amigo secreto desde $10.000"
estado: guion            # idea | guion | grabado | editado | listo | publicado | medido
pilar: tendencia-promo        # mira-como | util | ensena | historia | tendencia-promo
formula: T7    # T1..T10 (ver skill tiktok-marketing/references/hook-formulas.md)
objetivo: guardados
duracion_objetivo_s: 22
fecha_creado: 2026-11-03
fecha_plan: 2026-11-08T18:00
fecha_publicado:
url:
campana: navidad-2026
idea: I033
---

# V006 · Regalos para el amigo secreto desde $10.000

> Campaña de Navidad 2026 (`estrategia/campana-navidad-2026.md`) · Publicación: **dom 8-nov · 18:00**
> Con **tu cara y tu voz**. La voz IA del animatic (`salida/V006-animatic.mp4`) es solo una guía de ritmo.

## 1. Idea en una frase
> Lista con precios reales del catálogo para el amigo secreto: la gente la guarda y la comparte en el grupo de la oficina.

## 2. Hook (0-3 s): las 3 capas disparan a la vez
| Capa | Contenido |
|---|---|
| Frase hablada | "¿Te tocó amigo secreto y no sabes qué regalar?" |
| Texto en pantalla | AMIGO SECRETO DESDE $10.000 |
| Primer fotograma | Tú detrás de una mesa con los 5 productos en fila, de menor a mayor precio |

## 3. Texto para decir a cámara (teleprompter)
> Léelo **de corrido en una sola toma** mirando al lente (teleprompter de CapCut o similar), con energía y sonriendo.
> Si te equivocas, haz una pausa de 2 s y repite la frase entera. Puedes improvisar: los subtítulos salen de lo que digas.
> Cada número es un bloque = una escena. Está igual en `video.json → voz.texto`, separado con `|`.

1. ¿Te tocó amigo secreto y no sabes qué regalar? Mira, desde 10 mil pesos.
2. Llavero con su nombre: 10 mil.
3. Su nombre en 3D para el escritorio: 18 mil.
4. Soporte para el celular: 20 mil.
5. Organizador de escritorio o figura decorativa: 25 mil.
6. Todo personalizado, hecho en nuestro taller y con envío a toda Colombia. Guárdalo para cuando te toque.

## 4. Guion por escenas
| Escena | Visual / toma (archivo) | Voz (bloque) | Texto en pantalla | Sonido |
|---|---|---|---|---|
| 1 | **CARA** `clips/cara.mp4`: Tú detrás de la mesa con los 5 productos en fila | ¿Te tocó amigo secreto y no sabes qué regalar? Mira, desde 10 mil pesos. | AMIGO SECRETO DESDE $10.000 | pop |
| 2 | **B-ROLL** `clips/p1-llavero.mp4`: Mano levantando el llavero con nombre (fondo limpio) | Llavero con su nombre: 10 mil. | $10.000 | pop |
| 3 | **B-ROLL** `clips/p2-nombre.mp4`: Nombre decorativo 3D sobre un escritorio | Su nombre en 3D para el escritorio: 18 mil. | $18.000 | pop |
| 4 | **B-ROLL** `clips/p3-soporte.mp4`: Soporte con un celular puesto | Soporte para el celular: 20 mil. | $20.000 | pop |
| 5 | **B-ROLL** `clips/p4-organizador.mp4`: Organizador de escritorio con cosas dentro (o una figura decorativa) | Organizador de escritorio o figura decorativa: 25 mil. | $25.000 | pop |
| 6 | **CARA** `clips/cara.mp4`: Tú con el llavero en la mano, guiño final | Todo personalizado, hecho en nuestro taller y con envío a toda Colombia. Guárdalo para cuando te toque. | GUÁRDALO | ding |

Cierre en bucle: la última frase conecta con la primera.

## 5. Lista de tomas (sesión de grabación)
- [ ] `clips/cara.mp4`: **toma continua a cámara** leyendo el texto de la sección 3 completo (se usa en las escenas 1, 6; en el resto suena tu voz sobre el b-roll). Vertical, ojos al lente, luz de frente, micrófono de solapa si tienes
- [ ] `clips/p1-llavero.mp4`: Mano levantando el llavero con nombre (fondo limpio) (escena 2, 3-5 s)
- [ ] `clips/p2-nombre.mp4`: Nombre decorativo 3D sobre un escritorio (escena 3, 3-5 s)
- [ ] `clips/p3-soporte.mp4`: Soporte con un celular puesto (escena 4, 3-5 s)
- [ ] `clips/p4-organizador.mp4`: Organizador de escritorio con cosas dentro (o una figura decorativa) (escena 5, 3-5 s)
- Nota: Los 4 b-rolls se graban en 10 minutos con el mismo fondo y la misma luz: 3-4 s por producto, moviéndolo despacio.

## 6. Montaje
1. Guarda los clips en `clips/` **con estos nombres exactos**. Lo que aún no exista sale como tarjeta guía.
2. `python herramientas\tiktok3d.py voz videos\V006-regalos-para-el-amigo-secreto-desde-10-0` → transcribe tu voz y muestra dónde empieza cada escena.
3. `python herramientas\tiktok3d.py video videos\V006-regalos-para-el-amigo-secreto-desde-10-0` → `salida\V006-final.mp4` (o `-animatic` con la lista de lo que falta).
4. `python herramientas\tiktok3d.py revisar videos\V006-regalos-para-el-amigo-secreto-desde-10-0\salida\V006-final.mp4` y mira los fotogramas.

## 7. Audio
- Voz: **la tuya** (`clips/cara.mp4`). Efectos de `audio/sfx` ya puestos por escena en `video.json`.
- Música dentro del archivo: ninguna. Añade un sonido en tendencia **en la app** al publicar (5-15 % bajo la voz).

## 8. Publicación
Caption:
```
Regalos para el amigo secreto desde $10.000 🎁
Llavero con nombre $10.000 · Nombre decorativo 3D $18.000 · Soporte para celular $20.000 · Organizador o figura $25.000. Personalizados y con envío a toda Colombia.
Envíaselo a quien organiza el amigo secreto de tu oficina 👇
#amigosecreto #regalosdenavidad #ideasderegalo #regalospersonalizados #pabonitas
```
- Portada (texto): **AMIGO SECRETO DESDE $10.000**
- Ajustes: público · comentarios ON · dúo/stitch ON · "Tu marca" ON · contenido IA: no (tu cara y tu voz)
- Hora: **dom 8-nov · 18:00**

## 9. Notas y reglas de este video
- Precios = catálogo de pabonitas.co (nov-2026). Si cambian, cambia guion, `video.json` y caption.
- No digas "envío gratis" salvo que lo decidas (campaña §5).
- Parte 2 en W47: por presupuesto ("amigo secreto de 20 mil" / "de 30 mil").
- Va fijado en el perfil (pin 2).

## 10. Resultados (`registro/metricas.csv` a las 24 h, 72 h y 7 d · consultas en `registro/pedidos-tiktok.csv`)
- Aprendizaje (1 línea, pásalo a `aprendizajes/aprendizajes.md`):
