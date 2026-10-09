# Revisión de velocidad y plan de diseño (9-oct-2026)

Revisión hecha con datos REALES de producción: bitácoras de Vercel de las
últimas 23 h (el código ya cronometra algunas pantallas con `[tiempo]`),
`pg_stat_statements` de Supabase (28 días), los avisos de rendimiento de
Supabase, el tamaño real de los renglones de caché y el build de producción.
Nada se cambió todavía.

## Resumen en una línea

El sistema es lento por **cuatro causas**, en este orden de peso:

1. **La seguridad por renglón (RLS) de la base está escrita de la forma lenta.**
   Toda consulta que hace una pantalla tarda en promedio **226 ms**; la misma
   clase de consulta hecha por el trabajo de fondo tarda **10 ms**. Medido:
   la lista de pedidos cortados de TikTok tarda **432 ms con RLS y 24 ms sin
   ella** (18 veces más). 135 de las 151 políticas tienen este problema.
2. **Varias pantallas calculan en el clic** en vez de leer un renglón ya
   masticado (va contra la regla de arquitectura del propio sistema):
   Ventas, Publicidad, Planificación China, Despacho TikTok, Ventas de fundas,
   Amazon ventas.
3. **Pantallas que bajan MEGAS de la base y los mandan al navegador**:
   el plan de Full completo (1.9 MB) en cada visita a Envíos; plan +
   inventario + sugerencia (≈5 MB) en Planificación China; el plan de fundas
   (3.9 MB) en Envíos y Etiquetas de fundas; 15 mil SKUs de fundas en una
   lista desplegable.
4. **Detalles del armazón** que hacen que TODO se sienta más lento: la página
   se desmonta y se anima en cada cambio de pestaña, casi ninguna pantalla
   muestra su título antes de tener todos los datos, y la barra de estado
   recarga la pantalla completa cada vez que se genera un plan nuevo.

Lo que **NO** es el problema (revisado y descartado):

- Región: Vercel (iad1) y Supabase (us-east-1) están en el mismo lugar.
- Peso del JavaScript: casi todas las páginas cargan ~105 KB, que es normal.
  Solo 6 pantallas pesan ~370 KB (Despacho, Contenedores, Preparar, Conteo).
- Memoria de la base: 98.8 % de las lecturas salen de memoria.
- El middleware ya lee la sesión sin viajar a Supabase.

## Tiempos medidos por pantalla

| Pantalla | Tiempo hoy | Por qué |
|---|---|---|
| **Ventas MELI** (`/ventas`) | **15–35 s** (medido, 142 visitas ayer) | El monitor se calcula en el clic (la caché dura 60 s y nadie la precalcula); la publicidad nunca se guarda (se descarta si trae avisos, y casi siempre trae); baja 18 mil fotos de stock en 19 páginas solo para escribir el «por qué» de 16 renglones. Cada búsqueda o cambio de orden en la tabla **vuelve a calcular todo** (~7 s por tecla). |
| **Publicidad** (`/publicidad`) | ~6–8 s | La misma publicidad sin caché; puede llamar al API de MELI en vivo. |
| **Despacho TikTok** (`/tiktok/despacho`) | 5–10 s, a veces se corta | Baja **todo el historial**: las 16 mil preparaciones y los 16 mil pedidos ya cortados de todos los cortes, ~50 consultas por visita, 36 de ellas de 1.4 s cada una. Los pendientes se leen dos veces. Cada ronda de corte recarga todo otra vez. |
| **Planificación China** (`/pedidos`) | lenta; la primera del día 10–60 s | Baja ≈5 MB aunque la sugerencia ya esté guardada; si la sugerencia tiene más de 30 min se recalcula en el clic. Además hay un error: al invalidar se marca la clave vieja `compras-china` y no la actual `compras-china:v2`, así que solo se refresca por tiempo. |
| **Envíos a Full** (`/envios`) | media | Baja el plan completo (1.9 MB) en cada visita y manda ~800 KB al navegador; filtra 2,600 renglones en cada tecla. |
| **Preparar pedido** (estación) | unos segundos | Lee los 27 mil renglones de pedidos de toda la historia para quedarse con los de un corte, y le vuelve a preguntar a TikTok paquete por paquete en cada carga. |
| **Ventas fundas** (`/yapanizcel/ventas`) | 5–15 s | Sin caché; el ayudante que pagina RPCs de fundas no tiene el arreglo del tope de 1,000 renglones que ya tiene calzado, así que repite el RPC completo ~15 a 35 veces. Esto también hace que el corte de fundas se corte por tiempo en el cron. |
| **Envíos / Etiquetas fundas** | media | Bajan los 3.9 MB del plan de fundas para enseñar unos cientos de renglones. |
| **SKUs / Listados fundas** | lenta | Bajan los 14,864 SKUs en 15 páginas con RLS; SKUs los mete en una lista desplegable de 15 mil opciones. |
| **Cortes de fundas** | se dispara trabajo de 15–74 s | Cada visita con datos de más de 10 min lanza un recálculo con la sesión del usuario (con RLS), que choca con el tope de 8 s. |
| **Amazon ventas** | 2–27 s | La caché se llena solo por mes; el rango de 7 días por omisión se calcula en el clic. |
| **Almacén TikTok, Precios, Videos, Productos nuevos TikTok, Costos de envío** | medias | Lecturas grandes con RLS o RPCs sin guardar; Productos nuevos pregunta la lista completa cada 5 s mientras hay cola. |
| **Bodega, Etiquetas, Cortes, Corte general, Ventas TikTok, Catálogo** | rápidas (<0.5 s) | Ya leen un renglón masticado. Bodega igual manda ~1.1 MB al navegador. |

