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
  volvería a publicar lo ya vendido (`tiktok/bodega.ts`). Se cuentan cajas
  FÍSICAS. **Esa bodega NO existe para el calzado**: `construirCajas` la
  descarta siempre (`esAlmacenTikTok`, salvo `incluirTikTok` que solo usa el
  kardex de TikTok), /corridas la ignora y un trigger deja
  `almacenes_activos.surte_full = false` pase lo que pase (migración 0045;
  antes el RPC la daba de alta en `true` y sus cajas entraron a bodega, al
  plan de Full y al pedido a China). A TikTok solo se le escribe un SKU que alguna vez
  se contó (entrada o ajuste): uno con puras salidas se queda con el número
  que TikTok ya tiene.
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
  más se toca; escanear la guía en la estación enseña qué empacar), la
  lista de empaque en el mismo orden con los mismos números, y la lista de
  SURTIDO (`pdfSurtidoDelCorte`): pares por SKU en orden alfabético para
  jalar de bodega. **El orden del corte es: PRIMERO todo lo de UN SOLO
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
  reloj de 48 h corriendo. Ahora, tras 3 fallos seguidos, ya no se pregunta
  en ese corte: los paquetes salen como DROP_OFF a propósito (que es lo que
  TikTok hace de todos modos con una recolección sin horario, sin decirlo)
  y se declara UNA vez (`avisoDeGuardia`, renglón con `orderId` vacío en
  `errores`), no 52. Confirmar el envío es lo urgente; el horario no. La
  pantalla agrupa los errores repetidos (`agruparErrores`: «203 pedidos: se
  acabó el tiempo»), y los `rechazados` de los faltantes excluyen a los
  pedidos que sí entraron al corte.
  **CORTE LUNES** (`tiktok/lunes.ts`, `hacerCorteLunes`, `modo: "lunes"`):
  el lunes se despacha lo del viernes, sábado y domingo, y lo del viernes y
  el sábado ya casi cumple las 48 horas que da TikTok para despachar. Ese
  botón hace PRIMERO un corte completo con lo que tiene dos días o más de
  antigüedad (`partirEnTandas`, día en hora de México: corrido un lunes son
  viernes y sábado) y luego un SEGUNDO corte con lo del domingo y el lunes.
  Un pedido sin fecha se va con los urgentes. Si el primer corte se come el
  rato de Vercel, el segundo NO se hace a medias: dice cuántos quedaron y el
  botón normal se los lleva completos. La simulación enseña la partición
  antes de confirmar nada.
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
  `numerosPreparados` lo traduce a la hoja que se está enseñando.
  **Preparar pedido** (`tiktok/preparar.ts`, estación en
  `/tiktok/despacho/[id]/preparar`): se empieza por la ETIQUETA (FNSKU de
  Amazon, impreso como barras en la guía Y en el renglón de la lista: hoja,
  guía y caja llevan el mismo código) — elige el siguiente paquete sin
  preparar con ese producto y pita UNA VEZ POR PAR; luego el PRODUCTO (FNSKU de la
  caja, un escaneo por par). El camino principal con muchos paquetes del
  mismo producto es empezar por el PEDIDO: el renglón de la hoja lleva el
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
  manda al 3PL en ese momento. Los amarres capturados a mano
  (`tiktok_mapeo_sku`) siguen mandando sobre todo, pero de Almacén TikTok se
  quitaron sus DOS bloques por decisión del dueño (10 y 11-sep-2026): la
  lista de «Amarres a mano» y el de «N SKU de TikTok sin amarrar al
  catálogo» con sus sugerencias y su botón Amarrar. Quedan las sugerencias
  del renglón del inventario (`LigarTikTok`) y `/api/tiktok/mapeo`; los
  amarres se consultan en la base.
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
  `Consolidado.versionContable` (hoy 3): al cambiar las reglas del dinero se
  sube, y lo que escribió un build que no las conoce se descarta y se
  recalcula en vez de enseñarse.
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
  monitor de Amazon: neto liquidado o SKU Economics). Regla del dueño: la
  publicidad se descuenta al modelo que la gastó; los GASTOS GENERALES de
  cada plataforma (Full, colecta, FBA, otros cargos, devoluciones netas del
  costo recuperado, ads sin amarre y a mano) se dividen entre las unidades
  vendidas en esa plataforma (`cargoPorUnidad`) y cada modelo y categoría
  carga su parte. El total del canal cuadra con su corte individual. Excel
  con hoja por canal (`consolidado-excel.ts`).
