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
  verificada con GT135 DK/TABACO y GT155 BEIGE): si una talla se agota
  pero su caja sobre-surtiría a las hermanas (la mayoría de la caja no
  tapa faltantes), NO se completan sus 30 días. El sobrante de una hermana
  se mide con su POSICIÓN COMPLETA (disponible + en camino) ÷ venta del
  horizonte del canal (MELI 30 días; FBA 30 + 7 de recepción). Hermanas al
  día (≤ `corridaSobranteFactor`, 1.5) → viaja la MITAD de las cajas; corrida
  dispareja (alguna arriba del factor, con stock sin venta o sin amarre) →
  viaja UNA SEMANA de venta de la talla agotada por envío, topada por su
  faltante (goteo que se apaga solo al acercarse al objetivo) — SALVO que
  el faltante junto de las tallas cortas pase de `corridaFaltanteGrande`
  (200 pares): esa venta pesa más que el sobrante y la corrida se surte
  COMPLETA, sin recorte. Lo
  recortado se surte completo (tolerancia de rescate 0: redondea a cajas
  hacia arriba); en la MITAD, como medias cajas no existen, la caja que
  completa la fracción sube marcada OPCIONAL (4 cajas → 2 firmes; 3 cajas
  → 1 firme + 1 opcional) y las demás cajas recortadas NO se marcan
  opcionales. La tolerancia general de rescate es de 7 días: una talla
  rápida a medio morir sí fuerza su caja.
- **El envío a Amazon tarda ~7 días en volverse vendible en FBA**
  (`RIESGO_DIAS_FBA`), dato del negocio: el objetivo real por talla en FBA
  es 30 + 7 = 37 días, no más.
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
- **El costo de envío sale de las medidas que MELI capturó, y se equivoca.**
  En Full, MELI MIDE la caja al recibirla y guarda el resultado en los
  atributos `PACKAGE_*` de la publicación (`PACKAGE_DATA_SOURCE = MEASUREMENT`)
  o, en las publicaciones con variantes dentro, en el `/user-products/{id}` de
  cada variante (ahí NO hay atributos ni en el item ni en la variación). Con
  esas medidas calcula el peso facturable y el costo. Cuando mide mal, esa
  talla paga de más en cada venta: en el GT229, quince tallas de 27 × 24 × 10
  pagan $88.50 y dos que quedaron como 11 × 29 × 37 y 28 × 25 × 25 pagan
  $139.50 y $190. El simulador es
  `/users/{id}/shipping_options/free?dimensions=AltoxAnchoxLargo,gramos`, y
  **solo acepta enteros** (con decimales contesta 400). La verdad de qué mide
  la caja son las hermanas del mismo modelo: se ordenan los tres lados de
  mayor a menor (MELI permuta los ejes y eso NO es un error) y se saca la
  mediana lado por lado.
- **Los envíos a Full registrados (`envios_full`) SOLO alimentan cálculos**:
  cuentan como "en camino" en el plan, nunca descuentan inventario. Caducan
  solos a los 7 días y se quedan visibles como caducados.