## El plan

Ordenado por lo que más se nota contra lo que cuesta hacerlo. Cada fase se
puede hacer y subir por separado.

### Fase 1 — Base de datos (lo que más se nota en TODAS las pantallas)

1. **Reescribir las políticas de RLS** para que la cuenta se revise UNA vez
   por consulta y no una vez por renglón:
   `account_id in (select id from meli_accounts where owner_id = (select auth.uid()))`
   (y lo mismo para Amazon, fundas y el miembro de TikTok, en una sola
   política por tabla en vez de dos). La seguridad queda **igual**: mismas
   reglas, solo escritas para que Postgres las evalúe una vez. Una migración.
   *Esperado: las consultas de pantalla bajan de ~226 ms a ~10–30 ms.*
2. **Arreglar el paginado de fundas** (`yapanizcel/db.ts`) con el tope de
   1,000 renglones que ya tiene calzado. *Termina los cortes por tiempo del
   corte de fundas y acelera todas las pantallas de fundas.*
3. Los índices que faltan y los que nadie usa (avisos de Supabase): menor.

### Fase 2 — Las pantallas que calculan en el clic pasan a leer un renglón

4. **Ventas MELI y Publicidad**: la vista se guarda masticada para los rangos
   de siempre (7 días, 30 días, mes en curso) en el latido; la pantalla lee
   el renglón y, si está viejo, lo refresca por atrás (como ya hace Cortes).
   La publicidad se guarda aunque traiga avisos (los avisos van guardados con
   ella). La tabla de modelos filtra/ordena en el navegador sin volver a
   calcular. El «por qué» de Suben/Bajan sale de un RPC, no de 18 mil fotos.
   *15–35 s → menos de 1 s.*
5. **`conCacheApp` sirve lo guardado y refresca por atrás** en vez de calcular
   en el clic cuando vence. Arregla de un jalón Planificación China, Productos
   nuevos y Cargar pedidos (el Google Sheet). Más: corregir la clave
   `compras-china:v2` en `invalidar()` y no bajar plan + inventario cuando la
   sugerencia ya está guardada.
6. **Despacho TikTok**: los conteos de preparados / enviados / cancelados de
   los 30 cortes que se enseñan salen de UNA consulta agrupada por corte (no
   del historial completo); pendientes una sola vez; tras cada ronda de corte
   solo se refresca la lista de cortes. *5–10 s → menos de 1 s.*