- **El dinero de Amazon EXACTO sale de la Finances API por grupo de
  liquidación** (`amazon/finanzas.ts` + `finanzas-sync.ts`, tablas
  `amazon_finanzas_grupos` / `amazon_finanzas_eventos`, migración 0071, cron
  `/api/cron/amazon-finanzas` cada 10 min). Cada evento se guarda crudo y
  clasificado (principal, impuesto cobrado, comisión, FBA, IVA retenido,
  promociones, por renglón/SKU; publicidad con base e IVA; cargos de
  servicio, ajustes…) con clave = huella del JSON (releer es idempotente).
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
  final. Sonda sin escribir: `/api/amazon/diagnostico-finanzas?pedido=…`
  o `?grupo=…`.
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
| Productos nuevos: lista en `app_cache` `nuevos:productos` (cae con `invalidar()`), fotos guardadas en `nuevos:fotos` y solo se re-pregunta lo que falta (`productos-nuevos-fotos.ts`) | `src/lib/servicios/productos-nuevos.ts` + `/api/pedidos/nuevos/fotos` |
| Lógica del pedido a China explicada para el dueño | `docs/PLANIFICACION-CHINA.md` |
| Caché del plan                   | `src/lib/servicios/cache.ts` (`plan_cache`) |
| Sugerencia de compra a China     | `src/lib/servicios/compras.ts` (+ `fba.ts` para el lado Amazon) |
| Lectura de proforma de fábrica   | `src/lib/importar/proforma.ts` + `leer-hoja.ts` |
| Envíos separados por bodega      | `src/lib/servicios/envios.ts`               |
| Cargar pedidos (muchas proformas, lista con filtros) y faltantes contra el sheet de pendientes (`PEDIDOS_SHEET_URL`, pestaña por `gid`, AR* ignorados) | `src/app/pedidos/cargar` + `components/cargar-pedidos-lote.tsx` + `src/lib/servicios/pedidos-sheet.ts` |
| Packing list de la fábrica → contenedor (lector + amarre pedido/modelo/color/talla) | `src/lib/importar/packing-list.ts` + `src/lib/servicios/packing-list.ts` + `/api/contenedores/packing-list` |
| Productos nuevos en camino (pedidos sin stock nunca; fotos en MELI y Amazon, mínimo 2) | `src/lib/servicios/productos-nuevos.ts` (+ `-revisar.ts`, `-fotos.ts`) + `src/app/pedidos/nuevos` + `/api/pedidos/nuevos/fotos` |
| Packing lists desde la carpeta de Drive de la fábrica (cron diario 13:00Z + botón; una subcarpeta por contenedor; solo se entra a los embarques desde el último cargado, `numeroDeEmbarque`; el contenedor ya cargado se reconoce por NÚMERO de embarque, "S259" = "S259-2026"; facturas y pedidos de la misma carpeta se omiten; entran como contenedor `borrador` que el dueño confirma; solo calzado: lo que no amarra con un pedido se omite; un contenedor confirmado no se toca; bitácora en `drive_packing_lists`, migración 0077). SIN llave (decisión del dueño): carpeta pública leída por `embeddedfolderview` + `uc?export=download`; `GOOGLE_DRIVE_API_KEY` es opcional (API v3 con md5); `DRIVE_PACKING_FOLDER_ID` opcional | `src/lib/servicios/drive.ts` + `drive-packing.ts` + `/api/cron/packing-lists` + `/api/contenedores/drive` + `components/packing-drive.tsx` |
| Recordatorios del contenedor por correo (migración 0082, en el cron diario de packing lists): una SEMANA antes de la llegada estimada, las fotos que faltan; el día que LLEGA, aviso de que está en USA. Uno por contenedor (`aviso_previo_en`, `aviso_llegada_en`); lo ya recibido o con más de 30 días de retraso no dispara nada | `src/lib/servicios/avisos-contenedor.ts` |
| Compartir los documentos del embarque: lee la subcarpeta de Drive de ESE contenedor y abre un borrador de correo con los enlaces (un `mailto:` no lleva adjuntos) | `/api/contenedores/[id]/documentos` + botón «Compartir docs» |
| Correo con las fotos que faltan al cargar un contenedor NUEVO (a mano o desde Drive): productos nuevos de sus pedidos sin publicar o con menos de 2 fotos; Resend por HTTP (`RESEND_API_KEY`, `CORREO_REMITENTE`, `CORREO_AVISOS`); constancia en `contenedores.fotos_aviso_en` | `src/lib/servicios/fotos-contenedor.ts` + `correo.ts` |
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
