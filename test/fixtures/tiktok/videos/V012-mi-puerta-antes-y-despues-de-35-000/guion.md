---
id: V012
titulo: "Mi puerta antes y después de $35.000"
estado: guion            # idea | guion | grabado | editado | listo | publicado | medido
pilar: util        # mira-como | util | ensena | historia | tendencia-promo
formula: T1    # T1..T10 (ver skill tiktok-marketing/references/hook-formulas.md)
objetivo: compartidos
duracion_objetivo_s: 18
fecha_creado: 2026-11-03
fecha_plan: 2026-11-07T11:00
fecha_publicado:
url:
campana: navidad-2026
idea: I039
---

# V012 · Mi puerta antes y después de $35.000

> Campaña de Navidad 2026 (`estrategia/campana-navidad-2026.md`) · Publicación: **sáb 7-nov · 11:00**
> Con **tu cara y tu voz**. La voz IA del animatic (`salida/V012-animatic.mp4`) es solo una guía de ritmo.

## 1. Idea en una frase
> La funda navideña sublimada transforma la puerta: antes/después muy compartible, con precio real.

## 2. Hook (0-3 s): las 3 capas disparan a la vez
| Capa | Contenido |
|---|---|
| Frase hablada | "Así quedó mi puerta por 35 mil pesos." |
| Texto en pantalla | MI PUERTA POR $35.000 |
| Primer fotograma | La puerta ya decorada con la funda (el resultado primero), plano completo |

## 3. Texto para decir a cámara (teleprompter)
> Léelo **de corrido en una sola toma** mirando al lente (teleprompter de CapCut o similar), con energía y sonriendo.
> Si te equivocas, haz una pausa de 2 s y repite la frase entera. Puedes improvisar: los subtítulos salen de lo que digas.
> Cada número es un bloque = una escena. Está igual en `video.json → voz.texto`, separado con `|`.

1. Así quedó mi puerta por 35 mil pesos.
2. Antes era así.
3. Le pongo la funda navideña, sublimada en nuestro taller…
4. Hay de Santa, Mamá Noel, Cascanueces, Reno, Nacimiento y Merry Christmas.
5. 35 mil pesos, con envío a toda Colombia. ¿Cuál pondrías en la tuya? Comenta.

## 4. Guion por escenas
| Escena | Visual / toma (archivo) | Voz (bloque) | Texto en pantalla | Sonido |
|---|---|---|---|---|
| 1 | **B-ROLL** `clips/despues.mp4`: Plano completo de la puerta con la funda puesta, luz cálida | Así quedó mi puerta por 35 mil pesos. | MI PUERTA POR $35.000 | pop |
| 2 | **B-ROLL** `clips/antes.mp4`: El mismo encuadre, la puerta sin nada (trípode en el mismo sitio) | Antes era así. | ANTES | whoosh |
| 3 | **B-ROLL** `clips/poniendo.mp4`: Tú poniendo la funda (la herramienta lo acelera para que quepa) | Le pongo la funda navideña, sublimada en nuestro taller… | · | whoosh |
| 4 | **B-ROLL** `clips/disenos.mp4`: Las fundas extendidas o fotos de los 6 diseños | Hay de Santa, Mamá Noel, Cascanueces, Reno, Nacimiento y Merry Christmas. | 6 DISEÑOS | pop |
| 5 | **CARA** `clips/cara.mp4`: Tú frente a la puerta decorada, a cámara | 35 mil pesos, con envío a toda Colombia. ¿Cuál pondrías en la tuya? Comenta. | ¿CUÁL ELIGES? | ding |

Cierre en bucle: la última frase conecta con la primera.

## 5. Lista de tomas (sesión de grabación)
- [ ] `clips/despues.mp4`: Plano completo de la puerta con la funda puesta, luz cálida (escena 1, 3-5 s)
- [ ] `clips/antes.mp4`: El mismo encuadre, la puerta sin nada (trípode en el mismo sitio) (escena 2, 3-5 s)
- [ ] `clips/poniendo.mp4`: Tú poniendo la funda (la herramienta lo acelera para que quepa) (escena 3, 3-5 s)
- [ ] `clips/disenos.mp4`: Las fundas extendidas o fotos de los 6 diseños (escena 4, 3-5 s)
- [ ] `clips/cara.mp4`: **toma continua a cámara** leyendo el texto de la sección 3 completo (se usa en las escenas 5; en el resto suena tu voz sobre el b-roll). Vertical, ojos al lente, luz de frente, micrófono de solapa si tienes
- Nota: Trípode fijo: el ANTES y el DESPUÉS tienen que tener exactamente el mismo encuadre.

## 6. Montaje
1. Guarda los clips en `clips/` **con estos nombres exactos**. Lo que aún no exista sale como tarjeta guía.
2. `python herramientas\tiktok3d.py voz videos\V012-mi-puerta-antes-y-despues-de-35-000` → transcribe tu voz y muestra dónde empieza cada escena.
3. `python herramientas\tiktok3d.py video videos\V012-mi-puerta-antes-y-despues-de-35-000` → `salida\V012-final.mp4` (o `-animatic` con la lista de lo que falta).
4. `python herramientas\tiktok3d.py revisar videos\V012-mi-puerta-antes-y-despues-de-35-000\salida\V012-final.mp4` y mira los fotogramas.

## 7. Audio
- Voz: **la tuya** (`clips/cara.mp4`). Efectos de `audio/sfx` ya puestos por escena en `video.json`.
- Música dentro del archivo: ninguna. Añade un sonido en tendencia **en la app** al publicar (5-15 % bajo la voz).

## 8. Publicación
Caption:
```
Mi puerta antes y después de una funda navideña de $35.000 🎄
Sublimada en nuestro taller de Bucaramanga. Diseños: Santa, Mamá Noel, Cascanueces, Reno, Nacimiento y Merry Christmas. Envíos a toda Colombia.
¿Cuál pondrías en tu puerta? 👇
#decoracionnavideña #navidad #antesydespues #hogar #pabonitas
```
- Portada (texto): **MI PUERTA ANTES Y DESPUÉS**
- Ajustes: público · comentarios ON · dúo/stitch ON · "Tu marca" ON · contenido IA: no (tu cara y tu voz)
- Hora: **sáb 7-nov · 11:00**

## 9. Notas y reglas de este video
- [CONFIRMAR] medidas de la funda y para qué puertas sirve. Ponlo en un comentario fijado.
- Diseños genéricos, sin personajes con marca.

## 10. Resultados (`registro/metricas.csv` a las 24 h, 72 h y 7 d · consultas en `registro/pedidos-tiktok.csv`)
- Aprendizaje (1 línea, pásalo a `aprendizajes/aprendizajes.md`):
