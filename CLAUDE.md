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
  **Cobertura para no forzar caja** (`coberturaSinForzarDias`, 15;
  decisión del dueño, 15-sep-2026): cuando la caja va a FORZAR otras
  tallas (la regla de arriba aplica: menos de la mitad de la caja tapa
  faltantes), ya no se mira el horizonte de 30 días sino 15. Si a la talla
  que la pide todavía le alcanza el stock para 15 días, su necesidad se
  borra (`cobertura_suficiente`) y no viaja nada; con menos de 15, la
  regla de la mitad / 7 días sigue igual. El rescate del optimizador
  obedece lo mismo (tolerancia infinita para esas tallas). Los productos
  NUEVOS quedan fuera: a ellos se les rellena la caja.
- **Tres reglas de producto en el plan de Full** (decididas por el dueño el
  9-sep-2026 al revisar por qué EnvioPack aportaba pocas cajas; la
  preferencia Industher → Caseshop → EnvioPack de `prioridadAlmacen` se
  queda). Las tres se deciden por PRODUCTO (modelo + color aplastado,
  `Caja.producto`, que `construirCajas` llena) y viven en `engine/index.ts`:
  1. **Producto NUEVO en crecimiento** (`nuevoDias`, 60; GT190, GT193…):
     se estrenó en Full dentro de la ventana hace menos de esos días
     (`DemandaSku.lanzamiento`: primer día con foto, movimiento o venta;
     un SKU con datos desde el primer día de la ventana es viejo) y ninguna
     talla vendía antes de la ventana (`skusConVentaPrevia`, del RPC
     `ventas_resumen_sku` con rango abierto). A un producto nuevo cualquier
     faltante le FUERZA su caja: tolerancia de rescate 0, exento de la regla
     de la corrida despareja y la caja va FIRME, nunca opcional. Si no se le
     surte, nunca va a pagar.
  2. **Holgura sobre el objetivo** (`holguraObjetivoDias`, 2): quedar en 32
     días en vez de 30 no es sobre-surtir. En el optimizador, las piezas que
     caen dentro de la holgura (descontando lo que la talla ya traiga arriba
     de su objetivo) no cuestan como sobrante y cuentan como útiles en el
     rescate.
  3. **Producto SIN VENTA** (`cajasMinimasSinEstreno`, 2): nunca ha vendido
     un par en Full (ni en la ventana ni en toda la historia,
     `skusConVentaHistorica`) y hay cajas en CUALQUIER bodega → se le
     sostiene una POSICIÓN mínima de 2 cajas del modelo + color (piso en el
     optimizador, primero las de corrida). Lo que ya tiene en Full o
     viajando en un envío dado de alta descuenta; lo que la bodega apenas
     APARTÓ para un envío pendiente NO (`enCaminoBodega`): esa caja suele
     ser el mismo envío que se está armando y el dueño quiere que el
     envío del producto nuevo lleve sus 2 cajas (GT160/GT206 el
     9-sep-2026). Una talla excluida a mano saca al producto. Si el RPC de
     historia falla, esta regla se apaga en esa corrida y el plan lo avisa.
- **El envío a Amazon tarda ~7 días en volverse vendible en FBA**
  (`RIESGO_DIAS_FBA`), dato del negocio: el objetivo real por talla en FBA
  es 30 + 7 = 37 días, no más.
  **Las tres reglas de producto también rigen el plan de FBA**
  (`fba-plan.ts`, pedido del dueño el 14-sep-2026: «no me sale para mandar
  los productos nuevos, hazlo igual que MELI»): la historia sale del RPC
  `amazon_historia_sku` (migración 0086: pares de toda la historia y
  estreno = primera venta o primera foto con stock, por SKU de Amazon,
  amarrado a MELI como los renglones). Diferencia con Full: en Amazon no
  todo está publicado, así que un producto SIN VENTA solo se manda a probar
  si alguna talla tiene publicación Active o Inactive en `amazon_listings`
  (una Incomplete no recibe inventario). Si el RPC falla, NUEVO y SIN VENTA
  se apagan en esa corrida y el plan lo avisa (`PlanFbaCajas.avisos`). La
  pantalla enseña cada envío por bodega en su propia sección (Caseshop +
  Industher, EnvioPack) con el Excel de ese envío.
  **La historia se lee POR PÁGINAS** (`traerRpcTodo`; 9-oct-2026, dueño:
  «me pones sin venta en Amazon GT144 o GT154 y no son nuevos»): el RPC
  trae ~4,500 SKUs y el API entrega 1,000 por respuesta, así que todo lo
  que en el alfabeto venía después del GT13x salía SIN VENTA y se le pedía
  la posición mínima de 2 cajas (GT144 tenía 1,265 pares vendidos). Lo
  mismo le pasaba a `ventas_resumen_sku` (1,667 SKUs de calzado con venta:
  plan de Full, Ventas MELI, Publicidad, Excel por modelo de TikTok); ahora
  lleva ORDER BY (migración 0125) y se lee con `rpcPaginado`.
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
  amarra se enseña y NO se guarda. Un DEDAZO en el color se rescata solo si
  hay UN color del mismo pedido+modelo a una letra (`aUnaLetra`,
  `colorParecido`): la fábrica escribió "Toffe" por TOFFEE y 103 cajas de
  GT150 se quedaron fuera de S260-2026. Dos letras NO se adivinan
  ("M BROWN" contra "LT BROWN" del pedido es otro color y se declara). Lo que
  no entró completo se guarda RENGLÓN POR RENGLÓN (`problemasDelCasado`, en
  `drive_packing_lists.resultado.problemas` y en el `motivo`): antes solo se
  guardaba «omitidos: 3» y el dueño no tenía cómo saber que de 611 cajas
  entraron 399. Y se queda EN EL CONTENEDOR (`contenedores.pendientes`,
  migración 0081): el borrador enseña «N cajas sin amarrar» y en Contenido
  sale cada renglón con lo que PODRÍA ser —los renglones del mismo modelo
  con cajas libres, el color más parecido primero— para que el dueño
  confirme ahí mismo o lo descarte. Nunca se aplica solo. Subirlo dos veces al mismo contenedor no
  duplica: lo de ese contenedor se reemplaza. El pedido tiene que estar
  cargado antes (Cargar pedidos). **Las MEDIDAS y el PESO de la caja también
  salen del packing list de la fábrica** («Means» 0.66 × 0.56 × 0.24 en
  metros → cm, «G.W/ctn» en kg; `medidasDeCeldas`) y se guardan por renglón
  en `contenedor_lineas` (migración 0094), nunca se capturan a mano
  (decisión del dueño, 18-sep-2026: «lo tomes del packing list, ahí sí
  sale»). **El botón «Packing list» del contenedor descarga el formato del
  agente aduanal** (`packing-list-contenedor.ts`): LOTE PEDIDO, MODELO,
  COLOR, SKU (`IN10126-GT142-CREAM`, con talla si la caja es unitalla),
  PARES por caja, CAJAS, LARGO, ALTO, ANCHO, PESO, PRECIO = costo por par de
  Productos y costos × pares de la caja, NOMBRE (título de la publicación) y
  CODIGO FISCAL por la categoría de MELI del modelo (Botas y Botines
  53111500; alpargatas, mocasines, flats, zapatillas y demás zapatos
  53111600; Pantuflas 53111700; Sandalias y Chanclas 53111800; Tenis
  53111900). Lo que falta queda en blanco y en una hoja «Avisos»: no se
  inventa.