7. **Estación de preparar**: leer solo los renglones del corte y guardar lo
   que TikTok contesta de cada paquete para no volver a preguntar.
8. **Fundas**: Ventas masticada como la de TikTok; el plan de fundas guarda
   aparte una versión chica para Envíos y Etiquetas; SKUs con buscador en vez
   de lista de 15 mil; Listados desde caché. Los cortes de fundas los recalcula
   solo el cron.
9. **Amazon ventas/publicidad**: el cron llena también los rangos de 7 y 30
   días. **Costos de envío, Precios, Videos, Productos nuevos TikTok**: sus
   lecturas pesadas a caché y refresco por atrás.

### Fase 3 — Menos peso hacia el navegador y armazón más ágil

10. **Envíos**: leer solo lo que la pantalla usa del plan (no 1.9 MB) y
    mandar al navegador lo que se ve, con búsqueda. **Bodega**: no mandar dos
    copias de cada SKU ni los renglones vacíos. **Planificación China**: solo
    los campos que usa la tabla.
11. **Armazón**: quitar el desmontaje + animación en cada cambio de pestaña;
    la barra de estado deja de recargar la pantalla completa (solo Envíos y
    Pedidos lo necesitan) y se pausa cuando la pestaña no está a la vista.
12. **Que el título y los filtros salgan al instante** y los datos lleguen
    después (streaming con `Suspense` / `loading.tsx` por sección), como ya
    hace Envíos.
13. Filtros con valor diferido en las tablas grandes y tope de renglones
    visibles; la librería de PDF se carga solo al imprimir.

### Fase 4 — Diseño (el segundo cambio que pediste)

Hoy cada pantalla está armada a mano: hay ~6 formas distintas de poner el
título, ~10 estilos de subtítulo, 32 copias del aviso «Conecta Mercado Libre»
con 4 redacciones, 25 copias del recuadro ámbar, 248 botones de los que solo
3 archivos usan el botón común, y ~1,580 estilos escritos a mano dentro de
las pantallas. Las explicaciones largas son reglas del negocio escritas como
texto de pantalla (Costos de envío tiene un párrafo de 10 líneas; Despacho
tiene 11 párrafos).

Plan:

14. **Un juego de piezas comunes** en `src/components/ui/`:
    `Encabezado` (título + UNA línea + botones + «datos de hace X min» +
    «¿Cómo se calcula?» plegable), `Seccion`, `BarraHerramientas` (filtros,
    fechas, descargas), `Tabla`, `Cifras` (las tarjetas de números, siempre
    en la misma rejilla), `Boton` / `Enlace`, `Aviso` (info, alerta, crítico,
    éxito), `SinCuenta` y `Frescura` única.
15. **Pasar las 57 pantallas a esas piezas**, sección por sección (Negocio,
    Inventario, Envíos, China, Ventas, Amazon, TikTok, Fundas), con estas
    reglas:
    - Título + una sola línea. La explicación larga va plegada en «¿Cómo se
      calcula?», no se borra.
    - Arriba siempre en el mismo orden: título → cifras → filtros → tabla.
    - Un solo lugar para cada botón (se quitan los repetidos: Sincronizar
      en dos lados, el link a Cargar pedidos arriba y abajo, Sheets en
      Inventario y Ajustes de fundas, dos buscadores en Bodega…).
    - Los avisos que repiten lo que ya dice una tarjeta se quitan.
16. **Afinar la apariencia**: escala de tipografía y espaciado fija, colores
    de estado suaves como fichas (no `color-mix` a mano), tablas con
    encabezado fijo y números alineados, mismo menú y barra superior.

No cambia ninguna regla del negocio ni ningún número: solo cómo se ve y
dónde está cada cosa.

## Orden recomendado

1. **Fase 1** primero (un día de trabajo, una migración): mejora todas las
   pantallas a la vez y no cambia nada visible.
2. **Fase 2**, empezando por Ventas, Despacho y Planificación China (las que
   más usas y las más lentas).
3. **Fase 3**.
4. **Fase 4** al final, cuando ya todo abra rápido: así el rediseño se hace
   una sola vez sobre pantallas que ya no van a cambiar por dentro.
