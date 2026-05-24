# Vialink — Actualización: los buses ahora siguen calles reales

> **Para:** David (lectura no técnica) + el agente IA del frontend de Sebastián
> **Sesión:** 23 May 2026 noche
> **TL;DR:** Antes los buses se veían atravesando edificios. Hoy se arregló a nivel de backend (sin tocar el frontend). Solo falta agregar 7 animaciones para que la demo se vea cinematográfica.

---

## 1. ¿Qué pasaba antes? (el problema en lenguaje claro)

Imagina que para dibujar la ruta del bus C12 entre el Centro y Uninorte yo le había marcado al sistema **solo 11 puntos clave**, como si fueran las paradas principales: "sale del Centro, pasa por la Catedral, llega a Romelio, sigue por Mall Plaza, etc.".

El problema: entre cada par de esos puntos, el sistema **dibujaba una línea recta**, sin importar que ahí hubiera edificios, parques o cuadras enteras. Es como cuando uno se imagina un mapa y dice "voy del punto A al punto B" trazando una recta — pero en la realidad uno tiene que dar la vuelta por una calle.

**Resultado visible:** cuando el bus se movía entre dos de esos puntos, aparecía cortando a través de barrios, casas o el río. Se veía irreal.

---

## 2. ¿Qué se implementó? (la solución, en 2 pasos)

### Paso 1: "Snap to roads" — pegar las rutas a las calles

Le pedí a Mapbox (el servicio de mapas) que tomara mis 11 puntos del C12 y me devolviera **el recorrido real siguiendo calles**: cada giro, cada esquina, cada avenida. En vez de 11 puntos, ahora tengo 519.

Hice eso para las 16 rutas (las 14 tradicionales + las 2 de Transmetro). Pasamos de 110 puntos dibujados a mano → **7,402 puntos siguiendo calles**.

**Cuánto mejoró:** mucho. Los buses ya no cortaban por edificios *grandes*.

**Pero quedó un problema sutil:** Mapbox solo te da un punto en cada **giro**. Cuando una ruta sigue por una avenida larga (ej. la Murillo) durante 1km sin dar vueltas, Mapbox te marca dos puntos: el inicio y el fin del tramo recto. Entre esos dos puntos el bus se movía recto — lo cual está bien si la avenida es recta, pero **en algunas zonas esa "recta" cortaba una cuadra esquinada o un parque**.

### Paso 2: "Refinement" — densificar para que ningún tramo sea recto largo

Tomé el polyline ya pegado a las calles, **agregué puntos intermedios cada 25 metros** (rellenando los tramos largos), y le pedí a Mapbox que cada uno de esos puntos también lo "snapeara" a la calle más cercana. Esto se llama **Map Matching**.

**Lo importante:** ahora **ningún tramo entre dos puntos consecutivos del recorrido es mayor a 25 metros**. Eso significa que no hay manera de que el bus cruce una cuadra entera — siempre está sobre una calle.

### Métricas antes vs después

| Ruta | Antes | Después |
|---|---|---|
| C12 (Centro - Uninorte) | máximo salto: 257m | máximo salto: 25m |
| S12 (Sabanilla - Centro) | máximo salto: **1,138m** ← muy mal | máximo salto: 25m |
| C5 (Galapa - Centro) | máximo salto: 403m | máximo salto: 25m |
| ... | ... | ... |
| **TODAS las 16 rutas** | en promedio 100+ segmentos defectuosos | **0 segmentos defectuosos** |

---

## 3. ¿Por qué ahora SÍ va a funcionar?

Tres garantías concretas:

1. **Cualquier bus, en cualquier momento, está sobre una calle.** Lo verifiqué con la base de datos: la distancia entre cada bus y la calle donde "debe" estar es exactamente 0 metros.

2. **A cualquier zoom level se ve bien.** Antes solo se veía decente con el mapa "desde lejos". Ahora incluso si haces zoom máximo (ver edificios individuales) el bus sigue estando sobre la calle.