- **TikTok Shop es ENVÍO PROPIO y lleva su PROPIO inventario.** No es Full ni
  FBA ni las cajas de Industher: es un cuarto almacén, con kardex nuestro en
  `tiktok_movimientos` (esa tabla es la fuente de verdad; `tiktok_inventario`
  solo guarda el saldo ya sumado). Un pedido pagado sin despachar APARTA, no
  descuenta; el saldo baja hasta que el envío se confirma
  (`AWAITING_COLLECTION` en adelante). Lo que se le publica a TikTok es
  `saldo - apartado`, nunca negativo, y se le ESCRIBE por API en cada
  movimiento del kardex y cada hora en el cron — si no se publica, la tienda
  sigue vendiendo lo que ya no hay. El doble descuento lo impide un índice
  único sobre `(account_id, tipo, referencia, sku)`: una orden genera una sola
  salida por SKU.
  **Industher SUMA en la bodega "TikTok" y descuenta SOLO lo que el ERP le
  manda**: después de cada corte el ERP le manda las salidas
  (`tiktok-3pl.ts`, `INDUSTHER_SALIDAS_URL`, referencia `TT-CORTE-n`,
  idempotente; el endpoint lo publica el 3PL, que es de otra persona) y las
  guarda en `tiktok_salidas_3pl`. Su número entra al kardex como ENTRADA por
  diferencia contra lo ya reconocido (movimientos `industher:*` MENOS las
  salidas que el 3PL ya confirmó); una BAJA se atribuye primero a las salidas
  pendientes de ese SKU y solo el resto es merma (`conciliarAcumulado`):
  una salida nunca se descuenta dos veces. NUNCA como ajuste absoluto, que
  volvería a publicar lo ya vendido (`tiktok/bodega.ts`). Se cuentan cajas
  FÍSICAS. Esa bodega NO surte a Full (`almacenes_activos.surte_full =
  false`, se inserta sola). A TikTok solo se le escribe un SKU que alguna vez
  se contó (entrada o ajuste): uno con puras salidas se queda con el número
  que TikTok ya tiene.
  **Tiempo real:** TikTok ya aparta solo al vender; la única forma de vender
  de más es que el ERP le escriba un número viejo. Por eso (1) NUNCA se le
  escribe sin antes leer sus pedidos recientes (`sincronizarTikTok` con
  `soloPedidos`, también desde la captura a mano); (2) se reconcilia contra
  lo que TikTok DICE tener (`tiktok_skus.cantidad_tiktok`, del catálogo), no
  contra lo último escrito: una edición en el Seller Center se corrige sola;
  (3) los avisos de TikTok entran por `/api/tiktok/webhook` (firma HMAC sobre
  `app_key + cuerpo`, se guarda y se procesa con `after()`), y (4) el envío se
  confirma DESDE EL ERP (`confirmarEnvio`: TikTok envía por paquete) y
  descuenta en el mismo clic. Cron cada 15 min como red de seguridad.
  **Despacho por CORTES** (`tiktok-despacho.ts`, `/tiktok/despacho`): "hacer
  corte" confirma en TikTok todos los pendientes de un jalón (TikTok no da la
  guía hasta confirmar; para RECOLECCIÓN hay que mandar también un
  `pickup_slot` de `handover_time_slots`, si no TikTok lo vuelve drop-off), guarda el corte con sus pedidos (`tiktok_cortes`,
  `tiktok_ordenes.corte_id`) y de él salen dos PDF reimprimibles: las guías
  de TikTok unidas con `pdf-lib` en orden modelo → color → talla y "#n · SKU"
  estampado abajo a la derecha (nada más se toca), y la lista de empaque en
  el mismo orden con los mismos números. El siguiente corte solo toma lo que
  no tiene corte.
  **Preparar pedido** (`tiktok/preparar.ts`, estación en
  `/tiktok/despacho/[id]/preparar`): se empieza por la ETIQUETA (FNSKU de
  Amazon, impreso como barras en la guía Y en el renglón de la lista: hoja,
  guía y caja llevan el mismo código) — elige el siguiente paquete sin
  preparar con ese producto y pita UNA VEZ POR PAR; luego el PRODUCTO (FNSKU de la
  caja, un escaneo por par). Lo que no tiene FNSKU no lo cierra el escáner:
  solo "Dar por bueno sin escanear", registrado como `MANUAL:` en
  `tiktok_preparaciones.escaneos`. Decisión del dueño: la etiqueta lleva el
  FNSKU (no el código de paquete) porque el flujo arranca por la etiqueta.
  El FNSKU sale de `mapaAmazon`/`buscarAmazon`.

- **El catálogo de Amazon (`amazon_listings`) NO se mezcla con `amazon_skus`.**
  `amazon_skus` se llena de rebote con el reporte de ÓRDENES —solo lo que ya
  vendió— y `amazon_resumen_skus` la usa como universo de claves del plan de
  FBA: cada fila cuenta como UNA TALLA de su grupo modelo+color. Meterle ahí
  las publicaciones sin venta le agrega tallas con venta 0, y la regla de la
  corrida despareja las lee como hermanas al día (`sanas.length >
  agotadas.length`, `fba.ts`): media corrida dejaría de viajar. El catálogo
  completo (activos, inactivos, precio, imagen principal) vive aparte y solo
  lo lee la sección de contenido.
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

## ERP YAPANIZCEL (fundas) — sección aparte, mismo proyecto

Segundo negocio: fundas para celular en OTRA cuenta de Mercado Libre. Vive en
`/yapanizcel/*`, `src/lib/yapanizcel/` y tablas con prefijo `yz_`. No comparte
ni una tabla con el ERP de calzado; sí comparte el login, la base y el deploy.

