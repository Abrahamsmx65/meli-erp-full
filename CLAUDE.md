# CLAUDE.md — contexto del proyecto para Claude Code

ERP para un vendedor de calzado en Mercado Libre México (GETAC). Decide qué
cajas mandar a Mercado Envíos Full, qué pedirle a China, y lleva inventario,
corridas y etiquetas. Todo el código, comentarios y UI están **en español**;
mantenlo así.

## Stack

Next.js 15 (App Router) + React 19 + Tailwind v4 · Supabase (Postgres + Auth +
RLS) · Vercel · ExcelJS / SheetJS (solo `.xls`) · vitest.

```
npm run dev      # local
npm test         # vitest run  (todas las pruebas deben pasar)
npx tsc --noEmit # tipos
npm run build    # build de producción
```

Proyecto de Supabase: `iodgqfqwphchuwlynvzn`. Migraciones en
`supabase/migrations/` — **ya están aplicadas** en producción; el archivo y la
base deben decir lo mismo. Si agregas una, aplícala con el MCP de Supabase y
guárdala numerada.

## Reglas del negocio que NO se negocian

- **Las cajas nunca se abren.** Solo se mandan cajas completas. Muchas cajas
  son mixtas (una corrida: varias tallas del mismo modelo+color).
- **Regla de la corrida despareja** (MELI y Amazon, `engine/corrida.ts`,
  calibrada con GT135 DK/TABACO y GT155 BEIGE): si una talla se agota pero
  su caja sobre-surtiría a las hermanas (la mayoría de la caja no tapa
  faltantes), NO se completan sus 30 días. El sobrante de una hermana se
  mide con sus APTAS (sin en camino) ÷ venta del horizonte, como se lee la
  pantalla de Full. Hermanas al día (≤ 1.3×) → viaja la MITAD de las
  cajas; corrida dispareja (alguna arriba de 1.3×, con stock sin venta o
  sin amarre) → viajan 7 días de venta de la talla agotada, descontando
  solo lo EN CAMINO (lo apto en piso ya se está vendiendo). Lo recortado
  se surte completo (tolerancia de rescate 0: redondea a cajas hacia
  arriba) y esas cajas NO se marcan opcionales. La tolerancia general de
  rescate es de 7 días: una talla rápida a medio morir sí fuerza su caja.
- **Todos los productos son de Full.** Si un SKU no tiene stock en Full es
  porque se acabó, no porque sea otra logística. No filtres por logística.
- **El stock histórico se toma de los movimientos de MELI**, no de las fotos
  diarias del sistema. Prioridad en `stockHistory.ts`: operaciones → snapshot
  → reconstrucción.
- **Los SKUs de bodega pueden diferir del de MELI** (sufijo `-MX`, espacios en
  el color, "MBROWN" vs "M BROWN"). El amarre está en `src/lib/importar/sku.ts`
  y tiene tres niveles: manual → exacto → canónico → aplastado.
- **Envíos a Full por bodega:** Caseshop + Industher salen juntos, EnvioPack
  aparte. Configurado en `almacenes_activos.grupo_envio`.
- **Recibir un contenedor NO crea existencias.** El inventario de bodega llega
  del **API de Industher** (sincronización diaria en el cron y botón en
  /importar; llave en `INDUSTHER_API_KEY`); crear filas propias lo contaría dos
  veces. El Excel de existencias ya no tiene UI: queda solo como respaldo de
  emergencia en `/api/importar`.
- **El SKU de las publicaciones de Full vive en `/user-products/{id}`** (atributo
  SELLER_SKU, texto en `values[].name`), NO en la publicación: las variantes
  llegan con `attributes` vacío y `seller_custom_field` en null. MELI limita esa
  consulta a ~1/s, así que la sincronización apunta lo no resuelto en
  `skus_pendientes` y `/api/meli/skus-pendientes` lo resuelve en segundo plano
  (se re-lanza solo). Nunca deducir un SKU: solo dato real de MELI.
- **Las órdenes también llegan sin SKU**: al contar ventas SIEMPRE hay que
  amarrar por item+variación contra el catálogo (`claveItem`, como hacen
  `obtenerVentas` y `recalcularDiaVentas`). Descartar renglones sin
  seller_sku deja el panel con muchas menos ventas que MELI.
- **Los envíos a Full registrados (`envios_full`) SOLO alimentan cálculos**:
  cuentan como "en camino" en el plan, nunca descuentan inventario. Caducan
  solos a los 7 días y se quedan visibles como caducados.