3. **El cambio es invisible para el frontend.** Sebastián no tiene que tocar una sola línea de código. El frontend pide la información del bus al backend exactamente igual que antes, pero el backend ahora le da datos correctos.

---

## 4. ¿Cómo cae esto al frontend? (sin tocar código)

Esto es importante: el frontend ya está funcionando bien con el código que Sebastián escribió. Lo que cambió es **los datos que el backend le envía**.

Analogía: imagínalo como si Sebastián hubiera construido una vitrina que recibe ropa de un proveedor. La vitrina ya está armada y se ve bien. Yo (el proveedor) le mandaba ropa con manchas. Ahora le mando ropa limpia. La vitrina sigue siendo la misma vitrina — solo se ve mejor lo que muestra.

**Estado actual del frontend de Sebastián** (rama `claude/bold-yalow-312f6f`):

| Lo que ya implementó | ¿Hecho? |
|---|---|
| Buscador de direcciones con autocomplete (Sprint 1) | ✅ Sí, con tests |
| Modal al hacer click en un bus (Sprint 2) | ✅ Sí, con tests |
| Dibuja la línea de la ruta cuando seleccionás un bus | ✅ Sí |
| Se conecta al backend para recibir movimientos en vivo | ✅ Sí |
| Bus3DMarker con halo cuando se selecciona | ✅ Sí |
| Manejo de errores (404, 410, mock IDs) | ✅ Sí |

**Lo único que falta del frontend:** las **7 animaciones para el pitch** (Sprint 3). Esto es polish visual, no funcionalidad nueva.

---

## 5. ¿Qué falta hacer en el frontend para llegar 10/10 al pitch?

Las 7 animaciones que documenté en `docs/frontend-implementation.md` sección 13.11. En orden de impacto visual:

| # | Animación | Por qué importa para el pitch |
|---|---|---|
| 1 | **EtaCountdown en vivo** ⭐ | Cuando el jurado abra el modal del bus, el número de minutos va a contar hacia abajo (5 min → 4 min → 3 min...) al mismo tiempo que ve el bus acercarse en el mapa. Sincronía visual = sensación de "esto es real" |
| 2 | **Polyline que se dibuja como un trazo** | Cuando se selecciona un bus, la línea de la ruta aparece dibujándose desde el inicio hasta el final (~1 segundo). Más cinematográfico que aparecer de golpe |
| 3 | **Bus seleccionado con halo pulsante** | El bus elegido tiene un círculo de luz alrededor que pulsa, y los otros buses se atenúan. El jurado entiende inmediatamente cuál está mirando |
| 4 | **Botón "Avísame" se transforma en check verde** | Cuando se hace click en el botón, en lugar de un toast, el mismo botón cambia a verde con un ✓. Detalle premium |
| 5 | **Modal sube con física de resorte** | Cuando se abre el modal, sube con rebote suave (no robóticamente). Estándar de iOS |
| 6 | **Bus apunta hacia donde va** | Hoy el bus está siempre orientado hacia arriba. Con esto, rota según la dirección real (norte/sur/este/oeste/diagonales) |
| 7 | **Trail detrás del bus** (opcional) | Pequeña "estela" detrás del bus seleccionado. Solo si sobra tiempo |

Cada una está completamente especificada con código copy-paste en el doc técnico. Su agente IA puede implementarlas en orden, ~3-4 horas total.

---

## 6. Acciones inmediatas

### Para ti (David)

1. **Levanta tu backend local**: `pnpm start:prod` (Sebastián apunta a `http://localhost:3000`). Si no quieres tener el backend prendido en tu Mac, hacer push a Railway y avisar a Sebastián que cambie su `.env.local` a `VITE_API_URL=https://vialink-backend-production.up.railway.app`
2. **Manda este documento a Sebastián** + el prompt del final
3. (Opcional) Validar visualmente en geojson.io que el polyline de C12 se ve bien