- **Cuenta y app de MELI propias.** Credenciales en `MELI_YZ_CLIENT_ID` /
  `MELI_YZ_CLIENT_SECRET`; tokens en `yz_tokens` (RLS con cero políticas, como
  `meli_tokens`). Redirect URI: `/api/yapanizcel/meli/callback`. La RLS usa
  `es_mi_cuenta_yz()`, aparte de `es_mi_cuenta()` a propósito.
- **No hay cajas ni corridas.** La funda es unidad suelta. El SKU es
  `DISEÑO-MODELO(-COLOR)` donde "modelo" es el del CELULAR y "diseño" el de la
  funda (499, 501…). Los pedidos a China se ven POR DISEÑO.
- **A Full se manda en DECENAS CERRADAS** (`multiplo_envio`, 10): la falta se
  redondea ARRIBA a decena y se topa ABAJO por lo que hay en bodega. Menos de
  una decena en bodega = no se manda. Motor puro en `yapanizcel/plan.ts`.
  La venta diaria pesa 50% la última semana, 30% la anterior y 20% el resto
  de la ventana (cada bloque ÷ sus días con stock; un bloque sin stock no
  cuenta como cero, se deja fuera), y la ventana termina AYER: hoy va a
  medias. Verificado con 601-iPad10 (pasó de 35 a 65 al día a media ventana).
- **El inventario de bodega viene de un Google Sheets** (`YAPANIZCEL_SHEET_URL`,
  una pestaña por diseño, SKU completo en la columna A y cantidad en la B, sin
  encabezados; `yapanizcel/sheets.ts` también acepta tabla o matriz). Se
  REEMPLAZA completo en cada lectura. Recibir un pedido NO crea existencias.
  **Solo cuentan las pestañas cuyo nombre empieza con número** (el diseño):
  TOTALES y CONSECUTIVO TOTALES son resúmenes y RETIRO no se suma, por
  decisión del dueño. Fixture real en `fixtures/yz-inventario.xlsx`.
- **El amarre de SKUs va por niveles y los inseguros solo se PROPONEN**
  (`yapanizcel/sku.ts`): exacto → canónico → aplastado se aplican solos; la
  N o C antes del diseño (`N-462-A06` = `462-A06`) y el color escrito distinto
  (black/blk, navy/blue, fucsia/fuchsia; `FAMILIAS_COLOR`) se amarran solos
  por decisión del dueño; otros prefijos (CH-, R-) y las piezas en otro orden se sugieren
  en `/yapanizcel/skus` y se confirman con un clic (escribe `yz_mapeo_skus`).
  Un empate NUNCA se resuelve solo. Ignorados en `yz_skus_ignorados`.
- **Costos por MODELO desde un Excel** (MODELO, COSTO) en `yz_costos`; se
  buscan por el diseño del SKU (`costoDeSku`). Sin costo = ganancia no
  calculable, nunca costo 0.
- **Ganancia sobre el neto real** (`net_received_amount`, caché en
  `yz_ordenes_neto`, re-lectura de órdenes recientes por cargos diferidos).
  Los días con neto incompleto se marcan como estimados.
- **Envíos registrados (`yz_envios`) solo alimentan cálculos**: cuentan como
  en camino hasta caducar (`dias_caducidad_envio`) o marcarse recibidos.
- **La sincronización va por tramos de 7 días con presupuesto de tiempo**
  (`yapanizcel/tramos.ts` + `yz_sync_estado`): el catálogo es grande (~18 mil
  variantes) y una sola llamada no cabe en los 300 s de Vercel. Cada corrida
  recalcula lo reciente y extiende hacia atrás hasta 90 días; la pantalla y el
  cron llaman en bucle con `continuar: true` hasta que `completo` sea true.
