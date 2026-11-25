# Auditoría de peticiones a Supabase (Fase 0) — 24/25-nov-2026

Fuente: edge logs de Supabase, últimas 24 h (agrupados por endpoint, método
y forma de la consulta) y lectura del código.

## Hallazgo principal

**El 100 % de las peticiones grandes vienen del SERVIDOR** (`service_role`,
user-agent `node`). Ninguna viene del navegador. El problema no es el polling
de las pantallas: la barra de estado ya consulta `/api/estado` cada 60 s y
se pausa con la pestaña escondida. Lo que cuesta es el trabajo de fondo que
se dispara con cada aviso (TikTok y MELI) y el plan de Full que se rehace
cada 10 min.

## Tabla de auditoría

| # | Archivo | Qué consulta | Cada cuánto | Quién lo dispara | Peticiones/día |
|---|---|---|---|---|---|
| 1 | `lib/servicios/tiktok.ts:525` → `reconstruirVentasDiarias` (`:1503`) | Rehace `tiktok_ventas_diarias` de los ÚLTIMOS 7 DÍAS: ~7,000 pedidos en 8 páginas de `tiktok_ordenes` + sus renglones de `tiktok_orden_items` en ~25 tandas de 300 ids, + borra/escribe | En **cada** aviso de TikTok (~3,950 corridas/día) | Webhook TikTok → `procesarWebhooksPendientes` → `sincronizarPedidosPorId` | `tiktok_orden_items` ~200,000 · `tiktok_ordenes` ~32,000 · `tiktok_ventas_diarias` ~32,000 |
| 2 | `lib/datos/repos.ts:130` `traerTodo` | Manda SIEMPRE un `HEAD count` junto con la página 0, aunque la tabla quepa en una página | En cada lectura paginada del sistema | Todo el fondo | Casi todos los HEAD: ~150,000 |
| 3 | `lib/servicios/latido.ts:378` `latidoApagado` | `sync_log` tarea `en_vivo` en la última hora | En **cada** aviso de MELI (~79,000/día) | Webhook MELI (`app/api/meli/webhook/route.ts`, `after`) | `sync_log` ~79,400 |
| 4 | `app/api/meli/webhook/route.ts` | `insert` en `webhooks_meli` | Cada aviso | MELI | `webhooks_meli` ~79,000 |
| 5 | `lib/servicios/tiktok.ts:389` `conCandadoTikTok` | `adquirir_candado_trabajo` en bucle **cada 2 s** hasta 30 s (aviso) o 60 s (cron) | Cada aviso de TikTok que choca con otro | Webhook TikTok + cron `*/15` | `adquirir_candado_trabajo` ~43,000 (solo ~6,000 lo consiguen) |
| 6 | Pipeline de un aviso de TikTok (`sincronizarPedidosPorIdSinCandado`: `amarradorDeCuenta`, `procesarPedidos`, `recalcularSaldos`, `publicarDisponibilidad`) | Catálogo completo de `skus` (4 páginas + HEAD), `tiktok_skus` (2 lecturas de 3 páginas + HEAD), `tiktok_inventario` (2 páginas + HEAD), `tiktok_movimientos`, `tiktok_tienda`, `tiktok_salidas_3pl`, RPCs de saldos | ~3,950 veces/día | Webhook TikTok | `skus` ~25,000 · `tiktok_skus` ~38,000 · `tiktok_inventario` ~13,000 · `tiktok_movimientos` ~25,000 · `tiktok_tienda` ~9,600 · RPCs ~16,000 |
| 7 | `lib/datos/repos.ts:395` `cargarInsumos` (plan de Full) | Historia completa de `stock_operaciones` (~330 páginas) y `stock_snapshots` (~250) + ventas | 6 veces/hora (cron `/api/cron/plan` `*/10` → `latido`), el plan se invalida con cada movimiento de stock | Cron Vercel | `stock_operaciones` ~47,000 · `stock_snapshots` ~35,600 · `ventas_diarias` ~10,000 |
| 8 | `lib/servicios/productos-nuevos.ts:484` | N+1: 4 consultas `limit 1` POR PRODUCTO (`ventas_diarias`, `stock_snapshots`, `stock_operaciones`, `amazon_ventas_diarias`) | Cada vez que se rearma la lista (~cada 15 min) | Cron `nuevos-fotos` y la pantalla tras `invalidar()` | ~22,700 |
| 9 | Por ubicar (registro de netos de MELI) | `ordenes_neto` por `order_id` de uno en uno + PATCH | Continuo | Probablemente latido / `reparar-ordenes` `*/5` | `ordenes_neto` ~18,000 |
| 10 | `app/api/estado/route.ts` | 5 lecturas chicas, incluye `count: 'exact'` de avisos sin procesar | Cada 60 s, pausado con pestaña oculta | Barra de estado (navegador) | < 2,000 |
| 11 | pg_cron en la base | `amazon_recarga` `*/5`, `amazon_fnskus` `*/10`, `amazon_ventas` `*/15`, `limpiar-ventas-sucias` cada minuto | Fijo | Base de datos | (dentro de Amazon/ventas) |
| 12 | `vercel.json` | 32 crons; cada minuto: `tiktok-etiquetas`, `tiktok-ciclicos`; cada 5: `reparar-ordenes`; cada 10: `plan`, `consolidado`, `amazon-pantallas`, `amazon-finanzas`, `yapanizcel/netos`, `yapanizcel/skus-pendientes` | — | Vercel | — |

### Avisos de MELI por tema (24 h, solo de nuestras cuentas)