### Para Sebastián (después de leer este doc)

1. Refresca su frontend y verifica que ya los buses se ven sobre calles reales (sin tocar código)
2. Implementa las 7 animaciones del pitch usando el prompt del final
3. QA visual final en iPhone real

---

## 7. 🤖 Prompt para el agente IA del frontend

> Copia desde `>>>` hasta `<<<` y pásaselo a tu agente IA (Cursor/Claude Code/etc.):

```
>>>

Vamos a agregar las animaciones del pitch al frontend de Vialink.

CONTEXTO IMPORTANTE:
- Estás trabajando en la rama claude/bold-yalow-312f6f del frontend
- Ya implementaste los Sprints 1 (geocoding/buscador) y 2 (click-on-bus)
- El backend YA tiene los corridors siguiendo calles reales (sin acción de tu parte)
- El frontend está apuntando a http://localhost:3000 (backend de David corriendo en su mac) con VITE_USE_MOCKS=false

LO QUE FALTA:
Sprint 3 — las 7 animaciones documentadas en sección 13.11 del documento
docs/frontend-implementation.md del repo del backend
(https://github.com/davideliaspalacio/vialink-backend/blob/main/docs/frontend-implementation.md)

Si ese doc no está disponible, en este mismo repo (frontend) probablemente
existe una copia local. Si no, pídele a David que te lo mande.

REGLAS INVIOLABLES (las mismas de antes):
1. NO reescribir src/lib/api.ts
2. NO reescribir src/hooks/useRealtime.ts
3. NO reescribir src/lib/dataSource.ts — solo extender si hace falta
4. Mantén la estructura existente: components/, hooks/, lib/, types/
5. TDD: test rojo → código verde → refactor
6. Mobile-first 393px
7. Cada animación es un commit separado, con mensaje "feat(anim): <descripcion>"

ORDEN DE IMPLEMENTACIÓN (por impacto visual descendente):

1. EtaCountdown.tsx (45 min) ⭐ EL WOW
   - Componente nuevo en src/components/ui/EtaCountdown.tsx
   - Recibe initialEtaSeconds como prop
   - Cuenta hacia abajo cada segundo (setInterval)
   - Cambia de color cuando faltan <60s (verde), <30s (naranja pulsante)
   - Cuando llega a 0: muestra "🚌 Llegando ahora"
   - Usar framer-motion para transiciones entre números (AnimatePresence con key=segundos)
   - Integrar en BusDetailSheet.tsx reemplazando los números estáticos de ETA

2. AnimatedRoutePolyline.tsx (1h)
   - Componente nuevo que reemplaza el <Polyline> normal en MapaPage
   - Al montarse, usa SVG strokeDashoffset trick para "dibujar" el polyline
     desde inicio hasta fin en ~800ms
   - Al desmontarse, fade out simple

3. Bus seleccionado con halo pulsante (20 min)
   - Ya tienes el halo en Bus3DMarker.tsx cuando isSelected
   - Agrega animación CSS @keyframes bus-pulse (scale + opacity)
   - Otros buses con opacity 0.35 cuando hay uno seleccionado (prop dimmed)
   - Transition suave 0.4s

4. AvisameButton — botón se transforma en check (30 min)
   - El BusDetailSheet actual no tiene el botón "Avísame cuando llegue"
   - Agregarlo: crea el botón al final del sheet
   - Estados: idle → loading → success
   - En success: motion.button con layout, cambia background a success y muestra "✓ Te avisaremos a 3 min"
   - Si user no tiene ubicación: disabled con tooltip

5. Spring physics al abrir BottomSheet (5 min)
   - Modificar BottomSheet.tsx (o el equivalente que uses)
   - Si usa framer-motion: cambiar transition a { type: 'spring', damping: 30, stiffness: 300 }
   - Si usa CSS: cambiar a framer-motion

6. Bus rotación según heading (10 min)
   - Bus3DMarker ya recibe bus.heading
   - El icono debe rotar con transform: rotate(${heading}deg)
   - Transition: transform 1s linear (mismo tick que la posición)

7. Trail behind bus (opcional, 1h)
   - Solo si llegas con tiempo extra
   - useRef<Array<[lat, lng]>>(5) que push/shift cada vez que el bus se mueve
   - Renderiza 5 markers fantasma con opacidad decreciente detrás del bus seleccionado

PARA CADA ANIMACIÓN:
- Lee el código copy-paste de sección 13.11 del doc técnico
- Crea archivo + tests primero (RED)
- Implementa código (GREEN)
- Corre `pnpm test` y confirma verde
- Verifica visualmente en `pnpm dev` (responsive 393px en DevTools)
- Commit con mensaje claro
- Pasa a la siguiente

CUANDO TERMINES:
- Muestra resultado final de pnpm test (todas verdes)
- Lista de archivos creados/modificados
- Screenshot mental: ¿el modal del bus se ve cinematográfico ahora?

EMPIEZA POR EL #1 (EtaCountdown) — es el de mayor impacto visual y donde
queremos ver el "wow" durante el pitch.

<<<
```

