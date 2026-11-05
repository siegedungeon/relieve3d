---
id: {{ID}}
titulo: "{{TITULO}}"
estado: idea            # idea | guion | grabado | editado | listo | publicado | medido
pilar: {{PILAR}}        # mira-como | util | ensena | historia | tendencia-promo
formula: {{FORMULA}}    # T1..T10 (ver skill tiktok-marketing/references/hook-formulas.md)
objetivo: completar     # completar | guardados | comentarios | compartidos | seguidores | DMs
duracion_objetivo_s: 20
fecha_creado: {{FECHA}}
fecha_plan:
fecha_publicado:
url:
---

# {{ID}} · {{TITULO}}

## 1. Idea en una frase
> (Una sola idea por video. ¿Qué se lleva el espectador? ¿Qué producto y precio real se ve?)

## 2. Hook (0-3 s): las 3 capas disparan a la vez
| Capa | Contenido |
|---|---|
| Frase hablada | |
| Texto en pantalla (≤ 7 palabras, distinto de la frase) | |
| Primer fotograma (visual) | |

## 3. Texto para decir a cámara (teleprompter)
> Léelo **de corrido en una sola toma** mirando al lente (teleprompter de CapCut o similar), con energía y sonriendo.
> Si te equivocas, haz una pausa de 2 s y repite la frase entera: luego se recorta esa parte.
> Las `|` marcan los cortes de escena: no se leen. Está escrito igual en `video.json → voz.texto`.

```
(texto)
```

## 4. Guion por escenas
| Escena | Visual / toma | Voz (bloque) | Texto en pantalla | Sonido |
|---|---|---|---|---|
| 1 | CARA: hook | | | pop |
| 2 | B-ROLL | | | whoosh |
| 3 | CARA: cierre en bucle + CTA | | | |

## 5. Lista de tomas (sesión de grabación)
- [ ] `clips/cara.mp4`: la **toma continua** a cámara (vertical, ojos al lente, luz de frente, micrófono de solapa si tienes)
- [ ] `clips/broll1.mp4`: …
- [ ] Timelapse de la impresión (Bambu Handy/Studio) → `clips/timelapse.mp4`
- [ ] 10 s de sonido limpio de la impresora (sin voz)

## 6. Montaje
1. Guarda los clips en `clips/` **con estos nombres exactos**. `video.json` ya los espera: lo que falte sale como tarjeta guía.
2. `python herramientas\tiktok3d.py voz videos\{{ID}}-…` → transcribe tu voz y muestra dónde empieza cada escena.
3. `python herramientas\tiktok3d.py video videos\{{ID}}-…` → `salida\{{ID}}-final.mp4` (o `-animatic` si falta algo, con la lista de lo que falta).
4. Si improvisas, no pasa nada: los subtítulos salen de lo que dijiste de verdad.

## 7. Audio
- Voz: **la tuya** (`clips/cara.mp4`). Voz guía IA solo para el animatic.
- Sonido ambiente de la impresora: sí / no
- Música dentro del archivo: ninguna. El sonido en tendencia se añade **en la app de TikTok** al publicar (5-15 % bajo la voz).
- Efectos: pop / whoosh / ding (de `audio/sfx`)

## 8. Publicación
- Caption (1ª línea con palabra clave buscable + precio real si aplica; ver `estrategia/hashtags-y-seo.md`):
- Hashtags (4-5, set N1-N7 o A-E):
- Portada (texto):
- Ajustes: público · comentarios ON · dúo/stitch ON · "Tu marca" ON si vende · contenido IA: no (tu voz real)
- Hora de publicación:

## 9. Resultados (`registro/metricas.csv` a las 24 h, 72 h y 7 d; consultas en `registro/pedidos-tiktok.csv`)
- Aprendizaje (1 línea, pásalo a `aprendizajes/aprendizajes.md`):