| Tema | Avisos | ¿Se procesa? |
|---|---|---|
| shipments | 29,357 | No (entra marcado como procesado) |
| orders_v2 | 13,348 | Sí |
| invoices | 7,942 | No |
| payments | 7,820 | No |
| items | 7,218 | Sí |
| stock-locations | 3,761 | Sí |
| fbm_stock_operations | 3,759 | Sí |
| public_candidates | 2,511 | No |
| post_purchase | 1,543 | No |
| public_offers | 1,456 | No |
| items_prices | 392 | No |
| user_products_families | 100 | No |
| questions | 54 | No |

Ningún código lee esos temas: **~51,000 avisos al día (65 %) se guardan para
nada**. Se pueden dar de baja en el devcenter de MELI (app de calzado →
Notificaciones): shipments, invoices, payments, public_candidates,
post_purchase, public_offers, items_prices, user_products_families,
questions.

## Propuesta por fase

### Fase 1 — Polling del frontend
Nada grande que hacer: la barra ya va cada 60 s y se pausa. Solo cambiar el
`count: 'exact'` de `/api/estado` por `'estimated'`.

### Fase 2 — Candado, workers y crons (necesita OK)
- **A. Avisos de TikTok en lote.** El webhook solo guarda; un cron cada
  minuto procesa TODOS los pendientes de un jalón (hoy cada aviso corre el
  pipeline entero). El kardex y la publicación siguen casi en tiempo real
  (≤ 1 min). Sin el bucle de 2 s: si el candado está ocupado, los avisos
  esperan a la siguiente pasada.
- **B. `reconstruirVentasDiarias` fuera del camino del aviso.** Solo en la
  corrida de 15 min (ventas diarias de TikTok no deciden kardex ni
  publicación; las leen compras, reabasto y familias).
- **C. Plan de Full cada 30 min** en vez de cada 10 (o solo cuando haya
  avisos de stock/órdenes nuevos), y leer la historia de stock solo desde
  la última corrida. *Decisión del dueño: ¿30 min de retraso en el plan está
  bien?*
- **D. `latidoApagado` con memoria de 1 min por instancia** (hoy pregunta a
  la base en cada aviso de MELI).
- **E. Productos nuevos: las 4 consultas por producto en un solo RPC.**

### Fase 3 — Webhooks de MELI
La ruta YA solo hace un insert y contesta 200. Falta: D (arriba), dar de
baja los temas no usados (acción del dueño en MELI) y deduplicar
`resource+topic` (hoy items llega 7.7 veces por recurso).

### Fase 4 — Consultas
- **`traerTodo` sin HEAD cuando la página 0 no se llenó** (la mayoría).
- `select('*')` en los `limit 1` de productos nuevos (se va con E).

### Fase 5 — Vercel
Revisar memoria y `maxDuration` (casi todo en 300 s, cortes 800 s).

## Estimación de peticiones/día

| Endpoint | Antes | Después | Con qué |
|---|---|---|---|
| GET+HEAD `tiktok_orden_items` | ~200,000 | ~3,000 | B + 2 |
| GET `sync_log` | ~83,000 | ~4,000 | D |
| POST `webhooks_meli` | ~79,000 | ~28,000 | baja de temas (dueño) |
| GET `stock_operaciones` | ~52,000 | ~16,000 | C + E |
| RPC `adquirir_candado_trabajo` | ~43,000 | ~3,000 | A |
| GET `stock_snapshots` | ~41,000 | ~12,000 | C + E |
| GET+HEAD `tiktok_ordenes` | ~41,000 | ~4,000 | A + B |
| GET+HEAD `skus` | ~35,000 | ~9,000 | A + 2 |
| GET+HEAD `tiktok_skus` | ~38,000 | ~9,000 | A + 2 |
| `tiktok_movimientos`, `ventas_diarias`, `amazon_ventas_diarias`, `ordenes_neto`, `app_cache` | ~85,000 | ~35,000 | A + C + E + 2 |
| POST `tiktok_ventas_diarias` | ~16,000 | ~1,000 | B |
| **Total de la tabla** | **~713,000** | **~124,000 (−83 %)** | |

Las cifras de "después" son estimaciones; se miden con 24 h de logs tras el
deploy.

## Cambios hechos (25-nov-2026, aprobados por el dueño: B, C, D, E y conteos; A rechazado)

| Cambio | Archivo | Antes → después |
|---|---|---|
| B. Ventas diarias de TikTok solo en la corrida completa | `lib/servicios/tiktok.ts` | En cada aviso (~3,950/día) y cada corrida `soloPedidos` → cada 15 min (96/día) |
| C. Plan de Full | `lib/servicios/latido.ts` (`EDAD_MAX_PLAN_MS`) | Cada latido (~10 min) → a lo más cada 30 min |
| D. `latidoApagado` | `lib/servicios/latido.ts` | Una lectura por aviso de MELI (~79,000/día) → una por minuto por instancia |
| E. Historia de Productos nuevos | `lib/servicios/productos-nuevos.ts` + migración 0166 `skus_con_historia` | 4 consultas por producto → 1 RPC por tanda de 500 SKUs |
| Conteos | `lib/datos/repos.ts` `traerTodo` | HEAD en cada lectura → solo si la página 0 vino llena |

Sin A, el pipeline de cada aviso de TikTok (catálogo, kardex, publicación)
sigue corriendo por aviso, igual que el bucle del candado cada 2 s.
Estimación revisada: de ~713,000 a ~300,000 peticiones/día en la tabla
(−58 %); con la baja de temas de MELI, ~250,000 (−65 %).
