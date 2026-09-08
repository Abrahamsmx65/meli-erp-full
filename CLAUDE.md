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
- **El packing list de la fábrica arma el contenedor** (`/contenedores`):
  NUESTRO ID es la referencia del embarque (S259-2026) y el ISO del
  contenedor (MIEU3920536) es el número de la naviera. Un
  bloque por color con la corrida en filas de talla; "IN10079-3" es el pedido
  IN10079 en su tercer embarque parcial (el sufijo se quita). Se amarra por
  pedido + modelo + color aplastado + talla contra `pedido_lineas`; lo que no
  amarra se enseña y NO se guarda. Subirlo dos veces al mismo contenedor no
  duplica: lo de ese contenedor se reemplaza. El pedido tiene que estar
  cargado antes (Cargar pedidos).
- **Un producto es NUEVO si nunca tuvo stock en Full ni en FBA** (stock
  actual, fotos, movimientos, ventas): la bodega no cuenta. Se agrupa por
  modelo + color comparando el SKU completo sin talla ni sufijo
  (`claveProductoDeSku`), porque `skus.modelo` parte mal los modelos con
  guion (GT104-1). Segundo nivel LAXO (`claveProductoLaxa`): la proforma
  escribe el color por partes con anotación ("BLK/BLK/RED", "BLK/BLK/BLK
  (NEGRO)") y MELI/Amazon lo tienen como "BLK / RED", "BLK-BLK" o "BLK";
  sin paréntesis y con repetidos seguidos colapsados caen en el mismo lugar
  (verificado con GT134).
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
  FÍSICAS. **Esa bodega NO existe para el calzado**: `construirCajas` la
  descarta siempre (`esAlmacenTikTok`, salvo `incluirTikTok` que solo usa el
  kardex de TikTok), /corridas la ignora y un trigger deja
  `almacenes_activos.surte_full = false` pase lo que pase (migración 0045;
  antes el RPC la daba de alta en `true` y sus cajas entraron a bodega, al
  plan de Full y al pedido a China). A TikTok solo se le escribe un SKU que alguna vez
  se contó (entrada o ajuste): uno con puras salidas se queda con el número
  que TikTok ya tiene.
  **Tiempo real:** TikTok ya aparta solo al vender; la única forma de vender
  de más es que el ERP le escriba un número viejo. Por eso (1) NUNCA se le
  escribe sin antes leer sus pedidos recientes (`sincronizarTikTok` con
  `soloPedidos`, también desde la captura a mano); (2) se reconcilia contra
  lo que TikTok DICE tener (`tiktok_skus.cantidad_tiktok`, del catálogo), no
  contra lo último escrito: una edición en el Seller Center se corrige sola;
  el camino del aviso (`sincronizarPedidosPorId`) lee el pedido que avisó
  MÁS la ventana desde el cursor, y el cursor solo avanza si la ventana se
  leyó bien; (2b) una SUBIDA del número solo se manda con causa —entrada, devolución,
  ajuste o pedido cancelado desde la última escritura a ese SKU
  (`frenarSubidasSinCausa`, `causasDeSubida`)— salvo en la corrida completa
  sin avisos pendientes, que acaba de leer todos los pedidos; bajar siempre
  se puede. Sin esto, un aviso atorado o una corrida encimada le regalaba a
  TikTok pares ya vendidos (así se sobrevendió el MY2304 morado el 3 de
  septiembre);
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
  estampado abajo a la derecha junto al CÓDIGO DEL PEDIDO en barras (nada
  más se toca; escanear la guía en la estación enseña qué empacar), la
  lista de empaque en el mismo orden con los mismos números, y la lista de
  SURTIDO (`pdfSurtidoDelCorte`): pares por SKU en orden alfabético para
  jalar de bodega. El siguiente corte solo toma lo que
  no tiene corte.
  **Preparar pedido** (`tiktok/preparar.ts`, estación en
  `/tiktok/despacho/[id]/preparar`): se empieza por la ETIQUETA (FNSKU de
  Amazon, impreso como barras en la guía Y en el renglón de la lista: hoja,
  guía y caja llevan el mismo código) — elige el siguiente paquete sin
  preparar con ese producto y pita UNA VEZ POR PAR; luego el PRODUCTO (FNSKU de la
  caja, un escaneo por par). El camino principal con muchos paquetes del
  mismo producto es empezar por el PEDIDO: el renglón de la hoja lleva el
  NÚMERO DE PEDIDO en Code 128 (juego C, `codigoDeOrden`), escanearlo
  elige ese paquete exacto y pasa a pedir sus FNSKU. El código de producto
  es SIEMPRE el FNSKU (decisión del dueño: la caja lleva la etiqueta de
  Amazon); si TikTok llama al color distinto (MY2304 CAMEL = BROWN en
  Amazon), la equivalencia por modelo en `tiktok_alias_amazon`
  (`tiktok/fnsku.ts`, formulario en Almacén TikTok) lo resuelve. Sin FNSKU
  solo queda "Dar por bueno sin escanear", registrado como `MANUAL:` en
  `tiktok_preparaciones.escaneos`. Un paquete completo se puede dar por
  preparado SIN escanear solo con la CLAVE DE SUPERVISOR
  (`tiktok_acceso.pin_supervisor`, capturada directo en la base, nunca en
  el repo; se valida en `acceso-preparar.ts` en tiempo constante) y queda
  como `SUPERVISOR:` en la constancia. Decisión del dueño: la etiqueta lleva el
  FNSKU (no el código de paquete) porque el flujo arranca por la etiqueta.
  El FNSKU sale de `mapaAmazon`/`buscarAmazon`.
  **Conteo cíclico** (`tiktok/conteo.ts`, `/tiktok/conteo` y
  `/preparar/{token}/conteo`): el mismo escáner, sumando UN PAR por escaneo
  del FNSKU. Se compara contra el SALDO (lo apartado sigue en la bodega),
  solo la diferencia entra al kardex como `ajuste` con referencia
  `conteo:<fecha>`, y en el mismo clic se publica a TikTok pasando por
  `sincronizarTikTok` con `soloPedidos` (regla de oro). Contar un MODELO
  COMPLETO deja en cero lo que no apareció, con confirmación explícita.
  La sincronización lleva candado (`candados_trabajo`, recurso
  `tiktok-sync`); `/tiktok/desfases` cruza TikTok vs kardex vs Industher y
  simula el corte; Pendientes grita los saldos negativos.
  **Amarre de SKUs de TikTok** (`tiktok/amarre.ts`): manual → exacto →
  canónico → aplastado → ordenado → PROPIO: un SKU con forma
  MODELO-COLOR-TALLA que MELI no tiene (el MY2304 morado solo se vende en
  TikTok) se acepta tal cual, con su `-MX`, porque ese par también sale de
  la bodega. Industher lo construye SIN sufijo (`MY2304-PURPLE-23`) y
  `aliasDesdeTikTok` lo lleva al nombre de TikTok: un solo renglón en el
  kardex para los dos lados.
  Lo que quedó sin amarre se reintenta en cada corrida
  (`reamarrarPendientes`) y, si ya salió en un corte, se descuenta y se
  manda al 3PL en ese momento.
  **Muestras gratis** (`tiktok_ordenes.es_muestra`: `is_sample_order` o
  total $0): se despachan y descuentan como cualquier pedido, pero NO son
  venta (`ventas.ts` las deja fuera) y /tiktok/ventas las lista aparte.
  **Lo recibido** sale de finanzas de TikTok por pedido
  (`liquidacionDePedido`, `/finance/202309/orders/{id}/statement_transactions`),
  solo para entregados, 25 por corrida, reintento diario; queda en
  `neto_recibido` con el crudo en `liquidacion`. Hasta que TikTok liquida,
  la pantalla dice "sin liquidar", nunca estima. Ventas por MODELO
  (`resumenPorModelo`): el neto del pedido se reparte por precio entre sus
  renglones.

- **La ganancia de MELI se cuenta con dinero real, orden por orden**
  (`corte-meli.ts`, `/ventas/cortes`): neto DEPOSITADO por Mercado Pago
  (`ordenes_neto.neto`, ya sin comisión, envío de Full ni retenciones) −
  devoluciones − costo por modelo − publicidad (Product Ads + a mano) −
  gastos de Full (facturación de MELI, `meli_cargos`, + a mano en
  `gastos_meli`) − otros = utilidad neta. Todo se suma en CENTAVOS enteros
  y el total del mes sale de las ÓRDENES, no de los renglones diarios (que
  reparten y redondean). Las órdenes CANCELADAS no existen para el corte;
  las DEVUELTAS sí vendieron y la devolución se resta aparte, una sola vez
  (si Mercado Pago ya bajó el neto, solo se resta lo que falte) y el COSTO
  de los pares devueltos se SUMA de vuelta porque regresan al stock
  (decisión del dueño; un par dañado se captura como gasto a mano). Para
  eso las órdenes guardan sus `renglones` (sku, unidades, importe,
  comisión) en `ordenes_neto`/`yz_ordenes_neto`, y el RPC
  `cortes_ordenes_por_dia` cuesta los pares devueltos contra
  `productos_config`; una devuelta sin renglones se estima con costo ÷
  venta del mes y la revisión le pide los renglones a MELI. Para eso
  cada orden se REVISA después de vendida (`devoluciones.ts`): las
  cancelaciones en bloque (`/orders/search` con status cancelled, y ese día
  se vuelve a barrer para que sus renglones salgan de la venta) y el pago
  de cada orden a los 10 y a los 40 días (`/collections/{pago}`: estado,
  `transaction_amount_refunded`, neto de hoy), montado en el latido y
  completo al hacer el corte. Un corte (`cortes_meli`) congela el estado de
  resultados en jsonb y su PDF (`corte-meli-pdf.ts`) se rehace de ahí; el
  del mismo mes se reemplaza. El corte DECLARA lo que le falta para ser
  exacto (neto estimado, modelos sin costo, órdenes sin revisar, ads o
  facturación sin leer) en `avisos`; nunca rellena con estimaciones
  calladas. De la facturación de MELI solo se restan las clases `full` y
  `otro` (`clasificarCargo`): comisión y envío ya van en el neto, Product
  Ads ya cuenta por el API de publicidad, los pagos son abonos.
  **Ventas en REVENTA** (MELI compra y revende; desde el 27 ago 2026, la
  mitad de las órdenes de calzado): la orden llega con `unit_price` YA NETO
  de comisión y envío (MELI los absorbe), `sale_fee` 0 y Mercado Pago la
  deposita completa (neto = total). Verificado con la orden
  2000014843734267: "Recibes $176.80" de $208. No cuestan nada más; el
  corte las cuenta (`reventa`) y explica por qué la comisión se ve baja.
  NUNCA estimarles un cargo aparte.
- **Corte GENERAL** (`servicios/consolidado.ts`, `/cortes`, `cortes_generales`):
  calzado en MELI + fundas en MELI + Amazon (`consolidado-amazon.ts` desde el
  monitor de Amazon: neto liquidado o SKU Economics). Regla del dueño: la
  publicidad se descuenta al modelo que la gastó; los GASTOS GENERALES de
  cada plataforma (Full, colecta, FBA, otros cargos, devoluciones netas del
  costo recuperado, ads sin amarre y a mano) se dividen entre las unidades
  vendidas en esa plataforma (`cargoPorUnidad`) y cada modelo y categoría
  carga su parte. El total del canal cuadra con su corte individual. Excel
  con hoja por canal (`consolidado-excel.ts`).
- **El FNSKU (etiqueta de FBA) tiene DOS fuentes** (`etiquetas/resolver.ts`,
  `mapaAmazon`): el reporte de inventario FBA (`amazon_inventario`), que solo
  trae lo que Amazon tiene o tuvo hace poco, y `amazon_listings.fnsku`, que
  se pregunta por SKU al API de publicaciones (`amazon/fnskus.ts`,
  `searchListingsItems`, 20 por llamada, montado en el latido) y cubre lo
  agotado ("Inactive") y lo nuevo sin primer envío. Ese API exige el Seller
  ID en `amazon_accounts.selling_partner_id` (Merchant Token, capturado a
  mano): sin él el paso contesta `sin_seller_id` y no pregunta nada. Un
  producto que NO está en MELI y SÍ en Amazon (MY2304-PURPLE) saca su
  etiqueta de aquí; el amarre del SKU es canónico → ordenado → aplastado y
  `-ME`/`-MEX` cuentan como sufijo de sitio igual que `-MX`.
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
  MXN final, en `productos_config`. Ahí también viven los diseños de FUNDAS
  (categoría "Fundas"): es el único lugar de costos del sistema. La ganancia de MELI usa el neto real
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

## Regla de arquitectura: datos ya masticados, decidida por el dueño

**Ninguna pantalla hace trabajo pesado en el request.** El trabajo (bajar
tablas, amarrar, agregar, optimizar) corre por atrás —latido, crons— y se
guarda masticado; la pantalla lee un renglón. El patrón es siempre el mismo:
tabla de caché con `vigente`/`motivo`/`datos jsonb` (`plan_cache`,
`plan_fba_cache`, `inventario_cache`, `yz_cache` por clave,
`consolidado_cache`, `app_cache`), invalidación desde los syncs y las rutas
que escriben, y precálculo en el latido (calzado) o el cron de netos
(fundas). **La pantalla SIRVE el renglón guardado aunque esté invalidado o
viejo** (declarándolo: componente `Frescura`, "Datos de hace X min") y el
fondo refresca por invalidación Y POR EDAD (`clavesObsoletasYz` mira
`generado_en`; el latido igual con `inventario_cache`): calcular en el clic
solo se vale cuando NO existe ningún renglón. Una escritura del usuario
que quiere ver su efecto ya (cargar un pedido, un amarre, un gasto) o
recalcula su renglón en la misma ruta si es barato, o lo manda al fondo con
`after()` de Next. Los CORTES van por periodo (`corte:YYYY-MM` en
app_cache/yz_cache y `consolidado_cache`) con la política de
`corteNecesitaRefresco`: mes corriente cada 10 min, mes cerrado casi
congelado; cambiar de mes es leer un renglón. Las agregaciones por rango de
fechas van en RPCs de Postgres (`ventas_resumen_sku`,
`publicidad_resumen_items`, `yz_ultimas_ventas`…), nunca bajando la tabla
cruda a Node, y las lecturas SIEMPRE acotadas por los DOS lados del rango.
Los RPCs y lecturas paginadas llevan ORDER BY estable (sin él, PostgREST
duplica o pierde renglones entre páginas). Antes de agregar una pantalla o
consulta nueva, sigue este patrón.

**Los avisos de MELI de la app de YAPANIZCEL** entran (si se configuran) por
`/api/yapanizcel/webhook`, que contesta 200 sin trabajo: la sincronización
de fundas es por sondeo. La URL de notificaciones del devcenter NUNCA debe
apuntar al callback del OAuth (así se llegó a ~1 millón de POST diarios que
eran la mayor parte de la factura de Vercel).

## ERP YAPANIZCEL (fundas) — sección aparte, mismo proyecto

Segundo negocio: fundas para celular en OTRA cuenta de Mercado Libre. Vive en
`/yapanizcel/*`, `src/lib/yapanizcel/` y tablas con prefijo `yz_`. No comparte
tablas con el ERP de calzado, con UNA excepción decidida por el dueño: los
COSTOS. `productos_config` (Productos y costos, en Bodega) es la fuente
única de costo y categoría de TODO —modelos de calzado y diseños de funda—
y de ahí leen Ventas de MELI, Ventas de fundas, el pedido a China de
fundas, Amazon y los cortes (`servicios/costos-unificados.ts`:
`modeloUnificado`, `configDeSku`, `mapaCostosUnificado`). `yz_costos` queda
como respaldo de lectura y el Excel de costos de fundas escribe en los dos
lados (categoría "Fundas" solo a los renglones nuevos). Sí comparte el
login, la base y el deploy.

- **Cuenta y app de MELI propias.** Credenciales en `MELI_YZ_CLIENT_ID` /
  `MELI_YZ_CLIENT_SECRET`; tokens en `yz_tokens` (RLS con cero políticas, como
  `meli_tokens`). Redirect URI: `/api/yapanizcel/meli/callback`. La RLS usa
  `es_mi_cuenta_yz()`, aparte de `es_mi_cuenta()` a propósito.
- **No hay cajas ni corridas.** La funda es unidad suelta. El SKU es
  `DISEÑO-MODELO(-COLOR)` donde "modelo" es el del CELULAR y "diseño" el de la
  funda (499, 501…). Los pedidos a China se ven POR DISEÑO.
- **A Full se manda en DECENAS CERRADAS** (`multiplo_envio`, 10) y para
  **15 días de cobertura** (`dias_objetivo`; hay poco espacio en Full): la falta se
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
- **Costos por diseño** en Productos y costos (`productos_config`, ver
  arriba); el Excel (MODELO, COSTO) de Ajustes de fundas sigue funcionando y
  escribe ahí también. Se buscan por la clave completa y luego por el diseño
  del SKU (`costoDeSku`). Sin costo = ganancia no calculable, nunca costo 0.
- **Ganancia sobre el neto real** (`net_received_amount`, caché en
  `yz_ordenes_neto`, re-lectura de órdenes recientes por cargos diferidos).
  La cuenta vende ~1,400 órdenes al día y la sincronización solo alcanza
  150 netos por tramo, así que CADA orden se registra al leerla (pagos y
  renglones sku/importe en `yz_ordenes_neto`) y un trabajo de fondo
  (`yapanizcel/netos.ts`, cron `/api/yapanizcel/netos` cada 10 min) pide
  los netos que faltan a Mercado Pago, registra hacia atrás las órdenes
  viejas y ASIENTA en `yz_ventas_diarias` los días que quedan completos sin
  releer MELI. Mientras un renglón no tiene depósito real, el panel lo
  ESTIMA con el porcentaje observado (neto ÷ venta de las órdenes con
  depósito, últimas 8 semanas, mínimo 50 órdenes; `estimarNeto`), que ya
  trae envío de Full y retenciones, y lo declara; nunca importe − comisión
  como si fuera el neto (así se infló la ganancia de fundas al 86% de la
  venta cuando el real es ~51%).
- **Envíos registrados (`yz_envios`) solo alimentan cálculos**: cuentan como
  en camino hasta caducar (`dias_caducidad_envio`) o marcarse recibidos.
- **Descontinuados** (`yapanizcel/descontinuados.ts`), dos niveles decididos
  por el dueño: un SKU sin UNA venta en 180 días no se ofrece a Full ni se
  pide a China y su diseño sigue saliendo con las variantes vivas; pero si
  NINGUNA variante del diseño vendió en 180 días, el diseño se retira
  COMPLETO, con todo y sus variantes nuevas o sin fecha (`disenos` en el
  resultado). Guardas: un SKU publicado hace menos de 180 días o sin fecha
  (`yz_skus.publicado_en`, que la sincronización fija con
  `yz_fijar_publicado`) no se juzga solo; un diseño con puras variantes
  nuevas/sin fecha es lanzamiento y no se retira; y sin 180 días de
  historial (`yz_sync_estado.ventas_desde`) no se descontinúa nadie.
  **Pedidos a China de fundas lee vistas derivadas**: el cálculo completo
  (`yz_cache` clave `compras`, ~6.5 MB) solo lo baja el Excel de todos los
  diseños; la pantalla lee `compras:resumen` y `compras:d:<diseño>`
  (`obtenerResumenCompras`/`obtenerDetalleCompras`), que se guardan junto
  con el completo (`recalcularCompras`) y caen con él (`invalidarYz` tumba
  la clave y su prefijo). El cron de netos las precalcula ANTES de la
  facturación para que siempre le alcance el tiempo.
- **La sincronización va por tramos de 7 días con presupuesto de tiempo**
  (`yapanizcel/tramos.ts` + `yz_sync_estado`): el catálogo es grande (~18 mil
  variantes) y una sola llamada no cabe en los 300 s de Vercel. Cada corrida
  recalcula lo reciente y extiende hacia atrás hasta 180 días; la pantalla y el
  cron llaman en bucle con `continuar: true` hasta que `completo` sea true.
- **Corte mensual de fundas** (`yapanizcel/corte.ts`, `/yapanizcel/cortes`,
  `/api/yapanizcel/{cortes,revisar,cargos,gastos}`): el MISMO motor y la
  misma pantalla que el de calzado (`armarEstadoResultados`, `CorteVista`,
  `pdfDelCorte` con `negocio`), pero armado desde las ÓRDENES registradas
  (`ventasDesdeOrdenes`: canceladas fuera, un día con alguna orden cobrada
  sin neto se deja sin neto y el motor lo estima con el ratio observado).
  Mientras `yz_sync_estado.ordenes_registradas_desde` no llegue al inicio
  del mes, la venta sale de `yz_ventas_diarias` y el corte lo declara.
  Revisión de devoluciones/cancelaciones en `yapanizcel/devoluciones.ts`
  (sin re-barrer días: marcar la orden basta), Product Ads por diseño en
  `yapanizcel/publicidad.ts` (gasto del anuncio repartido parejo entre los
  diseños de la publicación), facturación en `yz_cargos` con el almacén
  `almacenYz` (bitácora en `yz_sync_log`, tarea `cargos`), gastos a mano en
  `yz_gastos`, cortes en `yz_cortes`. Todo el fondo (netos, revisión,
  facturación) corre en el cron de `/api/yapanizcel/netos` cada 10 min.
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
| Cargar pedidos (muchas proformas, lista con filtros) y faltantes contra el sheet de pendientes (`PEDIDOS_SHEET_URL`, pestaña por `gid`, AR* ignorados) | `src/app/pedidos/cargar` + `components/cargar-pedidos-lote.tsx` + `src/lib/servicios/pedidos-sheet.ts` |
| Packing list de la fábrica → contenedor (lector + amarre pedido/modelo/color/talla) | `src/lib/importar/packing-list.ts` + `src/lib/servicios/packing-list.ts` + `/api/contenedores/packing-list` |
| Productos nuevos en camino (pedidos sin stock nunca; fotos en MELI y Amazon, mínimo 2) | `src/lib/servicios/productos-nuevos.ts` + `src/app/pedidos/nuevos` + `/api/pedidos/nuevos/fotos` |
| Costos de envío mal cobrados     | `src/lib/servicios/costos-envio.ts` + `/costos-envio` |
| Solicitud a MELI de revisión de medidas (Excel Item ID/Site/medidas en cm y g ENTEROS hacia abajo + ficha de evidencia PNG por modelo, bucket `evidencia-envio`) | `src/lib/servicios/evidencia-envio.ts` (+ `-imagen.tsx`, `-generar.ts`) + `/api/costos-envio/evidencia` + `/api/costos-envio/excel?formato=meli` |
| Inventario desde API Industher   | `src/lib/servicios/industher.ts` + `/api/industher` |
| Vista de inventario precalculada (`inventario_cache`, como `plan_cache`: la invalida `invalidar()` y el latido la deja lista para Bodega y Planificación China) | `src/lib/servicios/inventario.ts` (`cargarInventario`/`recalcularInventario`) |
| Corridas desde Google Sheets     | `src/lib/servicios/corridas-sheets.ts` + `/api/corridas/sheets` (URL en `CORRIDAS_SHEET_URL`) |
| Envíos a Full registrados        | `src/lib/servicios/envios-registrados.ts`   |
| Corte mensual MELI (estado de resultados al centavo, PDF, gastos a mano, facturación de MELI, revisión de devoluciones y cancelaciones) | `src/lib/servicios/corte-meli.ts` (+ `corte-meli-pdf.ts`, `cargos-meli.ts`, `devoluciones.ts`) + `src/app/ventas/cortes` + `/api/ventas/*` |
| Monitor de ventas MELI / Amazon  | `src/lib/servicios/ventas-monitor.ts`, `amazon-monitor.ts` (filtro de fechas en `components/filtro-fechas.tsx`); las sumas van en Postgres (`ventas_resumen_sku`, `ventas_totales_dia`, migración 0060) con respaldo renglón por renglón |
| Product Ads sincronizado a la base (`publicidad_diaria`, montado en el latido; la pantalla suma con `publicidad_resumen_items` y cae al API en vivo si el rango no está cubierto) | `src/lib/servicios/publicidad-sync.ts` + `publicidad.ts` |
| Caché del plan de FBA (`plan_fba_cache`, como `plan_cache`; lo invalidan `invalidar()` y las sincronizaciones de Amazon, y el latido lo deja precalculado) | `src/lib/servicios/plan-fba-cache.ts` |
| Etiquetas (ZPL, PDF, resolución) | `src/lib/etiquetas/` (`zpl.ts`, `pdf.ts`, `resolver.ts`, `code128.ts`) |
| ZIP de etiquetas por pedido      | `src/app/api/pedidos/[id]/etiquetas/route.ts` |
| Sincronización con Amazon        | `src/lib/amazon/` (`sync.ts`, `spapi.ts`, `reportes.ts`) |
| Contenido de marca en Amazon     | `src/lib/servicios/contenido-amazon.ts` + `src/app/amazon/contenido` (imágenes y padres en `src/lib/amazon/catalogo.ts`) |
| Acceso sin contraseña a contenido | `src/lib/servicios/acceso-contenido.ts` + `src/app/contenido/[token]` + `/api/contenido-publico/[token]` |
| TikTok Shop (API firmado, kardex) | `src/lib/tiktok/` (`client.ts`, `firma.ts`, `api.ts`, `kardex.ts`, `amarre.ts`) |
| TikTok: sincronizar y publicar    | `src/lib/servicios/tiktok.ts` (+ `tiktok-bodega.ts` foto de Industher, `tiktok-panel.ts` pantalla, `tiktok-despacho.ts` cortes) |
| Videos de producto (Higgsfield)  | `src/lib/higgsfield/` + `src/app/videos` + `/api/videos/*` |
| ERP YAPANIZCEL (fundas)          | `src/lib/yapanizcel/` (`sku.ts`, `plan.ts`, `sheets.ts`, `sync.ts`, `ventas.ts`, `compras.ts`, `pedidos.ts`) + `src/app/yapanizcel/*` + `/api/yapanizcel/*` |
| Páginas                          | `src/app/{envios,inventario,ventas,amazon,tiktok,pedidos,pedidos/cargar,pedidos/nuevos,contenedores,corridas,etiquetas,videos,pendientes,ajustes}` |

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

## Proyecto aparte: `boletos/` (venta de boletos para eventos)

Sistema **independiente** del ERP que vive en la carpeta `boletos/` con su
propio `package.json`, su propia migración (tablas con prefijo `ev_`) y su
propio despliegue en Vercel (Root Directory = `boletos`). No comparte tablas ni
código con el ERP ni con YAPANIZCEL. Léase `boletos/README.md`.

**No se mezclan.** Una tarea del ERP no toca `boletos/` y una de boletos no
toca el ERP: ni código, ni commits, ni explicaciones. Por eso `vitest.config.ts`
y `tsconfig.json` de la raíz excluyen `boletos/`: sus pruebas y tipos se corren
desde su propia carpeta con sus propias dependencias.