- **Un pedido con COLOR FANTASMA se grita en Cargar pedidos**
  (`servicios/amarre-pedido.ts`; pedido del dueño el 6-oct-2026: «si el
  sistema ve que un pedido no está ligado a un SKU, que me alerte»): cada
  renglón modelo + color se amarra contra el catálogo de MELI con los
  cinco niveles de `buscarVariante`. Si el MODELO sí está publicado pero
  con otros colores (`color_fantasma`: "BLK (NEGRO)" contra "BLK", "GREY
  BLUE" sin publicar) su inventario en camino no descuenta del color real
  en Planificación China y Productos nuevos lo enseña «sin publicar», así
  que se avisa en ROJO con los colores que MELI sí tiene: en la ventana de
  confirmación de la proforma (`Proforma.amarre`, antes de guardar), en la
  lista de pedidos vivos (`PedidoResumen.sinSku`) y en Renglones (el campo
  de color sugiere los publicados y se calla al corregirlo). Un modelo que
  MELI no tiene (`modelo_nuevo`) es producto nuevo de verdad y no se grita.
  Nunca se corrige solo. Si el catálogo no se puede leer, no se avisa nada.
  **Y el dueño LIGA a mano el color con la variante de MELI**
  (`servicios/alias-color.ts`, tabla `pedido_color_amarres`, migración
  0113, `POST /api/pedidos/amarre-color`, ventana `components/ligar-colores.tsx`;
  pedido del dueño el 7-oct-2026: «que me ponga lo que MELI tiene, lo
  marque en rojo por afuera y cuando me meta salgan las variantes de ese
  modelo y yo elija cómo ligarlo; lo mismo en los packing lists de China,
  lo que hay en camino en contenedores»): el pedido y el contenedor con un
  color fantasma llevan un botón ROJO «Ligar a MELI» (y la raya roja en el
  renglón); la ventana enseña las variantes publicadas del modelo y se
  elige una, o «es un color nuevo» (`color_meli` NULL → estado
  `color_nuevo`, ya no se grita). El amarre es por MODELO + color aplastado,
  no por pedido —la misma escritura se repite en los pedidos siguientes— y
  el renglón del pedido CONSERVA la escritura de la fábrica (así sigue
  amarrando el packing list). Lo obedecen: la alerta (`evaluarAmarre` con
  `MapaAlias`), el «en camino» de `inventario_cache` (y con él Planificación
  China y Bodega), Productos nuevos (`agruparProductosDePedidos`), las
  etiquetas del pedido y el casado del packing list (`colorPorAlias`: los
  dos lados traducidos a MELI dicen lo mismo, solo con UN candidato). Un
  amarre a un color que MELI ya no tiene vuelve a salir como fantasma. Se
  quita desde la misma ventana («Amarres»). Al guardar se invalidan
  inventario y plan.
  **Los renglones del packing list que no amarran se sugieren POR
  ELIMINACIÓN** (`servicios/packing-sugerencias.ts`, puro con pruebas;
  `sugerirRenglon`; dueño, 7-oct-2026: «hay negro, medium brown y crema; el
  crema y el negro se amarran y solo sobró el medium brown: me lo sugieres
  y solo me pones ahí para confirmar»): en Contenido, cada pendiente dice
  «Packing list · IN10079: GT219 MEDIUM BROWN · 40 cajas → Es GT219 M BROWN
  del pedido IN10079 · 40 sin barco» con su porqué (del pedido y modelo ya
  entraron los demás colores y solo queda uno = `eliminacion`, en verde;
  comparten una palabra del color con sinónimos = `parecido`, en ámbar; si
  no, `ninguna` y se elige a mano). Para eso el pendiente guarda el PEDIDO
  del packing list (`PendientePacking.pedido`) y la clase de caja (unitalla
  contra su talla, corrida contra corrida). «Sí, es este» suma las cajas y,
  con «Recordar» (marcado por omisión cuando el renglón del pedido amarra
  con MELI; `LineaContenido.colorMeli` del endpoint de líneas), guarda en
  `pedido_color_amarres` el nombre del packing list → color de MELI para
  que el siguiente embarque amarre solo por `colorPorAlias`. Nunca se
  aplica solo.
- **Un producto es NUEVO si nunca tuvo stock en Full ni en FBA** (stock
  actual, fotos, movimientos, ventas): la bodega no cuenta. Se agrupa por
  modelo + color comparando el SKU completo sin talla ni sufijo
  (`claveProductoDeSku`), porque `skus.modelo` parte mal los modelos con
  guion (GT104-1). Segundo nivel LAXO (`claveProductoLaxa`): la proforma
  escribe el color por partes con anotación ("BLK/BLK/RED", "BLK/BLK/BLK
  (NEGRO)") y MELI/Amazon lo tienen como "BLK / RED", "BLK-BLK" o "BLK";
  sin paréntesis y con repetidos seguidos colapsados caen en el mismo lugar
  (verificado con GT134).
- **Lo pedido a China que todavía no llega cuenta como «en camino» AUNQUE
  la bodega ya conozca el pedido** (`engine/pendiente-china.ts`,
  `pendientePorLinea`, en `recalcularInventario`; dueño, 5-oct-2026: «el
  sistema no está tomando en cuenta lo que está pedido en China»): un
  pedido que llega por partes dejaba de contar ENTERO en cuanto la bodega
  reportaba la primera parte; el IN10079 (97,680 pares) tenía 31,272
  recibidos y los 66,408 que siguen en el mar o en China no existían para
  Bodega, Planificación China ni el catálogo (69,576 pares en total ese
  día). Por pedido y modelo: pendiente = pedido − máx(cajas en contenedores
  RECIBIDOS, físico de la bodega de ese pedido) − lo que la bodega ya
  reporta en camino de ese pedido, repartido entre sus renglones por lo que
  a cada uno le falta por contenedores. Un pedido que la bodega no conoce
  cuenta completo, como antes; uno que ya llegó completo (aunque siga
  abierto) no suma nada.
- **Recibir un contenedor NO crea existencias.** El inventario de bodega llega
  del **API de Industher** (sincronización diaria en el cron y botón en
  /importar; llave en `INDUSTHER_API_KEY`); crear filas propias lo contaría dos
  veces. El Excel de existencias ya no tiene UI: queda solo como respaldo de
  emergencia en `/api/importar`.
- **Una publicación de MELI = UN SOLO renglón activo en `skus`.** MELI deja
  editar el SELLER_SKU de una variante y el catálogo se guarda por
  (cuenta, SKU), así que escribir el nombre nuevo NO borra el viejo. El
  barrido completo lo limpia (`detectarSkusFantasma`) pero corre una vez al
  día; el aviso del webhook llega en el momento y hasta el 10-sep-2026 solo
  daba de alta, así que 26 publicaciones quedaron con DOS renglones activos
  (el mismo `inventory_id` como "GT134-NAVY / RED-28-MX" y como
  "GT134-NAVY-RED-28-MX"). Con las dos vivas, `construirCajas` amarraba la
  caja de la bodega TikTok tantito a una y tantito a la otra: el kardex se
  pasó los 15 pares de un nombre al otro dos veces al día y el par vendido
  el 7-sep se quedó en el nombre viejo, con saldo −1. `procesarItem`
  (`webhooks.ts`) ahora apaga el nombre anterior de ESA variante en el acto
  (`renombresDePublicacion`: se reconoce por su user product y, si no hay,
  por item + variación; nunca las hermanas ni las que esperan su SKU).
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
  mediana lado por lado. **El user product manda el valor SOLO en
  `values[0].struct`** (ni `value_name` ni `value_struct`): hasta el
  25-sep-2026 no se leía y 1,110 de 1,693 publicaciones quedaban "sin
  medida". **El envío se cobra por TRAMO DE PRECIO** ($299–$498 con
  descuento, desde $499 completo) y MELI lo enseña al precio de VENTA
  (`/items/{id}/sale_price`, la promoción), no al de lista: la revisión
  guarda `precio_venta` y le pregunta al simulador con ese (el dueño leía
  «MELI ya lo corrigió» cuando solo había cambiado el precio). Las que
  cobran de más se releen en CADA pasada; `medidas_en` es la fecha de
  LECTURA real, no de la pasada. **El RPC de ventas reales vive MASTICADO en
  `app_cache` (clave `envio-real`, `leerEnviosRealesConEstado`,
  `refrescarEnviosReales` cada hora en el latido; migración 0099)**: el
  28-sep-2026 `envio_real_por_sku` corría bajo RLS y se cancelaba a los 8 s
  del rol `authenticated` (la política por renglón dejaba al planificador
  sin estimaciones: 17 s), `leerEnviosReales` se tragaba el error y la
  pantalla caía al simulador con TODO «sin ventas» y el GT229 otra vez con
  «4 cobran de más». Ahora la función es `security definer` con su propio
  control de acceso (`es_mi_cuenta`, service_role o `session_user`
  postgres; NUNCA `current_user`, que dentro de una security definer es el
  dueño de la función) y contesta en ~1 s; la pantalla lee el renglón
  guardado, lo refresca si tiene más de una hora, y si el RPC falla sirve
  la última lectura o declara en ámbar que la revisión salió solo del
  simulador (`EstadoVentasReales.aviso`). Nunca en silencio. **Lo que MANDA es lo que MELI COBRÓ de
  verdad** (RPC `envio_real_por_sku`, migración 0097, sobre
  `ordenes_neto.envio_vendedor`; decisión del dueño, 25-sep-2026: «¿por qué
  simulas y no revisas exactamente?»): cada pedido de un SKU se compara
  contra los pedidos de sus hermanas AL MISMO PRECIO por unidad —el envío
  cambia con el precio del pedido: la misma talla pagó $59.60, $67.60 y $76
  el mismo día en reventa, y abajo de $299 la medida casi no pesa— y lo
  pagado de más es la diferencia mayor a $5, pedido por pedido, en 60 días
  (los ±$1–2 entre tallas son normales: una talla grande pesa más). **Solo
  pedidos que VIAJARON SOLOS**: un carrito es un pack de varias órdenes que
  comparten UN envío y `/shipments/{id}/costs` le pone el paquete completo a
  cada orden (GT114: solo $39, con otro producto $80, con dos más $121…); la
  primera versión marcó 53 tallas del GT114 con $38 mil "de más" por eso.
  Y una talla se señala solo si sus DOS ÚLTIMOS pedidos comparables pagaron
  de más (`sigueCobrandoDeMas`; regla del dueño: «hay que fijarse siempre
  en los últimos dos pedidos por variante»): MELI corrige medidas de vez en
  cuando (la GT229-TABACO BROWN-26 pagó $111.60 hasta el 3-sep y $76 desde
  el 16-sep), lo de 60 días es historial y uno solo con envío doble es un
  carrito a medias. El 25-sep-2026 con esa regla quedaban 4 tallas de toda
  la cuenta ($123.60 en 60 días): MELI ya había corregido casi todo. El GT229-TABACO BROWN-24
  (28 × 25 × 25 en MELI, $152 vs $76 en el simulador) pagó en 26 ventas lo
  mismo que sus hermanas: NO cobra de más. Con ≥2 pedidos comparables manda
  lo real (`conVentas`); sin ventas, el simulador. El RPC no hace self-join
  (el planificador sin estadísticas del CTE se iba a minutos): la mediana de
  las hermanas sale de un arreglo por ventana, 1.5 s en 60 días. La pantalla enseña los DOS últimos cobros por variante con el
  precio del pedido y lo que pagaron las hermanas a ese precio. Sonda sin
  escribir: `/api/costos-envio/diagnostico?sku=…` (item, variación, user
  product, `/items/{id}/shipping_options/free`, simulador a cada precio y
  ventas reales).
- **Los envíos a Full registrados (`envios_full`) SOLO alimentan cálculos**:
  cuentan como "en camino" en el plan, nunca descuentan inventario. Caducan
  solos a los 7 días y se quedan visibles como caducados.
- **TikTok Shop es ENVÍO PROPIO y lleva su PROPIO inventario.** No es Full ni
  FBA ni las cajas de Industher: es un cuarto almacén, con kardex nuestro en
  `tiktok_movimientos` (esa tabla es la fuente de verdad; `tiktok_inventario`
  solo guarda el saldo ya sumado). Un pedido pagado sin despachar APARTA, no
  descuenta; el saldo baja hasta que el envío se confirma
  (`AWAITING_COLLECTION` en adelante). **Un pedido creado SIN PAGAR
  (`UNPAID`) TAMBIÉN aparta** (`efectoDeEstado` → `espera`,
  `estaComprometido`; 18-sep-2026): TikTok le tiene el par apartado al
  comprador mientras paga —en México el pago en efectivo tarda hasta tres
  días— y hasta ese día el ERP lo trataba como «nada», publicaba
  `saldo − pagados` y TikTok volvía a vender esos pares; cuando el
  comprador pagaba dos días después (586077460963886586, MY2305-MINT-24-MX
  el 15-sep, pagado el 17) el par ya se había ido en otro pedido. ASÍ SE
  SOBREVENDIÓ: en diez días ~570 pedidos nacieron sin pagar y se cancelaron
  solos (38 h promedio en ese estado) y ~40 pagaron tarde. El sin pagar
  solo cuenta para lo que se PUBLICA; no entra al corte, no lo bloquea la
  defensa y no mueve el kardex; si TikTok lo cancela, vuelve a ofrecerse.
  Lo que se le publica a TikTok es
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
  diferencia contra lo ya reconocido (en la sincronización de TikTok cada
  15 min, que baja la foto de Industher ella misma; el botón de Industher
  en /importar también concilia y publica en el fondo con `after()`,
  21-sep-2026: «sincronizo mi bodega y no se actualiza en Almacén TikTok») (movimientos `industher:*` MENOS las
  salidas que el 3PL ya confirmó MÁS las devoluciones); una BAJA se atribuye
  primero a las salidas pendientes de ese SKU y solo el resto es merma
  (`conciliarAcumulado`): una salida nunca se descuenta dos veces.
  **Una DEVOLUCIÓN sube el kardex pero el par no vuelve solo al estante**: el
  paquete ya había salido y el 3PL ya lo descontó. Por eso la devolución entra
  en la base y solo sobrevive si la bodega la CONFIRMA —si el par regresa de
  verdad, Industher lo cuenta y la base cuadra; si no, la diferencia sale como
  retiro «Devolución que no volvió al estante de Industher»—. Sin esto la
  diferencia se quedaba para siempre y el kardex le ofrecía a TikTok pares que
  no existían: el 14-sep-2026 eran 18 pares en 10 SKUs, y en TODOS la
  diferencia contra la bodega era exactamente su número de devoluciones
  (GT102-GREY-25-MX ofrecía 3 con el estante en cero). NUNCA como ajuste absoluto, que
  volvería a publicar lo ya vendido (`tiktok/bodega.ts`). **Un SKU CONTADO a
  mano se concilia desde su conteo** (`conciliarAcumulado`, 6-oct-2026): la
  base contra la foto de Industher es el saldo del kardex (que el `ajuste`
  ya pisó) más las salidas pendientes, no la historia de entradas y mermas
  de Industher; si no, la foto siguiente volvía a restar lo que el conteo
  ya quitó: el GT148-CREAM-23-MX se contó a cero el 5-oct (21 pares que no
  existían, dueño: «no los tengo, bórralos») y la conciliación de la
  mañana escribió «merma 21» y dejó el kardex en −21 (al GT134-BLK-23-MX
  le pasó igual el 30-sep). Los dos se volvieron a poner en cero por SQL. **Se cuentan
  SOLO las cajas DISPONIBLES del 3PL** (`paresDisponiblesPorSkuDesdeCajas`;
  hasta el 29-sep-2026 se contaban las físicas = disponibles + apartadas):
  Industher marca APARTADA la caja de cada salida que el ERP le manda (y
  a veces reserva pares por su cuenta) y la descuenta del físico solo al
  despachar; el kardex ya restó esa salida con el ack del endpoint, así que
  contar el físico volvía a meter el par como «entrada» mientras el 3PL
  tardaba: el GT114-LT BROWN-28-MX (7 entrados, 7 vendidos, Industher con
  físico 1 / apartado 1 / disponible 0 porque el par no aparecía) recibió
  «entrada 1» a los 3 minutos del corte #42, TikTok volvió a ofrecerlo y el
  dueño lo cancelaba y se volvía a publicar. Lo apartado por Industher se
  lee aparte (`paresApartadosPorSkuDesdeCajas`, `apartadasBodega`) solo
  para explicar la baja («Apartado en Industher: N pares reservados») y el
  aviso de una baja detenida. El estante que topa la publicación y la
  alarma también es el disponible. **Esa bodega NO existe para el calzado**: `construirCajas` la
  descarta siempre (`esAlmacenTikTok`, salvo `incluirTikTok` que solo usa el
  kardex de TikTok), /corridas la ignora y un trigger deja
  `almacenes_activos.surte_full = false` pase lo que pase (migración 0045;
  antes el RPC la daba de alta en `true` y sus cajas entraron a bodega, al
  plan de Full y al pedido a China). A TikTok solo se le escribe un SKU que alguna vez
  se contó (entrada o ajuste): uno con puras salidas se queda con el número
  que TikTok ya tiene.
  **UN SOLO NOMBRE EN EL KARDEX POR VARIANTE, y es el de TikTok**
  (`aliasDesdeTikTok` / `AliasTikTok` con `siempre`, `paresPorSkuDesdeCajas`
  en `tiktok/bodega.ts`; 28-sep-2026): MELI escribe la misma variante de
  dos formas («GT134-NAVY / RED-28-MX» por user product, «GT134-NAVY-RED-28-MX»
  por el item) y `skus.activo` alterna entre las dos cada día (el barrido
  de las 14:00Z apaga una, el webhook del latido revive la otra), así que
  la caja de Industher, que se amarra contra los `skus` ACTIVOS, se movía
  dos veces al día de un renglón del kardex al otro (merma 15 / entrada 15)
  mientras el par vendido esperaba en el otro nombre con estante en cero:
  la alarma de «SKU desaparecido» del 28-sep era eso. Ahora la caja cae
  SIEMPRE en el nombre con el que TikTok vende esa variante
  (`tiktok_skus.sku_interno`, por clave canónica), sea cual sea el nombre
  activo en MELI; un SKU sin amarre solo bautiza lo que MELI no tiene, como
  antes. Los renglones viejos con el otro nombre se vacían solos (merma
  contra la foto) y se quedan en cero.
  **A TikTok se le publica el MENOR entre el kardex y el ESTANTE del 3PL**
  (`disponibleConEstante`, decisión del dueño el 14-sep-2026 después de
  sobrevender): mientras las dos fuentes no coincidan gana la más baja,
  siempre. Vender de menos se arregla con un conteo; vender lo que no hay
  cuesta el pedido. El tope solo BAJA (subir necesita su entrada) y NO se
  aplica en dos casos: sin lectura del 3PL (`pares: null` — un API caído no
  puede apagar la tienda) y en un SKU contado a mano DESPUÉS de esa foto,
  porque entonces el conteo es el dato más fresco y si no el conteo cíclico
  no serviría contra un 3PL desactualizado. Cuando el tope actúa se DECLARA
  en los avisos de la publicación: taparlo sería volver a esconder el
  problema.
  **Un SKU que DESAPARECE de la foto con pares apartados NO se da de baja**
  (`conciliarAcumulado` → `detenidas`, `BajaDetenida`; decisión del dueño,
  20-sep-2026): el 19-sep a las 21:45 Industher dejó de traer el
  MY2304-BROWN-29 (21 pares, 18 vendidos esa noche en dos pedidos de 4 y
  9), el kardex escribió «merma 21» en silencio y el corte del lunes habría
  cancelado los 18 pedidos. Ahora, si el SKU desaparece COMPLETO y tiene
  apartados, la baja se detiene: el kardex conserva los pares, a TikTok se
  le sigue publicando el menor (cero), el sync lo declara en `avisos` y la
  alarma suena EN EL ACTO (`DesfasePeligroso.urgente`, sin esperar las 6
  horas) para que alguien confirme con un conteo o Industher lo regrese;
  hasta entonces el corte no surte esos pedidos. Una baja PARCIAL sigue
  siendo merma (el 3PL corrigió a propósito) y un SKU sin nada apartado
  también.
  **La guardia corre en el fondo, no en una pantalla** (`tiktok/alarma.ts` +
  `tiktok-alarma.ts`, migración 0087, en el cron de TikTok): el cruce de los
  tres números ya existía en `/tiktok/desfases` pero era una pantalla que
  nadie abría —el GT102-GREY-25-MX estuvo CUATRO DÍAS ofreciendo pares que
  la bodega no tenía—. Ahora cada corrida anota en `tiktok_desfases` desde
  cuándo lleva mal cada SKU y manda UN correo cuando aguanta más de
  `HORAS_PARA_AVISAR` (6); lo que se compone solo desaparece sin molestar.
  Solo suena la dirección PELIGROSA —kardex arriba del estante, o kardex
  negativo—: el 14-sep los 16 SKUs que no cuadraban eran todos del lado sano
  (449 pares sin ofrecer) y una alarma que no distinguiera sonaría 16 veces
  al día hasta que nadie la viera. Las salidas que el 3PL aún no confirma se
  suman al kardex antes de comparar, si no cada corte dispararía la alarma.
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
  de TikTok unidas con `pdf-lib` en el ORDEN DEL CORTE y "#n · SKU"
  estampado abajo a la derecha junto al CÓDIGO DEL PEDIDO en barras (nada
  más se toca; escanear la guía en la estación enseña qué empacar). **La
  guía de J&T deja espacio en blanco abajo y el estampado cabe ahí; la de
  Cainiao (y cualquier paquetería desconocida) NO** —llena la hoja hasta el
  borde con teléfono y correo y el código del pedido se encimaba—, así que
  a esas se les agrega una FRANJA de 34 pt abajo (`necesitaFranja`,
  `FRANJA_ESTAMPA`, con `tiktok_ordenes.paqueteria`): la guía se incrusta
  completa arriba y el estampado va en la franja; la impresora encoge un
  8 % y nada se encima (pedido del dueño el 15-sep-2026). Luego la
  lista de empaque en el mismo orden con los mismos números —SIN códigos
  de barras desde el 18-sep-2026 («ya no me pongas el FNSKU para escanear,
  solo el SKU y cantidades»): sección por modelo con un renglón por SKU
  COMPLETO (el dueño no lo quiso partido en color y talla), los paquetes
  INTERCALADOS gris y blanco para no perder la línea, la cantidad de más
  de un par en un recuadro sombreado, el pedido en texto y un paquete con
  varios renglones en recuadro negro con su total; el escaneo se hace con
  la guía y con la caja—. **Cada MODELO empieza en su propia hoja y cada
  hoja trae ARRIBA lo que hay que surtir para ESA hoja** (`tiktok/empaque.ts`
  motor puro: `partirEnHojas`, `surtidoDeHoja`, `renglonesDeTallas`;
  `tiktok/empaque-pdf.ts` dibuja sin base; decisión del dueño, 25-sep-2026:
  «la lista de surtido no la estamos ocupando porque es demasiado junto
  sacar todo lo que hay y nada más se hace más bolas»): un recuadro
  «SURTIR PARA ESTA HOJA» con un renglón por modelo + color y sus tallas
  con pares («GT114 BEIGE  23 ×2  24 ×4  25 ×1  26 ×6 = 13»), se surte eso
  y luego se empaca la hoja completa; un paquete nunca se parte entre
  hojas y el bloque de surtido cuenta en lo que cabe. La línea del corte
  (fecha, paquetes, resumen por modelo) va SOLO en la primera hoja y el
  título grande del modelo solo en su primera hoja; las de continuación
  llevan una línea («Corte #39 · lista de empaque · GT114», a la derecha
  «GT114: hoja 2 de 4 · hoja 2 de 16»; dueño, 25-sep-2026: «esto no lo
  tienes que repetir en cada hoja»). La lista de
  SURTIDO del corte completo (`pdfSurtidoDelCorte`: pares por SKU en orden
  alfabético para jalar de bodega) se queda por si hace falta. **El orden del corte es: PRIMERO todo lo de UN SOLO
  MODELO y al final lo REVUELTO** (`esDeUnModelo`, `numerarPaquetes`;
  decisión del dueño el 14-sep-2026: «así se me hace más fácil despachar o
  preparar pedidos más rápido»). Un paquete de una pieza, de dos pares del
  mismo zapato o de dos tallas del mismo modelo es UN MODELO (GT114 ×2 en
  el mismo envío cuenta como uno); dos modelos distintos en la misma caja
  es revuelto, y esos van juntos en su propia sección de la lista de
  empaque (`GRUPO_REVUELTOS`), nunca mezclados con la del modelo de su
  primer par. Dentro de cada bloque sigue el paseo de la bodega: modelo →
  color → talla. **El orden NO se le cambia a un corte ya hecho**: sus
  hojas están impresas y a medio preparar, y renumerarlas dejaría el papel
  de la mesa sin cuadrar, así que cada corte guarda con qué orden nació
  (`tiktok_cortes.orden_paquetes`, migración 0088: `bodega` los 20 de antes,
  `un-modelo` los nuevos) y `cargarCorte` lo vuelve a armar SIEMPRE con ese.
  Una fecha de corte no serviría: dependería de la hora del despliegue.
  **Orden «un-color» desde el 5-oct-2026** (`ORDEN_ACTUAL`, `esDeUnColor`,
  `PaqueteNumerado.variosColores`; dueño: «cuando hago corte por modelo,
  aunque sea el mismo modelo, que se divida primero todo el color completo
  y al final los que son revueltos de un color u otro»): dentro de cada
  modelo van primero los paquetes de UN solo color (por color y talla) y al
  final los que mezclan colores del mismo modelo; los revueltos de varios
  modelos siguen al final de todo y en su propia sección. El corte #49
  (solo GT148, sin nada preparado) se pasó a mano a este orden por SQL y
  `VERSION_ESTAMPA` subió a 8 para que sus tomos guardados con los números
  viejos se rearmaran.
  El siguiente corte solo toma lo que
  no tiene corte. Un pedido que TikTok rechace se anota y se queda fuera,
  pero un 503 PASAJERO ya no cuenta como rechazo: el borde (Akamai) contesta
  esos con una PÁGINA HTML, no con JSON, y el cliente la lanzaba antes de
  llegar a su propia política de reintentos (429/5xx, tres esperas
  crecientes), así que un pedido se quedó fuera del corte #17 por un 503
  de un segundo. Ahora un cuerpo ilegible se decide por el código HTTP y el
  error se guarda resumido (`resumirCuerpoHtml`), no la página entera.
  **Si TikTok no da horarios, el corte se rinde a tiempo**
  (`tiktok/recoleccion.ts`, `FALLOS_PARA_RENDIRSE` = 3): el 15-sep-2026
  `handover_time_slots` contestó «Internal error» (36009003) en TODOS los
  paquetes y el corte se lo pidió a cada uno con sus reintentos de 2+4+8 s;
  de 255 pedidos solo 52 alcanzaron a confirmarse y 203 se quedaron con el
  reloj de 48 h corriendo. Y NO era error del pedido: a la tienda le
  ACTIVARON la recolección SIN HORA FIJA (dato del dueño, 15-sep-2026), así
  que no hay horario que pedir y el paquete sale bien como PICKUP sin
  `pickup_slot`. Ahora, tras 3 fallos seguidos, ya no se pregunta en ese
  corte; los paquetes salen como recolección sin horario y se declara UNA
  vez como NOTA (`avisoDeGuardia`, renglón con `orderId` vacío en
  `errores`, la pantalla lo pinta gris), no 52 en rojo. Solo cuando TikTok
  contesta que ese paquete NO tiene recolección (`puedeRecoleccion ===
  false`) se manda DROP_OFF a propósito. Confirmar el envío es lo urgente;
  el horario no. La pantalla agrupa los errores repetidos
  (`agruparErrores`: «203 pedidos: se acabó el tiempo», con «ver cuáles»),
  y los `rechazados` de los faltantes excluyen a los pedidos que sí
  entraron al corte.
  **CORTE LUNES** (`tiktok/lunes.ts`, `hacerCorteLunes`, `modo: "lunes"`):
  el lunes se despacha lo del viernes, sábado y domingo. Regla del dueño
  (20-sep-2026; antes el domingo se iba con el lunes): ese botón hace
  PRIMERO un corte completo con TODO lo pendiente de antes de hoy —viernes,
  sábado, domingo y lo que venga de más atrás, hasta el domingo a las 23:59
  de MÉXICO (`partirEnTandas`, `DIAS_URGENTE` 1, día por `diaMx`, UTC−6
  fijo: las 23:59 del domingo son domingo aunque en UTC ya sea lunes)— y
  luego un SEGUNDO corte solo con lo vendido el lunes. Un pedido sin fecha
  se va con los urgentes. **La primera tanda tiene TODO el rato de Vercel y
  la segunda solo arranca si la primera no dejó nada por tiempo**
  (`contarSinTiempo`, `ERROR_SIN_TIEMPO`; 21-sep-2026: ~800 pedidos
  atrasados, la primera tanda con medio rato confirmó 294 y dejó 485, y la
  segunda se llevó los 205 del lunes de todos modos). Un corte confirma
  ~300 pedidos en los 5 minutos de Vercel (TikTok contesta ~1/s); con más,
  el aviso dice cuántos de días anteriores quedaron y se le da otra vez a
  «Hacer corte», que SIEMPRE toma lo más viejo primero
  (`pendientesDeCorte` → `ordenarPorAntiguedad`, sin fecha al frente).
  La simulación enseña la partición antes de confirmar nada.
  **CORTE AYER** (`hacerCorteAyer`, `modo: "ayer"`; pedido del dueño el
  22-sep-2026: «que me haga corte de todo lo que entró ayer hasta las 12 de
  la noche, para poder ir preparándolo si tengo tiempo adelantado un día
  antes»): UN corte con la primera tanda de `partirEnTandas` —todo lo
  pendiente hasta ayer a las 23:59 de México y lo más viejo— y lo de HOY se
  queda sin corte a propósito. Con puros pedidos de hoy no hace nada y lo
  dice; si se acaba el tiempo, el aviso pide darle otra vez (toma lo más
  viejo primero). Los tres botones: «Corte ayer» (hasta ayer), «Corte
  lunes» (hasta ayer y luego hoy, en dos) y «Hacer corte» (todo).
  **UN CORTE QUE CONTINÚA OTRO SE LE UNE** (`corteQueContinua`,
  `erroresAlUnir` en `tiktok/lunes.ts`, `corteDeHoyQueContinua`,
  `ResultadoCorte.unido`; decisión del dueño, 21 y 22-sep-2026: «agrupar
  los cortes que hice hoy todos juntos», «agrupar todo en el corte 36»;
  el 21-sep se unieron a mano los #32–#35 por SQL): si algún pedido que
  se va a cortar quedó POR TIEMPO (`ERROR_SIN_TIEMPO`) en un corte de HOY
  (México) al que nadie le ha preparado nada (`tiktok_preparaciones` por
  `corte_id` = 0), el corte nuevo NO abre otro número: suma sus pedidos y
  pares al de antes, quita de sus errores los «sin tiempo» de los pedidos
  que esta vez se intentaron, agrega los nuevos y tira el PDF de etiquetas
  guardado (`corte-{id}-e{VERSION}.pdf`) para que se rearme con los
  paquetes nuevos (las guías por paquete siguen). Con algo ya preparado
  NO se une: las hojas están impresas y renumerarlas descuadra la mesa.
  Lo de HOY en la segunda tanda del corte lunes no venía de ningún «sin
  tiempo», así que abre su propio corte, como debe.
  **Y la pantalla encadena las rondas sola, SIN TOPE** (`hayQueSeguir` en
  `tiktok/lunes.ts`; `hacerCorte` en `components/despacho-tiktok.tsx`;
  decisión del dueño, 22-sep-2026: «que no tenga que picarle otra vez,
  sino automáticamente se vuelva a hacer el corte hasta terminar» y «no
  quiero que pongas máximos»): cada clic es un bucle de llamadas al mismo
  endpoint con el mismo modo; mientras la ronda deje pedidos por tiempo Y
  haya confirmado a alguien, se lanza la siguiente (una ronda sin
  confirmar a nadie es TikTok sin contestar y no se repite a ciegas; ese
  es el único freno, no hay número máximo de rondas), y cada ronda se une
  al mismo corte por la regla de arriba. La pestaña
  tiene que quedarse abierta: es la pantalla la que encadena, porque el
  servidor no puede encadenarse a sí mismo dentro de los 5 min de Vercel.
  **Si el navegador suelta la conexión a medio corte, la pantalla espera y
  sigue** (`hacerCorte` en `components/despacho-tiktok.tsx`; 28-sep-2026:
  el dueño vio «Load failed» en Safari mientras el servidor guardaba el
  corte #40 con 700 pedidos): un error de red en el POST no es un error
  del corte; se reintenta cada 15 s, un 409 (corte en curso) también se
  espera, hasta 10 min, y la siguiente ronda toma lo que quedó y se une al
  mismo corte. Solo después de esos 10 min se enseña el error.
  **Las consultas del corte van por TANDAS de ids** (`porTandas`,
  `TANDA_IDS` 300, en `renglonesConDefensa`, la marca del corte y la
  relectura): el lunes 28-sep-2026 había 1,400 pedidos pendientes y un
  solo `.in("order_id", …)` ponía ~28 KB de ids en la URL; el gateway de
  Supabase contestaba «Bad Request» y el corte y la simulación se caían
  ENTEROS antes de tocar TikTok (tres 500 en `/api/tiktok/cortes` y uno en
  `/simular`; el dueño: «no me dejó hacer un corte, me sale bad request»).
  **UN SOLO CORTE A LA VEZ** (`conCandadoDeCorte`, recurso `tiktok-corte`
  en `candados_trabajo`, `ERROR_CORTE_EN_CURSO`, 409 en la ruta): el
  23-sep-2026 a las 10:33 la ronda automática y otro clic corrieron
  juntos sobre los mismos 118 pedidos; el primero se unió al #37 y el
  segundo, que ya no encontró los «sin tiempo» en los errores del #37,
  abrió el #38 con los mismos pedidos (se unieron a mano por SQL). El
  segundo clic ya no arranca: contesta que hay un corte en curso.
  **CORTE POR MODELO** (`tiktok/corte-modelos.ts` motor puro con pruebas:
  `pedidosDeSoloModelos`, `pendientesPorModelo`, `etiquetaDeModelos`,
  `mismoFiltro`; `hacerCorte({ soloModelos })`, `pendientesDeCorteFiltrados`,
  `pendientesPorModeloDeCuenta` en `tiktok-despacho.ts`; `soloModelos` en el
  cuerpo de `POST /api/tiktok/cortes` y `?modelos=` en `/simular`;
  `tiktok_cortes.modelos`, migración 0109; selector de fichas en Despacho;
  pedido del dueño, 5-oct-2026: «quiero poder despachar modelos que tienen
  muchas ventas por separado; el GT148 va a tener como 2,000 ventas, y los
  demás modelos por separado»; ese día 1,363 de 2,247 pendientes eran solo
  GT148): se marcan uno o varios modelos y los tres botones (Corte ayer,
  Corte lunes, Hacer corte) toman SOLO los pedidos cuyos pares son todos de
  UN modelo de la lista; un paquete REVUELTO (GT148 + GT114) se va con el
  corte general (decisión del dueño). La defensa se decide sobre TODOS los
  pendientes y luego se recorta a lo que entra («el que compró primero se
  lleva el par» aunque su paquete vaya en otro corte); las tandas del corte
  lunes/ayer se parten sobre lo filtrado. El corte guarda su filtro
  (`modelos`, null = general), la lista lo enseña («solo GT148») y la
  continuación por tiempo (`corteDeHoyQueContinua`) solo se une a un corte
  de hoy con el MISMO filtro: nunca se mezcla un corte de GT148 con uno
  general. El filtro se apaga solo al terminar, como «sin defensa».
  **Un corte por modelo se UNE al de hoy del mismo modelo aunque no haya
  nada «por tiempo»** (`corteQueContinua({ sinExigirTiempo })`,
  `hacerCorte({ unirAlDeHoy })`; dueño, 5-oct-2026: el #51 «solo GT114» de
  un pedido se abrió aparte del #50 «solo GT114» de 713 y se unió a mano
  por SQL: «se armó por separado»): si nadie le ha preparado nada, dos
  cortes del mismo modelo el mismo día son el mismo trabajo. La segunda
  tanda del corte lunes (lo de HOY) pasa `unirAlDeHoy: false` y sigue
  abriendo su propio corte. **Desde el 7-oct-2026 la regla vale también
  para el corte GENERAL**: el #58 (6 pedidos: uno reintentado del #57 y
  cinco que entraron mientras el #57 corría) se abrió un minuto después del
  #57 (869 pedidos) porque el #57 no había dejado nada «por tiempo»; se
  unieron a mano por SQL (dueño: «salieron separados, ¿qué pasó ahí?»).
  Ahora un corte se une al de hoy con el mismo filtro (general con general,
  GT148 con GT148) mientras nadie le haya preparado nada.
  **La función del corte vive 800 s, no 300** (`maxDuration = 800` en
  `/api/tiktok/cortes`, `MS_CORTE` 740 s, `MS_CORTE_LUNES` 760 s; Fluid
  compute del plan Pro; 5-oct-2026, dueño: «¿por qué no le pones más de 5
  minutos?»): con 300 s el corte #49 (solo GT148, 1,363 pedidos) necesitó
  5 rondas y una ronda sin pestaña dejó 57 pedidos «por tiempo». La
  pantalla espera hasta 20 min por un 409 o una conexión perdida. Y al
  UNIR rondas, TODO error viejo de un pedido reintentado se quita
  (`erroresAlUnir`), no solo el «sin tiempo»: el #49 decía 56 «stock en
  duda» por 26 pedidos.
    **STOCK EN DUDA: ni se confirma ni se cancela** (`stockEnDuda`,
  `AutoBloqueo.enDuda`, `renglonesConDefensa().enDuda`; decisión del
  dueño, 22-sep-2026): cuando la bodega dejó de reportar el SKU POR
  COMPLETO y el kardex aún tiene pares (la baja detenida de arriba), la
  defensa NO bloquea (bloquear = cancelar en TikTok): el pedido entero se
  queda fuera del corte, declarado en `errores` y en la simulación, hasta
  un conteo, que Industher lo regrese, o un corte sin defensa. El corte
  #36 canceló 7 pedidos (18 pares) del MY2304-BROWN-29 que el dueño había
  apartado por precaución: los pares existían y los pedidos se perdieron.
  Una baja PARCIAL sigue siendo merma y se bloquea como antes; un contado
  a mano después de la foto manda el kardex.
  **Las salidas al 3PL van por LOTES de 500 hasta vaciar** (`SALIDAS_POR_LOTE`,
  `referenciaDeLote`: `TT-CORTE-{id}-{primera salida}`, `TT-REINTENTO-{primera
  salida}`; única por lote y estable al reintentar el mismo): antes
  `empujarSalidasAl3pl` mandaba UN lote de 500 con referencia `TT-CORTE-n`
  y el resto esperaba al cron (el #36, 866 salidas, 500 descontadas al
  hacerlo y 366 a los diez minutos), y una continuación del mismo corte
  habría repetido la referencia, que el 3PL descarta como duplicada.
  **El resumen del corte dice PARES descontados, no renglones**
  (`ResultadoEmpuje.paresConfirmados`, `paresDeSalidas`; 24-sep-2026): una
  salida al 3PL es un renglón pedido + SKU con sus pares, y el #38 decía
  «683 salidas descontadas» contra 696 pares confirmados; el dueño leyó
  que faltaban 13 y eran 13 renglones de dos pares. Todo se descontó.
  **Las etiquetas de un corte grande salen por TOMOS de 200 guías**
  (`PAQUETES_POR_TOMO`, `tomosDeCorte`, `rangoDeTomo` en `tiktok/despacho.ts`;
  `pdfEtiquetasDelCorte(…, tomo)`, `?tomo=n` en `/api/tiktok/cortes/{id}/etiquetas`;
  22-sep-2026): cada guía de TikTok pesa ~105 KB y el #36 (916 paquetes)
  era un solo PDF de ~96 MB que la función de Vercel no alcanzaba a armar
  ni a servir —se moría sin dejar bitácora—; ni el #35 de ayer (798) llegó
  a guardarse. Los tomos se cuentan por los PEDIDOS del corte (la pantalla
  ya los tiene; el servidor lee `tiktok_cortes.pedidos`), el último tomo
  llega hasta el último paquete, cada tomo se guarda aparte en el bucket
  (`corte-{id}-e{VERSION}-t{n}.pdf`) y la numeración "#n" es la del corte
  completo. Un corte de hasta 200 pedidos sigue siendo un solo botón. El
  calentamiento ya NO arma el PDF: `bajarGuiasDelCorte` solo baja al bucket
  las guías que faltan, con presupuesto de tiempo (30 s tras el corte,
  200 s tras cada impresión), y la impresión de un tomo baja las suyas.
  **Las etiquetas se ARMAN Y SE GUARDAN POR ATRÁS en cuanto termina el
  corte** (`calentarEtiquetasDelCorte`, `estadoEtiquetasDelCorte`,
  `calentarCortesRecientes` en `tiktok-despacho.ts`; ruta
  `/api/tiktok/cortes/{id}/calentar`: GET estado, POST un rato de trabajo;
  candado `tiktok-etiquetas-{id}` en `candados_trabajo`; pedido del dueño,
  28-sep-2026: «al mismo tiempo que hace corte se hagan las etiquetas, se
  guarde por atrás y no cada vez que genera las etiquetas se vuelva a hacer
  todo de nuevo»; antes el corte solo bajaba guías 30 s y el primer
  «Etiquetas PDF» de 700 pedidos tardaba ~15 min bajando y armando cada
  tomo): la ruta del corte, en su `after()`, baja las guías que falten y
  arma y guarda cada tomo con TODO el rato que le quede a la función (si el
  corte quedó por tiempo solo baja guías: la siguiente ronda se le une y
  renumera, y armar tomos sería trabajo perdido); la pantalla sigue con
  llamadas cortas (`calentarEtiquetas`, POST cada ~2 s, 75 s de trabajo por
  llamada) hasta que `completo`, enseña «Armando las etiquetas por atrás:
  2 de 4 tomos» / «Etiquetas listas para imprimir» y al abrirse retoma los
  cortes de las últimas 24 h que no estén completos; y el cron de TikTok
  termina lo de los cortes de los últimos 2 días aunque nadie tenga la
  pestaña abierta. **Y el corte se ENCADENA solo hasta terminar**
  (`disparar-etiquetas.ts` → `POST /api/tiktok/cortes/{id}/calentar?cuenta=…
  &eslabon=n` con el bearer de CRON_SECRET, ruta pública en el middleware
  para ese patrón; `eslabonDeFondo`: contesta 202 y trabaja 280 s en
  `after()`; `MAX_ESLABONES_ETIQUETAS` 24 (~2 h; el freno real es `avanzo`); bitácora tarea `etiquetas` por
  eslabón con `guiasBajadas`, `tomosArmados`, `guiasSinRevisar`, `seguir`):
  TikTok entrega ~1 guía por segundo y una función vive 5 min, así que un
  corte de 600 pedidos necesita más de lo que le queda a la ruta del corte.
  El `after()` del corte trabaja lo que alcanza y, si falta, prende el
  eslabón 1; cada eslabón prende el siguiente solo si AVANZÓ (`avanzo`:
  bajó guías o armó tomos) y no estaba `ocupado`; mientras el corte siga
  «sin tiempo» (`corteSigueAbierto`) el eslabón solo baja guías. El 30-sep-2026
  el corte #43 (638 pedidos) terminó a las 13:31Z y a las 13:39Z solo había
  152 guías bajadas (el cron de inventario le daba 150 s cada 15 min); el
  dueño abrió media hora después y la impresión tuvo que bajar y armar todo.
  Dueño: «no necesita un cron cada 5, solo que después de confirmar el
  corte se hagan y se guarden ahí». **El eslabón NUNCA había prendido, y la causa era el
  ORIGEN** (`origenDeLaApp` en `servicios/origen-app.ts`; 1-oct-2026: el
  corte #45 de 611 pedidos se quedó con 23 guías y las etiquetas salieron
  64 minutos después, a golpes del cron de 15 min; ni un 202 en los logs
  ni un renglón `etiquetas` en tres días): el POST se mandaba a
  `NEXT_PUBLIC_APP_URL`, que es otro dominio del proyecto detrás de la
  autenticación de Vercel, así que nunca llegaba a la función. Ahora todo
  lo que el servidor se manda a sí mismo (etiquetas, publicación en
  TikTok, SKUs pendientes de MELI) va a `VERCEL_PROJECT_PRODUCTION_URL`,
  igual que el link de los empleados, y cada disparo deja constancia en
  `tiktok_sync_log` (tarea `etiquetas-disparo` / `publicar-disparo` con el
  status). Y como seguro, **un cron CADA MINUTO** (`/api/cron/tiktok-etiquetas`,
  `calentarCortesRecientes` con todo el rato de la función y bitácora
  `etiquetas` por corte con `origen: cron-minuto`): sin cortes pendientes
  cuesta dos lecturas; con uno, trabaja ~4.5 min y el candado por corte
  hace que las corridas encimadas contesten «ocupado». Dueño, 1-oct-2026:
  «al momento que hago el corte, tomas todas las etiquetas, las juntas y
  están disponibles para descargar; no hay que armar nada después». Las
  guías se piden de OCHO en ocho (`GUIAS_A_LA_VEZ`; con 3 obreros salían a
  ~1 por segundo) y la pantalla vuelve a calentar cada vez que la lista de
  cortes cambia (`idsCortes`), porque la ronda que perdía la conexión
  volvía con `corteId: null` y nunca calentaba el corte que sí se guardó. Un tomo solo se guarda si salió COMPLETO (una guía que
  TikTok aún no da se reintenta en cada pasada), así que imprimir es leer
  los tomos del bucket y juntarlos en el navegador. **Una descarga que no
  es PDF ni imagen NO es guía** (`bytesDeGuia`, «formato desconocido»
  con el content-type y los bytes): cuenta como sin guía y el tomo no se
  guarda. El 29-sep-2026 el #347 del corte #42 bajó una página de error,
  se contó como buena, el tomo 2 se guardó «completo» con la hoja «SIN
  GUÍA — formato desconocido» y nunca se volvió a pedir (la guía real
  llegó 8 s después por `bajarGuiasDelCorte`). Supabase NO deja borrar
  objetos del bucket por SQL (`storage.protect_delete`), así que el botón
  «Rearmar etiquetas» del renglón del corte (`rearmarEtiquetasDelCorte`,
  DELETE en `/api/tiktok/cortes/{id}/calentar`) tira los tomos guardados
  y la pantalla los vuelve a armar por atrás; las guías por paquete se
  quedan.
  **Pero el dueño imprime UN solo archivo** («por atrás se hagan 200 guías
  cada vez y el PDF sí me lo presentes junto para imprimirlo más fácil»,
  22-sep-2026): el botón «Etiquetas PDF» (`imprimirEtiquetas` en
  `components/despacho-tiktok.tsx`) pide cada tomo al servidor con
  `?formato=enlace`: si ya está guardado, el servidor contesta un ENLACE
  FIRMADO al bucket (`enlaceDeTomo`, 10 min) y el navegador lo baja
  DIRECTO de ahí, `TOMOS_A_LA_VEZ` (3) a la vez —por la función de Vercel
  el flujo es de ~2 MB/s y un tomo de 21 MB tardaba ~10 s: el #40 con sus
  8 tomos ya armados seguía en «tomo 1 de 8» un minuto (28-sep-2026, el
  dueño: «me metí y me sale otra vez eso»)—; si no está, el servidor lo
  arma, lo guarda y manda el enlace (o el PDF si quedó incompleto). Luego
  los junta EN EL NAVEGADOR con pdf-lib (import dinámico; unir 8 tomos
  toma ~2 s), enseñando el avance (`avanceDeTomos`: «Bajando las etiquetas
  ya armadas: 3 de 8 tomos»), y abre el PDF completo en la pestaña que
  abrió en el clic (abrirla después la bloquea el navegador). Al terminar
  un corte, la pantalla pide los tomos en el fondo (`calentarEtiquetas`)
  para que ya estén guardados cuando se impriman. Vercel nunca sirve el
  archivo grande ni los tomos ya guardados.
  **El código del pedido en la guía va alineado a los puntos de la térmica**
  (`moduloParaTermica`, `alPuntoDeImpresora` en `etiquetas/code128.ts`;
  `VERSION_ESTAMPA` 7; dueño, 22-sep-2026: «a veces sale borroso el código
  de barras del pedido»): el módulo medía 0.75 pt = 2.1 puntos a 203 dpi y
  el rasterizador pintaba unas barras de 2 puntos y otras de 3. Ahora el
  módulo son 2 puntos EXACTOS de impresora, el arranque cae en la rejilla
  y, en las guías con franja, se compensa el ~8 % que encoge la hoja para
  que impreso vuelva a medir 2 puntos.
  **FALTANTES del corte** (`faltantesDelCorte`, `pdfFaltantesDelCorte`,
  `/api/tiktok/cortes/{id}/faltantes`): un corte que quedó a medias no dice
  por sí solo QUÉ se quedó, así que el renglón del corte enseña los pedidos
  sin preparar con su "#n", su número de pedido y sus productos, el
  resumen de pares por surtir y la hoja para imprimir (`?formato=pdf`, con
  el pedido en barras para escanearlo igual en la estación). Aparte van los
  pedidos que TikTok RECHAZÓ al hacer el corte: también faltan, pero nunca
  tuvieron guía. La constancia de preparado se sigue por la IDENTIDAD del
  paquete (pedido + paquete, `clavePaquete`), no por el "#n": el número es
  el lugar en la hoja de hoy y cambiaría al cambiar el orden del corte;
  `numerosPreparados` lo traduce a la hoja que se está enseñando. **Un
  pedido cancelado DESPUÉS del corte ya no falta** (`PaqueteDespacho.cancelado`,
  `faltantesDePaquetes`; 18-sep-2026: el 586038646418343934 del corte #20,
  cancelado en el Seller Center el 15, siguió tres días como faltante):
  conserva su número en la hoja pero sale de los faltantes, del total y
  del «X / Y preparados» (la pantalla resta los cancelados y los enseña
  aparte). **Y un pedido que TikTok ya tiene EN CAMINO o ENTREGADO tampoco
  falta aunque nadie lo haya escaneado** (`PaqueteDespacho.enviado`,
  `yaSeEnvio`: IN_TRANSIT, DELIVERED, COMPLETED; pedido del dueño el
  18-sep-2026: «pedidos que no se escanearon bien pero en plataforma ya se
  enviaron»): se fue con el repartidor, cuenta como listo y la pantalla lo
  enseña como «ya enviado sin escanear». Con solo la guía creada
  (AWAITING_COLLECTION) NO: eso lo hace el propio corte y no prueba que se
  empacó. Y para que se entere solo, `releerSinPrepararDeCortesRecientes`
  vuelve a leer en TikTok los pedidos sin preparar de los cortes de los
  últimos `DIAS_RELEER_CORTES` (3) días, hasta `TOPE_RELEER` (80): de
  fondo después de cada corte y antes del correo de faltantes de la mañana.
  Y el botón «Actualizar» de Despacho (`/api/tiktok/cortes/releer`,
  `DIAS_RELEER_BOTON` 14, `TOPE_RELEER_BOTON` 200; pedido del dueño el
  18-sep-2026) hace lo mismo en el momento sobre los cortes que la pantalla
  enseña y CONTESTA qué dejó de faltar (`cambiosDeRelectura`: pedidos que
  pasaron a enviados o a cancelados), no solo cuántos releyó.
  **PEDIDOS DE ALMACÉN** (`tiktok/pedidos-almacen.ts` motor puro,
  `servicios/tiktok-pedidos-almacen.ts`, `/tiktok/pedidos`, tabla
  `tiktok_pedidos_almacen`, migración 0089): la bodega de TikTok se vacía
  con lo que se vende y se rellena desde las bodegas de cajas. Un pedido
  junta lo VENDIDO en un periodo (`tiktok_ventas_diarias`, arranca donde
  terminó el último pedido) por modelo/color/talla, el kardex de TikTok y
  la existencia por bodega (de `inventario_cache`, los `pedidos[]` de cada
  renglón; China no cuenta), decide cuánto PEDIR —«reponer lo vendido» par
  por par, o «cobertura a N días» = venta diaria × N − disponible— y de
  QUÉ bodega: Industher primero (la bodega de TikTok vive ahí), luego
  Caseshop, luego EnvioPack (`ORDEN_BODEGAS`), hasta donde alcance cada
  una. **Lo que ninguna bodega tiene NO se pide ni sale en el Excel**
  (decisión del dueño, 16-sep-2026): el pedido se topa por la existencia y
  el SKU sin nada en bodega solo se cuenta (`sinBodega`, «vendido sin
  bodega»). Las bodegas guardan cajas cerradas: la hoja pide PARES por
  talla y la bodega elige las cajas. El Excel trae la hoja completa por
  SKU, UNA HOJA POR BODEGA con solo lo que se le pide a esa bodega (la que
  se manda) y por modelo. Pedido del dueño el 16-sep-2026.
  **DEFENSA AUTOMÁTICA DEL CORTE** (`tiktok/bloqueos.ts` puro, columnas
  `bloqueado_en`/`bloqueo_motivo`/`bloqueo_resultado` en
  `tiktok_orden_items`, migración 0091; decisión del dueño, 16-sep-2026:
  «no quiero algo manual, solo que se integre en el sistema automático»):
  al hacer el corte (y en la simulación), por cada SKU se compara lo que
  PIDEN los pedidos pendientes contra lo que FÍSICAMENTE hay
  (`paresFisicos`: el menor entre el kardex y el estante del 3PL menos las
  salidas que aún no descuenta, la misma regla con la que se publica; un
  SKU contado a mano después de la foto usa el kardex). Lo que no alcanza
  se bloquea solo (`autoBloqueos`), de los pedidos MÁS NUEVOS hacia atrás:
  el que compró primero se lleva el par. Un SKU sin renglón de stock NO
  se toca: cancelar a ciegas también es error. Luego, ANTES de confirmar
  cada pedido, `decidirPedido` separa lo bloqueado y se le pide a TikTok
  que lo CANCELE (`cancelarRenglones`: `POST
  /return_refund/202309/cancellations`, la ruta del VENDEDOR en 202309,
  parcial por `sku_id`; todo bloqueado = pedido completo) y se confirma lo
  demás. **El motivo se le pregunta a TikTok POR PEDIDO**
  (`motivosDeCancelacion`: `GET
  /return_refund/202309/orders/{id}/aftersale_eligibility` como vendedor;
  `nombresDeMotivo` junta todo `available_reason_names` a cualquier
  profundidad y `motivoSinStock` elige el que hable de stock, si no el
  primero; el crudo de la primera respuesta se guarda en `tiktok_sync_log`
  tarea `diagnostico-cancelacion` porque su forma no está en ningún SDK
  público). La 202309 contestó el 18-sep-2026 SIN `available_reason_names`
  (solo eligible/request_type por renglón), así que se prueban versiones
  más nuevas del mismo endpoint (`VERSIONES_ELEGIBILIDAD`, de 202310 a
  202510; el 21-sep-2026 TikTok contestó 36009004 «Invalid API version» a
  202505/202507/202510, y la 202309 se prueba también con
  `request_type=CANCEL`, `intentosDeElegibilidad`) hasta que alguna traiga
  motivos; la sonda `/api/tiktok/diagnostico/cancelacion?pedido=…` hace
  las mismas preguntas SIN cancelar y además prueba la calculadora de
  reembolso (`/refunds/calculate`) y `reject_reasons`, y contesta el crudo.
  **La lista fiable del mercado son las cancelaciones que TikTok YA
  ACEPTÓ en la tienda** (`motivosUsadosEnCancelaciones`: `POST
  /return_refund/202309/cancellations/search`, `cancel_reason` + `role` de
  cada cancelación de los últimos 90 días; `motivosDeVendedor` se queda
  con las del rol SELLER, stock primero): el 21-sep-2026 la sonda enseñó
  que solo existe la 202309, que no trae nombres, y que la calculadora
  contesta «reverse reason is unknown» a las claves de la documentación.
  Lo que el dueño cancela a mano en el Seller Center trae el nombre exacto
  y el corte lo usa ANTES que las claves fijas. **El nombre real en México
  es `seller_cancel_reason_out_of_stock`** («Sin existencias»; visto el
  21-sep-2026 con rol SELLER, 4 veces) y va primero en
  `MOTIVOS_SIN_STOCK`. Si ninguno entra el
  error del corte dice qué contestó TikTok a CADA clave intentada
  (`cancelarRenglones`; antes solo se veía la última). Las claves fijas de la documentación (`MOTIVOS_SIN_STOCK`)
  quedan de respaldo: el 18-sep-2026 TikTok contestó a ellas 25001014
  «cancel_reason must exactly match an available_reason_names value
  returned by Get Aftersale Eligibility». Hasta ese día el corte pedía
  `/order/202309/orders/cancellation_reasons` (no existe) y cancelaba por
  `/order/.../cancel` (tampoco), y el error se tragaba: la defensa nunca
  canceló nada y 16 pedidos se quedaron fuera de cuatro cortes seguidos con
  «no dio un motivo». Solo se pasa a otro motivo si TikTok rechaza EL
  MOTIVO (`esErrorDeMotivo`: código 25001021 o «reason» en el mensaje), el
  mensaje REAL de TikTok queda en el corte y en `bloqueo_resultado`, y una
  cancelación que TikTok deje PENDIENTE (`cancel_status` PENDING) NO
  cuenta como aceptada. **TikTok MX contestó 11050001 a la cancelación
  PARCIAL** («Cannot partially cancel this order: partial cancellation
  requires the order's market and cancel_reason to support partial
  cancellation»): un pedido grande con un renglón sin stock se queda
  fuera del corte y se le AVISA POR CORREO a quien despacha
  (`esErrorDeParcial`, `avisarParcialesSinCancelar`, `armarCorreoParciales`;
  al destinatario de faltantes, con el renglón sin stock y lo que sí hay,
  para cancelarlo a mano en el Seller Center; un pedido ya avisado no se
  repite en `DIAS_SIN_REPETIR_AVISO`, 3; decisión del dueño, 18-sep-2026).
  **Todo correo deja constancia en `tiktok_sync_log`** (`registrarCorreo`,
  tareas `correo-faltantes`, `correo-parciales`, `correo-alarma`,
  `correo-prueba`: destinatario, remitente, si Resend lo aceptó y el motivo
  si no): el 18-sep david no recibía el de faltantes y no había cómo saber
  por qué. Un remitente sin dominio verificado en Resend
  (`onboarding@resend.dev`, el de omisión si falta `CORREO_REMITENTE`) SOLO
  entrega al dueño de la cuenta de Resend: a cualquier otro correo Resend
  contesta 403. La sonda `/api/tiktok/diagnostico/correo?para=…` manda una
  prueba y contesta lo que dijo Resend. **Si TikTok no acepta la cancelación, el
  pedido ENTERO se queda fuera del corte** y se declara: confirmar un par
  que no existe es el error caro. **TikTok MX SÍ aceptó la cancelación
  PARCIAL el 6-oct-2026** (corte #54: 34 pedidos con GT148-CREAM sin
  stock; 26 eran de un solo renglón y se cancelaron completos, 8 eran
  pedidos grandes y TikTok canceló SOLO el renglón CREAM), pero al cancelar
  un renglón TikTok REARMA el paquete con un id nuevo y el `/ship`
  inmediato contesta 21011027 «Arrange shipment failed» (`esFalloDeArmado`
  en `tiktok/despacho.ts`): en los 8 falló, 6 quedaron AWAITING_COLLECTION
  de todos modos (TikTok les armó la guía) y 2 pendientes; los 8 se
  quedaron sin corte y el siguiente corte los recoge (los ya enviados solo
  se agrupan). Ahora ese fallo se reintenta UNA vez a los 4 s releyendo los
  paquetes. **Y el paquete del renglón cancelado NO viaja**
  (`paquetesQueViajan` en `tiktok/despacho.ts`, puro con pruebas;
  `paquetesVivosDelPedido` en el servicio; 7-oct-2026): al cancelar un
  renglón TikTok deja el pedido con DOS paquetes —el del renglón cancelado,
  sin guía y que nunca se envía, y el rearmado con lo que sí va— y el ERP
  confirmaba y numeraba los dos: el corte #57 enseñaba 882 etiquetas de 875
  pedidos (7 pedidos de GT148 con CREAM cancelado, dos números cada uno,
  uno «SIN GUÍA» para siempre; los tomos 2, 4 y 5 nunca se daban por
  completos y el dueño: «no existe un pedido que tiene dos paquetes»). Con
  más de un paquete se le pregunta a TikTok qué renglones lleva cada uno
  (`renglonesDelPaquete`) y el que solo lleva cancelados se descarta, al
  confirmar y al armar etiquetas (y se quita de `tiktok_ordenes.paquetes`);
  si TikTok no dice qué lleva, viaja; nunca se deja un pedido sin paquete.
  Los 7 del #57 se limpiaron por SQL (quedó el paquete con guía) y el dueño
  rearmó las etiquetas. **Un pedido SIN renglones vivos no se confirma**
  (`DecisionDePedido.nadaQueConfirmar`): guarda defensiva del mismo día
  para no pedirle a TikTok el envío de un pedido ya cancelado completo que
  TikTok aún enseñe pendiente. **Un bloqueo automático no es para
  siempre** (`esBloqueoAutomatico`, prefijo `auto:`): cada corte lo vuelve
  a decidir con el stock de hoy y, si llegó mercancía, lo libera
  (`liberados`, `bloqueo_resultado = liberado: ya hay stock`); el 18-sep
  Industher metió 35 pares de GT148-BLK-24 a mediodía y los pedidos seguían
  bloqueados de la mañana.
  **Corte SIN defensa** (`hacerCorte({ sinDefensa })`, casilla en Despacho
  que se apaga sola tras el corte; decisión del dueño, 21-sep-2026: «las
  que no se pudieron confirmar porque no hay stock igual las confirmas»):
  no se bloquea nada por stock y los bloqueos automáticos vigentes se
  liberan (`bloqueo_resultado = liberado: corte sin defensa`); el corte
  lo deja anotado como NOTA. Los pares salen del kardex igual y pueden
  dejarlo en negativo: la alarma lo grita y un conteo lo cuadra.
  **Un corte donde NADIE entró no se guarda** (`corteId: null` en
  `ResultadoCorte`; el 18-sep se guardaron dos cortes vacíos seguidos):
  lo cancelado se relee igual y el resumen dice, agrupado, por qué no
  entró nadie.
  Un renglón cancelado no va en la etiqueta ni en la lista (`cargarCorte`
  salta reversa y `bloqueo_resultado = cancelado`), los pares del corte y
  las salidas al 3PL salen de lo VIVO, y los cancelados se releen para
  que el kardex libere el apartado. La simulación enseña «se cancela». No
  hay pantalla para bloquear a mano.
  **CORREO DE FALTANTES** (`tiktok-faltantes-correo.ts`, cron
  `/api/cron/tiktok-faltantes` a las 13:30Z = 7:30 México): cada mañana,
  si algún pedido de los cortes de los últimos 3 días no se escaneó en la
  estación, un correo a `CORREO_FALTANTES_TIKTOK` (por omisión
  daviddarwishb@gmail.com) con los números de pedido, su «#n» y sus
  productos, por corte. Sin faltantes, sin correo. Pedido del dueño el
  16-sep-2026.
  **Preparar pedido** (`tiktok/preparar.ts`, estación en
  `/tiktok/despacho/[id]/preparar`): se empieza por la ETIQUETA (FNSKU de
  Amazon, impreso como barras en la GUÍA; la lista de empaque ya no lleva
  códigos) — elige el siguiente paquete sin
  preparar con ese producto y pita UNA VEZ POR PAR; luego el PRODUCTO (FNSKU de la
  caja, un escaneo por par). El camino principal con muchos paquetes del
  mismo producto es empezar por el PEDIDO: la guía lleva el
  NÚMERO DE PEDIDO en Code 128 (juego C, `codigoDeOrden`), escanearlo
  elige ese paquete exacto y pasa a pedir sus FNSKU. El código que se
  IMPRIME es SIEMPRE el FNSKU (decisión del dueño: la caja lleva la etiqueta
  de Amazon); si TikTok llama al color distinto (MY2304 CAMEL = BROWN en
  Amazon), la equivalencia por modelo en `tiktok_alias_amazon`
  (`tiktok/fnsku.ts`, formulario en Almacén TikTok) lo resuelve. Pero la
  MISMA caja puede traer pegada la etiqueta de Mercado Envíos Full, así que
  el escáner también acepta el CÓDIGO FULL de MELI (el `inventory_id` de la
  variante). **El MISMO zapato está publicado en las DOS cuentas de MELI y
  cada una le da su propio código Full** (GT134-BLK-24-MX: FIEE49194 en
  `skus`, JNQX88982 en `yz_skus`; 164 de los 168 SKUs que TikTok vendió en
  30 días tienen código en la segunda cuenta y solo 107 en la primera), así
  que los DOS catálogos entran COMPLETOS y los dos códigos valen para ese
  par: `tiktok/codigos.ts` arma la lista (`codigos` de cada par) con los
  tres amarres del ERP —canónico → ordenado → aplastado, cómo esté escrito
  el SKU en cada cuenta NO importa— y `preparar.ts` da por bueno el par con
  cualquiera de ellos. Son ~17 mil variantes entre las dos cuentas: el
  catálogo se mastica en `app_cache` clave `codigos-full` (media hora, TTL,
  `codigosMeliDeCuenta`) y la pantalla lee un renglón; una variante recién
  publicada tarda esa media hora en ser escaneable por su código Full (el
  FNSKU funciona desde el primer momento). Un producto sin FNSKU pero con
  código Full imprime ESE código y se escanea; "Dar por bueno sin escanear" (registrado
  como `MANUAL:` en `tiktok_preparaciones.escaneos`) queda solo para lo que
  no tiene NINGÚN código. Un paquete completo se puede dar por
  preparado SIN escanear solo con la CLAVE DE SUPERVISOR
  (`tiktok_acceso.pin_supervisor`, capturada directo en la base, nunca en
  el repo; se valida en `acceso-preparar.ts` en tiempo constante) y queda
  como `SUPERVISOR:` en la constancia. La clave se pide en un cuadro
  propio de la estación con teclado de DÍGITOS (`inputMode="numeric"`,
  `pidiendoClave` en `components/preparar-tiktok.tsx`; el dueño la cambió
  y pidió el teclado numérico el 29-sep-2026), no con `window.prompt`. Decisión del dueño: la etiqueta lleva el
  FNSKU (no el código de paquete) porque el flujo arranca por la etiqueta.
  El FNSKU sale de `mapaAmazon`/`buscarAmazon`.
  **La estación aguanta sin wifi** (`tiktok/cola-preparados.ts` puro con
  pruebas; `components/preparar-tiktok.tsx`; dueño, 7-oct-2026: «a veces no
  hay buena señal y cuando escanean no jala bien la info; que tengan un
  caché en la página y se vaya actualizando como puede con el wifi»): el
  escaneo nunca necesitó red (`avanzar` decide en el navegador con los
  paquetes que la página ya trae); lo único que viajaba era el POST de la
  constancia. Si ese POST falla POR RED (`esErrorDeRed`: «Failed to
  fetch», «Load failed», NetworkError), la constancia se guarda en
  `localStorage` (clave `tiktok-preparados-pendientes:{corteId}`), el
  paquete se da por preparado en ese dispositivo y la cola se reintenta
  sola cada 15 s, al volver la conexión (`online`) y tras cada guardado
  que sí entra; al abrir la página se retoma lo que quedó. Un rechazo del
  SERVIDOR no se encola: se saca y se enseña en rojo. La pantalla dice en
  ámbar «N paquetes por guardar · sin señal…» y «Sin señal de wifi. Puedes
  seguir escaneando». La clave de supervisor sí necesita red (la valida el
  servidor) y lo dice. Cargar la página sigue necesitando señal.
  **Conteo cíclico** (`tiktok/conteo.ts`, `/tiktok/conteo` y
  `/preparar/{token}/conteo`): el mismo escáner, sumando UN PAR por escaneo
  del FNSKU. Se compara contra el SALDO (lo apartado sigue en la bodega),
  solo la diferencia entra al kardex como `ajuste` con referencia
  `conteo:<fecha>`, y en el mismo clic se publica a TikTok pasando por
  `sincronizarTikTok` con `soloPedidos` (regla de oro). Contar un MODELO
  COMPLETO deja en cero lo que no apareció, con confirmación explícita.
  La sincronización lleva candado (`candados_trabajo`, recurso
  `tiktok-sync`; la corrida completa del cron ESPERA hasta 60 s si un
  aviso lo tiene tomado, no se rinde: el 21-sep-2026 se perdieron cinco
  corridas en dos horas por rendirse al instante); `/tiktok/desfases` cruza TikTok vs kardex vs Industher y
  simula el corte; Pendientes grita los saldos negativos.
  **Amarre de SKUs de TikTok** (`tiktok/amarre.ts`): manual → CATÁLOGO
  (`tiktok_skus.sku_interno`, lo ya amarrado es memoria: el nombre del
  kardex de un SKU no cambia porque MELI escriba hoy la variante distinto)
  → exacto → canónico → aplastado → ordenado → PROPIO: un SKU con forma
  MODELO-COLOR-TALLA que MELI no tiene (el MY2304 morado solo se vende en
  TikTok) se acepta tal cual, con su `-MX`, porque ese par también sale de
  la bodega. Industher lo construye SIN sufijo (`MY2304-PURPLE-23`) y
  `aliasDesdeTikTok` lo lleva al nombre de TikTok: un solo renglón en el
  kardex para los dos lados.
  Lo que quedó sin amarre se reintenta en cada corrida
  (`reamarrarPendientes`) y, si ya salió en un corte, se descuenta y se
  manda al 3PL en ese momento. Los amarres capturados a mano
  (`tiktok_mapeo_sku`) siguen mandando sobre todo, pero de Almacén TikTok se
  quitaron sus DOS bloques por decisión del dueño (10 y 11-sep-2026): la
  lista de «Amarres a mano» y el de «N SKU de TikTok sin amarrar al
  catálogo» con sus sugerencias y su botón Amarrar. Quedan las sugerencias
  del renglón del inventario (`LigarTikTok`) y `/api/tiktok/mapeo`; los
  amarres se consultan en la base.
  **La tabla del Almacén TikTok es para ENCONTRAR un SKU**
  (`components/inventario-tiktok.tsx`, motor puro en
  `tiktok/inventario-vista.ts`; pedido del dueño el 18-sep-2026: «tienes
  todo revuelto»): orden ALFABÉTICO por SKU con números naturales (GT102
  antes de GT134, talla 9 antes de 24), buscador por pedazos sin importar
  guiones ni acentos («gt134 blk 24», el título también cuenta) y arriba
  el total de lo que se está viendo (SKU, en almacén, apartados,
  disponibles, vendidos). Lo urgente lo gritan las fichas y Pendientes,
  no el orden de la tabla. **Solo una publicación ACTIVATE cuenta como
  «en línea»** (`conPublicacion` en `tiktok-panel.ts`,
  `RenglonTikTok.estadoPublicacion`; dueño, 2-oct-2026: «lista de todo lo
  que hay stock TikTok que no está en línea»): un borrador (GT168 BLK) o una
  desactivada por el vendedor (GT074, GT100, GT102, GT105, GT110…) tiene el
  stock fuera de línea; el renglón lo dice y la casilla «Solo con stock sin
  publicación activa» los lista. Ese día eran 48 SKU.
  **EXCEL POR MODELO del Almacén TikTok** (`tiktok/resumen-modelos.ts`
  motor puro con pruebas, `servicios/tiktok-resumen-modelos.ts`, botón
  «Excel por modelo» en la tabla del inventario → `GET
  /api/tiktok/resumen-modelos`; pedido del dueño, 2-oct-2026: «un Excel que
  tenga el SKU, por ejemplo GT142, el ID de publicación de TikTok, el stock
  en mi bodega de TikTok, el stock en mi bodega en general entre todas,
  cuántas ventas tengo en Mercado Libre en total, el tipo de producto y la
  foto»): un renglón por MODELO (el que está en TikTok por catálogo o
  kardex, o tiene pares en alguna bodega de cajas; el que solo vendió en
  MELI no abre renglón) con la foto INCRUSTADA en la celda (primera del
  producto de TikTok copiada en `tienda_productos`; si no está en TikTok,
  la de Amazon por `amazon_listings.asin` → `amazon_padres.imagen_url`; la
  URL va aparte por si la descarga falla, «sin bajar»), categoría de
  `productos_config`, el producto ACTIVO de TikTok con su estado y los
  demás productos del modelo en otra columna (borradores, desactivados,
  borrados), kardex de la bodega TikTok (saldo, apartado incluido el de la
  tienda, disponible), pares DISPONIBLES por bodega de cajas (cajas
  disponibles × pares por caja de `existencias`, sin la bodega TIKTOK) y
  las ventas de MELI de TODA la historia (`ventas_resumen_sku` con rango
  abierto; los últimos 30 días en la ventana previa del mismo RPC). Lee
  con el cliente admin (junta bodega, costos y Amazon) y el rol de TikTok
  también lo baja.
  **Muestras gratis** (`tiktok_ordenes.es_muestra`: `is_sample_order` o
  total $0): se despachan y descuentan como cualquier pedido, pero NO son
  venta (`ventas.ts` las deja fuera) y /tiktok/ventas las lista aparte.
  **Lo que TikTok VA A PAGAR por cada pedido en pie se lee de TikTok, no se
  calcula** (`tiktok/liquidacion.ts` puro: `interpretarTransacciones`,
  `estadoDePago`; `transaccionesDePedido` en `tiktok/api.ts`;
  `liquidarPedidos` en `servicios/tiktok.ts`; migración 0096; decisión del
  dueño, 25-sep-2026: «no me interesa lo liquidado, me interesa cuánto me
  van a pagar por cuánto pedido y sumar solo lo que está en pie […] no
  quiero que me lo calcules tú según estimaciones, sino revisar exactamente
  cuánto me pagan, y también hay comisiones a afiliados»). TikTok liquida
  cada pedido ~10 días después de la venta (4 a 15; 1,176 pedidos vistos),
  así que la versión 202309 del endpoint (`/finance/202309/orders/{id}/
  statement_transactions`, solo lo YA liquidado) dejaba casi todo el mes en
  «sin liquidar». La **202501** trae también las transacciones NO
  liquidadas con su `settlement_amount` y su `status` (SETTLED o no): ese
  es el número que se enseña, liquidado o por liquidar. Se pregunta por
  cada pedido EN PIE (`ESTADOS_EN_PIE`: pagado y no cancelado; muestras no),
  hasta 250 por corrida del sync (~1/s, lo que alcance el tiempo), primero
  lo nunca leído de los pedidos que YA SALIERON (`ESTADOS_CON_TRANSACCIONES`:
  TikTok no publica transacciones hasta que el pedido se envía; 246 del
  día contestaron `total_count: 0`) y dentro de eso lo MÁS NUEVO (la
  pantalla se mira por los últimos días); lo «sin dato»
  (TikTok aún sin transacciones, pedidos recién creados) se reintenta cada
  12 h, lo por liquidar se relee cada día (cambia con devoluciones) y lo
  liquidado cada semana. Queda en `pago_esperado` / `pago_estado`
  (`liquidado` | `por_liquidar` | `sin_dato`) / `pago_afiliado` /
  `pago_desglose` (versión, ingreso, cargos, afiliado, envío neto del
  subsidio, IVA e ISR retenidos, reembolsos) con el crudo en `liquidacion`;
  `neto_recibido` sigue siendo SOLO lo ya liquidado. Si TikTok contesta que
  la 202501 no existe (36009004 / 404) se cae a la 202309 y se avisa. **Pero por pedido TikTok no
  publica NADA hasta que liquida** (25-sep-2026: los pedidos en camino o
  entregados esa semana contestaron `total_count: 0` en las dos
  versiones), así que el «por liquidar» sale de la LISTA de toda la tienda
  («Get Unsettled Transactions» = `GET /finance/202507/orders/unsettled`,
  `transaccionesSinLiquidar` en `tiktok/api.ts`, `RUTAS_SIN_LIQUIDAR`;
  la ruta y la forma salieron del SDK generado de TikTok en npm porque la
  documentación no se alcanza desde el entorno de Claude y las cinco rutas
  adivinadas el 28-sep-2026 contestaron 36009009 «Invalid path»;
  `sort_field=order_create_time` es obligatorio, `page_size` 1–100,
  ventana opcional `search_time_ge/lt`; solo lo creado desde el 1-ene-2025
  y lo ya liquidado desaparece de ahí. Cada renglón trae `order_id` (un
  AJUSTE trae `adjustment_order_id`), `type`, `status`, `unsettled_reason`
  y los montos con prefijo `est_` —`est_settlement_amount` es lo que
  TikTok ESTIMA que pagará hasta liquidar, y así se declara: es su
  número, no uno nuestro; `normalizarSinLiquidar` los copia a los nombres
  sin prefijo y el IVA viene como `vat_amount`—. La lista trae el pedido
  desde que se PAGA, aunque todavía no salga (`unsettled_reason`
  `WAITING_FOR_PACKAGE_DELIVERY`): la primera lectura real (28-sep-2026,
  52 páginas, 5,149 pedidos, $709,719 por liquidar y $56,391 de afiliados)
  le puso dato a 1,296 pedidos por enviar. Lo que queda «sin dato» son
  pedidos ENTREGADOS que ya salieron de esta lista y aún no aparecen en un
  estado de cuenta (184 del 11 al 18-sep ese día): los recoge la lectura
  por pedido cada 12 h cuando TikTok los liquide. `leerSinLiquidar` en
  `servicios/tiktok.ts` corre en SU PROPIO CRON (`/api/cron/tiktok-pagos`
  cada hora → `sincronizarPagosTikTok`, bitácora tarea `pagos`; decisión
  del dueño, 28-sep-2026: «cada función debería vivir por su propia parte»:
  el dinero no comparte tiempo ni el candado `tiktok-sync` con el
  inventario ni con el despacho), seguido de `liquidarPedidos`; la lista
  completa se relee si la última lectura `ok` en `tiktok_sync_log` tiene
  más de 50 min (`CADA_CUANTO_SIN_LIQUIDAR_MS`), hasta 60 páginas de 100): se agrupa
  por pedido (`agruparPorPedido`, motor puro), cada grupo se interpreta
  igual que un pedido y se guarda de un jalón con el RPC
  `tiktok_guardar_pagos_por_liquidar` (migración 0098, lotes de 500) como
  `por_liquidar` con `pago_desglose.version = "sin-liquidar"` —la primera
  versión hacía 5,300 UPDATE uno por uno en CADA sync de 15 min: el sync
  pasó de ~60 s a 250–316 s y el 28-sep-2026 dos corridas murieron por
  tiempo (504)—; un pedido ya liquidado no se
  toca y `liquidarPedidos` NO degrada a «sin dato» un pedido que trae su
  número de la lista. La primera página cruda (dos renglones), qué contestó
  cada ruta que no sirvió y cuántos pedidos quedaron con dato van a
  `tiktok_sync_log` tarea `sin-liquidar` en cada corrida: desde la base se
  ve con qué forma llega y se afina la lectura sin abrir nada a mano. La
  sonda `/api/tiktok/diagnostico/liquidacion?pedido=…` contesta el crudo
  de las dos versiones sin escribir, y `/api/tiktok/diagnostico/pagos?
  cuantos=250` lee de un jalón hasta 250 pedidos (para el arranque). La
  fórmula de TikTok MX, verificada campo por campo en lo liquidado por si
  hace falta cotejar: comisión 8 % de lo pagado + $6 por par, IVA retenido
  8 % e ISR 2.5 % sobre la base sin IVA, envío del vendedor (~$19 por
  renglón, subsidiado por TikTok en ~72 %) y comisión de afiliados (~7 %
  del pago en el 8 % de los renglones); NO se usa para estimar. **Ventas
  TikTok** (`resumenPorModelo`, `/tiktok/ventas`): por modelo, «Me paga
  TikTok» = ese número repartido por precio entre los renglones del pedido
  (liquidado + por liquidar), afiliados aparte, «sin dato» aparte y fuera
  de la ganancia (= lo que paga TikTok − costo de los pares con dato), y
  «Por par» = esa ganancia ÷ pares con dato (pedido del dueño, 28-sep-2026:
  «cuánto gano por unidad vendida después de todos los gastos»; el pago de
  TikTok ya trae descontados comisión, cargo por par, afiliados, envío e
  IVA/ISR retenidos; el ERP no lleva gastos propios de TikTok como el 3PL);
  los cancelados no se enseñan en ningún lado, ni en «Pedidos por estado».
  **Ventas TikTok se lee MASTICADA, como MELI y Amazon** (`servicios/
  tiktok-ventas.ts`, `app_cache` clave `tiktok:ventas:v1:{desde}:{hasta}`,
  TTL 10 min, `Frescura`; RPC `tiktok_ventas_pedidos`, migración 0105;
  dueño, 1-oct-2026: «que la info se vaya guardando, no que cada vez jale
  todo»): hasta ese día la pantalla bajaba las 12 mil órdenes COMPLETAS
  (con el JSON crudo del pedido) y los 15 mil renglones bajo RLS en cada
  apertura; Postgres las cancelaba a los 8 s («Algo falló al cargar esta
  pantalla») y, cuando alcanzaba, tardaba medio minuto. Ahora el RPC trae
  de un jalón los pedidos del rango (un día de margen por UTC→México) más
  los que aún no salen, sin `detalle`; el motor puro de `tiktok/ventas.ts`
  mastica, se guarda, la pantalla lee el renglón y si está viejo o
  invalidado pide el recálculo en `after()`; solo sin renglón se calcula en
  el clic. «Pedidos por estado» cuenta los del rango y los pendientes.
  **ORIGEN DE LA VENTA: creadores vs tienda** (`tiktok/afiliados.ts` puro,
  `servicios/tiktok-afiliados.ts`, `origenDeVentas` en `tiktok/ventas.ts`,
  `components/origen-ventas-tiktok.tsx`; dueño, 1-oct-2026: «una gráfica
  de cuánto es por creadores y cuánto por mí, y el top 10 de creadores que
  generaron la venta y su porcentaje»): TikTok no pone al creador en el
  pedido; vive en `POST /affiliate_seller/202410/orders/search` (ruta y
  forma del SDK de npm; `creator_username`, tasa y comisión por SKU;
  ventana por `create_time`, 100 por página; el SDK marca `program_id` y
  no se manda: si TikTok lo exige, el error queda en la bitácora
  `afiliados` con el crudo de la primera página). `leerAfiliados` corre en
  el cron de PAGOS (cada hora, tras el dinero, con el tiempo que sobre):
  ventana reciente de 3 días + un tramo de fondo de 7 días hacia atrás
  desde donde se quedó (`app_cache` `tiktok:afiliados:fondo`) hasta el
  primer pedido; escribe por LOTE (`tiktok_guardar_afiliados`:
  `creador` = el que más pares trajo, `creador_detalle` por SKU) y, solo si
  la ventana se leyó COMPLETA, marca lo que no apareció como revisado sin
  creador (`tiktok_marcar_afiliados_leidos`, `afiliado_leido_en`) = venta
  de la TIENDA. Un pedido sin revisar se declara aparte («sin revisar»),
  nunca se cuenta como nuestro. La pantalla: barra apilada creadores /
  tienda / sin revisar con % de lo cobrado y el top 10 por cobrado.
  Primera lectura real (1-oct-2026, 19:09Z): 24 páginas, 2,066 pedidos
  de 3 días, 5,550 pedidos con creador y 298 creadores; TikTok NO exigió
  `program_id`. El tramo de fondo es de 3 días (`DIAS_POR_TRAMO`) porque
  con 7 no cabía en las 60 páginas de una corrida y el cursor no avanzaba.
  **PRECIOS PARA TIKTOK** (`tiktok/precios.ts` puro con pruebas,
  `/tiktok/precios`; fue SOLO del dueño hasta el 2-oct-2026, hoy también
  la abre el rol de TikTok;
  pedido del dueño, 1-oct-2026: «basándome en lo que recibo de MELI por un
  producto quiero recibir lo mismo en TikTok, tomando en cuenta sus
  comisiones e impuestos; afiliados al 4 % fijo aunque sea más; tres
  niveles: relámpago live el más bajo, relámpago normal 5 % arriba y
  campaña regular otro 5 % arriba»): por modelo, el objetivo es el neto de
  MELI por par del periodo (monitor de ventas, depósito real, 30 días por
  omisión) — NO: desde el mismo 1-oct-2026 el objetivo es el neto de MELI
  por par CUANDO SE VENDE EL RELÁMPAGO (RPC `meli_neto_relampago_por_modelo`,
  migración 0106: por modelo, las órdenes de UN renglón se agrupan por
  precio unitario y el escalón MÁS BAJO con volumen —≥ 10 % de los pares,
  mínimo 3— es el relámpago; su neto ÷ pares es el objetivo; dueño: «el
  neto de cuando se vende el relámpago», «el GT148 debería estar en $128.99,
  no en $157»: el promedio mezclaba precio lleno y oferta), y manda sobre
  todo el precio que el dueño capture en «Mi precio»
  (`tiktok_precios_objetivo`, `POST /api/tiktok/precios`,
  `components/mi-precio-tiktok.tsx`; vacío = volver al calculado). El
  relámpago NORMAL es el que deja ese neto con la fórmula de
  TikTok (`netoTikTok` / `precioParaNeto`; parámetros del dueño,
  1-oct-2026: comisión 6 % —«no me han cobrado, pero van a comenzar
  pronto», se descuenta ya—, $6 por par, afiliado 4 % fijo, envío 8 % del
  precio —«no es $19, es 8 %»—, IVA 8 % e ISR 2.5 % retenidos sobre la base
  sin IVA, y $2 por par de empaque), redondeado al peso hacia arriba: ese
  es el RELÁMPAGO NORMAL; el live va 5 % ABAJO «aunque me deje menos
  dinero que MELI» y la campaña regular 5 % arriba (`nivelesDePrecio`;
  ajuste del dueño el mismo día). Los parámetros van en la URL
  (`parametrosDesde`). «TikTok hoy» es el precio REAL pagado en los
  pedidos de los últimos 14 días (`tiktok_ventas_pedidos`, ofertas y
  relámpagos incluidos; dueño: «toma el real que está en oferta, no el
  precio base»), y solo sin pedidos el de lista de `tiktok_skus`; en ámbar
  los que están por debajo del normal. **La tabla va en orden ALFABÉTICO
  natural por modelo y tiene buscador** (`filtrarPrecios` en el motor,
  `components/tabla-precios-tiktok.tsx`; dueño, 2-oct-2026: «me lo puedes
  ordenar por SKU y poner un buscador»): por pedazos en modelo y categoría
  («gt148», «botas»), sin guiones ni acentos, y arriba cuántos modelos se
  ven. Antes iba por pares vendidos en MELI. **Casilla «quitar 10.5 %» por
  modelo** (`tiktok_precios_objetivo.quitar_retencion`, migración 0108,
  `precio` ya opcional; `netoSinRetencionMeli`, `RenglonPrecio.quitarRetencion`
  / `netoRelampagoReal` / `retencionQuitada`; `QuitarRetencionTikTok`;
  dueño, 2-oct-2026: «muchos precios de MELI los consideré tomando en cuenta
  el 10.5 % y ahora que ya no hay por reventa gano más de lo que tenía
  planeado; quiero elegir en cada SKU si se calcula como está o como si sí
  me quitaran el 10.5 % de MELI»): con la casilla el objetivo de ese modelo
  es el neto del relámpago × (1 − (IVA ret. + ISR ret.) ÷ 1.16) y el precio
  de TikTok sale más bajo; la columna lo declara («−$11.68 de retención»).
  «Mi precio» sigue mandando sobre todo.
  **PRODUCTOS NUEVOS de TikTok: publicar en TikTok Shop lo que ya está en
  Amazon** (`tiktok/publicar.ts` motor puro, `servicios/tiktok-publicar.ts`,
  `/tiktok/nuevos`, `/api/tiktok/publicar-productos`, tabla
  `tiktok_publicaciones`, migración 0100; pedido del dueño, 30-sep-2026:
  «toma todos los productos que tengo en Amazon de calzado —SKUs, imágenes,
  variantes y todo—, le pongo el precio y se me publica masivamente»). La
  pantalla agrupa `amazon_listings` por MODELO → color → talla
  (`partirSkuAmazon`: Amazon a veces pone la talla antes del color,
  GT128-23-BLK-MX), con el título limpio del padre (`amazon_padres`) o el
  del listing sin su paréntesis de variante (`tituloLimpio`), tacha los
  colores que TikTok ya vende (`tiktok_skus` activos, traduciendo el color
  con `tiktok_alias_amazon`), y por omisión publica solo los colores con
  alguna talla ACTIVA en Amazon (`coloresActivosPorPublicar`; la casilla
  «Incluir colores sin tallas activas» mete los demás). UN producto de
  TikTok por modelo con sus colores y tallas como variantes, precio ÚNICO
  por producto; el `seller_sku` es el nombre con que el ERP conoce el par
  (el de MELI si existe, si no `MODELO-COLOR-TALLA-MX`, `skuParaTikTok`)
  para que el amarre y el kardex lo reconozcan desde el primer pedido, y
  nace con el inventario que el ERP ya le publica a ese SKU
  (`tiktok_inventario.publicado`; sin kardex, 0). La categoría, la marca,
  los atributos del producto, el peso/medidas del paquete y los IDs de los
  atributos de venta Color y Talla se COPIAN de una PLANTILLA: un producto
  ACTIVO de la tienda del mismo modelo, si no cualquiera de calzado
  (`plantillaDesdeProducto` sobre `GET /product/202309/products/{id}`;
  si le falta Color o Talla se completan con
  `/categories/{id}/attributes`). Las fotos salen de la ficha CAPTURADA de
  Amazon (`fichasCapturadasPorSku`: `main/other_product_image_locator`,
  `bullet_point` y `product_description` de Listings Items) y, si no hay,
  del catálogo público por ASIN; se bajan y se suben a TikTok por multipart
  (`Cliente.llamarMultipart`, firma SIN cuerpo como el SDK de referencia y
  SIN `shop_cipher`: con él TikTok contesta 36009004 «not required for
  this request», visto en la primera publicación real el 30-sep-2026;
  `/product/202309/images/upload`, `use_case` MAIN_IMAGE), hasta 4 por color
  y 9 principales (`elegirImagenesPrincipales`), la primera de cada color
  como `sku_img`. La cola corre POR ATRÁS: la ruta encola, trabaja 240 s en
  `after()` y encadena eslabones con el bearer de CRON_SECRET
  (`disparar-publicacion.ts`, `?cuenta=&eslabon=`, 202 y 270 s de trabajo,
  `MAX_ESLABONES_PUBLICACION` 48; el cron de TikTok empuja lo pendiente si
  un eslabón se perdió); candado `tiktok-publicar`; un renglón queda
  `publicado` con su `product_id` (y sus SKUs entran a `tiktok_skus` ya
  amarrados) o `error` con el mensaje REAL de TikTok (un rechazo de TikTok
  o un cuerpo inarmable es definitivo; red o tiempo se reintenta hasta
  `INTENTOS_MAXIMOS` 3; las fotos ya subidas quedan en `resultado.subidas`
  y el reintento no las vuelve a subir), con «Reintentar» y «Quitar»; bitácora
  `tiktok_sync_log` tareas `publicar-producto` (cuerpo enviado y respuesta)
  y `publicar` (por eslabón). «Dejarlos como borrador» manda `save_mode
  AS_DRAFT` (TikTok rechazó `DRAFT`, que es lo que decía el SDK). Publicar es del dueño (403 al rol tiktok, que solo ve). Lista
  masticada en `app_cache` `tiktok:nuevos` (15 min; cae con cada corrida).
  **El título se corrige en el renglón antes de confirmar** (textarea por
  modelo, viaja en `titulo` del pedido) y **los colores de las variantes
  van en ESPAÑOL** (`nombreColorEspanol`, lista `COLORES` en
  `tiktok/publicar.ts`: BLK → Negro, DK BROWN → Café oscuro, BLK/RED →
  Negro / Rojo; el seller_sku conserva el código; un código que no está en
  la lista se publica tal cual en Capital y la pantalla lo marca con ⚠ para
  agregarlo); pedido del dueño, 30-sep-2026. Solo entran modelos de
  CALZADO (`esModeloDeCalzado`, letras + número): las fundas de la misma
  cuenta de Amazon (499-IPAD10-BLK) no son de aquí.
  **Lo aprendido el 30-sep-2026 con las primeras 10 publicaciones reales:**
  (a) TikTok rechaza la palabra «tabaco» en el nombre de una variante
  (12052153 «prohibited term `tabaco`»; GT169 y GT135): TABACO BROWN es
  «Café tostado», TAN «Canela», NUDE «Color piel»; si TikTok rechaza otro
  término, el error lo dice y se cambia en `COLORES`. (b) Un BORRADOR ya
  cuenta como «en TikTok» (solo `DELETED` no): el GT168 como borrador
  seguía saliendo como publicable y el dueño lo volvió a encolar. (c) Un
  rechazo NO detiene la cola: antes un error no definitivo hacía `break` y
  el GT169 se quedó atrás del GT168 repetido; ahora solo el tiempo corta la
  vuelta, y «ya vende» / «ya no está en el catálogo» son definitivos.
  (c2) **«Volver a publicar aunque TikTok ya lo tenga»** (casilla en
  Productos nuevos, `PedidoDePublicacion.forzar` → `resultado.forzar`;
  dueño, 2-oct-2026: «quiero volver a publicar el GT168 porque quedó mal
  pero ya no me sale»): un borrador o un producto mal hecho cuenta como «ya
  en TikTok» y el modelo desaparece de lo publicable; con la casilla se
  encola con TODOS sus colores y sale OTRO producto; el malo se borra en el
  Seller Center y la siguiente lectura del catálogo lo marca DELETED.
  (d) Un modelo SIN ninguna talla activa en Amazon (GT265, GT266) publica
  todos sus colores de todos modos (`coloresActivosPorPublicar` cae a
  todos) y el filtro «solo con tallas activas» nace apagado. (e) El eslabón
  de fondo (`dispararPublicacionTikTok`) no dejó NINGÚN rastro en dos
  horas (ni los de etiquetas en tres días: `tiktok_sync_log` sin tarea
  `etiquetas`), así que el disparo se anota en la bitácora (tarea
  `publicar-disparo` con status y error, `dispararYAnotar`) y la PANTALLA
  empuja la cola cada 45 s mientras haya pendientes (`accion: continuar`,
  el candado evita encimarse); el cron de TikTok la termina sin pestaña.
  (f) **Guía de tallas** (`tiktok/guia-tallas.ts` puro + `guia-tallas-imagen.tsx`
  con `next/og`; dueño: «cada uno es 23 = 23 cm»): la talla MX es el largo
  de la plantilla en cm; se dibuja la tabla talla → cm con las tallas del
  producto, se sube como `SIZE_CHART_IMAGE` (si TikTok no acepta ese
  `use_case`, se intenta como `DESCRIPTION_IMAGE` y se avisa) y va en
  `size_chart.image`; el mismo texto va al final de la descripción.
  (g) **Lo ya publicado se CORRIGE por edición parcial, no se rehace**
  (`corregirPublicado`, `correccionesPendientes`; `POST
  /product/202309/products/{id}/partial_edit`, `editarProductoParcial`:
  solo cambia lo que viaja; la edición completa exige mandar todo y un
  campo de menos lo borra): un renglón `publicado` sin
  `resultado.guiaTallas` se corrige con el tiempo que le sobre a la cola
  (y el cron lo recoge por `hayPendientes`): guía de tallas con las tallas
  que el producto TIENE en TikTok, y las variantes cuyo color quedó en
  código de Amazon (los 16 primeros) se renombran en español mandando el
  `value_name` nuevo sin `value_id`. Hasta `INTENTOS_CORRECCION` (2);
  bitácora tarea `corregir-producto`. Dueño, 30-sep-2026: «me corriges lo
  que subió mal».
  **(h) Una publicación de MELI con VARIOS modelos se publica como UN
  producto** (`agruparPublicacionesMeli`, `agruparVariantesMeli`,
  `nombreVarianteMeli` en `tiktok/publicar.ts`; `encolarPublicacionesMeli`
  y `publicarUnoDeMeli` en el servicio; `components/publicaciones-meli-
  tiktok.tsx`; `tiktok_publicaciones.fuente` = `meli` + `item_id`,
  migración 0107; dueño, 2-oct-2026: «quiero crear en TikTok el listado
  GT117 a GT122, pero se agrupan en un solo listado aunque son diferentes
  SKUs»): en MELI la publicación MLM2745026941 junta GT117…GT122 (36
  variantes) y en Amazon no existen, así que el publicador por modelo no
  las veía. Productos nuevos enseña aparte las publicaciones de MELI con
  2+ modelos (de `skus` activos por `item_id`) y las encola completas: la
  variante de TikTok es «modelo + color en español» («GT117 Café», «GT118
  Negro»; `ColorAPublicar.nombre` manda sobre el color), las fotos salen
  de `variations[].picture_ids` contra `pictures` de `/items/{id}` (sin
  fotos propias, las del producto), la descripción de
  `/items/{id}/description` y el seller_sku es el SKU de MELI tal cual.
  Para esos renglones `modelo` = item y `colores` = sus modelos. Lo común
  (subir fotos, guía de tallas, cuerpo, crear, SKUs al catálogo) vive en
  `publicarArmado`, que usan las dos fuentes.

- **TIENDA EN LÍNEA DE GETAC: vende del MISMO almacén que TikTok** (proyecto
  `tienda/`, migración 0101; pedido del dueño, 1-oct-2026: «vamos a ocupar el
  mismo inventario que tenemos en TikTok y va a ser sincronizado porque si algo
  se vende aquí ya no se puede vender en el otro; de ahí tomamos listados,
  imágenes y precios»). No tiene stock propio: aparta pares en
  `tiktok_inventario.apartado_web` y `publicarDisponibilidad` los RESTA de lo
  que le publica a TikTok igual que el `apartado` de TikTok (un par, un dueño);
  la tienda ofrece `tienda_disponibles` = la misma regla (menor entre kardex y
  estante, solo SKUs contados: `tope_estante` y `contado` los escribe
  `publicarDisponibilidad` en cada corrida) menos los dos apartados. El
  apartado se decide DENTRO de Postgres con los renglones del kardex
  bloqueados (`tienda_crear_pedido`, `for update`): dos compradores no se
  llevan el último par, y el precio sale del catálogo, nunca del navegador.
  `apartado_web` lo mantiene SOLO `tienda_recalcular_apartado` (pedidos
  `pendiente_pago` y `pagado`); `recalcularSaldos` no lo toca. Lo apartado
  por la tienda también cuenta en el panel, en Pedidos de almacén y en la
  baja detenida de la bodega; lo que la tienda suelta (caducado, cancelado)
  es causa de subida (`causasDeSubida`). Catálogo copiado de TikTok
  (`tienda/catalogo.ts` puro, `servicios/tienda-catalogo.ts`): productos
  ACTIVOS de TikTok leídos completos cada 12 h (fotos, descripción en texto,
  colores y tallas de `sales_attributes`) y el PRECIO copiado de
  `tiktok_skus` en cada corrida; una variante sin amarre al kardex no se
  vende. Pago con Mercado Pago Checkout Pro: el aviso solo dice qué pago
  leer y el pago se lee de MP con la llave (`aplicarPago`), tiene que ser de
  ese pedido y cubrir su total; 45 min de apartado, 72 h con OXXO/SPEI
  pendiente; un pago que llega tarde vuelve a apartar si aún hay, si no el
  pedido queda `sin_stock` (devolver el dinero). La tienda avisa al ERP
  (`POST /api/tiktok/tienda/aviso`, bearer `TIENDA_SECRET`, ruta pública)
  y el ERP publica pasando por `sincronizarTikTok` con `soloPedidos` (regla
  de oro). El despacho es en el ERP (`/tiktok/tienda`, rol tiktok incluido):
  «Marcar enviado» = salida en el kardex con referencia = folio (GW000123),
  salida al 3PL (`tiktok_salidas_3pl`, order_id = folio, `corte_id` null) y
  se suelta el apartado DESPUÉS de la salida; cancelar devuelve el dinero
  con `MP_ACCESS_TOKEN`. El cron de TikTok caduca lo no pagado
  (`tienda_expirar`) ANTES de publicar y refresca el catálogo. Clientes sin
  contraseña (código de 6 dígitos al correo) en tablas propias: el registro
  del ERP sigue cerrado. La guía de paquetería se captura a mano por ahora.
  Variables y despliegue en `tienda/README.md`.
  **Catálogo para CREADORES** (`tienda/` → `/influencers`, `lib/influencers.ts`
  puro; pedido del dueño, 2-oct-2026): enseña SOLO lo ACTIVO en TikTok
  (el mismo día el dueño pidió primero activos e inactivos y luego «no
  enseñes los inactivos»), aunque la tienda no lo venda. El ERP sigue
  copiando los inactivos y borradores (no los `DELETED`,
  `ESTADOS_FUERA_DE_CATALOGO`) con `activo = false`, por si se vuelven a
  pedir; la tienda no los vende (`tienda_crear_pedido` exige producto
  activo). El creador elige color y talla y manda la selección por WhatsApp
  (`INFLUENCERS_WHATSAPP` en el proyecto de la tienda; sin él, WhatsApp
  deja elegir el contacto) o la copia. Sin buscadores (`noindex`).
  **Fotos por color: Amazon a veces carga en una talla las fotos de OTRO
  color** (GT135, 2-oct-2026: café oscuro, café tostado y olivo salían con
  las del beige). Por color se prueban hasta 4 publicaciones de Amazon con
  las ACTIVAS primero (`emparejarAmazon`), con el catálogo por ASIN y la
  ficha capturada de cada una, y `elegirFotosPorColor` descarta la foto
  principal que se repite en dos o más colores mientras haya otra propia.
  **CATÁLOGO COMPLETO** (`tienda/` → `/catalogo`; `tienda/catalogo-amazon.ts`
  motor puro con pruebas, `servicios/catalogo-amazon.ts`; dueño, 5-oct-2026:
  «un catálogo de todos los productos que tenemos aunque no estén activos
  en TikTok, dividido por categorías […] todo lo que hay en Amazon aunque
  no esté activo, solamente que tenga fotos»): TODO el calzado de
  `amazon_listings`, activo o inactivo, MENOS los GT viejos (hasta el GT100,
  `esModeloVigente`; «hay muchos modelos viejos que son hasta GT100 que no
  hay que meterlos»; los de otro prefijo sí). Por color se le preguntan al
  catálogo de Amazon hasta 2 ASINs, activos primero (`fichasDeCatalogo`:
  fotos, clasificación y título en una llamada por cada 20), lo contestado
  se guarda por ASIN en `app_cache` `catalogo-amazon:asins` y se relee cada
  7 días; solo entra el color con fotos y el modelo con algún color. La
  CATEGORÍA es la de Productos y costos y, si el modelo no tiene, la
  clasificación de Amazon («Otros» si ninguna). Corre en el cron de la
  tienda (`/api/cron/tienda`, cada hora) con el tiempo que sobre y avanza
  por tandas de 200 ASINs; el resultado va a `app_cache` `catalogo-amazon`
  y la página lo lee (secciones por categoría, misma tarjeta y selección
  por WhatsApp que `/influencers`, sin existencia). Bitácora
  `tiktok_sync_log` tarea `catalogo-amazon`. **Y cada noche a las 2:00 de
  México se relee COMPLETO** (`/api/cron/catalogo-amazon`, `0 8 * * *`;
  `refrescarCatalogoAmazon({ desde })` relee lo leído antes de la hora en
  que arrancó la pasada, los ASINs más viejos primero, bitácora con
  `origen: nocturno`; dueño, 6-oct-2026: «que el catálogo de Amazon se lea
  cada noche a las 2am»): con los 7 días, una foto cargada en Amazon
  tardaba hasta una semana en salir; ese día GT211, GT212, GT215, GT216,
  GT220, GT222 y GT225 del IN10079 no estaban en el catálogo porque Amazon
  no tenía ni una foto (en MELI tienen una, pausadas). **La pasada se
  encadena sola hasta terminar** (dueño, 7-oct-2026: «debe volver a pedir
  la lectura si no alcanzó»): la ruta contesta 202, trabaja ~4.5 min en
  `after()` y, si quedaron ASINs por leer, se llama a sí misma con
  `?eslabon=n+1&inicio=<ms>` (bearer CRON_SECRET al origen de producción,
  como etiquetas y publicación; `MAX_ESLABONES_CATALOGO` 12; constancia en
  `tiktok_sync_log` tarea `catalogo-amazon-disparo`). Un modelo SIN fotos
  en Amazon sigue sin salir: la regla «solo que tenga fotos» se queda.
  **BACK del catálogo** (`/tiktok/catalogo`, «Catálogo creadores» en el
  menú de TikTok, `components/back-catalogo.tsx`, `POST /api/tiktok/catalogo`;
  dueño, 5-oct-2026: «un back para poder gestionar cuáles quiero que sean
  visibles y cuáles no, poner cantidad total entre stock en mi bodega y en
  mar, y poder cambiar las categorías»): por modelo, la casilla «se ve»
  (`tienda_catalogo_ajustes.oculto`, migración 0110; sin renglón = visible),
  la CATEGORÍA, que se escribe en `productos_config` (la fuente única: la
  ven también cortes y ventas; el costo no se toca), y los pares en
  BODEGA (`enBodega`) y en el MAR (`enCamino`, lo que viene de China) de
  `inventario_cache` —que ya incluye los pedidos de China que la bodega
  todavía no ve— más la bodega de TikTok (saldo de `tiktok_inventario`,
  que la vista de inventario descarta), sumados por modelo
  (`stockPorModelo`). El renglón `catalogo-amazon` lleva TODO (lo oculto
  también, con `oculto`, `bodega`, `mar`, `tiktok`, `total`); la página
  filtra lo oculto y enseña en cada tarjeta, ARRIBA de la foto, SOLO el
  total («N pares en stock»; dueño, 5-oct-2026: «no me interesa cuánto hay
  en detalle ni colores, solo arriba que diga cuánto hay en total»); el
  desglose queda en el back. **Cada vez que el latido recalcula la vista de
  inventario, rearma también el catálogo** (`soloArmar`, sin Amazon; el
  GT213 se quedó en 0 con 1,200 pares en camino porque el catálogo se armó
  un minuto antes que el inventario). Al guardar, la ruta rearma el catálogo con lo ya
  leído de Amazon sin preguntarle (`refrescarCatalogoAmazon({ soloArmar })`
  en `after()`) y la tienda lo toma en 2 minutos.
  **PRECIO DE TIKTOK en el catálogo** (`preciosTikTokPorModelo`; dueño,
  5-oct-2026: «aumentarle el precio que tendría en TikTok según la lista de
  precios que tenemos»): la MISMA cuenta de Precios para TikTok
  (`renglonesDePrecio` con `PARAMETROS_POR_OMISION`, relámpago de MELI de
  30 días por `meli_neto_relampago_por_modelo`, casilla «quitar 10.5 %» y
  «Mi precio», que manda). La tarjeta enseña el relámpago NORMAL
  (`precioDesde`) y el back los tres niveles; un modelo sin relámpago ni
  «Mi precio» sale sin precio. Guardar en Precios para TikTok también
  rearma el catálogo (`after()` en `/api/tiktok/precios`).
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
  `productos_config`; una devuelta sin renglones NO recupera costo (nada
  se estima; se declara) y la revisión le pide los renglones a MELI. Para eso
  cada orden se REVISA después de vendida (`devoluciones.ts`): las
  cancelaciones en bloque (`/orders/search` con status cancelled, y ese día
  se vuelve a barrer para que sus renglones salgan de la venta) y el pago
  de cada orden a los 10 y a los 40 días (`/collections/{pago}`: estado,
  `transaction_amount_refunded`, neto de hoy), montado en el latido y
  completo al hacer el corte. Un corte (`cortes_meli`) congela el estado de
  resultados en jsonb y su PDF (`corte-meli-pdf.ts`) se rehace de ahí; el
  del mismo mes se reemplaza. **NADA SE ESTIMA (decisión del dueño, 9-sep-2026):**
  la venta cuyo depósito aún no se lee queda FUERA del neto y de la
  utilidad (`ventaSinDeposito`) y el corte lo declara en `avisos` junto con
  lo demás que le falta para ser exacto (modelos sin costo, órdenes sin
  revisar, ads o facturación sin leer). Lo mismo en Ventas, Publicidad y
  fundas: solo el neto REAL de Mercado Pago; ni importe − comisión ni
  porcentaje observado. **Los cargos se leen del pago REAL** de Mercado
  Pago (`https://api.mercadopago.com/v1/payments/{id}`, `meli/pagos.ts` +
  `pagos-api.ts`, migración 0070): comisión = máx(cargos del pago,
  Σ sale_fee × cantidad), retenciones por `tax_withholding-isr/iva`, envío
  del vendedor por `/shipments/{id}/costs`, reventa por `static_tags`
  `meli_resale` reconstruida al precio público con `/sites/MLM/listing_prices`
  (la venta bruta sube; el neto no), orden y pago recortados en
  `orden_cruda`/`pago_crudo`, fuente en `cargos_fuente`. Lo leído con la
  forma vieja se recarga en el fondo (`reparacion_netos_v3`, cron de netos).
  De la facturación de MELI solo se restan las clases `full` y
  `otro` (`clasificarCargo`): comisión y envío ya van en el neto, Product
  Ads ya cuenta por el API de publicidad, los pagos son abonos.
  **Ventas en REVENTA** (MELI compra y revende; desde el 27 ago 2026, la
  mitad de las órdenes de calzado): la orden llega con `unit_price` YA NETO
  de comisión y envío (MELI los absorbe), `sale_fee` 0 y Mercado Pago la
  deposita completa (neto = total). Verificado con la orden
  2000014843734267: "Recibes $176.80" de $208. No cuestan nada más; el
  corte las cuenta (`reventa`) y explica por qué la comisión se ve baja.
  NUNCA estimarles un cargo aparte.
  **Bono de envío de Full** (migración 0075, `ajuste_envio`/`neto_pago`):
  el cargo `shp_fulfillment` del pago es el costo de LISTA y el del vendedor
  es `/shipments/{id}/costs`; MELI abona la diferencia aparte (abono
  `shipping` sobre el envío de la venta en el reporte de liberaciones de
  Mercado Pago, verificado al centavo en agosto 2026: 57.03 − 38 = 19.03).
  Lo que pagó el COMPRADOR de envío viaja dentro del pago (el bruto sube
  igual que el cargo, 143 = 38 + 105) y NO es bono: se resta
  (`envioCompradorEnPago`, `pagos.ts`). `neto` = `neto_pago` + `ajuste_envio`
  siempre; la revisión lee `neto_pago` como control, nunca `neto`.
  **Devoluciones** (migración 0076, `reclamos.ts`): reclamo
  (`/post-purchase/v1/claims/search`), retorno (`/v2/claims/{id}/returns`)
  y revisión del almacén (`/v1/returns/{id}/reviews`,
  `product_condition`): el costo del par devuelto solo se recupera si
  volvió a la venta (`devolucion_destino = a_la_venta`); descartado o sin
  revisión es merma y el corte lo declara. Si MELI absorbió el reembolso, el
  pago no se toca y la venta cuenta completa.
  **Cancelaciones SOLO confirmadas orden por orden** (10-sep-2026): la
  búsqueda en bloque `/orders/search?order.status=cancelled` devolvió
  órdenes que MELI, preguntadas una por una (`/orders/{id}`), tiene PAGADAS
  y que el barrido de pagadas seguía trayendo: 537 de las 566 "canceladas"
  de septiembre no tenían reembolso y ~5 % de la venta salía del corte (los
  "días que no cuadran"). `marcarCanceladas` / `marcarCanceladasYz` marcan
  solo lo que `/orders/{id}` confirma (y guardan la orden cruda);
  `repararCanceladasFalsas` relee en cada latido las canceladas sin
  reembolso cuya orden cruda no dice `cancelled` y les devuelve su estado.
  **El corte usa el desglose por orden en cuanto alguna orden lo tiene**
  (migración 0080): lo que no lo tiene entra como «sin desglose» con su
  cargo exacto (total − depósito original, `sin_desglose_total/neto`).
  Antes una sola orden sin desglose tiraba el mes al cálculo residual, donde
  la comisión y el envío reconstruidos de las reventas salían como un
  descuadre de cientos de miles. `pendientes_vencidas` separa las órdenes a
  las que ya toca revisión de las que aún no llegan al plazo.
  **Conciliación contra reportes reales**: `/ventas/conciliar` (Ventas de
  MELI, Excel, por pack) y `/amazon/conciliar` (transacciones de Amazon,
  CSV); el navegador lee el archivo y manda JSON gzip (límite de 4.5 MB de
  Vercel). El reporte de liberaciones de Mercado Pago se cruza por
  `payment_id` (pagos) y `shipping_id` (abonos de envío).
- **La base es UNA y cualquier despliegue que alguien abra escribe en ella.**
  Las URL de preview de Vercel viven para siempre: el 10-sep-2026 una
  anterior al 9-sep guardó el corte general de julio con el Amazon de antes
  de la Finances API (`monitor:v2` en `app_cache` lo delata) y con los cortes
  de canal viejos, y la pantalla lo sirvió como bueno; el mismo julio se veía
  distinto según la URL. Se trabaja SOLO en
  `https://meli-erp-full.vercel.app`. El candado es
  `Consolidado.versionContable` (hoy 6; subió a 4 el 25-sep-2026 con la cobertura nueva, a 5 el 28-sep-2026 al entrar TikTok y a 6 ese mismo día al sacar los depósitos rebotados de Amazon): al cambiar las reglas del dinero se
  sube, y lo que escribió un build que no las conoce se descarta y se
  recalcula en vez de enseñarse. **Y Vercel YA NO construye previews**
  (`ignoreCommand` en `vercel.json`: solo se construye `main`; decisión del
  dueño, 2-oct-2026, al revisar la factura): cada cambio se construía hasta
  tres veces (preview al subir la rama, producción al mezclar y otro preview
  al alinear la rama), ~$0.27 USD por build, 58 builds el 1-oct; en
  septiembre los builds fueron $30 de $261. Las URL de preview tampoco
  existen ya para escribir en la base. El pico de septiembre ($222 del 31-ago
  al 10-sep) fue la avalancha de avisos de YAPANIZCEL con Observability Plus
  encendido ($115 en eventos); el complemento quedó DESACTIVADO y no se
  vuelve a prender.
- **Lo que se CONGELA no se arma con un renglón invalidado** (decisión del
  dueño, 10-sep-2026). La regla de servir lo guardado aunque esté viejo es
  para las PANTALLAS; un derivado que se guarda como fresco (el corte
  general, que lee los cortes por canal) tiene que recalcular el renglón
  invalidado: `obtenerConCachePorPeriodo({ exigirVigente: true })`. Sin eso,
  el corte general de agosto congeló el corte de fundas de cuando solo el
  10 % de los depósitos estaba leído y enseñó $317 mil de neto y $93 mil de
  envío contra $2.89 millones y $1.32 millones reales, con una pérdida de
  $1.18 millones que nunca existió (el corte de fundas decía lo correcto:
  dos pantallas, dos respuestas). Si el recálculo falla se usa lo guardado,
  pero el renglón derivado se marca NO vigente y se declara en `avisos`:
  nunca se congela un número que se sabe viejo.
- **Corte GENERAL** (`servicios/consolidado.ts`, `/cortes`, `cortes_generales`):
  calzado en MELI + fundas en MELI + Amazon (`consolidado-amazon.ts` desde el
  monitor de Amazon: neto liquidado o SKU Economics) + TikTok Shop DESDE
  SEPTIEMBRE 2026 (`consolidado-tiktok.ts`, `TIKTOK_DESDE`; dueño,
  28-sep-2026: «antes no vendía»): neto = lo que TikTok paga por cada
  pedido en pie (liquidado o su «por liquidar»), costo solo de los pares
  con ese número; lo que TikTok aún no calcula queda fuera y se declara,
  como la venta sin depósito de MELI. Regla del dueño: la
  publicidad se descuenta al modelo que la gastó; los GASTOS GENERALES de
  cada plataforma (Full, colecta, FBA, otros cargos, devoluciones netas del
  costo recuperado, ads sin amarre y a mano) se dividen entre las unidades
  vendidas en esa plataforma (`cargoPorUnidad`) y cada modelo y categoría
  carga su parte. El total del canal cuadra con su corte individual. Excel
  con hoja por canal (`consolidado-excel.ts`). **La tabla y el Excel
  enseñan los REPARTOS POR UNIDAD** (`repartosPorUnidad`, `porUnidad`,
  `adsPorModeloTotal`; dueño, 7-oct-2026: «aquí no se divide el total de
  publicidad y gastos generales entre unidades»): publicidad por modelo ÷
  unidades, gastos generales ÷ unidades y los dos juntos, por canal y en el
  total (el total divide entre las unidades de los canales calculables,
  `unidadesCalculables`). Se calculan al enseñar a partir de lo guardado:
  no cambian el masticado ni la `versionContable`.
  **Se mastica POR ATRÁS** (`refrescarConsolidadosDeFondo`, cron
  `/api/cron/consolidado` cada 10 min, candado `consolidado`; dueño,
  24-sep-2026: «toma como 5 minutos en lo que cuadran los números desde que
  lo abro»): antes solo se recalculaba al abrir /cortes. La pantalla dice de
  cuándo son los datos (`Frescura`).
  **Cada mes contra el anterior** (`consolidado-comparar.ts`,
  `components/comparacion-mensual.tsx`; dueño, 25-sep-2026: «si el mes
  creció o decreció contra el mes pasado, más que nada en unidades y
  ganancia»): unidades y ganancia por canal y total con su %, y la
  utilidad neta final. Con el mes EN CURSO se compara contra LOS MISMOS
  DÍAS del mes anterior (mismo día, «del 1 al 25»; dueño, 25-sep-2026:
  «no contra el total»): `mismosDiasDelAnterior`, `cargarConsolidado({
  hasta })` corta los tres canales, la publicidad, los gastos y la
  facturación de MELI en ese día, y el cron lo guarda en `app_cache`
  (`consolidado-mismos-dias:v1:{periodo}:{hasta}`). Mientras no exista,
  queda el RITMO por día como respaldo. Los meses cerrados se comparan
  contra el anterior completo; el cron mantiene calculados TODOS los meses
  desde `PRIMER_PERIODO_CORTES` (enero 2026) para que siempre haya contra
  qué, y arriba de /cortes salen todos esos meses para elegir (dueño,
  25-sep-2026: «elegir todo, no pasar de mes en mes»). Todo solo se
  LEE en la pantalla (`leerConsolidadoGuardado`, `leerMismosDiasGuardado`).
  **Amazon: lo asentado que aún no se deposita SÍ cuenta** (misma fecha):
  la liquidación en curso entra al neto como dinero por cobrar, una
  liquidación que descuadra se declara con su diferencia y NO tumba lo
  demás; la cobertura del neto de Amazon es 1 con eventos leídos y `exacto`
  sigue exigiendo todo cerrado y cuadrado. En MELI la venta de REVENTA
  reconstruida al precio público cuenta como venta cubierta (antes
  septiembre salía con 71 % teniendo todos los depósitos leídos).
- **La facturación de MELI (`cargos-meli.ts`) se lee POR ID y REANUDABLE**:
  el endpoint de detalles da 5 llamadas por minuto y un mes de calzado trae
  ~74 mil renglones (agosto 2026). La paginación por `offset` topa en 10 mil
  (6-oct-2026: agosto se quedó en 9,900 contestando 422 en cada latido, y
  como siempre estaba «pendiente», mayo, junio y julio nunca empezaron; los
  ocho filtros de partición que se sondearon —`sondearParticion`, por día y
  por subtipo— MELI los ignoró todos). La que MELI documenta es por
  `from_id` = el `last_id` de la página anterior, `limit` 1000,
  `sort_by=ID`, sin tope (`leerPorId`, `ProgresoCargos.modo = "id"`,
  `desdeId` para retomar); la de offset con partición queda SOLO de respaldo
  si MELI rechaza el id (`modo = "offset"`). **Una página CORTA no es el
  final mientras el `total` de MELI diga que faltan renglones** (6-oct-2026:
  julio y agosto 2026 contestaron 950 renglones en el día 10 con ~48 mil y
  ~50 mil por delante, y la lectura los dio por «completos» con diez días:
  13,950 de 61,966 y 24,950 de 74,059); el cursor es el `last_id` o, si no
  viene, el mayor `detail_id` de la página (`mayorIdDe`, `avanza`), la
  última página cruda queda en el progreso (`ultimaPagina`: renglones,
  last_id, total, claves) y un cierre corto se declara en los avisos. Un
  mes «completo» corto contra el total de MELI se relee por id solo, hasta
  `MAX_RELECTURAS_CORTAS` (2) veces (`necesitaRelecturaPorTotal`,
  `relecturas`); si MELI rechazó el id (`offset`) no se insiste. **El
  `total` de MELI cuenta DESDE `from_id`**: solo vale el de la primera
  página. Un mes dado por completo CON EL MES
  ABIERTO (septiembre 2026 se leyó el día 7 con 9,132 renglones) se relee
  solo (`leidoAntesDeCerrar`, cada `HORAS_RELECTURA_MES_ABIERTO`, sin tirar
  lo guardado) hasta que la lectura sea posterior al cierre. La revisión
  general compara lo leído contra el total que declara MELI
  (`hallazgosDeFacturacion`). El endpoint `/summary` del periodo NO existe
  (404): no hay totales por tipo, solo el detalle.
- **Órdenes viejas sin registrar** (`reparar-ordenes.ts`, cron
  `/api/cron/reparar-ordenes` cada 5 min, tarea `reparacion_ordenes_v1`
  en `sync_log`, hoy `reparacion_ordenes_v2` hasta `FONDO_REPARAR_ORDENES`
  = 1-ene-2026 por decisión del dueño; dueño, 25-sep-2026): la reparación de agosto solo llegó
  60 días atrás y del 1 al 19 de junio el calzado no tenía NINGUNA orden
  en `ordenes_neto` (~12,600 órdenes, $2.8 millones fuera del neto; el
  corte de junio salía con 29 %). Barre un día a la vez con
  `recalcularDiaVentas` (150 órdenes con pago real por barrido) y se queda
  en el día mientras registre órdenes nuevas; luego pasa al anterior,
  hasta el fondo. La v1 (junio) dejó el 1-jun al 19-jun al 100 %. Un barrido que MELI contesta degradado se
  anota en la bitácora y se sigue. Invalida el corte del mes que toca.
- **El dinero de Amazon EXACTO sale de la Finances API por grupo de
  liquidación** (`amazon/finanzas.ts` + `finanzas-sync.ts`, tablas
  `amazon_finanzas_grupos` / `amazon_finanzas_eventos`, migración 0071, cron
  `/api/cron/amazon-finanzas` cada 10 min). Cada evento se guarda crudo y
  clasificado (principal, impuesto cobrado, comisión, FBA, IVA retenido,
  promociones, por renglón/SKU; publicidad con base e IVA; cargos de
  servicio, ajustes…) con clave = huella del JSON **más el grupo** (`g:`;
  releer es idempotente). Sin el grupo, los cargos mensuales idénticos
  («Premium Services Fee» −$16,240, «Subscription» −$600, mismo JSON cada
  mes y sin fecha) se colapsaban en un solo renglón y seis liquidaciones de
  2026 quedaron sin su cargo (~$101 mil sin restar, 6-oct-2026). Al releer
  un grupo desde su primera página se retiran sus renglones con la clave
  vieja. `amazon_finanzas_recuadrar` (migración 0086) recalcula el control
  `cuadra` desde lo guardado en cada corrida del sync.
  El NÚMERO DE CONTROL es el `OriginalTotal` del grupo cerrado: la suma de
  sus eventos tiene que darlo (`cuadra`); si no, se declara. El grupo
  abierto se relee cada hora. Los RPC `amazon_finanzas_por_sku` / `_otros` /
  `_cobertura` suman en Postgres por fecha de ASIENTO en hora de México;
  `servicios/finanzas-amazon.ts` arma el periodo y `MonitorAmazon.real` lo
  lleva a Ventas Amazon y al Corte general (`bloqueAmazon` usa lo real en
  cuanto hay eventos en el rango; SKU Economics y el reporte de
  liquidación quedan de respaldo para lo anterior a la ingesta). Regla del
  dueño: publicidad al modelo que la gastó (atribución por SKU de SKU
  Economics) y lo que la factura real de Product Ads (CON IVA) cobró de más,
  gasto general; las devoluciones de Amazon NO recuperan costo (no se sabe
  si el par regresó vendible). SKU Economics es una ESTIMACIÓN de Amazon y
  para julio 2026 solo cubría ~15 % de las unidades: nunca es la fuente
  final. **Un depósito REBOTADO no es ingreso** (`AdjustmentEventList` con
  `FailedDisbursement`; migración 0098, `LISTAS_QUE_NO_SON_RESULTADO`): el
  2-ene-2026 el banco devolvió los $326,732.82 de la liquidación del 30-dic
  al 2-ene y Amazon los regresó al saldo como «ajuste»; contado así, enero
  ganaba ese dinero dos veces. `amazon_finanzas_otros` lo separa de su
  lista, queda fuera de la ganancia y se declara. Las `SellerRewards`
  (recompensas de Amazon, $538,896 en enero) sí son abono y van con su
  nombre. Sonda sin escribir: `/api/amazon/diagnostico-finanzas?pedido=…`
  o `?grupo=…`. **Lo real solo arma un mes si lo cubre DESDE SU PRIMER DÍA**
  (`realCubreDesde`: alguna liquidación completa que empiece ese día o
  antes); si no, el mes sale del respaldo y se declara. La ingesta
  arrancaba en abril y la primera liquidación leída empezó el 29-mar: marzo
  salía con 3 días de eventos (1,960 unidades contra ~16,600). Desde el
  28-sep-2026 `FINANZAS_DESDE` es 15-dic-2025 y, si lo guardado no llega al
  fondo, la lista de grupos se vuelve a pedir desde ahí (si Amazon no
  acepta la fecha vieja, sigue con la ventana reciente).
- **Los RPC de Amazon que corren en el FONDO aceptan al `service_role`**
  (migración 0111: `amazon_economia_por_sku`, `amazon_economia_cobertura`,
  `amazon_historia_sku`, `amazon_compras_por_sku`; `amazon_pagos_por_sku` y
  los `amazon_finanzas_*` ya lo hacían): `es_mi_cuenta_amazon` se decide por
  `auth.uid()` y el cron del corte general, el latido y la planificación
  llaman con el cliente admin. Hasta el 6-oct-2026 contestaban «Esa cuenta
  de Amazon no es tuya», el corte general de TODOS los meses decía «no se
  pudo leer SKU Economics», la publicidad de Amazon ($443 mil en agosto)
  iba completa como gasto general y la ganancia por modelo de Amazon salía
  sin ella (dueño: «Amazon no está jalando su publicidad»); y el plan de FBA
  perdía NUEVO y SIN VENTA en cada corrida. Un RPC nuevo que vaya a correr
  en el fondo lleva SIEMPRE `coalesce(auth.role(), '') <> 'service_role'
  and not es_mi_cuenta…`. **El API de Supabase devuelve a lo más 1,000
  renglones por respuesta pida lo que pida el rango** (`TOPE_FILAS_SERVIDOR`
  en `traerRpcTodo`, `datos/repos.ts`): con `paso` 10,000 llegaban 1,000 y
  «menos de los pedidos» se leía como «ya acabé», así que
  `amazon_economia_por_sku` entregaba los 1,000 primeros SKU en orden
  alfabético (casi todos fundas) y la publicidad de Amazon por modelo del
  corte general era $8,738 de los $417,138 de agosto 2026 (el resto a
  «general»). Ahora solo se para con un lote vacío o más corto que el paso
  Y que el tope. **Y `amazon_economia_hueco` busca por llave**
  (migración 0112): agrupaba los 2.47 millones de renglones de
  `amazon_economia` para revisar cuatro días y el paso `cron_economia` murió
  por tiempo en cada latido del 10-sep al 6-oct-2026 (SKU Economics se
  quedó en el 30-sep).
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
  AMAZON`, y `PEDIDO - BOX LABEL.pdf` de 10×5 cm con código de barras: una
  etiqueta por color para las cajas de corrida y UNA POR TALLA
  (`PEDIDO-MODELO-COLOR-TALLA`, `etiquetas/carton.ts`) para las cajas de una
  sola talla, como el IN10172 de GT148 con 48 pares de la misma talla por
  caja; pedido del dueño el 22-sep-2026).

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

**Revisión de velocidad del 9-oct-2026** (`docs/PLAN-VELOCIDAD-Y-DISENO.md`;
dueño: «otros sistemas abren al momento, el nuestro tarda mucho»). Lo que se
midió y quedó como regla:
- **RLS se evalúa UNA vez por consulta** (migración 0116): las políticas son
  `account_id in (select mis_cuentas_meli())` (y `_amazon`, `_yz`,
  `_tiktok`), NUNCA `es_mi_cuenta(account_id)` por renglón —esa función es
  SECURITY DEFINER, Postgres la corría en cada renglón y una consulta de
  pantalla tardaba 226 ms promedio contra 10 ms del fondo (los pedidos
  cortados de TikTok: 432 ms → 24 ms)—. Una tabla nueva usa el mismo patrón;
  `auth.uid()` en una política va como `(select auth.uid())`. Las funciones
  `es_mi_cuenta*` se quedan para los RPC.
- **Las pantallas leen con `servirConCacheApp`** (`cache-app.ts`): sirve el
  renglón aunque esté viejo y refresca en `after()` con candado por clave;
  `conCacheApp` (calcula en el clic al vencer) queda para el fondo. Ventas
  MELI tardaba 15–35 s, Planificación China 10–60 s la primera vez de cada
  media hora. Los rangos por omisión de Ventas/Publicidad (MELI y Amazon) y la
  sugerencia de compra a China se precalculan en el latido.
- **Leer solo lo que se enseña**: Despacho cuenta el avance de los cortes en
  la lista con el RPC `tiktok_avance_cortes` (0120), no bajando las 16 mil
  preparaciones; `cargarCorte` lee solo los renglones del corte; /envios usa
  `obtenerPlanLigero` (RPC `plan_cache_ligero`, 0123, sin la explicación de
  cada línea, más copia en memoria por `generado_en`); el plan de fundas se
  guarda también en `plan:pantalla` y `plan:sugeridas`.
- `rpcTodo` de fundas para con un lote más corto que lo pedido Y que el tope
  de 1,000 de PostgREST (como `traerRpcTodo`): antes repetía el RPC completo
  una vez por cada mil renglones y el corte de fundas moría por tiempo.
- **Las funciones viven en `iad1`, junto a la base** (`regions` en
  `vercel.json`; 9-oct-2026): corrían en `sfo1` y la base está en
  us-east-1, así que cada consulta cruzaba el país (~50 ms por viaje y una
  pantalla hace varios en serie).
- **Pestañas dentro de la pantalla** (`components/ui/pestanas.tsx`, regla en
  `docs/DISENO.md`; dueño: «para no ver todo su contenido junto de golpe»).
- La barra de estado pregunta cada 60 s, se pausa con la pestaña escondida y
  solo recarga las pantallas que usan el plan; la página ya no se desmonta en
  cada navegación. `clienteAdmin` vive en `supabase/admin.ts` (sin
  next/headers) para que los servicios que llegan a componentes de cliente
  lo puedan importar.

**Diseño de pantallas** (`docs/DISENO.md`, piezas en
`components/ui/pagina.tsx`; dueño, 9-oct-2026: «que todo se vea más bonito,
más profesional […] que todo sea de la misma manera»): toda pantalla es
`<Pagina>` → `<Encabezado ceja titulo descripcion frescura acciones ayuda>`
→ `<Cifras>` → `<Seccion>`; UNA línea de descripción y la regla larga
plegada en «¿Cómo se calcula?» (se mueve, no se borra); avisos con `<Aviso>`
de cuatro tonos; `<SinCuenta>` para «conecta primero»; nada de colores a mano
(`texto-2`, `texto-tenue`, `enlace`, `boton-*`).

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
- **Publicaciones GEMELAS: el mismo producto publicado dos veces, con N-/C-
  y sin ella** (`yapanizcel/gemelas.ts`; `462-A57` y `N-462-A57`, `462-i14` y
  `N-462-i14`). Decisión del dueño (15-sep-2026): «hoy solo ocupamos los
  SKUs de 462 comenzando con N-, hay que juntar todo por ahí». La bodega y
  el pedido de la fábrica dicen `462-A57` y amarraban EXACTO con la
  publicación vieja, así que la N- (la que vende) se quedaba sin bodega ni
  en camino. Ahora cada grupo de gemelas (clave aplastada sin la N/C,
  `clavePrefijoNC`) tiene UNA PRINCIPAL —la de prefijo si no está cerrada
  en MELI (activa primero, N antes que C); si no, la sin prefijo— y las
  demás se ABSORBEN: el amarre de bodega y el del pedido apuntan a la
  principal (`cargarInventarioAmarrado`, `amarrarSkus`), y Pedidos a China,
  el plan de envíos y Bodega suman bajo ella venta, Full, transferencia,
  envíos en camino, bodega y pedido a China (`VarianteCompra.gemelas`,
  `PlanConDetalle.gemelas`, columna «Incluye» en el Excel). Un grupo se
  descontinúa solo si TODAS sus gemelas lo están. Ventas y Listados siguen
  por publicación.
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
  los netos que faltan a Mercado Pago (PRIMERO las órdenes sin depósito,
  luego las que solo les falta desglose o envío), registra hacia atrás las
  órdenes viejas y ASIENTA en `yz_ventas_diarias` POR ORDEN (RPC
  `yz_asentar_dia`, migración 0079): cada renglón sku+día guarda el neto de
  las órdenes con depósito y `importe/unidades/comision_con_neto`; los
  resúmenes declaran la diferencia como sin leer. Antes un día solo entraba
  COMPLETO y casi ninguno lo estaba (el panel quedó con $75 mil de neto
  contra $4.4 millones de venta el 9-sep-2026). La ganancia resta el costo
  SOLO de las unidades con depósito leído. Mientras un renglón no tiene depósito real, el panel NO lo
  estima: su venta se declara como «sin depósito leído» (`ventaSinNeto`,
  `unidadesSinNeto`) y queda fuera del neto y de la ganancia (decisión del
  dueño, 9-sep-2026; antes se estimaba con un porcentaje observado y, más
  antes, con importe − comisión, que infló la ganancia al 86% de la venta
  cuando el real es ~51%). El cron de `/api/yapanizcel/netos` DEBE estar en
  la lista de rutas públicas del middleware: sin eso contestaba 307 y nunca
  corrió.
- **Envíos registrados (`yz_envios`) solo alimentan cálculos**: cuentan como
  en camino hasta caducar (`dias_caducidad_envio`) o marcarse recibidos.
- **El Excel del pedido de la fábrica NO viene siempre igual** (`yapanizcel/pedidos.ts`,
  fixtures `yz-pedido.xls` del 499 y `yz-pedido-462.xls` de las micas): el
  de fundas trae "Model", "Total" = CANTIDAD y "一套 Set" = costo; el de micas
  deja la columna del modelo SIN encabezado (la primera es la marca: Iphone,
  Samsung, Redmi, Moto), "Qty" = cantidad y "Total" = COSTO (mica + tools
  kit). "Total" solo es cantidad si no hay otra; sin encabezado de modelo,
  el modelo es la columna de texto más a la derecha antes de la cantidad y
  la marca la anterior. La marca escribe el modelo como MELI
  (`modeloSegunMarca`: XR → ixr, SE 2022 → ise2022, Note 13 Pro 4G →
  Rmn13pro-4g con su red, Poco X8 Pro 5G → PocoX8pro sin red, 12C → Rm12c).
  **Columnas por COLOR** (8-oct-2026, fixtures `yz-pedido-{662,686,648,714}.xls`):
  la fábrica reparte la cantidad en una columna por color (662: BLK /
  GREEN / FUCHSIA / CREAM con "Qty" como suma; 686: 黑色 / una SIN nombre /
  purple 紫色 / Pink / Grey con "Total") o en una sola columna titulada con
  el único color (714 "Transparent透明", 648 "Transparent", sin Qty). Un
  encabezado es color si es UNA palabra de color en inglés o SOLO el color
  en chino (`colorDeEncabezado`, `COLORES_ZH`; "小單箱子用黃色膠布" es una
  nota de cinta amarilla, no un color). Con varios colores sale una línea
  por color CON color (`662-A07-BLK`) y la suma solo sirve para avisar; con
  uno solo el SKU va SIN color (`714-A37`, `648-A07`) y, si MELI sí lo lleva
  (`714-G05-transparent`), el amarre lo prueba con el color y lo adopta.
  Una columna de cantidades sin encabezado entre las de color es un color
  sin nombre (`?`): al amarrar se toma el ÚNICO color del modelo en MELI que
  el archivo no nombra (686 iPad 11 → navy) y se declara; con dos o más,
  queda en rojo. Entre varios renglones candidatos a encabezado gana el que
  más columnas reconoce (el 662 trae la fila china arriba de la inglesa);
  con varias columnas de costo del mismo rango (648: RMB mica, RMB caja,
  RMB set) gana la de más a la DERECHA; "Cost of Set" y "UNIT PRICE(RMB)"
  son costo, "Amount" y "PRICE" (importe) no; la fecha suelta ("16/9/2026"
  sin "Date :") también se lee.
  Al leer, cada línea se amarra contra `yz_skus` (`amarrarLineas` →
  `amarrarLineasCon`, puro) y la pantalla pinta EN ROJO las que no amarran,
  con el SKU editable en el renglón y re-amarre al corregirlo
  (`/api/yapanizcel/pedidos/amarrar`): se guardan igual pero NUNCA cuentan
  como en camino (`cargarPedidosEnCamino` las salta).
  **El "+" es parte del nombre** (`canonizar` lo vuelve PLUS): MELI tiene
  `C-514-Rmn14pro-5G` Y `C-514-Rmn14pro+5G` (Pro y Pro+), y borrarlo las
  dejaba con la misma clave: el amarre lo veía como empate y el pedido se
  quedaba sin amarre. Un empate entre puras GEMELAS sí se resuelve a la
  principal (`amarreConGemelas`); entre productos distintos, nunca.
- **Etiquetas de Full de las fundas** (`/yapanizcel/etiquetas`,
  `yapanizcel/etiquetas.ts`, `/api/yapanizcel/etiquetas{,/pdf,/zpl}`): la
  MISMA etiqueta y la misma pantalla que la del calzado (`components/etiquetas.tsx`
  con `api` y `soloMeli`; PDF y ZPL por `generarPdfMeliDatos` /
  `generarZplDatos`), pero contra `yz_skus` y SOLO el lado de MELI: las
  fundas no llevan FNSKU desde aquí. El amarre del SKU tecleado es exacto →
  canónico → aplastado (`yapanizcel/sku.ts`); la variante impresa es
  `modelo - color` del desglose del SKU. Las sugerencias salen del plan de
  envíos (`mandar` > 0).
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
| Latido (drena avisos, recalcula, repara historial; candado atómico `candados_trabajo` recurso `latido`, las lecturas de `sync_log` solo son pre-filtro) | `src/lib/servicios/latido.ts` (+ `latido-amazon.ts`) |
| Productos nuevos: lista en `app_cache` `nuevos:productos` (cae con `invalidar()`), fotos guardadas en `nuevos:fotos` y solo se re-pregunta lo que falta (`productos-nuevos-fotos.ts`). Las fotos de Amazon se cuentan en TODAS las tallas del color y en su PADRE (`amazon_padres`) y, si el catálogo aún no las publica, en la ficha CAPTURADA por SKU (Listings Items, `fotosCapturadasPorSku`): hasta el 1-oct-2026 solo se miraba el primer ASIN en el catálogo y el dueño veía «0 fotos» en lo que ya había cargado (GT211) | `src/lib/servicios/productos-nuevos.ts` + `-revisar.ts` + `/api/pedidos/nuevos/fotos` |
| Lógica del pedido a China explicada para el dueño | `docs/PLANIFICACION-CHINA.md` |
| Caché del plan                   | `src/lib/servicios/cache.ts` (`plan_cache`) |
| Sugerencia de compra a China (demanda MELI corregida + Amazon corregida + TikTok OBSERVADA tal cual, sin tendencia ni agotamiento por decisión del dueño el 5-oct-2026; el stock libre de la bodega de TikTok cuenta como comprado) | `src/lib/servicios/compras.ts` (+ `fba.ts` para el lado Amazon, `tiktok-compras.ts` para TikTok) |
| Lectura de proforma de fábrica   | `src/lib/importar/proforma.ts` + `leer-hoja.ts` |
| Envíos separados por bodega      | `src/lib/servicios/envios.ts`               |
| Cargar pedidos (muchas proformas, lista con filtros) y faltantes contra el sheet de pendientes (`PEDIDOS_SHEET_URL`, pestaña por `gid`, AR* ignorados) | `src/app/pedidos/cargar` + `components/cargar-pedidos-lote.tsx` + `src/lib/servicios/pedidos-sheet.ts` |
| Packing list de la fábrica → contenedor (lector + amarre pedido/modelo/color/talla) | `src/lib/importar/packing-list.ts` + `src/lib/servicios/packing-list.ts` + `/api/contenedores/packing-list` |
| Productos nuevos en camino (pedidos sin stock nunca; fotos en MELI y Amazon, mínimo 2) | `src/lib/servicios/productos-nuevos.ts` (+ `-revisar.ts`, `-fotos.ts`) + `src/app/pedidos/nuevos` + `/api/pedidos/nuevos/fotos` |
| Packing lists desde la carpeta de Drive de la fábrica (cron diario 13:00Z + botón; una subcarpeta por contenedor; solo se entra a los embarques desde el último cargado, `numeroDeEmbarque`; el contenedor ya cargado se reconoce por NÚMERO de embarque, "S259" = "S259-2026"; facturas y pedidos de la misma carpeta se omiten; entran como contenedor `borrador` que el dueño confirma; solo calzado: lo que no amarra con un pedido se omite; un contenedor confirmado no se toca; bitácora en `drive_packing_lists`, migración 0077). SIN llave (decisión del dueño): carpeta pública leída por `embeddedfolderview` + `uc?export=download`; `GOOGLE_DRIVE_API_KEY` es opcional (API v3 con md5); `DRIVE_PACKING_FOLDER_ID` opcional | `src/lib/servicios/drive.ts` + `drive-packing.ts` + `/api/cron/packing-lists` + `/api/contenedores/drive` + `components/packing-drive.tsx` |
| Recordatorios del contenedor por correo (migración 0082, en el cron diario de packing lists): una SEMANA antes de la llegada estimada, las fotos que faltan; el día que LLEGA, aviso de que está en USA. Uno por contenedor (`aviso_previo_en`, `aviso_llegada_en`); lo ya recibido o con más de 30 días de retraso no dispara nada | `src/lib/servicios/avisos-contenedor.ts` |
| Compartir los documentos del embarque: lee la subcarpeta de Drive de ESE contenedor y abre un borrador de correo con los enlaces (un `mailto:` no lleva adjuntos) | `/api/contenedores/[id]/documentos` + botón «Compartir docs» |
| Correo con las fotos que faltan al cargar un contenedor NUEVO (a mano o desde Drive): productos nuevos de sus pedidos sin publicar o con menos de 2 fotos; Resend por HTTP (`RESEND_API_KEY`, `CORREO_REMITENTE`, `CORREO_AVISOS`); constancia en `contenedores.fotos_aviso_en` | `src/lib/servicios/fotos-contenedor.ts` + `correo.ts` |
| Resumen de ventas de AYER por correo a las 8:00 de México (cron `/api/cron/resumen-diario` 14:00Z; pedido del dueño, 28-sep-2026) y cada LUNES además la SEMANA pasada de lunes a domingo (`semanaQueCierra`, `tramosPorMes` si cruza de mes, `sumarFilas`): unidades, facturación y ganancia de calzado, fundas, Amazon y TikTok, las cuatro del motor del corte general recortado a UN día (`cargarConsolidado({ desde, hasta })`); ganancia del día = neto real − costo − publicidad, SIN los gastos que se cobran por mes (van en el corte); lo que aún no tiene depósito o número de TikTok se declara. Abajo, el mes hasta hoy del corte general guardado. Destinatarios `CORREO_RESUMEN_DIARIO` separados por coma (por omisión los tres del dueño, `DESTINATARIOS_RESUMEN`); constancia en `sync_log` tarea `correo-resumen-diario` y no se repite un día ya mandado (`?dia=…&forzar=1` para probar) | `src/lib/servicios/resumen-diario.ts` + `/api/cron/resumen-diario` |
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
| TikTok: sincronizar y publicar    | `src/lib/servicios/tiktok.ts` (+ `tiktok-bodega.ts` foto de Industher, `tiktok-panel.ts` pantalla, `tiktok-despacho.ts` cortes, `tiktok-ventas.ts` ventas masticadas, `tiktok-afiliados.ts` creadores) |
| TikTok: Productos nuevos (publicar en TikTok el calzado de Amazon) | `src/lib/tiktok/publicar.ts` + `src/lib/servicios/tiktok-publicar.ts` + `src/app/tiktok/nuevos` + `/api/tiktok/publicar-productos` |
| Videos de producto (Higgsfield). **El MCP a veces contesta con una PREGUNTA en vez de folio** y el ERP la contesta solo (`generarContestandoAvisos` / `paramsTrasAviso` en `higgsfield/mcp.ts`, hasta `REINTENTOS_POR_AVISO` 3): `unlim_choice` → `use_unlim: true` (las generaciones de prueba son gratis) y `notice.type = preset_recommendation` («tu prompt se parece al preset X, ¿lo usas o generas literal?») → se vuelve a llamar con `declined_preset_id` = ese preset para generar LITERAL lo pedido (24-sep-2026: david veía «El Studio no devolvió folio: {"notice":…}» y no había a quién contestarle). Lo que siga sin folio se enseña con el crudo completo. La sonda `/api/videos/diagnostico?llave=…&herramienta=generate_video` enseña el esquema de la herramienta | `src/lib/higgsfield/` + `src/app/videos` + `/api/videos/*` |
| ERP YAPANIZCEL (fundas)          | `src/lib/yapanizcel/` (`sku.ts`, `plan.ts`, `sheets.ts`, `sync.ts`, `ventas.ts`, `compras.ts`, `pedidos.ts`) + `src/app/yapanizcel/*` + `/api/yapanizcel/*` |
| Tienda en línea de GETAC (catálogo copiado de TikTok, pedidos y despacho en el ERP) | `src/lib/tienda/` + `src/lib/servicios/tienda-catalogo.ts`, `tienda-pedidos.ts` + `src/app/tiktok/tienda` + `/api/tiktok/tienda/*`; la página pública vive en `tienda/` |
| Páginas                          | `src/app/{envios,inventario,ventas,amazon,tiktok,pedidos,pedidos/cargar,pedidos/nuevos,contenedores,corridas,etiquetas,videos,pendientes,ajustes}` |

## Seguridad — cosas que ya se decidieron

- El registro está **cerrado**: tabla `usuarios_permitidos` + trigger sobre
  `auth.users`. Para dar acceso a alguien, inserta su correo ahí.
- **Usuarios de operación con acceso SOLO a TikTok** (migración 0090,
  `src/lib/acceso/roles.ts`; el primero es «david», 16-sep-2026): el ERP
  era de una persona y `es_mi_cuenta()` sigue siendo del dueño, NO se
  toca. Un miembro va en `cuenta_miembros (account_id, user_id, rol)` y
  `es_miembro_tiktok()` es su llave: SOLO las tablas `tiktok_*` la aceptan
  (política `*_miembros_tiktok`), más la LECTURA de `meli_accounts` (para
  `cuentaActiva`), `inventario_cache` (el pedido de almacén) y `skus` (el
  amarre). Costos, ventas de MELI, cortes, Amazon y fundas, no. El rol viaja
  en el JWT (`auth.users.raw_app_meta_data.rol = 'tiktok'`, que solo
  escribe la base; `user_metadata` NO cuenta) y el middleware manda a
  `/tiktok/despacho` cualquier ruta fuera de `/tiktok`, `/api/tiktok`,
  `/preparar`, `/api/preparar-publico`, `/videos`, `/api/videos`, `/login`,
  `/auth` y `/api/salir`
  (403 en las de API). **Desde el 2-oct-2026 ese rol abre TODAS las
  secciones de TikTok** (dueño: «dale acceso al usuario david a todas las
  secciones adentro de TikTok»): `SOLO_DUENO` quedó vacío, Precios para
  TikTok (netos de MELI y costos) y publicar Productos nuevos ya no exigen
  ser dueño; las pantallas leen con el cliente admin, así que la RLS no
  estorba. Los videos de producto se le dieron el 17-sep-2026
  (migración 0092), el dueño se los QUITÓ el 18-sep-2026 (migración 0093)
  y se los VOLVIÓ A DAR el 24-sep-2026 (migración 0095: `videos_producto`
  y `personajes_video` aceptan otra vez `es_miembro_tiktok`; `/videos` y
  `/api/videos` en `PREFIJOS_TIKTOK`); el menú
  solo enseña las entradas que puede abrir (`entradaVisible`). Entra
  con su NOMBRE: el login le pega `@getac.erp` a lo que no trae arroba
  (`DOMINIO_USUARIOS`), correo que no recibe nada. Se creó por SQL directo
  en `auth.users` + `auth.identities` (no hay service_role en el entorno
  de Claude); la contraseña la decidió el dueño.
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

## Proyecto aparte: `tienda/` (tienda en línea de GETAC)

Next.js con su propio `package.json` y su propio despliegue en Vercel (Root
Directory = `tienda`), pero sobre la MISMA base y el MISMO almacén que TikTok
(ver la regla de la tienda arriba). Solo habla con la base desde el servidor
con service_role y por los RPC `tienda_*`. Sus pruebas y tipos se corren desde
`tienda/`; la raíz la excluye en `vitest.config.ts` y `tsconfig.json`. Léase
`tienda/README.md`.

## Proyecto aparte: `boletos/` (venta de boletos para eventos)

Sistema **independiente** del ERP que vive en la carpeta `boletos/` con su
propio `package.json`, su propia migración (tablas con prefijo `ev_`) y su
propio despliegue en Vercel (Root Directory = `boletos`). No comparte tablas ni
código con el ERP ni con YAPANIZCEL. Léase `boletos/README.md`.

**No se mezclan.** Una tarea del ERP no toca `boletos/` y una de boletos no
toca el ERP: ni código, ni commits, ni explicaciones. Por eso `vitest.config.ts`
y `tsconfig.json` de la raíz excluyen `boletos/`: sus pruebas y tipos se corren
desde su propia carpeta con sus propias dependencias.