- **Costos y categorías son por MODELO** (mismo costo todos los colores), en
  MXN final, en `productos_config`. La ganancia de MELI usa el neto real
  depositado (net_received_amount de Mercado Pago, con cargos diferidos).
- **Los SKUs de Amazon traen los mismos pedazos en OTRO orden a veces**
  (`GT128-23-BLK-MX`, talla antes del color): amarrar con `claveOrdenada`
  (tokens ordenados), nunca solo con la clave canónica.
- **Las etiquetas están calcadas de formatos reales** y no se inventan:
  MELI y Amazon en ZPL vienen del generador viejo de etiquetas mixtas del
  usuario (plantillas verbatim en `etiquetas/zpl.ts`); el PDF 2×1 es esa
  misma plantilla traducida a 72/203 puntos, con Roboto Condensed Bold para
  MELI y Open Sans Condensed Light para Amazon; el ZIP por pedido replica
  IN10128_GT125.zip (carpeta `PEDIDO (MODELO)`, un "…, 2 LABEL.pdf" por
  talla con página Amazon + página MELI, Excel `SKU|LABEL MELI|LABEL
  AMAZON`, y `PEDIDO - BOX LABEL.pdf` de 10×5 cm con código de barras).

## Dónde está cada cosa

| Qué                              | Dónde                                       |
|----------------------------------|---------------------------------------------|
| Motor de demanda / stock / cajas | `src/lib/engine/` (`demand.ts`, `stockHistory.ts`, `boxes.ts`, `replenish.ts`) |
| Sincronización con MELI          | `src/lib/servicios/sync.ts`, `webhooks.ts`  |
| Latido (drena avisos, recalcula, repara historial) | `src/lib/servicios/latido.ts` (+ `latido-amazon.ts`) |
| Caché del plan                   | `src/lib/servicios/cache.ts` (`plan_cache`) |
| Sugerencia de compra a China     | `src/lib/servicios/compras.ts` (+ `fba.ts` para el lado Amazon) |
| Lectura de proforma de fábrica   | `src/lib/importar/proforma.ts` + `leer-hoja.ts` |
| Envíos separados por bodega      | `src/lib/servicios/envios.ts`               |
| Inventario desde API Industher   | `src/lib/servicios/industher.ts` + `/api/industher` |
| Corridas desde Google Sheets     | `src/lib/servicios/corridas-sheets.ts` + `/api/corridas/sheets` (URL en `CORRIDAS_SHEET_URL`) |
| Envíos a Full registrados        | `src/lib/servicios/envios-registrados.ts`   |
| Monitor de ventas MELI / Amazon  | `src/lib/servicios/ventas-monitor.ts`, `amazon-monitor.ts` (filtro de fechas en `components/filtro-fechas.tsx`) |
| Etiquetas (ZPL, PDF, resolución) | `src/lib/etiquetas/` (`zpl.ts`, `pdf.ts`, `resolver.ts`, `code128.ts`) |
| ZIP de etiquetas por pedido      | `src/app/api/pedidos/[id]/etiquetas/route.ts` |
| Sincronización con Amazon        | `src/lib/amazon/` (`sync.ts`, `spapi.ts`, `reportes.ts`) |
| Videos de producto (Higgsfield)  | `src/lib/higgsfield/` + `src/app/videos` + `/api/videos/*` |
| Clips de MELI en todas las variantes | `src/lib/servicios/clips.ts` + `/api/clips/*` + página `/clips` |
| Páginas                          | `src/app/{envios,inventario,ventas,amazon,pedidos,corridas,etiquetas,videos,pendientes,ajustes}` |

## Seguridad — cosas que ya se decidieron

- El registro está **cerrado**: tabla `usuarios_permitidos` + trigger sobre
  `auth.users`. Para dar acceso a alguien, inserta su correo ahí.
- `meli_tokens` tiene RLS con **cero políticas** a propósito: solo el
  service-role la lee. No agregues políticas.
- `es_mi_cuenta()` debe seguir ejecutable por `authenticated` (RLS la usa);
  `anon` no. No cambies eso.
- No uses `sheet_to_json` de SheetJS (CVE de prototype pollution en 0.18.5).
  `leer-hoja.ts` lee celda por celda.
- El webhook de MELI **debe contestar 200 en < 500 ms**: guarda y procesa
  después.

## Pendientes conocidos

- Conectar Amazon (tablas y vista `ventas_diarias_canal` ya existen).
- Crear el envío en MELI por API (hoy solo se prepara y separa).
- Excel de los ~390 SKUs que no se mandan porque la corrida no cuadra en otras
  tallas.
- La URL del webhook ya está puesta en la app de MELI y recibe avisos.