- Cron diario en `/api/cron/yapanizcel`; SKUs pendientes en
  `/api/yapanizcel/skus-pendientes` (mismo mecanismo que el de calzado), con
  cron propio CADA 10 MINUTOS porque MELI entrega ~1 user product por segundo y el
  catálogo trae ~15 mil variantes sin SKU en la publicación.

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
| Costos de envío mal cobrados     | `src/lib/servicios/costos-envio.ts` + `/costos-envio` |
| Solicitud a MELI de revisión de medidas (Excel Item ID/Site/medidas en cm y g ENTEROS hacia abajo + ficha de evidencia PNG por modelo, bucket `evidencia-envio`) | `src/lib/servicios/evidencia-envio.ts` (+ `-imagen.tsx`, `-generar.ts`) + `/api/costos-envio/evidencia` + `/api/costos-envio/excel?formato=meli` |
| Inventario desde API Industher   | `src/lib/servicios/industher.ts` + `/api/industher` |
| Corridas desde Google Sheets     | `src/lib/servicios/corridas-sheets.ts` + `/api/corridas/sheets` (URL en `CORRIDAS_SHEET_URL`) |
| Envíos a Full registrados        | `src/lib/servicios/envios-registrados.ts`   |
| Monitor de ventas MELI / Amazon  | `src/lib/servicios/ventas-monitor.ts`, `amazon-monitor.ts` (filtro de fechas en `components/filtro-fechas.tsx`) |
| Etiquetas (ZPL, PDF, resolución) | `src/lib/etiquetas/` (`zpl.ts`, `pdf.ts`, `resolver.ts`, `code128.ts`) |
| ZIP de etiquetas por pedido      | `src/app/api/pedidos/[id]/etiquetas/route.ts` |
| Sincronización con Amazon        | `src/lib/amazon/` (`sync.ts`, `spapi.ts`, `reportes.ts`) |
| Contenido de marca en Amazon     | `src/lib/servicios/contenido-amazon.ts` + `src/app/amazon/contenido` (imágenes y padres en `src/lib/amazon/catalogo.ts`) |
| Acceso sin contraseña a contenido | `src/lib/servicios/acceso-contenido.ts` + `src/app/contenido/[token]` + `/api/contenido-publico/[token]` |
| TikTok Shop (API firmado, kardex) | `src/lib/tiktok/` (`client.ts`, `firma.ts`, `api.ts`, `kardex.ts`, `amarre.ts`) |
| TikTok: sincronizar y publicar    | `src/lib/servicios/tiktok.ts` (+ `tiktok-bodega.ts` foto de Industher, `tiktok-panel.ts` pantalla, `tiktok-despacho.ts` cortes) |
| Videos de producto (Higgsfield)  | `src/lib/higgsfield/` + `src/app/videos` + `/api/videos/*` |
| ERP YAPANIZCEL (fundas)          | `src/lib/yapanizcel/` (`sku.ts`, `plan.ts`, `sheets.ts`, `sync.ts`, `ventas.ts`, `compras.ts`, `pedidos.ts`) + `src/app/yapanizcel/*` + `/api/yapanizcel/*` |
| Páginas                          | `src/app/{envios,inventario,ventas,amazon,tiktok,pedidos,corridas,etiquetas,videos,pendientes,ajustes}` |

## Seguridad — cosas que ya se decidieron

- El registro está **cerrado**: tabla `usuarios_permitidos` + trigger sobre
  `auth.users`. Para dar acceso a alguien, inserta su correo ahí.
- **Solo dos pantallas van sin sesión**, las dos con el mismo patrón:
  `/contenido/{token}` (la sección de contenido de Amazon) y
  `/preparar/{token}` (la estación de preparar pedidos de TikTok, para los
  empleados que empacan). El token vive en `contenido_acceso` /
  `tiktok_acceso`, tablas con RLS y **cero políticas** como `meli_tokens`; del
  otro lado se lee y escribe con service_role, así que el token es la única
  puerta: se compara en tiempo constante y SOLO en `acceso-contenido.ts` /
  `acceso-preparar.ts`. Cada una alcanza nada más las tablas de su sección
  (la de preparar: cortes y pedidos de TikTok para leer, preparaciones para
  escribir).
- `meli_tokens` tiene RLS con **cero políticas** a propósito: solo el
  service-role la lee. No agregues políticas.
- `es_mi_cuenta()` debe seguir ejecutable por `authenticated` (RLS la usa);
  `anon` no. No cambies eso.
- `tiktok_tokens` también tiene RLS con **cero políticas**, por lo mismo que
  `meli_tokens`. En el entorno solo van las credenciales de la APP
  (`TIKTOK_APP_KEY` / `TIKTOK_APP_SECRET`), nunca las de la tienda.
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
- **Clips de MELI: NO hay API para vendedores locales** (verificado ago 2026
  sondeando 10 rutas contra una publicación CON clip; el clip tampoco se
  asoma en el item ni en sus user products). La única ruta que existe es
  `/marketplace/items/{id}/clips` (Global Selling) y el PolicyAgent la niega
  (403 PA_UNAUTHORIZED). La sección /clips se construyó y se retiró; vive en
  el historial de git (commits e861525…6b75355) por si MELI publica el API.