---

## 8. Cómo verificar tú mismo que los buses están bien

Si quieres ver con tus ojos que los buses ya están sobre calles, hay 3 maneras:

### Opción A: Abrir el frontend de Sebastián

Que Sebastián levante su `pnpm dev`. Tú levantas el backend con `pnpm start:prod`. Abre el frontend en el navegador, navega al mapa, haz **zoom muy alto** (zoom 18 o 19, ver edificios) sobre algún bus. Vas a ver que el bus está sobre la calle.

### Opción B: GeoJSON.io con el polyline directo

```bash
# En terminal, con backend corriendo en local o usando Railway:
curl https://vialink-backend-production.up.railway.app/api/v1/routes \
  | jq -r '.routes[] | select(.code=="C12") | .id' \
  | xargs -I{} curl https://vialink-backend-production.up.railway.app/api/v1/routes/{}/corridor.geojson
```

Copia el JSON que sale, pégalo en https://geojson.io → ves la línea del C12 siguiendo cada giro de las calles de Barranquilla.

### Opción C: Confiar en las métricas

```
Ruta C12: 997 puntos en 17.65 km → punto cada ~17 metros de promedio
Máximo salto entre puntos: 25 metros (= ancho de una calle típica)
```

Es matemáticamente imposible que el bus "atraviese" una cuadra si entre cada punto del recorrido hay máximo 25 metros.

---

## 9. Estado del deployment

| Componente | Local | Producción (Railway) |
|---|---|---|
| Backend NestJS | Sebastián apunta acá con `VITE_API_URL=http://localhost:3000` | Sin los 3 endpoints nuevos de hoy (/geocode, /buses-at-address, /buses/:id/details). Sí tiene corridors refinados |
| Corridors refinados | ✅ Vivo | ✅ **Vivo** (DB compartida, sin redeploy) |
| `/geocode` | ✅ Vivo en local | ⏸️ Sin deploy. Para activarlo: push + config MAPBOX_ACCESS_TOKEN en Railway Variables |
| `/buses-at-address` | ✅ Vivo en local | ⏸️ Sin deploy (depende del geocode) |
| `/buses/:id/details` | ✅ Vivo en local | ⏸️ Sin deploy |
| Asistente Claude con `geocode_address` tool | ✅ Vivo en local | ⏸️ Sin deploy |

**Recomendación:** push a Railway cuando estés tranquilo para que Sebastián pueda apuntar a `https://vialink-backend-production.up.railway.app` y no dependa de que tu Mac esté prendida. Es 1 comando + 1 variable de entorno en el dashboard.

---

— David Palacio · Backend Lead Vialink
