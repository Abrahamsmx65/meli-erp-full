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
  **Y el resumen de Amazon también** (`cargarAmazon` → `amazon_resumen_skus`,
  ~10,500 SKUs ordenados por venta): el plan solo veía los 1,000 que más
  venden, y lo recién mandado a FBA (GT251…GT277, sin venta todavía) salía
  con 0 pares en FBA y se le volvían a pedir sus 2 cajas.
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
  sale»). **«G.W» junto a «Total G.W» es el peso POR CAJA** (16-oct-2026,
  dueño: «estás tomando mal los datos» en el S263): se tomaba como total y
  se dividía entre las cajas (11 ÷ 30 = 0.37 kg); S263 y S267–S271 tenían
  todos los pesos así. Y cada lectura del archivo pone medida y peso en
  TODOS los renglones del contenedor (`medidasParaRenglones`, pedido +
  modelo + color laxo + talla → pedido + modelo + talla → modelo + talla;
  sin acuerdo no adivina), también en lo confirmado a mano desde los
  pendientes: los GT268–GT271 del S263 («N10127», colores en español) se
  habían quedado sin medidas. Se corrigieron por SQL los 10 contenedores
  vivos contra sus archivos de Drive. **El botón «Packing list» del contenedor descarga el formato del
  agente aduanal** (`packing-list-contenedor.ts`): LOTE PEDIDO, MODELO,
  COLOR, SKU (`IN10126-GT142-CREAM`, con talla si la caja es unitalla),
  PARES por caja, CAJAS, LARGO, ALTO, ANCHO, PESO, PRECIO = costo por par de
  Productos y costos × pares de la caja, NOMBRE (título de la publicación) y
  CODIGO FISCAL por la categoría de MELI del modelo (Botas y Botines
  53111500; alpargatas, mocasines, flats, zapatillas y demás zapatos
  53111600; Pantuflas 53111700; Sandalias y Chanclas 53111800; Tenis
  53111900). Lo que falta queda en blanco y en una hoja «Avisos»: no se
  inventa.
  **Y los dos archivos de la BODEGA** (`servicios/bodega-contenedor.ts`
  puro con pruebas, `servicios/contenedor-datos.ts`, `GET
  /api/contenedores/{id}/bodega?archivo=productos|packing`, botones
  «Bodega: productos» y «Bodega: llegada»; dueño, 14-oct-2026: «para avisar
  a la bodega que llega mercancía doy de alta los productos y luego mando un
  Excel con lo que va a llegar»): CSV calcados de S259-PRODUCTOS.csv y
  PACKING_LIST_S259.csv. **El SKU es el de MERCADO LIBRE y los dos
  barcodes la etiqueta de caja que se mandó a China** (dueño, 16-oct-2026):
  SKU = PEDIDO + el SKU de la variante de MELI sin «-MX» ni talla
  (`skuMeliDeCaja`; IN10079-GT221-LT BROWN, IN10079-GT221-BLK; con talla si
  la caja es unitalla), amarrado con `amarreDeLineas` (amarres a mano
  incluidos; `conSkusMeli` en `contenedor-datos.ts`); sin variante en MELI
  lleva el color del pedido y se avisa. Barcode = PEDIDO-MODELO-COLOR(-TALLA)
  con el color del PEDIDO (BLACK) y cada espacio convertido en GUION
  (`codigoDeCaja`; IN10079-GT221-LT-BROWN): la almacenadora no acepta
  espacios, aunque la caja de origen venga con ellos. PRODUCTOS no repite
  lo que ya viajó en un contenedor ANTERIOR con el mismo barcode (embarque
  de número menor); el packing list sí lleva todo, con el SKU de MELI. Valor reposicion = el DOBLE del
  costo por par × pares (`FACTOR_VALOR_REPOSICION`); Atributos = pares por caja; Paquete 1 = medidas del packing list
  de la fábrica en el orden de «Means» (las que faltan salen de otro
  contenedor con el mismo modelo y pares); Categoria = 32 para TODO el
  calzado y Nombre = tipo por código fiscal (PANTUFLAS, BOTAS…). Lo que falta
  va en blanco y la pantalla lo avisa.
- **FAMILIAS: modelos que se piden JUNTOS** (`modelos_familias`, migración
  0148; `pedidos-china/familias.ts` puro con pruebas,
  `servicios/familias-modelos.ts`, `POST /api/pedidos/familias`, sección
  «Modelos que se piden juntos» en Planeación de compras; dueño,
  20-oct-2026: «tengo un modelo que es el GT117 a GT122, quiero juntarlo
  todo para que se pida junto»): GT117 BROWN, GT118 BLK, GT119 OLIVE, GT120
  GREY, GT121 NAVY y GT122 BLK son el mismo zapato en seis colores (una sola
  publicación en MELI, un solo IN de Mingtai). La familia se da de alta en
  la pantalla (modelos + nombre, «GT117-GT122» por omisión); el cálculo
  sigue por modelo + color, pero `RenglonCompra.familia` hace que la tabla
  los enseñe como UN modelo (cada número es un color más) y el «Excel del
  pedido» de la familia traiga todos sus modelos; en Nuevo pedido todo lo
  pegado ya es un solo borrador (`armarBorradorFamilia`: cada renglón con
  su `modelo`, la fábrica del primero que la tenga y los demás armados con
  esa) y la familia solo le da el nombre. **Un modelo de la familia que
  NUNCA se ha pedido se arma con la historia de sus hermanos**
  (`hermanosDeModelo`, `armarBorrador(…, hermanos)`, `modelosConFamilia`
  en el servicio; dueño, 20-oct-2026: GT120 salía «nunca se ha pedido» sin
  fábrica ni precio): fábrica, moneda, precio, caja y descripción de
  GT117/GT118 y el aviso lo dice. SOLO la familia registrada respalda:
  «números hermanos no se toma a menos que sea la misma familia» (GT104-5
  no hereda de GT104-3; si se quiere, se dan de alta como familia). Al
  guardar una familia se tumba `compras-china` (hoy `v6`) y se rehace por
  atrás.
- **NUEVO PEDIDO a China desde la lista del dueño** (`/pedidos/nuevo`;
  `pedidos-china/lista.ts` lee la lista, `armar.ts` arma el borrador,
  `fabricas.ts` + `excel.ts` el Excel EN EL FORMATO DE CADA FÁBRICA,
  `servicios/pedidos-borradores.ts`, `POST /api/pedidos/borradores`,
  migración 0139; dueño, 11-oct-2026: «quiero mandarte una lista así y que
  se haga solo todo», «tú haz la fábrica y hazlo en su formato», «cada
  modelo se pide en diferente Excel siempre», «el precio es diferente con
  cada fábrica», «el último ha sido IN10183»). Se pega la lista tal cual
  («GT179 CTNS OF 12 / BROWN / 26 22…»: talla y CAJAS de una sola talla;
  corridas con «23 24 25 / 5 10 11 X 20», «23:5 24:10 X 20» o «misma
  corrida x 20»; y la HOJA del dueño pegada con tabulador, 20-oct-2026,
  GT142: «RED 20 CTNS ⇥ ASSORTMENT» en UNA línea abre el surtido de 20
  cajas y los «talla ⇥ pares» de abajo son la corrida de la caja,
  «BLK ⇥ SOLID SIZE CTNS OF 48» es color + caja de una talla —«solid
  size» se quita, `RE_SOLID_SIZE`; «CTNS 48» sin OF también vale— y los
  «talla ⇥ cajas» de abajo son cajas por talla; y **«LT BROWN NEW COLOR»
  es un COLOR NUEVO** (`RE_COLOR_NUEVO`, `ColorLista.nuevo`,
  `LineaBorrador.colorNuevo`; GT128, 20-oct-2026: «voy a aumentar colores
  nuevos, llevan mismo precio pero no están en sistema»): toma el precio
  de los demás colores del modelo (misma talla, de esa fábrica), el Excel
  lo marca «(NEW COLOR)» en la descripción (`descripcionDeRenglon`; la
  marca viaja a `pedido_lineas.descripcion` y `armarBorrador` la quita al
  heredar la descripción), la pantalla y el correo dicen «NUEVO» y el
  aviso del borrador trae el SKU con que crearlo en MELI por talla
  (`skuMeliDeColorNuevo`: GT128-LT BROWN-23-MX); creado en MELI y
  sincronizado, las etiquetas del pedido salen solas; y **«SOLID SIZE 48»
  a secas son los pares por caja** y **«GT104 ⇥ 5-GREEN» es el modelo
  GT104-5 color GREEN** (`partirModeloColor`; GT104, 20-oct-2026: salía
  «nunca se ha pedido» y «falta cuántos pares trae la caja»): el pedido y
  el packing list escriben GT104-5 + GREEN y MELI lo parte como GT104 +
  «5-GREEN», así que se normaliza al escribir el modelo sin número y el
  color con él) y sale UN BORRADOR con TODO lo pegado y su IN consecutivo
  (`siguienteIn`: el mayor entre pedidos, borradores vivos y
  `pedidos_ajustes.ultimo_in`). Hasta el 20-oct-2026 salía un borrador por
  modelo; ese día el dueño pegó GT180 y GT181 juntos («cuando pego un texto
  junto es porque es un solo pedido y el sistema me lo generó en dos»): lo
  que se pega junto es UN pedido (`nombreDeBorrador`: el nombre de la
  familia si todos son de una, si no los modelos con coma; cada renglón
  lleva su `modelo`), para dos pedidos se pega dos veces, y el IN se
  CORRIGE a mano en el borrador (`actualizarBorrador({ pedido })`: forma
  IN + número, ni cargado en Órdenes de compra ni en otro borrador vivo).
  El campo de precio guarda lo TECLEADO mientras se escribe (`tecleado` en
  `nuevo-pedido.tsx`): antes el punto decimal desaparecía al teclearlo. Lo que la lista no dice sale del último
  pedido del modelo: fábrica (cada modelo siempre ha sido de una), moneda,
  descripción, el color como lo escribe la fábrica (BLK → BLACK), pares por
  caja, la corrida «misma» y el PRECIO por color y talla SOLO de pedidos a
  ESA fábrica (cambiar de fábrica en el borrador lo vuelve a armar sin
  precios); medidas de la caja del packing list de un contenedor anterior
  con los mismos pares. **Fábrica, moneda y precio NO son obligatorios**
  (dueño, 20-oct-2026: «si un producto no tiene fábrica, etc., solo mándame
  un Excel sencillo»): sin fábrica el pedido sale en el formato sencillo
  (`SIN_FABRICA`, encabezado «PURCHASE ORDER») y lo que no tiene precio va
  en blanco; `faltantesDeBorrador` solo exige renglones, cajas y pares por
  caja. Mientras es borrador NO cuenta para nada. Confirmar = `guardarProforma`
  con `origen = 'sistema'` (cuenta como en camino, da de alta corridas:
  **también las cajas de UNA talla**, una corrida por color y talla con el
  MISMO pedido y la talla pegada al color: `IN10121 · GT114 · TABACO
  BROWN-25 · { "25": 24 }`, calcada del sheet de corridas
  (`corridasDeProforma`; dueño, 20-oct-2026: «los que son de una talla igual
  crea corrida y toma cada caja color por separado», «así se suben: IN10121
  GT114 TABACO BROWN-25, no cada talla como otro pedido»; la primera versión
  las guardó como `IN10172-24` y se corrigieron por SQL; hasta ese día
  quedaban fuera; el sheet viejo las traía de TRES formas —«IN10057-24 ·
  GT114 · BLK», «IN10121 · GT114-23 · BEIGE» (que se leía como OTRO modelo)
  y «TABACO BROWN-25»— y `normalizarCorridaUnitalla` en `importarCorridas`
  las deja todas en color-talla al leer el sheet (las guardadas se
  convirtieron por SQL el 20-oct-2026; el sheet se ACUMULA, no borra); la
  pantalla de Corridas cuelga la caja de una talla de la bodega de su
  corrida color-talla; `numeroDePedido` toma el PRIMER número) y
  correo a `pedidos_ajustes.destinatarios` **EN INGLÉS** (`correoDeBorrador`;
  dueño, 20-oct-2026: «que los correos se hagan en inglés»: lo leen la
  fábrica y el agente; «Purchase order IN10187 · GT142 · …», Cartons /
  Pairs / Amount, NEW COLOR) con el Excel y **el ZIP de
  etiquetas del pedido** (`zipEtiquetasDePedido` en
  `servicios/etiquetas-pedido.ts`, el mismo de Órdenes de compra: PDF de
  2 etiquetas por talla, BOX LABEL y Excel de códigos; dueño, 20-oct-2026:
  «en el correo también se me comparta el PDF de etiquetas»). Un producto
  nuevo aún no tiene código Full ni FNSKU: esas variantes van en
  FALTANTES.txt. Si el ZIP no se arma el correo sale con el Excel y el motivo
  queda en `correo.etiquetas` (se edita en la pantalla; un correo que no
  sale no deshace el pedido, se reenvía). Formatos copiados de proformas reales: CHAOZHOU (USD, un
  renglón por color con las cajas de cada talla), JINJIANG (RMB, cajas bajo
  la talla, precio por talla en fila de continuación), MINGTAI (RMB),
  JIAXING INNOVATIVE (USD), FUZHOU (USD, «US$»), HUAIAN TENGCHUANG (USD) y
  el sencillo para las demás; sin datos bancarios. **Lo generado lo vuelve a
  leer `importarProforma` igual** (`excel.test.ts`, todos los formatos): la
  proforma FIRMADA que regresa la fábrica con ese IN se sube en Órdenes de
  compra y REEMPLAZA los renglones del pedido del sistema mientras nada
  esté en un contenedor.
  **El lector de proformas ahora lee la MONEDA** (`monedaDeProforma`, del
  encabezado del precio, las celdas o su formato «US$»; `formatosDeHoja`),
  el **precio por talla** de una fila de continuación (`preciosTalla`,
  `pedido_lineas.precios_talla`), el **CBM por caja** (`cbmCaja`,
  `pedido_lineas.cbm_caja`) y **hereda el precio** del modelo a los colores
  sin precio (FUZHOU lo pone solo en el primero: el IN10163 decía $1,483 y
  eran $11,618). Hasta el 11-oct-2026 todo se guardaba como RMB; la 0139
  corrigió la moneda por fábrica verificada (USD: Chaozhou, Jiaxing
  Innovative, Fuzhou, Tengchuang, Baike; RMB: Jinjiang, Mingtai; las demás
  quedan sin moneda hasta volver a subir su proforma) y rehízo el importe
  solo de los pedidos sin importe o con precio heredado (el de JINJIANG y
  MINGTAI ya era el bueno: cobran más las tallas grandes).
  **PENDIENTES POR ENVIAR** (`/pedidos/pendientes`,
  `servicios/pedidos-pendientes.ts`): por pedido vivo, las cajas que aún no
  están en NINGÚN contenedor (un packing list ya las metió aunque el
  contenedor siga en borrador), el dinero de eso en la moneda de la fábrica
  (USD y RMB nunca se suman; escalado al importe de la proforma) y los CBM
  (caja de la proforma o medidas del mismo modelo + pares en un packing
  list; lo que no tiene medida se cuenta aparte), por fábrica y en total
  con ≈ contenedores de 68 m³. Un pedido sale de ahí cuando todo está en
  contenedores.
  **El BL de la misma carpeta de Drive es el NÚMERO DE CONTROL del
  contenedor** (`importar/bl.ts` puro con pruebas, `importar/texto-pdf.ts`
  con `unpdf`, `leerBlsDeContenedores` en `drive-packing.ts`, columnas
  `contenedores.cajas_bl` / `bl_archivo` / `bl_leido_en`, migración 0135;
  idea del dueño, 11-oct-2026: «sería inteligente siempre confirmar contra el
  BL; ahí dice cantidad de cajas y está en el mismo Drive que el PL»): cada
  BL vivo (HBL de YQN, copia del master de HMM, telex, draft de Hapag) trae
  «CONTENEDOR/SELLO/611/CARTON…» y «TOTAL SIX HUNDRED ELEVEN(611) CARTON
  ONLY»; manda la línea del contenedor y el total solo si el BL no nombra
  otro. Se lee una vez por contenedor vivo (sin BL se reintenta al día;
  «Releer todo» lo vuelve a leer) y la columna Cajas de Contenedores dice
  «✓ BL 611» o, en rojo, «BL 611 · faltan 212 · 90 por confirmar». Ese día
  los 18 BL de S258–S271 se leyeron bien y casi todos los borradores
  estaban cortos: (1) la fila de TOTAL sin letrero o con «合计» se contaba
  como un renglón más y el contenedor salía al DOBLE (S267: 1,060 contra 530;
  S271: 1,426 contra 713) — ahora una fila con cajas y sin pedido, modelo,
  color, talla ni pares por caja es total y no se cuenta; (2) la fábrica
  empezó a anotar el color en español («BLK (NEGRO)», «DK.BROWN (MARRON
  OSCURO)», «COGNAC   coñac») y no amarraba con «BLK» del pedido — el
  casado prueba después del aplastado el color LAXO (`claveColorLaxa`: sin
  paréntesis, BLACK = BLK, sin punto, repetidos colapsados), y sin pedido en
  el archivo también rescata el dedazo a una letra (COGNAC / CONGNAC);
  (3) una caja de corrida contra un pedido que ese color lo tiene POR TALLA
  («Solid size») se reparte SOLO si sus cajas son exactamente las que les
  faltan a esas tallas (`repartoExactoPorTalla`; S269 GT134 BLK 41 + 51 = 92
  del IN10159); si no cuadra queda pendiente diciendo cuánto falta, nunca se
  adivina; (4) el pedido arrastrado de la fila de arriba que no tiene ese
  modelo (GT148G debajo de IN10079 en S265) se busca en los demás pedidos
  vivos; (5) los packing lists sin la referencia adentro (S263, S268, S270,
  S271) toman la de la subcarpeta (`referenciaDeNombre`) y el contenedor que
  quedó bautizado con el ISO se encuentra por el ISO y se RENOMBRA
  (`elegirContenedor`); dos packing lists con la misma referencia caen en
  el mismo contenedor (S261 trae dos archivos idénticos que solo cambian el
  ISO y su BL dice 542 para uno). «Releer todo» vuelve a armar los
  BORRADORES aunque su embarque sea anterior al último cargado, SALVO el que
  ya tiene cajas confirmadas a mano en Contenido (sus cajas ya no son las
  que entraron desde Drive; S263 tenía 232): ese no se rearma y se dice. Pero SÍ
  se le AGREGAN los renglones del pedido que el contenedor aún no tiene
  (`aplicarPackingList({ soloNuevas })`: no cambia cantidades ni quita nada,
  y de los pendientes solo quedan los que ya estaban pendientes). **Una
  talla «39 (26)» es la MEXICANA del paréntesis** (`tallaDeCelda`; S263,
  11-oct-2026): sin columna de pares por talla, la caja es unitalla de esa
  talla con sus pares por caja; antes los 198 cartones de GT114 de pedido
  por talla salían juntos sin talla y no amarraban. Un rango «36-41
  (23-27)» sigue siendo corrida.
  **Lo que NO es calzado viaja con el contenedor como «otros artículos»**
  (`esInsumo`, estado `insumo` del casado, `contenedores.otros`, migración
  0142; dueño, 11-oct-2026: «tengo en el S268 bolsas de plástico para
  empaque; que salga en el contenido pero no es algo para pedir»): Polybag,
  bolsas, cajas, etiquetas, cinta… no se amarran con pedidos, no son
  pendientes, no cuentan como inventario ni en camino; se enseñan en «Qué
  viene» y en Contenido («+ 35 otros») y SÍ cuentan contra el BL (S268:
  622 de calzado + 35 de bolsas = 657 del BL).
  **BORRAR un contenedor es para volver a armarlo desde Drive**
  (`ESTADO_RELEER`; 13-oct-2026: el dueño corrigió el S265 en Drive, lo
  borró junto con el S271 y «Traer de Drive» ya no los traía): el borrado
  deja sus archivos en `drive_packing_lists.estado = 'releer'`, la siguiente
  pasada los lee aunque no hayan cambiado y su embarque entra aunque sea
  anterior al último cargado. Un borrador corregido a mano NO toma los
  cambios del archivo (solo agrega renglones nuevos); para que los tome hay
  que borrarlo y traerlo de Drive.
  **Las PROFORMAS de los pedidos viajan en la misma carpeta y NO son
  packing list** (`esArchivoAjeno`: lo que se llama por su pedido
  «IN10148 (GT114).xls», «AR10137 …», pagos y bolsas; la referencia de la
  carpeta solo se toma si el archivo se llama packing o trae el ISO del
  contenedor): el mismo 11-oct-2026, el primer «Releer todo» con la
  referencia de la carpeta cargó las proformas como packing lists, duplicó
  S263, S268 y S271 (contenedores nuevos armados con la proforma; los
  correos de «0 productos nuevos» salieron de ahí) y le sumó renglones a
  S266, S267 y S269. Ahora `elegirContenedor` busca PRIMERO por el ISO (un
  duplicado con la misma S no se lleva el packing list) y rearmar un
  borrador desde Drive QUITA los renglones que el archivo ya no trae
  (`aplicarPackingList({ reemplazar })`; asignar solo agrega o actualiza).
  Se limpió por SQL: los duplicados quedaron en cero cajas y renombrados
  «DUPLICADO S26x-2026» para borrarlos con el botón «Borrar» (solo
  borradores, `DELETE /api/contenedores?id=`; el MCP de Supabase se cuelga
  con DELETE, igual que con DROP, y también con UPDATE sin WHERE o con
  varias sentencias juntas), los reales tomaron su referencia, los cuatro
  renglones de más se pusieron en cero y se recalcularon los estados de los
  pedidos.
  Simulado con la base real ese día: S261, S267, S269 y S270 quedan
  completos contra su BL, S260 521 de 611 (los 90 de M BROWN contra el LT
  BROWN del pedido siguen siendo decisión del dueño), S265 418 de 612, S268
  622 de 657 (35 son bolsas), S271 572 de 713 (GT135 por talla sin cuadrar).
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
  (verificado con GT134). **Los modelos con guion se parten mal en MELI y Amazon**
  (`numeroAlFrenteDelColor`; S267, 11-oct-2026): «GT104-1-BLK-25-MX» queda
  como modelo «GT104» + color «1-BLK», y el pedido y el packing list dicen
  «GT104-1» + «BLK». `indexarCatalogo` y `armarMapaFotos` registran también
  esa segunda lectura: sin ella el GT104-1…6 salía «modelo nuevo» (sin
  ligar a MELI, sin «Recordar» en Contenido) y sin foto en Contenedores.
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
- **Una caja que la bodega capturó con el SKU REVUELTO cuenta igual**
  (`rescatarFilaMalCapturada` en `importar/cajas.ts`, puro con pruebas; se
  aplica al leer el API de Industher, en `construirCajas` y en la pantalla
  de Corridas; dueño, 21-oct-2026: «en cualquier manera lo capte para tomar
  en cuenta como inventario»): Industher dio de alta 24 cajas de GT114 BLK
  del IN10057 como «IN10057-24-GT114-BLK» (modelo «IN10057», color
  «24-GT114-BLK», sin talla, 1 par por caja) y no contaban. Si el modelo
  es un PEDIDO (IN/AR/RT/S###) pasa a pedido y el color se parte en
  «talla-modelo-color» o «modelo-color»; si el color empieza con una talla
  («24-BLK») y la caja no trae talla, la talla sale del color. Un renglón
  normal no se toca. Y una caja de una talla con 0 o 1 «pares por caja»
  toma los pares de su corrida con la talla pegada al color (IN10057 ·
  GT114 · BLK-24 · {24: 24}).
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
  también. **Y solo se detiene si Industher ya NO TIENE el SKU** (19-oct-2026,
  dueño: «yo los quité de stock para que no se vendan […] que cuando
  quitamos, aunque esté en el kardex, se den de baja»): el GT148-M BROWN-26
  seguía en la foto con 9 pares físicos y los 9 APARTADOS por la bodega
  (disponible 0), el ERP solo lee lo disponible, la baja se detuvo y 6
  pedidos (8 pares) se quedaron «en duda» fuera del corte #81. Lo
  que Industher tiene apartado por su cuenta (`apartadasBodega`, más allá de
  las salidas pendientes) no se va a despachar: es baja a propósito, se
  escribe como merma «Apartado en Industher: N pares reservados…» y la
  defensa del corte cancela lo que ya no alcanza (`StockFisico.apartadoBodega`,
  `apartadoBodegaDeSku`, `EstanteTikTok.apartadas`; `stockEnDuda` ya no lo
  marca). Si Industher lo vuelve a soltar, entra otra vez.
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
  Y si tras perder la conexión el servidor contesta «No hay pedidos…», el
  corte YA se hizo: se da por terminado y se recarga la lista, no se pinta
  en rojo (19-oct-2026: el corte #79 «solo GT114» guardó sus 1,457 pedidos
  y el reintento de Safari enseñaba «No hay pedidos por despachar que sean
  solo de GT114»).
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
  **VENDEDORES EXTERNOS en la misma tienda: lo de DAVID** (`tiktok/externos.ts`
  motor puro con pruebas, `servicios/tiktok-externos.ts`, `/tiktok/externos`
  «Productos de David», `POST /api/tiktok/externos`, tabla
  `tiktok_productos_externos` y `tiktok_cortes.vendedor`, migración 0133;
  pedido del dueño, 11-oct-2026: «david, que vende en Shein, quiere subir sus
  productos pero él los despacha desde otra bodega; que pueda subir su stock
  y tenga una pestaña de cortes para él; sus pedidos no los metas a mi
  ganancia y no me importan sus costos; si un cliente compra un producto de
  nosotros dos juntos, que salga en su corte, no en el mío»): una
  PUBLICACIÓN de TikTok (product_id) se liga a un vendedor (`ligarPublicacion`;
  a sus SKUs sin amarre se les pone su `seller_sku` como nombre del kardex,
  `origen_amarre = externo`, y el catálogo de TikTok es memoria del amarre,
  así el nombre se queda) y con ella todos sus SKUs (`skusExternos`: sku →
  vendedor, caché de 20 s). Esos SKUs viven en el MISMO kardex (TikTok
  recibe el disponible por el mismo camino, `saldo − apartado`), pero: su
  stock lo captura David a mano (`guardarStockExterno`: `ajuste` con
  referencia `externo:david:<fecha>` y publicación pasando por
  `sincronizarTikTok` con `soloPedidos`, regla de oro); Industher no los
  tiene, así que la conciliación los salta (`sincronizarSaldoDesdeBodega`
  filtra movimientos y foto), el estante contesta «sin dato»
  (`EstanteTikTok.sinEstante`, `estanteDeSku`: ni tope al publicar, ni
  defensa por estante, ni alarma, ni Cuadre de inventario), y al 3PL no se
  le mandan sus salidas. **Un pedido con ALGÚN par de David es de David**
  (`vendedorDePedido`, `partirPorVendedor`): `pendientesDeCorte(db, cuenta,
  vendedor)` reparte (null = el dueño, 'david' = los suyos, el mixto con
  él), `hacerCorte({ vendedor })` lo guarda en `tiktok_cortes.vendedor` y la
  unión al corte de hoy exige el MISMO vendedor (`corteDeHoyQueContinua`);
  `/tiktok/despacho?vendedor=david` es su despacho (mismos botones, mismas
  etiquetas y lista) y arriba un enlace cruza entre los dos con los
  pendientes del otro. **Su venta no es del dueño** (`sinVentasExternas`):
  Ventas TikTok (`calcularVentasTikTok`), el corte general y el resumen
  diario (`cargarVentasTikTok`) quitan sus renglones y en un pedido mixto
  recortan lo que TikTok paga (neto, por liquidar, afiliado, desglose) a la
  parte de los pares del dueño POR PRECIO (sin precios, por pares); un
  pedido solo suyo desaparece. Compras a China, Reabasto de almacén, el
  Inventario TikTok y el Excel por modelo no lo cuentan, y la tienda en
  línea y el catálogo de creadores no copian sus publicaciones. Los
  vendedores viven en `VENDEDORES_EXTERNOS` (hoy solo `david`); la pantalla
  es de él y el rol de TikTok la abre; en el menú del DUEÑO no sale
  (`FUERA_DEL_MENU_DEL_DUENO` en `acceso/roles.ts`; dueño, 15-oct-2026:
  «quita los productos de David, no me interesa verlos»), la ruta sigue
  abierta. En un pedido mixto el par del dueño
  sale del kardex y SÍ se le manda a Industher como salida (es el mismo
  camino de siempre): quién se lo lleva a David es un acuerdo entre ellos.
  **Los SKU de David llevan el prefijo «D-» y ESE es su nombre en el
  kardex** (`amarreDeExterno` en `tiktok/externos.ts`, en el paso 1 de
  `sincronizarTikTok`; origen `externo`; acuerdo del dueño con David,
  16-oct-2026: «todo lo de él en los SKUs le está poniendo una D antes para
  diferenciar»): un SKU de una publicación ligada que no amarra con nada del
  ERP toma su `seller_sku` tal cual. Hasta ese día solo `ligarPublicacion`
  bautizaba los SKU sin amarre, y la sincronización del catálogo volvía a
  escribir `sku_interno = null` en cuanto David renombraba una variante
  («D-GT074-BLK-24-MX» no es un SKU de calzado para `pareceSkuDeCalzado`):
  el stock que capturó el 15-oct (D-GT074 y D-GT105, 20 SKU) nunca llegó a
  TikTok y la pantalla decía «178 SKU todavía no tienen stock capturado». Se
  rebautizaron 81 renglones por SQL. Lo que sí amarra (GT146-BLK-23-MX, mismo
  nombre que en MELI) se queda con ese nombre: David y el dueño comparten el
  renglón del kardex si usan el mismo SKU, por eso la «D».
  **LOTES: muchos paquetes iguales de UN par** (`tiktok/lotes.ts` motor puro
  con pruebas: `detectarLotes`, `PAQUETES_POR_LOTE_MIN` 10, `loteDeCodigo`,
  `avanceDeLote`; `itemsConLotes` en `tiktok/empaque.ts`; `dibujarLote` en
  `empaque-pdf.ts`; `separadorDeLote` en `pdfEtiquetasDelCorte`; modo lote
  en `tiktok/preparar.ts` (`paso: "lote"`, `EstadoEscaneo.lote`,
  `salirDeLote`, `trasGuardar`); pedido del dueño, 8-oct-2026: «cuando hay
  que mandar muchos productos de 1 unidad del mismo SKU, que sea más fácil
  y manejable»): como el corte ya va modelo → color → talla, los paquetes
  de un par del mismo SKU salen SEGUIDOS; desde 10 seguidos forman un LOTE
  (un cancelado corta la corrida). La lista de empaque los enseña como UN
  recuadro («LOTE · GT148-BLK-24-MX · 68 paquetes de 1 par · #120–#187 ·
  toma 68 cajas y las guías #120 a #187, cualquier guía va en cualquier
  caja») y el surtido de la hoja cuenta sus pares; en el PDF de etiquetas
  va una HOJA SEPARADORA delante de las guías del lote (y «continúa» si el
  lote empezó en el tomo anterior) para que la pila salga partida. En la
  estación, escanear el PRODUCTO de un lote con paquetes por preparar abre
  el MODO LOTE (dos pitidos): la caja se escanea UNA vez y de ahí cada guía
  (código del pedido o de hoja) queda preparada en el acto con constancia
  `LOTE:<sku>` + el código; una guía de otro producto se rechaza, un
  producto de otro lote cambia de lote, un producto sin lote cierra el modo
  y sigue normal, y «Salir del lote» lo cierra a mano. Al guardar, el lote
  sigue abierto (`trasGuardar`); con el lote completo el producto ya no lo
  abre. Decisiones tomadas por omisión (el dueño dijo «sí, mándalo» sin
  elegir): lote desde 10 y sin volver a pedir la caja cada N guías.
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
  **RETIRAR del almacén de TikTok** (`tiktok/retiro.ts` puro con pruebas:
  `planRetiro`, `referenciaDeRetiro` = `RETIRO-<fecha>`; `servicios/
  tiktok-retiro.ts`, `POST /api/tiktok/retiro`, casillas y botón «Retirar
  del almacén» en la tabla del Almacén TikTok, SOLO para el dueño; dueño,
  20-oct-2026: «una opción de poder quitar inventario en TikTok: elijo algún
  SKU y se pone en 0 en TikTok, en mi kardex y en Industher»): por SKU se
  retira lo DISPONIBLE (saldo menos apartado de TikTok y de la tienda) como
  SALIDA del kardex con esa referencia; lo APARTADO en pedidos pagados se
  queda (quitarlo haría que la defensa cancelara esos pedidos). A Industher
  se le manda por el MISMO endpoint de salidas de los cortes
  (`tiktok_salidas_3pl` sin corte, pedido = la referencia `RETIRO-…`,
  `empujarSalidasAl3pl`): si falla queda pendiente y el cron lo reintenta,
  y mientras la conciliación la cuenta como salida pendiente. A TikTok se le
  publica el cero pasando por `sincronizarTikTok` con `soloPedidos` (regla
  de oro). Lo de David no se retira por aquí. Un SKU sin disponible no
  cambia y se declara. Para que el par vuelva, una entrada o un conteo.
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
  publicación activa» los lista. Ese día eran 48 SKU. **Y la pantalla lo
  AVISA arriba, con la lista** (`RenglonTikTok.tienePublicacion`,
  `ListaSkusSinPublicacion` en `app/tiktok/page.tsx`; dueño, 15-oct-2026:
  «si tengo stock que no está ligado a ninguna publicación, que me salga un
  aviso y cuáles son»): UN aviso en ámbar con los SKU con stock SIN NINGUNA
  publicación y sus pares (hasta 40 y «y N más»). Lo apagado o en borrador
  NO se avisa (el dueño no lo quiso ver; la casilla de la tabla sigue). Ese
  día: 0 sin ninguna publicación y 47 apagadas con 3,784 pares.
  **ALMACÉN TIKTOK POR FAMILIA** (pestaña «Por familia» de `/tiktok`;
  `tiktok/familias.ts` puro con pruebas: `armarFamiliasTikTok`,
  `compararFamiliasTikTok`, `filtrarFamiliasTikTok`; `components/familias-tiktok.tsx`;
  `PanelTikTok.ventasPorSku` / `ventasDesde`, `cargarPanelTikTok` lee TODA
  `tiktok_ventas_diarias` y recorta los 30 días; dueño, 20-oct-2026: «quiero
  uno [por familia] que esté en la sección de inventario TikTok aparte»): un
  renglón por MODELO con SKU, en almacén, apartado, disponible, lo disponible
  SIN publicación activa («Sin línea»), vendidos en 30 días y desde que el ERP
  registra TikTok (1-sep-2026) y «Alcanza» = disponible ÷ ritmo de 30 días;
  abrir el renglón lo parte por color (`colorDeSku`). Sin lo de David; una
  familia agotada con historia sí sale (casilla «Solo con stock»).
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
  **DEVOLUCIONES** (`tiktok/devoluciones.ts` motor puro con pruebas,
  `servicios/tiktok-devoluciones.ts`, `/tiktok/devoluciones`,
  `POST /api/tiktok/devoluciones`, tabla `tiktok_devoluciones`, migración
  0129; pedido del dueño, 9-oct-2026: «cuando recibo una devolución la
  pueda buscar fácil, confirmar de recibido para que reembolsen al cliente
  y poner si se suma de nuevo al stock o se tira a la basura»): TikTok
  lleva las devoluciones en SU API (`/return_refund/202309/returns/search`;
  ruta y forma del SDK de npm), aparte de los pedidos: el renglón del
  pedido NO cambia a RETURNED (en un mes de ventas no hubo uno), así que
  hasta ese día el ERP no sabía de ninguna. El cron de TikTok (cada 15 min,
  `sincronizarDevoluciones`, bitácora tarea `devoluciones`) baja las
  creadas en los últimos 60 días (la primera vez desde el 1-sep-2026,
  `DEVOLUCIONES_DESDE`) y las guarda masticadas: pedido, SKU del ERP por
  renglón (amarrado por `order_line_item_id` contra `tiktok_orden_items`),
  guía de regreso y paquetería, motivo, reembolso, estado y qué le toca al
  vendedor con su plazo. La pantalla busca por la guía escaneada, el pedido
  o el SKU (`coincideBusqueda`, sin guiones ni espacios, mínimo 4
  caracteres) y agrupa (`grupoDeDevolucion`): POR RECIBIR (el cliente ya
  la mandó, `BUYER_SHIPPED_ITEM` o acción `SELLER_RESPOND_RECEIVE_PACKAGE`),
  en espera del cliente, pendientes de TikTok, recibidas y cerradas (un
  `REFUND` sin paquete nunca es una devolución recibida). **Confirmar
  recibido** (`confirmarDevolucionRecibida`) le manda a TikTok
  `APPROVE_RECEIVED_PACKAGE` —con eso TikTok reembolsa— y SOLO si TikTok
  acepta mueve el kardex (`movimientosDeDecision`): por par, «vuelve al
  stock» = DEVOLUCIÓN del SKU, «se tira» = devolución + MERMA del mismo par
  (constancia sin subir el saldo); la referencia es el PEDIDO, igual que la
  devolución automática del sync, así el índice único nunca cuenta dos
  veces. Los paquetes llegan a Industher (decisión del dueño: «directo,
  disponible para enviar»), así que su foto cuenta el par y el kardex
  cuadra; lo que vuelve se publica en el acto pasando por `sincronizarTikTok`
  con `soloPedidos` (regla de oro). Un par sin SKU del ERP no se confirma
  hasta amarrarlo. Pendientes grita las «por recibir» y las que vencen en
  48 h. Fuera de esta versión: rechazar el paquete ante TikTok, aprobar la
  solicitud inicial y reembolsos parciales. La migración se aplicó POR
  PARTES con `execute_sql` (el `apply_migration` del MCP se colgaba con
  más de una sentencia DDL ese día).
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
  **La VENTA de TikTok es lo que TikTok cuenta como INGRESO, no lo que pagó
  el cliente** (`ventaDeOrden`, `deDesglose` en `tiktok/ventas.ts`;
  migración 0135; dueño, 11-oct-2026: «según yo pagamos 6 % de comisión,
  8 % de envío y $6 de costo fijo, afiliados ~10 % e impuestos ~10 %; la
  suma debería ser casi 40 %»): `revenue_amount` de sus transacciones
  (precio menos el descuento del vendedor) incluye el descuento que TikTok
  pone de su bolsa y luego paga; septiembre 2026 liquidado: el cliente pagó
  $1,276,208 y el ingreso fue $1,357,487. Medida contra lo pagado, la barra
  de «plataforma» del corte general salía en 27 %; contra el ingreso, los
  cargos son ~30 % (33.7 % desde que TikTok MX cobra su 6 %, semana del
  28-sep). Misma regla que la reventa de MELI al precio público. Sin número
  de TikTok todavía, la venta es precio × cantidad. Lo obedecen el resumen
  por modelo (`cobrado` = venta; `pagadoCliente` aparte), las ventas
  diarias, el origen (creadores/tienda), Ventas TikTok («Venta»), el corte
  general, el correo y `ventas_por_hora` (gráficas e Inicio). **Los cargos
  van desglosados** (`pago_desglose.servicio` = `sfp_service_fee` 8 %,
  `porPar` $6, `comisionTikTok` el %, `anuncios`; `tiktok_desglose_fino`
  los sacó del crudo para lo ya guardado) y **los anuncios GMV Max que
  TikTok cobra dentro del pedido son PUBLICIDAD del modelo**, no plataforma
  (el neto los suma de vuelta y `ads` los resta: la utilidad no cambia). Lo
  POR LIQUIDAR no separa el cargo por par ni las retenciones: quedan en
  «reembolsos y cargos sin desglose». Septiembre: servicio $110,065, por
  par $58,140, comisión $27,987, afiliados $69,194, IVA $93,626, ISR
  $29,262, GMV Max $20,118. `versionContable` 9, `tiktok:ventas:v2`,
  `ventas-tiempo:v2`.
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
  **OFERTAS RELÁMPAGO desde el panel** (`tiktok/promociones.ts` puro con
  pruebas, `servicios/tiktok-promociones.ts`, `/tiktok/promociones`
  «Ofertas relámpago» en el menú, `POST /api/tiktok/promociones`, tabla
  `tiktok_promociones` migración 0144; rutas de promociones en
  `tiktok/api.ts` y el cliente acepta `DELETE`; pedido del dueño,
  15-oct-2026: «crear relámpagos en TikTok más rápido […] los relámpagos
  generales de los que duran cada 3 días, todo desde mi panel»). Lo que el
  API de promociones (`/promotion/202309/activities`, forma del SDK de
  npm) SÍ da: crear la actividad (`FLASHSALE`, `product_level VARIATION`,
  inicio y fin en segundos UNIX, inicio futuro, título único ≤ 50), meterle
  productos (`PUT …/products`, ≤ 300 variantes por llamada; por variante
  `activity_price_amount`, `quantity_limit` y `quantity_per_user` de 1 a 99
  o −1 sin tope), buscar por UN estado a la vez (`page_size` y
  `page_token` van en el CUERPO: en la URL TikTok contesta 36009004 «param
  page_size type invalid», visto el primer día en producción; y solo
  NOT_START, ONGOING, EXPIRED y DEACTIVATED: con DRAFT contesta 17029001
  «Invalid Parameter», así que los borradores no se leen), desactivar
  y quitar (`DELETE …/products`). Lo que NO da y sigue en el Seller Center: la
  relámpago de LIVE, las «existencias reservadas para el creador» y la
  inscripción a campañas de la plataforma. La pantalla: pestaña Ofertas
  (lo que TikTok tiene, masticado 2 min en `app_cache` `tiktok:promociones`,
  con Desactivar y Repetir, más la constancia local) y Nueva relámpago
  (nivel live / normal / campaña de Estrategia de precios por
  `preciosTikTokPorModelo`, inicio en 15 min por omisión y 72 h, topes,
  modelos ACTIVOS en TikTok —`productosParaOferta`: el producto activo con
  más variantes de cada modelo— con el precio sugerido editable). Al crear
  se guarda la constancia con lo que contestó TikTok (`creada`, `parcial`
  si rechazó algún lote, `sin_productos`, `error`); un solo clic a la vez
  (candado `tiktok-promocion`). Recordar: TikTok reserva para la
  promoción el stock de cada talla y no deja bajar el inventario abajo de
  eso (`minimum allowed open stock`, visto el 11-oct-2026 con el GT148).
  **CÍCLICOS: un modelo que NUNCA se queda sin relámpago** (pestaña
  «Cíclicos»; `tiktok_promociones_ciclicas` y `tiktok_promociones.ciclico_id`,
  migración 0146; motor puro `ventanasQueFaltan`, `horasDeCiclica`,
  `tituloDeCiclica`, `HORAS_MAX_CICLICA` 72, `VENTANAS_ADELANTE` 3;
  servicio `guardarCiclica` / `quitarCiclica` / `programarCiclicas` /
  `ciclicasGuardadas`; acciones `ciclica-guardar`, `ciclica-quitar`,
  `ciclica-programar` en `POST /api/tiktok/promociones`; cron
  `/api/cron/tiktok-ciclicos` cada hora; dueño, 15-oct-2026: «en cíclicos
  yo pongo un producto, cuál es el precio y el sistema se encarga de que
  siempre va a estar con relámpagos programadas; se pueden adelantar muchas
  y cada una dura máximo 72 horas»): por modelo, precio, horas (≤ 72) y
  topes; el fondo mantiene SIEMPRE UNA ventana viva o programada por
  modelo, una actividad FLASHSALE por ventana («Cíclica GT148 15/10 20:30»):
  cuando la que corre termina, la siguiente arranca 2 MINUTOS después
  (`MINUTOS_ARRANQUE_CICLICA`; dueño, 19-oct-2026: «en el tiempo más
  temprano posible cuando se vence la última, y el espacio entre una y otra
  de 2 minutos»): el cron corre CADA MINUTO con una revisión barata (dos
  lecturas; si todas tienen ventana propia viva y lejos de terminar no hace
  más), y cuando la viva de un modelo termina dentro de `MARGEN_ESPERA_MS`
  (75 s) ESPERA a que termine (`finDeLaViva`, más 5 s de respiro) y crea
  la siguiente pegada; si TikTok rechazara un inicio tan cercano
  (`esErrorDeInicio`) reintenta con los 15 min de siempre. Verificado en
  vivo el 19-oct-2026 a las 19:06 México: GT114, GT125, GT130, GT134,
  GT142 y GT150 arrancaron a las 19:08. La corrida lleva candado
  (`tiktok-ciclicos`, 300 s): la del minuto siguiente se encimaba con la
  que estaba esperando y dejaba «Ya se está creando una oferta» como
  aviso; ese mensaje ya no se anota y un aviso viejo se borra en cuanto
  la cíclica tiene su ventana viva. Una que ya terminó no cuenta.
  **TikTok NO deja adelantar** (19-oct-2026, dueño: «me salió esto en la
  cíclica de GT135 pero no hay ninguna»): un producto solo puede estar en
  UNA actividad ONGOING o NOT_START (17029022 «Resource Conflict»), así que
  la primera versión (3 ventanas encadenadas, `VENTANAS_ADELANTE` 3) creaba
  la segunda actividad VACÍA (TikTok rechazaba sus productos, estado
  `sin_productos`) y como esa no contaba como viva, el cron de cada hora
  volvía a pedir la misma ventana con el mismo título y TikTok contestaba
  17029004 «name already in use»: 90 constancias `error` en dos días.
  `VENTANAS_ADELANTE` es 1; `programarCiclicas` LIMPIA antes (desactiva en
  TikTok las propias `sin_productos` que no han terminado y borra las
  constancias repetidas de «already in use»), reintenta UNA vez con «·2» si
  el título ya existe (`esTituloRepetido`) y acepta `soloIds`.
  **Una relámpago A MANO no detiene la cíclica** (`esConflictoDeActividad`,
  `hastaCuandoBloquear`, `MINUTOS_BLOQUEO_SIN_AJENA` 60;
  `tiktok_promociones_ciclicas.bloqueada_hasta`, migración 0151; dueño,
  21-oct-2026: «la de GT148 SAHORY es para creador, no es pública ni chocan
  esas»): el GT148 llevaba desde el 15-oct sin cíclica porque el fondo tomaba
  «GT148 SAHORY MONSE MARLU» (ONGOING hasta el 22-oct, armada en el Seller
  Center para creadoras) como ventana viva y esperaba a que terminara. El API
  no dice si una actividad es de creadores o pública, así que el fondo ya no
  adivina: solo las ventanas PROPIAS cuentan para `ventanasQueFaltan`, crea
  la cíclica y, SOLO si TikTok la rechaza con 17029022, deja la cíclica
  `bloqueada_hasta` el fin de la ajena viva más larga (o una hora si no se
  ve cuál), la pantalla lo dice («TikTok la rechazó por otra relámpago
  pública; se reintenta …») y la revisión barata la salta hasta entonces;
  la actividad vacía la desactiva `limpiarVentanasVacias` como siempre. Las
  ajenas se siguen enseñando como «creada a mano» y sugieren el precio.
  **Alta masiva** (`guardarCiclicas`, acción `ciclica-guardar-varios`;
  dueño, 19-oct-2026: «una sección de listas de todos los productos activos
  en TikTok para poner muchos cíclicos masivamente» y «que el precio de la
  última relámpago ya esté ahí»): la pestaña enseña TODOS los modelos
  activos en TikTok con casilla y el precio precargado con su última
  relámpago (si no, el nivel normal de la estrategia); cada alta va por su
  cuenta y al final se programan juntas con el presupuesto que quede. El
  formulario de uno también precarga el precio al elegir el modelo. Cambiar el precio lo
  lleva a las ventanas que no han empezado (`actualizarProductosDeActividad`);
  «Quitar» desactiva esas en TikTok y deja terminar la que corre. Un modelo
  sin producto activo o un rechazo de TikTok queda en `ultimo_error` sin
  frenar a los demás; lo que no alcanza en la corrida lo recoge la
  siguiente hora. **La cadena arranca DESPUÉS de la relámpago que el
  producto ya tenga** (dueño, mismo día: «si ya hay una como la del GT148,
  que empiece desde que termine esa»): `relampagosPorProducto` lee el
  DETALLE de cada actividad viva y de las últimas 12 vencidas
  (`GET …/activities/{id}`, lo único que trae el precio de oferta por
  variante; masticado 10 min en `app_cache` `tiktok:promociones:productos`,
  cae con cada oferta creada o desactivada) y `preciosDeDetalle` /
  `relampagosDeActividad` / `ultimaRelampago` / `ventanasVivasDeRelampagos`
  lo vuelven «producto → sus relámpagos con precio»; las que no nacieron
  de la cíclica («ajenas», en curso o programadas) cuentan como ventanas
  vivas para `ventanasQueFaltan`. La pestaña enseña por modelo la ÚLTIMA
  relámpago en TikTok con su precio (y la sugiere como precio al dar de
  alta) y las ajenas en la lista de programadas como «a mano».
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
  **(i) Los colores que Amazon estrena se AGREGAN al listado que ya existe
  en TikTok, no se publican aparte** (`agregarColoresAProducto` en el
  servicio; `armarSkusParaAgregar` y `variantesDelProducto` puros con
  pruebas; `ProductoAmazonParaTikTok.productoTikTok` = el producto ACTIVO
  con más variantes del modelo y `precioTikTok` = su precio más común;
  `PedidoDePublicacion.agregarA` → `tiktok_publicaciones.producto_destino`,
  migración 0145; dueño, 15-oct-2026: «quiero poder agregar colores nuevos
  a listados ya hechos en TikTok que aumenten colores en Amazon, por
  ejemplo el GT125»): en Productos nuevos, un modelo que TikTok ya vende
  activo trae un selector por renglón, por omisión «Agregar los colores al
  listado que ya existe» (el otro valor publica aparte, como antes); el
  precio vacío toma el que el listado ya tiene en TikTok. La cola lo
  trabaja por `POST /product/202309/products/{id}/partial_edit` con
  `skus` SIN `id` (variante nueva) usando el PROPIO producto como plantilla
  (mismos ids de atributo de Color y Talla que sus hermanas), `sku_img`
  con la primera foto del color y, si caben en las 9, esas fotos también a
  `main_images` (se manda la lista completa: la edición parcial la
  reemplaza). Un color que el producto ya tiene (por nombre en español) se
  salta y se avisa; más de 100 variantes en total, se rechaza. Los sku_id
  nuevos salen de la respuesta o de releer el producto y entran a
  `tiktok_skus` con `product_id` = el destino. Con «Volver a publicar» no
  se agrega: se crea otro producto. El renglón de la cola dice «Al listado
  {id}» y la lista guardada de antes del 15-oct-2026 (sin `productoTikTok`)
  se rehace sola (`listaConDestino`). **La lista `skus` de la edición
  parcial es la lista COMPLETA del producto** (doc de TikTok: «cualquier
  SKU existente que no venga aquí se borra»): la primera versión mandó
  solo las nuevas y el GT125 (1736681213198828761) perdió sus 20 variantes
  de Negro, Café, Crema y Leopardo a las 17:04Z del 15-oct-2026 (dueño:
  «se desaparecieron los colores viejos»). Ahora `variantesDelProducto`
  devuelve también `skusActuales` (id, seller_sku, precio, atributos con
  su foto e inventario, tal como TikTok los trae) y `armarSkusParaAgregar`
  las manda PRIMERO con su id y luego las nuevas (`nuevas` aparte para
  dar de alta sus sku_id); si las actuales no se leyeron completas, no se
  manda nada. Las 20 se volvieron a agregar desde Publicar productos
  (fotos de Amazon, sku_id nuevos, mismos seller_sku: el kardex no cambia).
  **Y el sync del catálogo DA DE BAJA lo que TikTok ya no trae**
  (`catalogoConEstado` → `completo`; `skusDadosDeBaja` en `ResultadoSync`):
  hasta ese día una variante borrada seguía `activo` para siempre (el
  GT168 borrado hacía que cada corrida dijera «TikTok rechazó 20 SKU» y
  Publicar productos creía esos colores todavía en TikTok). Solo con el
  catálogo leído ENTERO (sin página que TikTok no contestara ni más de
  20 páginas); una lectura corta no da de baja a nadie.

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
  **Todas las pantallas de VENTAS cuentan como el corte y el correo**
  (migración 0133, `ventas_vivas` / `yz_ventas_vivas`; dueño, 9-oct-2026:
  «en el correo me llega diferente info de venta de ayer que lo que veo en
  el panel», eligió la venta al PRECIO PÚBLICO y «que en todas las
  secciones la info sea consistente»): `ventas_resumen_sku`,
  `ventas_totales_dia`, `yz_ventas_resumen` y `yz_ventas_por_dia` (Ventas
  MELI, Ventas de fundas, Publicidad, finanzas, Excel por modelo de TikTok)
  salen de las ÓRDENES VIVAS (sin canceladas) y, en un día sin órdenes
  registradas, de los renglones diarios, igual que `ventasDelCorte`; la
  reventa reconstruida (`total_comprador − total`) sube la venta Y la
  comisión repartida por importe entre los renglones de la orden: el neto
  no cambia. El 8-oct el panel decía 1,761 pares / $222 mil y el correo
  1,745 / $361 mil (16 pares cancelados y 1,584 de 1,620 órdenes en
  reventa); hoy dicen lo mismo al centavo. El PLAN de Full sigue con los
  renglones diarios (`ventas_resumen_sku_diarias`): solo pregunta si un SKU
  vendió alguna vez.
  **Gráfica de venta POR DÍA y POR HORA** (migración 0134, RPC
  `ventas_por_hora(canal, cuenta, desde, hasta)` → jsonb {dias, horas};
  `servicios/ventas-tiempo.ts` masticado en `app_cache`
  `ventas-tiempo:v1:{canal}:{desde}:{hasta}`, el latido deja listos 7 y 30
  días de calzado y TikTok; motor puro `graficas/ventas-tiempo.ts`;
  `components/ui/grafica-ventas-tiempo.tsx`; dueño, 9-oct-2026: «una gráfica
  por horas y por días en todos los canales y en el general»): en Ventas
  MELI, Ventas de fundas, Ventas Amazon, Ventas TikTok, Inicio (los cuatro
  canales, 30 días; sus cifras de hoy y 7 días salen de la MISMA serie) y la
  pestaña Resumen del Estado de resultados. Botones Por día / Por hora y
  Facturación / Unidades; por hora se suma cada hora de México en todo el
  rango y el globo da el promedio por día. Mismas reglas que cada pantalla:
  calzado y fundas = `ventas_vivas` con la hora de `orden_cruda.date_created`;
  TikTok = pedidos en pie, precio × cantidad; Amazon = `amazon_ventas_diarias`
  por día y `amazon_ventas_horas` por hora, que la lectura del reporte llena
  desde el 9-oct-2026 (`agregarDesdeReporte` → `horas`, `guardarHoras`): lo
  anterior no tiene hora y la gráfica lo dice.
  **Monitor de HOY en Inicio** (`graficas/monitor-hoy.ts` puro con pruebas,
  `components/ui/monitor-hoy.tsx`; dueño, 9-oct-2026: «un monitor de ventas
  hoy comparado con ayer y con el mismo día la semana pasada»): se compara
  A LA MISMA HORA, no contra el día completo: lo que ayer (o hace 7 días)
  llevaba = su día completo × la parte que ya había pasado según sus horas
  (no toda orden trae hora), la hora en curso en proporción a sus minutos, y
  el corte es la hora en que se leyó la serie (`servirVariosCanalesConFecha`),
  no la de ahora. Un canal sin hora ese día (Amazon antes del 9-oct) sale de
  la comparación —también lo suyo de hoy, `hoyContraAyer`— y se nombra.
  Las series de `ventas-tiempo` viven 5 min.
- **Una pantalla servida con datos viejos se vuelve a pedir sola**
  (`marca-refresco.ts`, `components/ui/refresco-al-terminar.tsx`; dueño,
  9-oct-2026: «cada vez que me meto a una pestaña me sale la información no
  actualizada y tengo que actualizar»): `servirConCacheApp`, al servir un
  renglón viejo y mandarlo a refrescar en `after()`, deja una marca POR
  REQUEST (`cache` de React) y `<Pagina>` monta un componente que hace
  `router.refresh()` a los 5, 15 y 40 s hasta que el servidor ya no lo
  manda. Y `staleTimes` se quitó de `next.config.mjs`: con 30 s el
  navegador reutilizaba la pantalla vieja al volver a una pestaña.
  **Todos los cachés que sirven viejo marcan** (11-oct-2026, dueño: «sigue
  algo mal, tengo que recargar varias veces en cada pestaña»): el primer
  arreglo solo cubría `servirConCacheApp`; el Estado de resultados
  (`consolidado-cargar`), los cortes por canal (`corte-cache`), Ventas de
  fundas, el plan de FBA y costos de envío refrescan con su propio
  `after()` y no avisaban. Ahora todos llaman `marcarRefrescando()` y la
  pantalla enseña «Actualizando datos…» mientras se vuelve a pedir. Y el
  recálculo de fondo de los monitores (ventas MELI, Amazon, publicidad
  MELI y Amazon) SALTA la copia en memoria de la instancia (60 s a 10 min):
  si no, guardaba datos viejos con hora nueva y el renglón «fresco» seguía
  mal hasta la siguiente vuelta.
  **Y la causa de fondo era que el refresco FALLABA** (11-oct-2026, logs de
  Vercel: «refresco de fondo: ventas_resumen_sku: canceling statement due
  to statement timeout»): `ventas_vivas` / `yz_ventas_vivas` de la 0133
  sacaban el importe de cada orden con una función de VENTANA que ordenaba
  ~100 mil renglones y se iba a disco (7.2 s en 90 días de calzado); con
  carga pasaban de los 8 s y el renglón viejo se quedaba para siempre. La
  0136 lo saca con un lateral sobre los renglones de la misma orden y los
  días con órdenes salen de las órdenes: 1.0 s, mismo resultado al centavo
  (comparado renglón por renglón en todo 2026). Un RPC nuevo sobre
  `ordenes_neto` no usa ventanas sobre los renglones. Y las causas de
  subida de TikTok leían los cancelados con un embebido
  `tiktok_orden_items!inner` que la base no puede resolver (no hay llave
  entre las tablas): fallaba en CADA aviso desde el 9-oct-2026 (3,024 veces)
  y por el catch se frenaba toda subida del número publicado; ahora es el
  RPC `tiktok_cancelados_por_sku` (0137). Quedan en la base dos funciones
  vacías `zz_ventas_vivas` y `zz_yz_ventas_vivas` de la prueba de ese día
  (el `drop` por el MCP se cuelga); se pueden borrar a mano.
  **Las ventas por día YA ESTÁN SUMADAS en la base** (migración 0138;
  11-oct-2026, dueño: «se tarda mucho todavía, más que todo cuando te vas a
  más días atrás, y no sé si se actualiza al momento sin actualizarlo yo»):
  `ventas_dia_sku` y `ventas_dia_hora` guardan por canal (`meli_calzado`,
  `meli_fundas`) el resultado de `ventas_vivas_calculo` /
  `yz_ventas_vivas_calculo` (el cuerpo de la 0136, sin permiso, solo para el
  fondo) y la regla por hora de la 0134 (hora −1 = sin hora o día de
  renglones diarios). Disparadores POR SENTENCIA de insert y update en
  `ordenes_neto`, `ventas_diarias` y sus gemelas `yz_` marcan el día en
  `ventas_dias_sucios`; pg_cron (`limpiar-ventas-sucias`, cada minuto) corre
  `limpiar_ventas_sucias()`, que rehace lo marcado después de su
  `ventas_dias_hechos.hecho_en` (`rehacer_ventas_dias`: pone en cero y
  vuelve a escribir, sin borrar) y, como red para lo que se BORRA (el
  barrido quita renglones de `ventas_diarias` sin reescribir el día), rehace
  por edad los últimos 3 días cada 15 min y los últimos 120 cada 6 h.
  `ventas_vivas`, `yz_ventas_vivas` y la rama MELI/fundas de
  `ventas_por_hora` leen las tablas: 180 días en 50–400 ms (antes 2.3–3.6 s
  por llamada); comparado al centavo renglón por renglón contra el cálculo
  en vivo de todo 2026 y la gráfica con el mismo md5. Un día tocado se ve en
  ≤ 1 min. Los monitores guardados viven 3 min (ventas) y 2 min (gráficas), y
  Inicio y las cuatro pantallas de Ventas se vuelven a pedir solas cada
  2 min mientras se ven y al volver a la pestaña (`<Pagina vivo>`,
  `components/ui/actualizacion-viva.tsx`). Sin disparadores de `delete` a
  propósito: el MCP pide confirmación por esa palabra y se cuelga.
  **Y la 0138 tumbó el guardado de órdenes 10 horas** (arreglo en la 0140):
  el disparador hacía `select distinct …, clock_timestamp()` y la hora hacía
  distinto cada renglón, así que una sentencia con DOS renglones del mismo
  día chocaba en su propio ON CONFLICT y se caía COMPLETA. De las 03:33Z a
  las 13:40Z del 11-oct-2026 no entró ninguna orden de MELI (calzado ni
  fundas) ni venta diaria; «Hoy» marcaba 0. Los barridos y el registro de
  órdenes lo recuperaron solos al arreglarlo. Un disparador nuevo se prueba
  con una sentencia de VARIOS renglones del mismo día, no con uno.
  **El latido deja masticados TODOS los atajos del filtro de fechas**
  (`rangosDeAtajos`: 7 días, Hoy, 30 días, Este mes, 15 días, Ayer; 11-oct-2026,
  dueño: «cambio de fechas y toma como 3 segundos»): monitor, publicidad y
  finanzas de Ventas y las series de la gráfica, no solo 7 y 30 días; picar
  un atajo es leer un renglón. Un rango a mano sigue calculándose en el clic
  (~1–3 s). Lo mismo vale para Ventas AMAZON (el cron
  `/api/cron/amazon-pantallas` deja el monitor de cada atajo, no solo 7 días:
  «Hoy» se veía de hace casi dos horas) y para las gráficas de Amazon y de
  fundas (`precalcularVentasTiempo` con `canales`; los atajos viven en
  `servicios/atajos-fechas.ts`). Y para Ventas TIKTOK (`precalcularVentasTikTok` en el
  latido; la pantalla ahora sí marca `marcarRefrescando()` al pedir el
  recálculo: antes se quedaba con lo viejo hasta recargar a mano). Se probó que la pantalla ESPERARA hasta 2.5 s el recálculo de un
  renglón viejo: /ventas pasó de ~40 ms a ~1 s y el dueño dijo «estaba mejor
  antes»; se quitó. `servirConCacheApp` sirve lo guardado al instante y
  recalcula en `after()`.
  **Ventas MELI va EN VIVO otra vez** (11-oct-2026, dueño: «antes todo era
  en vivo; no se trabajaba cuando cambiabas entre hoy, ayer, 7, 15 o 30
  días»; migración 0141). La copia del monitor por rango vencía a los 3 min
  y el latido corre cada ~6 (10 veces por hora, 87 s de promedio): casi
  toda visita servía lo viejo, mandaba a recalcular, enseñaba «Actualizando
  datos…» y se recargaba sola a los 5/15/40 s con los números brincando.
  Ahora: (1) el MONITOR (Hoy, Ayer, periodo, modelos, categorías) se
  calcula en cada visita sobre `ventas_dia_sku` con `ventas_monitor_datos`
  (periodo + anterior + totales por día en UNA llamada; 30 días ≈ 110 ms,
  180 ≈ 300 ms; comparado renglón por renglón contra `ventas_resumen_sku` +
  `ventas_totales_dia`: idéntico); los días cerrados SON lo guardado (la
  tabla de la 0138) y hoy entra con su retraso de ≤ 1 min. Ya no hay
  `ventas-monitor:` en `app_cache`; catálogo y stock para las razones viven
  2 min en memoria. (2) La GRÁFICA de MELI calzado y fundas se lee en vivo
  (`CANALES_EN_VIVO`, 20–70 ms); TikTok y Amazon siguen masticados.
  (3) Publicidad y dinero (cascada) siguen masticados y DECLARAN su edad
  (la ganancia dice «publicidad (hace X min)», la pestaña Dinero su
  `Frescura`); el cuadre «venta bruta por renglón vs. por orden» solo se
  hace si las dos cifras son del mismo momento (`mismoMomentoParaCuadrar`:
  periodo cerrado, o dinero de hace < 1 min). (4) Una `<Pagina vivo>` ya no
  monta `RefrescoAlTerminar`: nada de pastilla ni recargas a los 5/15/40 s;
  queda la vuelta tranquila de cada 2 min. (5) Los atajos de las cuatro
  pantallas de Ventas se PRECARGAN completos (`components/atajos-fechas.tsx`,
  `FiltroFechas precargar`) y se renuevan cada 30 s con la pestaña a la
  vista; `staleTimes.static` = 30 s: el clic cambia sin pantalla gris y con
  datos de < 30 s. Ventas de fundas sigue con su monitor masticado (10 min).
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
  **Revisión de septiembre 2026 (9-oct-2026, dueño: «el corte general es
  un desastre… revisa septiembre al 100»)**: (1) la venta del CALZADO sale
  de las ÓRDENES (`cortes_ventas_desde_ordenes`, migración 0131, un jsonb de
  un jalón; `ventasDelCorte` cae a `ventas_diarias` solo en días sin
  órdenes): los renglones diarios traían órdenes que /orders/{id} tiene
  canceladas (+279 pares, +$38 mil) y un neto viejo que el barrido no
  reescribe (+$67.6 mil en los días «que no cuadran»); (2) la publicidad de
  MELI se lee por páginas (1,101 anuncios, se perdían $3,930); (3) la
  facturación del MES ANTERIOR también se relee si quedó corta contra el
  total de MELI (fundas septiembre: 1,800 de 23,957, gastos de Full $3 mil
  contra $109 mil de agosto) y un mes leído con la paginación vieja sin
  total se relee una vez (julio de fundas); (4) los RPC de cortes evalúan
  el permiso UNA vez (migración 0130, abajo). `versionContable` 8 y
  `claveCorte` v3. Decisiones del dueño ese día: el IVA SE QUEDA dentro de
  la utilidad, los modelos sin costo se quedan como están, a TikTok NO se le
  suman muestras, 3PL ni empaque, y el ajuste MiscAdjustment de Amazon
  (~−$107 mil al mes, sin descripción en la Finances API) sigue como gasto
  general hasta saber qué es. **Los AJUSTES de los estados de cuenta de
  TikTok sí entran** («checa si no hay más cargos»; `tiktok/estados-cuenta.ts`
  puro con pruebas, `servicios/tiktok-estados.ts`, `estadosDeCuenta` en
  `tiktok/api.ts`): lo que TikTok cobra o abona SIN pedido vive en
  `GET /finance/202309/statements` (`adjustment_amount` por estado; ruta y
  forma del SDK público de npm), no en las transacciones por pedido que lee
  `liquidacion.ts`. El cron de pagos los lee cada 3 h a `app_cache`
  `tiktok:estados-cuenta` y deja en la bitácora (tarea `estados-cuenta`) el
  crudo de las transacciones de los primeros estados con ajuste para saber
  qué tipos cobra; `bloqueTikTok` suma los ajustes del mes por la FECHA DEL
  ESTADO (México) como gasto de la plataforma, y sin estados leídos lo
  declara. **El Excel del corte general lleva los tonos de la página**
  (`consolidado-excel.ts`: encabezados azul marino, bloques en gris, la
  utilidad en verde/rojo, pestañas «Cada peso» con los colores de la gráfica
  y «Qué falta» por tipo). Los «cargos
  detallados superan…» de los carritos NO son dinero perdido: esas órdenes
  ya traen el cargo diferido en `neto_actual`.
  **La pantalla y el PDF se leen, no solo se suman**
  (`consolidado-informe.ts` motor puro con pruebas: `cascadaDelMes` cierra
  al centavo de la venta a la utilidad con los reembolsos ya descontados en
  su propio renglón, `repartoDelPeso` = de cada $100 por canal,
  `avisosParaMostrar` separa lo que pide ACCIÓN, lo que LLEGA SOLO —revisión
  a 40 días, lo por liquidar de TikTok— y las NOTAS que solo explican, y
  junta el neto sin costo por canal con su monto; `estadoDelCorte` =
  definitivo / preliminar / N cosas por revisar; `loQuePaso` = el mes con
  palabras). Antes salía «Datos parciales · 25 avisos» siempre, aunque 15
  fueran explicaciones permanentes. **«Hacer corte» abre su INFORME PDF**
  (`consolidado-pdf.ts`, pdf-lib; `/api/cortes/general/{id}/pdf` y vista
  previa `/api/cortes/general/pdf?periodo=`): portada con la utilidad y lo
  que pasó, cascada y cada peso, utilidad por canal, contra el mes
  anterior, detalle por canal, categorías, los modelos que más dejaron y
  los que perdieron, qué falta y cómo se calcula. Se rehace siempre del
  corte congelado (`cortes_generales.resumen`).
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
- **Lo que NO es del negocio se deja fuera del Estado de resultados**
  (`MODELOS_OMITIDOS_AMAZON`, `sinModelosOmitidos` en `consolidado-amazon.ts`;
  dueño, 16-oct-2026: «las bocinas Tronsmart las omites», opción A): las
  bocinas TRONSMART que se venden en la cuenta de Amazon no tienen costo y su
  neto entraba completo como ganancia. El bloque de Amazon les quita
  renglón, venta, neto, cargos y publicidad (el canal sigue cuadrando: venta
  − cargos = neto) y lo declara como NOTA; Ventas Amazon las sigue
  enseñando. `versionContable` 10. Ese mismo día se capturaron los costos de
  fundas y micas que faltaban (754, 748, 749, 750, 380, 585, 610, 640) y $10
  a las 10 publicaciones de mica con SKU de otro vendedor («black-S»,
  «MLM2111397273_6_36 EU»…; el dueño ya no vende ahí), y cinco avisos que
  llegan solos o solo explican dejaron de salir en «Pide acción».
- **AÑO DEL NEGOCIO, de mayo a abril** (`/cortes/anio`, «Año del negocio» en
  Negocio y botón «Año may–abr» en Estado de resultados;
  `servicios/consolidado-anio.ts` motor puro con pruebas: `periodosDelEjercicio`,
  `sumarAnio`; `leerAnio` en `consolidado-cargar.ts`; dueño, 15-oct-2026: «ver
  cómo va el año en total, mi cuenta es de mayo a abril»): suma el estado de
  resultados GUARDADO de cada mes del ejercicio (`leerConsolidadoGuardado`,
  con sus gastos del negocio) en centavos, sin recalcular nada; el ejercicio
  es el de la Cuenta del año (`ejercicioDeFecha`, `nombreEjercicio`). Mes por
  mes con barra de utilidad, por canal (antes de los gastos del negocio), por
  categoría y por modelo. Un mes sin estado (antes de enero 2026) no suma y
  se dice; el mes en curso va con lo que lleva y el promedio mensual es solo
  de los meses cerrados. Un canal no calculable en un mes no suma y se nombra
  el mes; una ganancia sin costo queda «sin costo algún mes», nunca cero.
- **GASTOS EMPRESARIALES: fijos cada mes + sueltos** (`/gastos`, «Gastos»
  en Negocio; `servicios/gastos-fijos.ts` + `gastos-empresariales.ts`,
  migración 0132; dueño, 9-oct-2026: «mis gastos regularmente son nóminas,
  fletes, rentas y logística a 3PL; la mayoría son los mismos todos los
  meses»). Un gasto FIJO se da de alta una vez (`gastos_fijos`: concepto,
  categoría, monto al mes, `desde`/`hasta` por mes) y cada mes se
  materializa su renglón en `gastos_empresariales` (día 1, `gasto_fijo_id`,
  único por fijo + mes; `asegurarGastosFijos` antes de cada lectura,
  idempotente, nunca más allá del mes en curso). Ese mes se puede CORREGIR
  (`editado`: la plantilla ya no lo pisa) u OMITIR (`omitido`: no se borra,
  si no se volvería a crear). Cambiar la plantilla corrige del mes en curso
  en adelante; los meses pasados se quedan como se cobraron. «Dar de baja»
  pone `hasta` = mes anterior. Se descuentan del TOTAL del negocio en el
  Estado de resultados (no por canal ni modelo; ahí solo se ven, se editan
  en Gastos). **En el mes EN CURSO un fijo cuenta en proporción a los días
  transcurridos** (`proporcionDelMes`, decisión del dueño): al día 9 de
  octubre, 9/31; lo mismo en los «mismos días del mes anterior». Un gasto
  suelto cuenta completo en su fecha. El resumen diario no los lleva.
  `apply_migration` del MCP se cuelga con sentencias `drop` (piden
  confirmación que no llega): en una migración nueva no se usan.
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
- **INVERSIÓN en Existencias = bodega + lo que va EN BARCO + Full + FBA + TikTok**
  (`inversionPorCategoria` en `servicios/inventario.ts`, `vistaBodega` en
  `servicios/bodega.ts`; dueño, 16-oct-2026: «para ver cuánto dinero real
  tenemos invertido»): todo a costo de `productos_config`. **Lo que sigue en la
  FÁBRICA no cuenta ni en la inversión ni en la ganancia** (dueño,
  18-oct-2026: «ni lo he pagado»): `soloLoEmbarcado` recorta el `enCamino`
  del inventario (que cuenta todo lo pedido sin llegar y así lo usa la
  planeación) a los pares en contenedores sin recibir de
  `paresEnBarcoPorModelo`, por modelo; en fundas solo los pedidos marcados
  «en camino» (`enCaminoChinaEmbarcado`). Lo de la fábrica solo se enseña
  en la nota. Full lleva lo que
  va en transferencia; FBA (`amazon_inventario`, solo calzado) lleva
  disponible, reservado, no disponible, investigando, transferencia y lo ya
  enviado o recibiéndose, NO lo «trabajando» (sus cajas siguen en bodega).
  TikTok = saldo de `tiktok_inventario` sin los SKU de David
  (`skusExternos`); esa bodega no está en `enBodega`, no se cuenta dos veces.
  **Ganancia estimada** (mismo día: «sumar la ganancia estimada de la venta
  de lo que hay en total, según lo que se gana en MELI»): todos esos pares ×
  (depósito real de MELI por par en 30 días − costo), el `netoPar` de
  `finanzas:tarifas-reales` (el de Números), antes de publicidad y gastos;
  un modelo con menos de 10 pares vendidos en MELI en 30 días se estima con el
  PROMEDIO de los que sí venden (su costo × depósito ÷ costo de esos;
  `sinVentaMeli.veces`, dueño, 16-oct-2026) y se nombra aparte. Sin costo
  capturado no entra a nada.
- **EXISTENCIAS POR FAMILIA con sus ventas** (`servicios/familias-existencias.ts`
  puro con pruebas: `armarFamiliasExistencias`, `colorDeSku`,
  `compararFamilias`, `filtrarFamilias`; `servicios/ventas-familias.ts`
  masticado en `app_cache` `existencias:ventas-sku:v1` 15 min;
  `VistaBodega.skusExistencias`; `components/familias-existencias.tsx`,
  pestaña «Por familia» de Existencias; dueño, 20-oct-2026: «una lista que no
  sea por SKU sino por familia con sus totales de stock y que tenga ahí las
  ventas que ha tenido el producto»): un renglón por MODELO con pares en
  bodega, barco, fábrica (fuera del total), Full + transferencia, FBA y
  TikTok (sin lo de David), las cajas contadas una vez, lo vendido en 30 días
  y desde que el ERP registra por canal (MELI calzado, Amazon, TikTok, de
  `inicio_ventas_skus` en dos llamadas; la histórica tarda ~1.5 s por el
  barrido de Amazon, por eso va masticada) y «Alcanza» = total ÷ ritmo de 30
  días. Abrir el renglón lo parte por COLOR (`colorDeSku`: a un SKU de Amazon
  con la talla antes del color se le quita la talla; sin color, el par cuenta
  solo en la familia). Sustituyó al «Total en México por familia»
  (`TotalMexico`), que solo traía cajas y pares de bodega.
- **FUNDAS en Existencias y «Todo junto»** (`servicios/existencias-fundas.ts`,
  `app_cache` `existencias:fundas:v1` 15 min; dueño, 16-oct-2026: «una
  sección de fundas, lo que hay en stock y en MELI y Amazon y lo que se gana,
  y sumar todo junto»): mismo motor (`inversionPorCategoria`) por DISEÑO.
  Bodega = el sheet ya amarrado (pantalla `inventario` de `yz_cache`; lo sin
  amarrar no se costea y se dice), camino = pedidos a China de fundas, Full =
  `yz_stock_full` + transferencia, FBA = SKU de Amazon cuyo diseño empieza
  con número. Los envíos registrados a Full NO se suman (el sheet los puede
  traer). Ganancia con el depósito real por pieza y diseño de
  `yz_ventas_resumen` en 30 días (≥ 10 piezas; si no, el promedio). Arriba,
  «Todo junto» suma calzado + fundas; cada uno con su propio depósito.
- **Costos y categorías son por MODELO** (mismo costo todos los colores), en
  MXN final, en `productos_config`. Ahí también viven los diseños de FUNDAS
  (categoría "Fundas"): es el único lugar de costos del sistema. La ganancia de MELI usa el neto real
  depositado (net_received_amount de Mercado Pago, con cargos diferidos).
- **COSTEO REAL POR CONTENEDOR y NÚMEROS, todo en el ERP** (`finanzas/costeo.ts`
  y `finanzas/numeros.ts` motores puros con pruebas, `servicios/costeo.ts`,
  `servicios/numeros.ts`, pantallas `/finanzas/costeo` «Costeo» y
  `/finanzas/numeros` «Números» en Negocio, `POST /api/finanzas/costeo` y
  `/api/finanzas/numeros`, migración 0135, `app_cache` `finanzas:costeo` y
  `finanzas:costeo-excel`; dueño, 11-oct-2026: «el costo que quiero es el
  real para calcular ganancias reales, pero para Números el del último
  contenedor», «ya no quiero actualizar Números ni usar el sheet COSTING
  GETAC, todo en el sistema»). LO PAGADO vive en `costeo_contenedores`
  (factura y flete en USD, aduana en pesos, entregado) y `costeo_pagos`
  (cada pago en USD con SU tipo de cambio: los pesos de la fábrica = factura
  × el T.C. ponderado de sus pagos; el flete con los suyos o, sin ellos, con
  el de la fábrica y se avisa). Se importó UNA vez de la pestaña COSTING
  GETAC del sheet de cuentas (el flete con el multiplicador de la fórmula de
  su propio renglón: S244–S247 apuntaban al renglón de arriba); ese sheet
  NUNCA se escribe y ya no se lee. QUÉ TRAÍA cada contenedor: el Excel de
  costeo de la fábrica («Costing for shoe Internet», se sube en la
  pantalla: pares, USD por par, CBM por pedido y flete total) o el packing
  list del ERP (medidas → CBM; su precio solo como proporción). Reparto: la
  fábrica por VALOR en USD; flete y aduana **a fuerzas por los CBM del
  contenedor** (sin CBM no se costea, no se adivina). **Comisiones (Joanne)
  y gastos NO son costo del par**: son gasto operativo. Cuenta solo
  entregado (capturado o RECIBIDO en Contenedores) y con aduana. S236–S238
  solo tienen la aduana: su fábrica se pagó el año anterior. Por modelo:
  «último» = el contenedor más nuevo que cuenta (el de Números) y «real» =
  PEPS sobre las existencias de hoy (Full + transferencias + bodega + TikTok
  + FBA). «Usar» pasa el real a `productos_config` (solo el costo, color
  ''), que leen los cortes; nunca se aplica solo. NÚMEROS reproduce el sheet
  del dueño fórmula por fórmula (`numeros_modelos`: envío MELI, relámpago,
  PV normal, retención 10.5 %, envío Amazon, deal fijo, TikTok extra /
  comisión / factor de oferta; importado el mismo día) con el costo del
  último contenedor, o el del catálogo si no hay. **Y con lo que COBRÓ cada
  plataforma** (mismo día: «en vez de mis estimaciones de comisión y costo
  de envío, ¿lo puedes calcular con lo real?»; migración 0136,
  `*_tarifas_por_modelo`, `servicios/tarifas-reales.ts`, `app_cache`
  `finanzas:tarifas-reales`, 6 h): con ≥ 10 pares en 30 días, MELI usa la
  comisión real, el envío real = MEDIANA de las ventas DIRECTAS de un par
  (el promedio lo inflan los carritos; con < 5 directas, el estimado) y la
  retención efectiva (la REVENTA, ~93 % de los pares, no trae retención);
  Amazon usa comisión + retención reales sobre el precio y FBA + promos por
  par; TikTok lo que se queda = 1 − (pago + $6) ÷ precio, más $6 por par.
  Sin ventas suficientes, la estimación del dueño, y la tabla dice cuál se
  usó. **Y debajo de la ganancia de MELI dice lo que se RECIBIÓ de verdad**
  (`ResultadoNumeros.recibidoMeli`; dueño, 15-oct-2026: «¿por qué no
  puedes decirme en real simplemente cuánto recibí aunque fue por
  reventa?»): el depósito de Mercado Pago por par en 30 días (`neto_par`
  del mismo RPC, reventa incluida) y lo que dejó sobre el costo. **Y ESA
  es la ganancia de MELI** cuando el modelo tiene ventas reales (mismo día,
  dueño: «que salga la que de verdad estoy recibiendo para calcular los
  precios en TikTok y Amazon»): «Recibir», el PVP de Amazon, el deal (y con
  él «Llevar precios a Amazon») y TikTok salen del depósito real; lo que
  dejaría el relámpago con las tasas queda abajo como referencia
  (`gananciaRelampago`). **Pero el depósito real AL PRECIO RELÁMPAGO, no el
  promedio del mes** (mismo día, dueño: «si GT148 lo vendo en 199, ¿por qué
  recibo más?»): el promedio ($139.80) mezclaba ventas a $250–$356; a
  $199.99 MELI deposita $126.87. RPC `meli_neto_por_precio_modelo`
  (migración 0143: depósito por par a cada precio al cliente redondeado al
  peso, la reventa al público con `total_comprador`) → `meliPorPrecio` en
  `finanzas:tarifas-reales:v2`; se usa el escalón a ±$1 del relámpago con
  ≥ `PARES_MINIMOS_AL_PRECIO` (5) pares, y el promedio del mes queda como
  referencia (`promedioMeli`). Sin ventas a ese precio, **se toma el
  relámpago REAL del histórico** (`escalonRelampago`: el precio más bajo con
  ≥ 10 % de los pares y al menos 5; `recibidoMeli.deHistorico`, la tabla lo
  dice en ámbar; dueño, 16-oct-2026: «si ya hay histórico en MELI nos
  basamos en ese para fijar precios»: GT150 decía 298.88 y se vende a 350 y
  370, GT129, GT169, GT229, GT252 y GT259 igual). Solo sin ninguna venta
  con volumen, la cuenta con las tasas. Los sueldos del dueño y de
  Daniel NO son del negocio: solo se apuntan, nunca entran a la utilidad.
- **LOS SHEETS DEL DUEÑO SE LEEN SOLOS Y MANDAN** (`finanzas/sheets.ts` puro
  con pruebas sobre los sheets reales en `fixtures/sheet-*-2026-10-16.xlsx`,
  `servicios/sheets-finanzas.ts`, cron `/api/cron/sheets-finanzas` cada hora,
  botón «Leer sheets» en Costeo, Números y Cuenta del año → `POST
  /api/finanzas/sheets`, constancia en `app_cache` `finanzas:sheets`; dueño,
  16-oct-2026: «sí, que lo lea automático y manda el sheet»). Desde ese día
  lo de abajo («se importó UNA vez, el sheet ya no se lee») ya NO vale:
  «Cuentas YAPANIZCEL» (`SHEET_CUENTAS`) y «Números» (`SHEET_NUMEROS`) se
  bajan como .xlsx y lo que vino del sheet se REEMPLAZA completo (por
  `clave_importacion` `cuentas:*`; el dueño inserta renglones en medio, así
  que el número de renglón no identifica nada): GASTOS MEX → gastos en
  efectivo (negativo = ingreso de la cuenta; la categoría que el ERP ya le
  tenía al concepto se respeta), TRANSFERENCIAS, CUENTA SHEIN (salidas),
  SUELDOS (retiros; fechas de texto «03-AGO-2026», «05-JUNIO-2026»), la
  renta de TOTAL, COSTING GETAC/FUNDAS (costo, flete, aduana, entregado y
  los pagos fábrica/flete; T.C. del flete = PESOS ENVIO ÷ COSTO ENVIO del
  renglón; un contenedor sin T.C. conserva sus pagos) y la pestaña CALZADO
  de Números (los parámetros salen de las FÓRMULAS: «0.105» = retención,
  «(N+8)/(1-0.24)» = extra y comisión de TikTok, «R*1.11» = oferta; un
  precio que es el factor de siempre se deja vacío y lo demás toma el valor
  del sheet). Lo capturado a mano en el ERP sin clave se queda. En Números, lo
  cambiado en el ERP le GANA al sheet (`finanzas/numeros-sheet.ts` puro
  con pruebas, `numeros_modelos.editados_erp` / `valores_sheet`, migración
  0148; dueño, 18-oct-2026: «si hice un cambio en el sistema, toma ese
  precio y no el del sheet»): campo por campo manda el ÚLTIMO cambio; lo
  editado en el ERP se respeta mientras el sheet diga lo mismo que en la
  lectura anterior, y si el dueño cambia ese campo en el sheet, el sheet
  vuelve a mandar y la marca se quita. Cuadra al
  centavo con la pestaña TOTAL (transferencias $44,154,035.64, gastos
  $410,966, retiros $3,692,260 y $3,181,615). El sheet NUNCA se escribe;
  si Google no lo entrega (deja de estar compartido) no se toca nada y el
  error queda en la constancia.
- **CALCULADORA FISCAL: precio de compra entre empresas** (`/finanzas/calculadora`
  «Calculadora fiscal» en Negocio; `finanzas/calculadora-precios.ts` motor
  puro con pruebas, `servicios/calculadora-precios.ts`, `POST
  /api/finanzas/calculadora` guarda los parámetros en `app_cache`
  `calculadora-precios:config`, `GET /api/finanzas/calculadora/contenedor?id=`
  el Excel de la factura; dueño, 21-oct-2026). Cadena: proveedor → INDUSTHER
  (se queda la ganancia) → KOMERLINE (vende en MELI y NO debe quedarse con
  ganancia). Komerline compra a = depósito real de MELI por par − gastos de
  Full por par del canal − publicidad por par (la del modelo + la sin amarre
  del canal), promedio de los meses CERRADOS elegidos (3 por omisión) del
  estado de resultados guardado (canal calzado en MELI). Producto NUEVO (< 10
  pares en esos meses): depósito al precio relámpago de Números (real al
  relámpago o con las tasas de Números) − Full y publicidad promedio del
  canal. Industher compra a = precio Komerline − gasto de logística y
  empleados (~$400,000 al mes) ÷ unidades al mes de TODAS las plataformas
  (promedio real o a mano) − 3 % de lo que le factura a Komerline. Todo CON
  IVA trasladado (base = ÷ 1.16). El Excel del contenedor trae una hoja por
  compra: modelo, código SAT (`codigoFiscalDeCategoria`), pares, precio sin
  IVA, IVA y total, y ANTES una hoja «Resumen» con la cuenta completa y los
  DOS precios lado a lado por modelo (`hojaResumen`; dueño, 21-oct-2026: «en
  el Excel no sale el precio de Industher»); la pantalla enseña la resta
  debajo de cada precio; lo que no tiene precio o código va en blanco y en
  «Avisos». Se ofrecen los contenedores DESDE EL S245
  (`PRIMER_EMBARQUE_FACTURA`, `?numero=S245`; dueño, mismo día): de
  Contenedores (desde S250, pares del packing list) y, los que nunca se
  cargaron ahí (S245–S249), del Excel de costeo de la fábrica
  (`finanzas:costeo-excel`, modelo y pares); si está en los dos, manda
  Contenedores. **Es PURAMENTE FISCAL** (dueño: «no se debe confundir con el
  corte general»): solo LEE el estado de resultados guardado y Números,
  nunca escribe ni cambia el corte general.
- **CUENTA DEL AÑO, SOCIOS y gastos en EFECTIVO** (`finanzas/cuenta.ts`
  motor puro con pruebas, `servicios/cuenta.ts`, `/finanzas/cuenta` «Cuenta
  del año» en Negocio, `POST /api/finanzas/cuenta`, migraciones 0137 y
  0138; dueño, 11-oct-2026). **La cuenta es del DUEÑO, no de Rafa** («la
  cuenta con Rafa es solo las de transferencias; el total es conmigo») y va
  de MAYO a ABRIL (`ejercicioDeFecha`, `?ejercicio=2026` = may-2026 a
  abr-2027; «cada año hacemos así las cuentas»): lo fechado cae por su
  fecha y lo que no (renta de oficina de 12 meses, contenedores) por su
  columna `ejercicio` (por omisión `ejercicio_actual()`). La **comisión de
  Joanne** es 1.5 % × costo USD × el tipo de cambio de la fábrica de ESE
  contenedor (`comisionAgenteDe`), calculada sola para todo contenedor
  pagado; `comision_agente` solo si se captura a mano. **SHEIN**: los
  depósitos ya son transferencias (DEPOSITO SHEIN, con comisión); la renta
  y la mercancía de la cuenta de Shein son movimientos `shein`; los dos se
  capturan en la pestaña Shein (el depósito se guarda como transferencia).
  Ese dinero es de DAVID y pasa por la cuenta de la EMPRESA (dueño: «le doy
  mercancía a David, ahí apunto su gasto, él me da todo su dinero y lo que
  gana al final de año se lo doy»; «es de la empresa, no mío como
  Abraham»), así que lo que deja (depósitos − renta − mercancía) es una
  SALIDA de la ganancia de la empresa («Shein: se le debe a David»), antes
  del reparto. `socios.recibe_shein` (0138) quedó sin uso. Todo el sheet «Cuentas YAPANIZCEL» (el de cuentas)
  se importó UNA vez y desde ahí se captura en el ERP; el sheet nunca se
  escribe. **Las transferencias a Rafa (Industher / Vantorix) NO son pagos
  de contenedores** (dueño: «esos pagos no tienen nada que ver con los
  contenedores»): son el dinero que pasa a una cuenta paralela desde la que
  Rafa paga a China o le da efectivo al dueño, y cobra 2/116 (~1.72 %) de
  cada una (`COMISION_RAFA`; `cuenta_paralela` tipo `transferencia`). La
  pantalla replica la pestaña TOTAL: recibido (transferencias − comisión)
  − contenedores de calzado y fundas en pesos (del costeo) − comisión del
  agente − gastos en EFECTIVO + ingresos sin comisión (CREDI PAGO: una
  deuda que le pagaron al dueño, tipo `ingreso`) − gastos de la cuenta
  (renta de oficina, tipo `gasto`) = ganancia, repartida entre los SOCIOS
  (`socios`: Abraham 25 %, Daniel 25 %, su papá 50 %) contra lo que cada
  uno retiró (`socios_retiros`; negativo = pagó algo del negocio; los
  retiros solo se APUNTAN, nunca son gasto). Al importar cuadró al centavo
  con la pestaña TOTAL (transferencias $41,889,509.39, comisión
  $793,784.63, retiros $3,627,820 y $3,135,465); la ganancia sale $57,100
  menor que la del sheet por el flete corregido de S244–S246. Los cuatro
  retiros SIN fecha de Abraham (DÓLARES VIAJE y tres AMEX) no se
  importaron: en el sheet estaban fuera de la suma. **GASTOS MEX** entró a
  Gastos con `gastos_empresariales.medio = 'efectivo'` (lo que se paga
  desde el banco con factura es `banco`, el de omisión) y categorías
  nuevas (Empaque, Marketing, Oficina y equipo, Comisiones, Trámites,
  Viajes): los dos medios cuentan igual en el Estado de resultados y los de
  efectivo además salen de la ganancia de la cuenta. Contenedores de
  FUNDAS (`P###`, `costeo_contenedores.negocio = 'fundas'`) en el mismo
  costeo; el P608 viajó en el S268. La comisión del agente (Joanne, 1.5 %
  del costo en pesos) vive en `costeo_contenedores.comision_agente`: gasto
  operativo, NUNCA costo del par. CUENTA SHEIN es de David: la renta que
  la empresa paga se la descuenta a él, no es gasto del negocio.
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
- **Los RPC SQL evalúan su permiso UNA vez** (migración 0130): el filtro
  `and (auth.role() = 'service_role' or es_mi_cuenta…(p_account))` dentro
  del WHERE se corría por renglón (auth.role() parsea el JWT cada vez):
  `yz_cortes_ventas_desde_ordenes_confirmadas` de abril tardaba 5.6 s y el
  cron del corte general se cancelaba a los 8 s en marzo–julio de fundas. Va
  envuelto en `(select …)` (InitPlan); un RPC nuevo, igual.
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
- **Revisión del 9-oct-2026: nada se queda con los primeros 1,000.** Toda
  lectura que pueda pasar de 1,000 renglones va por `traerTodo` /
  `traerRpcTodo` / `rpcPaginado` (o `porTandas` si lleva una lista de ids)
  y su RPC con ORDER BY estable. Ese día se cortaban: historia de Amazon,
  `ventas_resumen_sku`, `amazon_resumen_skus`, `publicidad_resumen_items`
  (0126), `envio_real_por_sku` y las causas de subida de TikTok. Un
  `.limit(2000)` NO trae 2,000. Y un `count: "exact"` sobre una tabla grande
  pasa de los 8 s del `statement_timeout`, que también rige al cliente admin
  (el rol `authenticator` lo trae): los netos de fundas morían en 86 de 144
  corridas por eso.
- **Una orden con pago definitivo y sin cargo de envío queda con el envío
  RESUELTO** (`pagosDefinitivos` en `meli/pagos-api.ts`): antes
  `envio_leido_en` se quedaba vacío, la orden se volvía a pedir en cada
  barrido y llenaba los 150 lugares; el registro de órdenes se atoró en el
  30-mar-2026 y fundas releía las mismas ~1,000 órdenes cada 10 min.
- Topes que quedaban (mismo día): la plantilla para publicar en TikTok se
  busca por MODELO en la base (no entre los «2,000» más recientes); los
  renglones de un día de `ventas_diarias` en `webhooks.ts` van por
  `filasDelDia`; la revisión de «publicaciones del catálogo» de Listados
  (calzado y fundas) va por tandas; la limpieza de SKUs pendientes de fundas
  lee todas las páginas. Índices parciales para lo que se buscaba barriendo
  la tabla: órdenes de fundas sin depósito (0127, 7.1 s → 9 ms) y órdenes
  canceladas (0128). Ventas y Publicidad de Amazon se mastican en su propio
  cron (`/api/cron/amazon-pantallas`, cada 10 min), no al final del latido.
- Product Ads solo rellena hacia atrás 89 días (`DIAS_API_ADS`): MELI no
  da más y pedirlo tronaba cada hora. El sync diario vive 800 s. Todo lo
  que el servidor se manda a sí mismo usa `origenDeLaApp`, y
  `/api/fiscal/procesar` es pública para su relanzamiento con CRON_SECRET.
- La barra de estado pregunta cada 60 s, se pausa con la pestaña escondida y
  solo recarga las pantallas que usan el plan; la página ya no se desmonta en
  cada navegación. `clienteAdmin` vive en `supabase/admin.ts` (sin
  next/headers) para que los servicios que llegan a componentes de cliente
  lo puedan importar.

**Marca y diseño** (9-oct-2026): logo `public/getac-logo.png`, nombre «GETAC», paleta crema/arena/café, DM Sans + Fraunces, SIN explicaciones en pantalla, menú con nombres nuevos (Estado de resultados, Existencias, Reabasto a Full, Planeación de compras, Órdenes de compra, Despacho de pedidos…) y sin Conciliar (las rutas siguen). Despacho de TikTok: solo cortes de 2 días (los demás tras «Ver cortes anteriores»), tiempo de preparación por corte (`tiktok_tiempos_cortes`, migración 0126) y sin la casilla «sin defensa» (el servidor la sigue aceptando).

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
  **Lo AGOTADO con historia se repone y lo que NUNCA vendió se estrena**
  (`HistoriaPrevia`, `ventaDiariaDeHistoria`, `DIAS_HISTORIA` 180, motivos
  `historia` y `estreno`, `LineaPlan.ventaDeHistoria` en `yapanizcel/plan.ts`;
  `cargarHistoriaPrevia` en `agregados.ts` con los mismos dos RPC de los
  bloques sobre los 180 días ANTERIORES a la ventana; dueño, 21-oct-2026:
  «no me pide mandar 567-i11-transparent pero no hay stock»): un SKU sin
  venta en la ventana y con NADA en Full ni en camino no le dice nada a la
  ventana, así que se decide con la historia: si vendió en esos 180 días, su
  venta diaria sale de ahí (unidades ÷ días con stock, calendario sin fotos,
  mismo piso) y se repone con eso (567-i11-purple: 58 vendidas hasta julio,
  10 en bodega, 0 en Full, pedía 0 para siempre; ese día eran 123 SKU con
  7,619 piezas en bodega); si NUNCA ha vendido y la bodega tiene al menos una
  decena, va UNA decena de prueba (`minimoEnvio`), salvo publicación cerrada
  en MELI (31 SKU ese día). No se repite: con la decena en camino o en Full ya
  no es estreno y, si no vende, Full ya cubre el objetivo. La pantalla lo dice
  en la columna de motivo y marca la venta diaria con «ᴴ». Sin historia
  cargada el motor no aplica ninguna de las dos (las pruebas viejas siguen).
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
  **Los diseños ELEGIDOS en Pedidos a China se guardan por cuenta**
  (`yz_parametros.pedidos_disenos`, migración 0150; `leerDisenosElegidos`
  / `guardarDisenosElegidos`, `POST /api/yapanizcel/pedidos/seleccion`;
  dueño, 20-oct-2026: «que no se desliguen solos, se quedan guardados»):
  hasta ese día vivían en localStorage y en la URL, y al cargar la
  pantalla se recortaban contra los diseños del resumen del momento y se
  volvían a guardar recortados. Ahora la URL (`?disenos=`) manda sobre lo
  guardado, lo guardado sobre el navegador, cada cambio se guarda medio
  segundo después del último clic y la elección NUNCA se recorta contra el
  catálogo: un diseño que el resumen no trae sigue elegido y reaparece.
  **A China se pide SOLO lo que falta de verdad, en números cerrados**
  (`redondearPedido`, `multiploDeDiseno` en `yapanizcel/compras.ts`, puros con
  pruebas; `yz_parametros.pedido_minimo` 50, `pedido_multiplo` 10 y
  `pedido_multiplos` por diseño `{"662": 20}`, migración 0151; campos en
  Configuración de fundas; dueño, 21-oct-2026: «solamente modelos que
  necesitan mínimo 50 unidades y todo con números cerrados redondeando hacia
  arriba en 10 y 10; de la fábrica 662 es 40 o 60, no 50»): por SKU, la
  FALTA = objetivo de 120 días − posición (`VarianteCompra.necesidad`); si
  es menor al mínimo no se pide nada (la pantalla la enseña en gris entre
  paréntesis y el Excel en «Falta»), y si llega, se sube al múltiplo cerrado
  del diseño (el 662 de 20 en 20: una falta de 50 se pide como 60). Los
  totales por diseño y el Excel suman lo ya redondeado.
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
| Productos nuevos: lista en `app_cache` `nuevos:productos` (cae con `invalidar()`), fotos guardadas en `nuevos:fotos` y solo se re-pregunta lo que falta (`productos-nuevos-fotos.ts`). **Lanzamientos se pone al día SOLO** (21-oct-2026, dueño: «no se actualizan los que ya tienen fotos y salen sin fotos»: lo guardado era del 13-oct y solo el botón o un contenedor nuevo volvían a preguntar): cron `/api/cron/nuevos-fotos` cada hora, la pantalla pregunta sola lo que falta al abrir si la revisión tiene más de `MINUTOS_REVISION_FOTOS` (30) o hay un producto sin revisar, y Amazon también cuenta las fotos que el catálogo nocturno ya leyó (`catalogo-amazon:asins`, todos los ASIN del color): ese día 32 colores tenían fotos ahí y salían en 0. Las fotos de Amazon se cuentan en TODAS las tallas del color y en su PADRE (`amazon_padres`) y, si el catálogo aún no las publica, en la ficha CAPTURADA por SKU (Listings Items, `fotosCapturadasPorSku`): hasta el 1-oct-2026 solo se miraba el primer ASIN en el catálogo y el dueño veía «0 fotos» en lo que ya había cargado (GT211) | `src/lib/servicios/productos-nuevos.ts` + `-revisar.ts` + `/api/pedidos/nuevos/fotos` |
| Lógica del pedido a China explicada para el dueño | `docs/PLANIFICACION-CHINA.md` |
| Caché del plan                   | `src/lib/servicios/cache.ts` (`plan_cache`) |
| Sugerencia de compra a China (MELI = lo que cada talla VENDE CON STOCK, `engine/demanda-surtida.ts`: días surtidos ≥ 0.75 ponderados por recencia en tandas por conteo 50/30/20, sin tope de 3× ni tendencia, decisión del dueño el 11-oct-2026 «calcular según el stock alto»; sin 14 días surtidos cae a la demanda del plan de Full y el renglón lo dice; `DemandaSku.tasaSurtida` → `LineaGuardada.demandaSurtida` → `demandaChinaDeLinea`; **una talla que va unitalla va SOLO unitalla**, redondeada hacia arriba y fuera de la corrida, y **sin receta de ese color la caja se supone**: la del mismo modelo en otro color, la de UNA talla con que se ha pedido el modelo (`cajasUnitallaDePedidos`; al confirmar un borrador solo las cajas de corrida se vuelven receta, una «SOLID SIZE 16 PRS» no es corrida pero sí dice la caja; dueño, 20-oct-2026) o la estándar de la cuenta (`cajaDeRespaldo`, `RenglonCompra.cajaSupuesta`, declarado en el renglón; dueño, 18-oct-2026); Amazon corregida por agotamiento + TikTok OBSERVADA tal cual, sin tendencia ni agotamiento por decisión del dueño el 5-oct-2026; el stock libre de la bodega de TikTok cuenta como comprado; caché `compras-china:v4`) | `src/lib/servicios/compras.ts` (+ `fba.ts` para el lado Amazon, `tiktok-compras.ts` para TikTok) |
| Lectura de proforma de fábrica   | `src/lib/importar/proforma.ts` + `leer-hoja.ts` |
| Nuevo pedido a China (lista → borrador por modelo → Excel en formato de la fábrica → correo) y Pendientes por enviar | `src/lib/pedidos-china/` (`lista.ts`, `armar.ts`, `fabricas.ts`, `excel.ts`) + `src/lib/servicios/pedidos-borradores.ts`, `pedidos-pendientes.ts` + `src/app/pedidos/{nuevo,pendientes}` + `/api/pedidos/borradores` |
| Envíos separados por bodega      | `src/lib/servicios/envios.ts`               |
| Cargar pedidos (muchas proformas, lista con filtros) y faltantes contra el sheet de pendientes (`PEDIDOS_SHEET_URL`, pestaña por `gid`, AR* ignorados) | `src/app/pedidos/cargar` + `components/cargar-pedidos-lote.tsx` + `src/lib/servicios/pedidos-sheet.ts` |
| CONFIRMACIÓN DE CHINA: China confirma un pedido SUBIÉNDOLO al mismo sheet de pendientes (dueño, 21-oct-2026: «para saber que en China me confirmaron el pedido hay que revisar que lo subieron al sheets; que a las 8 am corra y me salga ahí confirmado o falta confirmar»). `confirmacionDePedidos` (puro, en `pedidos-sheet.ts`) juzga SOLO los pedidos sin barco (estado `creado`): en el sheet = «Confirmado» con la fecha de la columna «Confirm» si la llenaron; fuera = «Falta confirmar»; pares distintos entre el ERP y el sheet se dicen. Órdenes de compra lo enseña en la ficha «Falta confirmar en China», debajo del estado de cada pedido y en la pestaña «Confirmación de China» (el sheet se relee cada 10 min al abrir la pantalla). El cron `/api/cron/confirmacion-pedidos` (14:00Z = 8:00 México) relee el sheet, lo deja masticado (`app_cache` `pedidos-sheet`), anota en `sync_log` tarea `confirmacion-pedidos` (faltan, confirmados, fuera) y la pantalla dice cuándo fue la última revisión y qué vio (`ultimaRevisionConfirmacion`). SIN correo (dueño, mismo día: «no necesito un correo para que me recuerde, solo el cron y poder verlo en el sistema») | `src/lib/servicios/confirmacion-pedidos.ts` + `/api/cron/confirmacion-pedidos` |
| Packing list de la fábrica → contenedor (lector + amarre pedido/modelo/color/talla) | `src/lib/importar/packing-list.ts` + `src/lib/servicios/packing-list.ts` + `/api/contenedores/packing-list` |
| Productos nuevos en camino (pedidos sin stock nunca; fotos en MELI y Amazon, mínimo 2) | `src/lib/servicios/productos-nuevos.ts` (+ `-revisar.ts`, `-fotos.ts`) + `src/app/pedidos/nuevos` + `/api/pedidos/nuevos/fotos` |
| Packing lists desde la carpeta de Drive de la fábrica (cron diario 13:00Z + botón; una subcarpeta por contenedor; solo se entra a los embarques desde el último cargado, `numeroDeEmbarque`; el contenedor ya cargado se reconoce por NÚMERO de embarque, "S259" = "S259-2026"; facturas y pedidos de la misma carpeta se omiten; entran como contenedor `borrador` que el dueño confirma; solo calzado: lo que no amarra con un pedido se omite; un contenedor confirmado no se toca; bitácora en `drive_packing_lists`, migración 0077). SIN llave (decisión del dueño): carpeta pública leída por `embeddedfolderview` + `uc?export=download`; `GOOGLE_DRIVE_API_KEY` es opcional (API v3 con md5); `DRIVE_PACKING_FOLDER_ID` opcional | `src/lib/servicios/drive.ts` + `drive-packing.ts` + `/api/cron/packing-lists` + `/api/contenedores/drive` + `components/packing-drive.tsx` |
| Recordatorios del contenedor por correo (migración 0082, en el cron diario de packing lists): una SEMANA antes de la llegada estimada, las fotos que faltan; el día que LLEGA, aviso de que está en USA. Uno por contenedor (`aviso_previo_en`, `aviso_llegada_en`); lo ya recibido o con más de 30 días de retraso no dispara nada | `src/lib/servicios/avisos-contenedor.ts` |
| Compartir los documentos del embarque: lee la subcarpeta de Drive de ESE contenedor y abre un borrador de correo con los enlaces (un `mailto:` no lleva adjuntos) | `/api/contenedores/[id]/documentos` + botón «Compartir docs» |
| Correo con las fotos que faltan al cargar un contenedor NUEVO (a mano o desde Drive): productos nuevos de sus pedidos sin publicar o con menos de 2 fotos; Resend por HTTP (`RESEND_API_KEY`, `CORREO_REMITENTE`, `CORREO_AVISOS`); constancia en `contenedores.fotos_aviso_en` | `src/lib/servicios/fotos-contenedor.ts` + `correo.ts` |
| Resumen de ventas de AYER por correo a las 8:00 de México (cron `/api/cron/resumen-diario` 14:00Z; pedido del dueño, 28-sep-2026) y cada LUNES además la SEMANA pasada de lunes a domingo (`semanaQueCierra`, `tramosPorMes` si cruza de mes, `sumarFilas`): unidades, facturación y ganancia de calzado, fundas, Amazon y TikTok, las cuatro del motor del corte general recortado a UN día (`cargarConsolidado({ desde, hasta })`); ganancia del día = neto real − costo − publicidad, SIN los gastos que se cobran por mes (van en el corte); lo que aún no tiene depósito o número de TikTok se declara. Abajo, el mes hasta hoy del corte general guardado. Destinatarios `CORREO_RESUMEN_DIARIO` separados por coma (por omisión los tres del dueño, `DESTINATARIOS_RESUMEN`); constancia en `sync_log` tarea `correo-resumen-diario` y no se repite un día ya mandado (`?dia=…&forzar=1` para probar). **Lleva la cara de la página** (dueño, 9-oct-2026): franja café con el logo por URL (`/getac-logo.png`, público), tarjeta blanca sobre crema, tres cifras grandes, tablas con el punto de color de cada plataforma y botón al Estado de resultados; la plantilla y los tonos viven en `correo-marca.ts` (`plantillaCorreo`, `TONO`), todo en línea y en tablas, con reglas para celular | `src/lib/servicios/resumen-diario.ts` + `/api/cron/resumen-diario` |
| Foto de producto junto a cada SKU en Contenedores (columna «Qué viene», Contenido y pendientes del packing list) y Catálogo y costos (pedido del dueño, 11-oct-2026). Sale de lo ya leído del catálogo de Amazon (`catalogo-amazon:asins`, primera foto del ASIN de cada color, activas primero; si no, la imagen del padre) con respaldo del modelo en la foto de TikTok (`tienda_productos`); el color se compara laxo (`claveColor`) y si no amarra se usa la foto del modelo. Masticado en `app_cache` `fotos-producto`, se rearma en cada lectura del catálogo de Amazon. Las fundas no llevan foto. El 11-oct-2026: 136 de 143 modelos de calzado con foto (GT211, GT212, GT215, GT216, GT220, GT222 y GT303 sin fotos en Amazon) | `src/lib/fotos/producto.ts` + `src/lib/servicios/fotos-producto.ts` + `components/ui/foto-producto.tsx` |
| Correo de PUBLICIDAD los LUNES y JUEVES (cron `/api/cron/publicidad-correo` `15 14 * * 1,4` = 8:15 México; dueño, 11-oct-2026: «qué cambios hay que hacer» en publicidad, «en los 3: Amazon, MELI calzado y MELI fundas, lunes y jueves, solo lo recibo yo»): las MISMAS recomendaciones del panel de Publicidad (`armarRecomendaciones`: gasto × stock × margen) sobre los 14 días completos hasta ayer, una sección por canal y agrupadas como en la pantalla (apagar/pausar, bajar, subir/encender, anunciar). Calzado = Product Ads + stock de Full. Fundas (`publicidadFundas`) = Product Ads de la cuenta de fundas por DISEÑO + `yz_stock_full`, con cobertura corta 5 días y larga 30 (a Full se le manda para 15; con 14/45 casi toda funda saldría «por agotarse»). Amazon (`publicidadAmazon`) = SKU Economics por SKU (gasto, venta y margen ANTES de publicidad = neto + publicidad − costo, mismos días; llega con días de retraso y el correo dice hasta cuándo) + stock de FBA (disponible + enviado + recibiendo + transferencia); Amazon no dice qué anuncio está pausado: modelo con gasto = anunciado; historia de toda la vida (`amazon_historia_sku`). Cada envío guarda su lista en `sync_log` tarea `correo-publicidad` y el siguiente la compara (`compararConAnterior`, por canal + modelo + acción): lo NUEVO desde el correo anterior va marcado, lo pendiente dice desde hace cuántos días y lo que ya no sale va en «Ya no hace falta»; un canal que no se pudo leer no da nada por resuelto y su lista se arrastra. **TACOS tope 10 %** (`TACOS_TOPE`, regla del dueño, 14-oct-2026: «el TACOS ideal que tenemos es 10 %, no hay que gastar más que eso»): arriba del 10 % de la venta del modelo se pide BAJAR (aunque el margen aguante) con el gasto al día que lo deja en el tope; SUBIR solo con TACOS abajo del 5 % y hasta ese 10 %; el correo marca en rojo el canal que pasa del tope. **Y mira el PRESUPUESTO DE HOY de cada campaña** (`presupuestoPorModelo` con `traerCampanasAds`, calzado y fundas; 14-oct-2026, dueño: «me llegó subir el gasto en fundas 650 pero ya se había subido»): el gasto de 14 días va atrasado, así que no se pide subir si el presupuesto de hoy ya llega al ~10 % ni bajar si ya está ahí; mover menos de `GASTO_DIA_MINIMO` ($10) al día tampoco se pide. Amazon no da presupuestos por aquí. **PRODUCTO POSICIONADO: bajar el gasto** (`esPosicionado`, regla 4b de `armarRecomendaciones`, calzado y fundas; dueño, 16-oct-2026: «no vale la pena gastar en productos ya posicionados, quiero revisar cuáles ya están estables y bajarles el gasto»): vende ≥ `POSICIONADO_RITMO_MIN` (10) al día hoy y en los 60 días anteriores (`ritmoPrevioDeModelo`, de `unidades_prev` de `ventas_resumen_sku` y de `yz_ventas_resumen`), la venta no cambió fuera de 0.8×–1.5× y a lo más el 50 % de lo vendido lo atribuye MELI a la publicidad → bajar el gasto a la MITAD, aunque el TACOS sea bajo, y nunca «subir»; si el presupuesto de hoy ya anda en la mitad no se repite, y a las dos semanas, si sigue igual, vuelve a pedir otra mitad. Medido ese día en calzado: MY2307, GT114, GT142, GT134, GT110 y GT135 entre 27 % y 50 % por publicidad; el resto de los modelos con anuncio, 70–120 %. Amazon no se toca (no hay unidades por publicidad por aquí). **Y el correo lista TODAS las campañas de MELI** (calzado y fundas; `armarDependencias`, `clasificarDependencia`, `DependenciaAds`; dueño, mismo día: «hazme de todas las campañas que tengo de qué dependo»): por modelo con gasto, sus campañas, venta al día contra los 60 días anteriores, % de lo vendido por anuncio, gasto al día y presupuesto de hoy, TACOS y la clase —posicionado, en medio (50–70 % por anuncio), depende (≥ 70 %), creciendo (> 1.5× o nuevo), cayendo (< 0.8×) o gasta sin vender— con el resumen de gasto por clase; queda en `porCanal.dependencias` de la bitácora. **«Pausar» solo con el anuncio CORRIENDO y sin bodega para reponer** (`anuncioCorriendo`, `stockBodegaDeModelo`; dueño, mismo día: «GT181 me pones que apague pero ya está pausado», «GT259 me pones que pause porque no hay stock, pero sí hay en mi bodega»): «paused», «hold» (MELI lo detiene sola sin stock) e «idle» ya no cuentan como prendidos —GT181 tenía tres tallas en hold y por eso seguía saliendo—, y si las bodegas propias (`inventario_cache` en calzado, `yz_inventario` en fundas) más Full cubren la cobertura corta, no se pausa: lo que falta es mandar a Full (GT259: 47 pares en Full y 528 en bodega). **ROAS objetivo en vez de presupuesto** (`roasObjetivoPorModelo`, `roasDeCampana` —`roas_target` o 100 ÷ `acos_target`—, `roasParaGasto`, `PRESUPUESTO_LLENO` 0.8; dueño, mismo día: «el presupuesto es 150 y gasta 50 […] si está bien posicionado, en vez de bajar el gasto podemos subir el ROAS objetivo, o al revés, bajarlo para que se mueva mejor»): para BAJAR el gasto (tope de TACOS o posicionado) se pide SUBIR el ROAS objetivo de la campaña; para SUBIRLO, si el presupuesto no se gasta (gasto al día < 80 % del de hoy), BAJAR el ROAS objetivo sin pasar del piso que deja la publicidad en el 10 % de la venta (ventas por anuncio ÷ venta ÷ 0.10); con el presupuesto lleno, subir el presupuesto como antes. El ROAS nuevo es el objetivo de HOY movido por la proporción de gasto que se busca, en pasos de 15 % a 50 % (bajar a la mitad = ×1.5); NO se parte del ROAS real, que MELI deja muy arriba del objetivo (GT135: objetivo 8, real 22; la primera versión pedía subirlo a 33.6). Lo ya movido se reconoce por el gasto de los últimos `DIAS_GASTO_RECIENTE` (3) días (`gastoDiaPorModelo`): si ya llegó a la meta, no se vuelve a pedir. Sin ROAS objetivo (campaña automática) se queda la regla del presupuesto. La lista de campañas enseña ROAS objetivo y real. Desde ese día las recomendaciones (panel y correo) también piden anuncio para un PRODUCTO NUEVO con stock y sin anuncio (no vendía antes del periodo; hasta `MAX_NUEVOS_SIN_ANUNCIO` 10, los de más stock). Va SOLO al dueño (`DESTINATARIO_PUBLICIDAD`; `CORREO_PUBLICIDAD` lo cambia); `?forzar=1&para=…` para probar | `src/lib/servicios/publicidad-correo.ts` + `publicidad-canales.ts` + `/api/cron/publicidad-correo` |
| Precios de Números → MELI y Amazon (Números → «Llevar precios a MELI y Amazon»: revisar en vivo y aplicar relámpago = precio relámpago, Buen Fin y todos los días = PV normal a .99, Amazon = PVP deal a .99 y su PRECIO MÍNIMO más de 15 % abajo en .99, `precioMinimoAmazon`, copiando lo demás de `purchasable_offer`; el dueño elige qué oferta es cada promoción; una relámpago candidata se inscribe reservando pares: lo que pida MELI o, sin mínimo, 5 y luego 1, «la cantidad no me importa». El rango min–max de MELI solo avisa: decide MELI. Una promoción CON APORTE de MELI (`meli_percentage` × precio original) que deja la venta en ≥ $299 cuando el precio propio es menor NO se toca (`cruzaEnvioPorAporte`, `pagarias_envio`): arriba de $299 el vendedor paga el envío; dueño, 14-oct-2026, GT266 en Buen Fin 26. Solo se deja sin tocar cuando MELI MANDA su aporte y con él cruza los $299; sin el dato NO se supone nada (dueño, 18-oct-2026: GT151 a $249.99 y GT272 a $298.99 en Buen Fin 26, «no es con aporte» — antes se suponía aporte en todo Buen Fin y luego un 3 %, y las dos veces se quedaron sin inscribir precios buenos)). Cron `/api/cron/relampagos` a las 10:00 de México (16:00Z) y a las 00:30 (06:30Z): inscribe TODAS las relámpago candidatas al precio relámpago de Números (MELI rechaza lo que no acepta), con los pares de arriba; bitácora `sync_log` tarea `relampagos-auto` (dueño, 13 y 14-oct-2026). **Todas las relámpago de una publicación comparten `promotion_id` (LGH-MLM1000)**: sin el folio de la propuesta (llega como `ref_id` «CANDIDATE-MLM…-…» en `/seller-promotions/items/{id}` y viaja en el POST como `offer_id`; el 20-oct-2026 sin él entraron 88 de 737) MELI inscribe UNA fecha y contesta «sí» a las demás (GT183, 17 al 19-oct-2026: dos «inscritas» al día y la del 20-oct siguió como propuesta). Por eso, tras inscribir, se relee cada publicación y las «inscritas» que siguen como propuesta pasan a fallidas («MELI contestó que sí pero…»); la bitácora guarda una `muestra` cruda de las propuestas que quedaron. **Y por el API MELI deja UNA SOLA relámpago programada por publicación** (prueba del 20-oct-2026, `GET /api/finanzas/numeros/relampagos/prueba`, bitácora `relampagos-prueba`; GT130 con la del 21-oct ya «pending»: seis formas del POST contestaron «sí» y todas devolvieron la MISMA `OFFER-…` del 21-oct, solo le cambiaron el precio; la del 23-oct siguió candidata; en la página «Participar» sí deja varias): una publicación con relámpago `pending`/`started` no se intenta (va a omitidas, una vez por publicación) y de las demás se inscribe UNA fecha por corrida; la siguiente entra cuando pase la programada, y la corrida de las 00:30 alcanza la relámpago del día en cuanto termina la de ayer. Botón «Confirmar relámpagos» en Números hace lo mismo a mano (`POST /api/finanzas/numeros/relampagos`, `origen: manual` en la bitácora; dueño, 16-oct-2026: para cuando el asesor carga ofertas) | `src/lib/precios/promociones.ts` + `src/lib/servicios/precios-modelos.ts` + `/api/finanzas/numeros/precios` |
| Ofertas MELI: ofertas CON APORTE de Mercado Libre (SMART, PRICE_MATCHING, MARKETPLACE_CAMPAIGN, UNHEALTHY_STOCK, PRE_NEGOTIATED) a las que invitan al calzado; se aceptan las que cumplen el PV NORMAL de Números contando el aporte: precio al cliente + aporte de MELI ≥ PV normal (a .99, como «Llevar precios»), y si el precio queda abajo de $299 pero con el aporte cruza los $299 (y el PV normal está abajo de $299) se resta el envío de Números y solo se acepta si aun así cumple (dueño, 19-oct-2026: «aceptar todas las ofertas con aporte que cumplen los criterios de Números para precio normal», automático y solo calzado). Relámpago, Buen Fin y todos los días NO se tocan aquí (son de Números y del cron de relámpagos). Lectura en bloque: `/seller-promotions/users/{id}` y `/seller-promotions/promotions/{id}/items` por `search_after`, no una llamada por publicación; aceptar = `POST /seller-promotions/items/{item}` con `promotion_id`, `promotion_type` y el `offer_id` si el tipo lo lleva. Sin precio, aporte u `offer_id` NO se acepta nada (`sin_datos`); con aporte 0 % va a «Sin aporte de MELI» (`sin_aporte`): «Acelera tus ventas de Full» (UNHEALTHY_STOCK) llegó así, con todo el descuento del vendedor. Masticado en `app_cache` `ofertas-meli`; cron `/api/cron/ofertas-meli` cada hora (`20 * * * *`) que revisa y, con «Aceptar solas» prendido (`app_cache` `ofertas-meli:config`; se prendió el 19-oct-2026 tras verificar la primera lectura real: `price` es lo que paga el cliente y llegan `offer_id`, `original_price` y `meli_percentage`), acepta; botones «Revisar ahora» y «Aceptar las que cumplen»; candado `ofertas-meli`; bitácora `sync_log` tarea `ofertas-aporte` con lo aceptado, lo rechazado por MELI y una muestra cruda de lo que contestó | `src/lib/precios/ofertas-aporte.ts` (puro con pruebas) + `src/lib/servicios/ofertas-meli.ts` + `src/app/ventas/ofertas` + `/api/ventas/ofertas` |
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
| TikTok: Devoluciones (leer las de TikTok, confirmar recibido = reembolso, par al stock o a la basura) | `src/lib/tiktok/devoluciones.ts` + `src/lib/servicios/tiktok-devoluciones.ts` + `src/app/tiktok/devoluciones` + `/api/tiktok/devoluciones` |
| TikTok: Productos de David (vendedor externo: ligar publicaciones, su stock a mano, sus cortes aparte, fuera de la ganancia del dueño) | `src/lib/tiktok/externos.ts` + `src/lib/servicios/tiktok-externos.ts` + `src/app/tiktok/externos` + `/api/tiktok/externos` + `/tiktok/despacho?vendedor=david` |
| TikTok: Ofertas relámpago desde el panel (ver las de TikTok, crear la general de 3 días con los precios de la estrategia, repetir, desactivar) | `src/lib/tiktok/promociones.ts` + `src/lib/servicios/tiktok-promociones.ts` + `src/app/tiktok/promociones` + `/api/tiktok/promociones` |
| TikTok: Productos nuevos (publicar en TikTok el calzado de Amazon) | `src/lib/tiktok/publicar.ts` + `src/lib/servicios/tiktok-publicar.ts` + `src/app/tiktok/nuevos` + `/api/tiktok/publicar-productos` |
| Videos de producto (Higgsfield). **El MCP a veces contesta con una PREGUNTA en vez de folio** y el ERP la contesta solo (`generarContestandoAvisos` / `paramsTrasAviso` en `higgsfield/mcp.ts`, hasta `REINTENTOS_POR_AVISO` 3): `unlim_choice` → `use_unlim: true` (las generaciones de prueba son gratis) y `notice.type = preset_recommendation` («tu prompt se parece al preset X, ¿lo usas o generas literal?») → se vuelve a llamar con `declined_preset_id` = ese preset para generar LITERAL lo pedido (24-sep-2026: david veía «El Studio no devolvió folio: {"notice":…}» y no había a quién contestarle). Lo que siga sin folio se enseña con el crudo completo. La sonda `/api/videos/diagnostico?llave=…&herramienta=generate_video` enseña el esquema de la herramienta | `src/lib/higgsfield/` + `src/app/videos` + `/api/videos/*` |
| ERP YAPANIZCEL (fundas)          | `src/lib/yapanizcel/` (`sku.ts`, `plan.ts`, `sheets.ts`, `sync.ts`, `ventas.ts`, `compras.ts`, `pedidos.ts`) + `src/app/yapanizcel/*` + `/api/yapanizcel/*` |
| Tienda en línea de GETAC (catálogo copiado de TikTok, pedidos y despacho en el ERP) | `src/lib/tienda/` + `src/lib/servicios/tienda-catalogo.ts`, `tienda-pedidos.ts` + `src/app/tiktok/tienda` + `/api/tiktok/tienda/*`; la página pública vive en `tienda/` |
| GETAC Wrapped (`/cortes/wrapped`, «GETAC Wrapped» en Negocio y botón en Año del negocio; dueño, 18-oct-2026: «algo divertido de mi negocio que esté padre»): el año del negocio (mayo a abril) en tarjetas tipo historia —unidades y ritmo, pares en fila en km y vueltas al Zócalo, modelo estrella y el que más dejó con su foto, mejor día, hora y día de la semana pico, canal favorito, categoría reina, mejor mes cerrado y utilidad neta— con copiar/WhatsApp al final. Sale del año ya sumado (`leerAnio`) y de `ventas_por_hora` de los cuatro canales; masticado en `app_cache` `wrapped:v1:{ejercicio}` (6 h). Una tarjeta sin datos no sale | `src/lib/servicios/wrapped.ts` (puro con pruebas) + `wrapped-cargar.ts` + `components/wrapped-getac.tsx` |
| Inicio (`/`): el filtro de fechas de Ventas (Hoy por omisión) y todo lo de abajo sigue al rango —cifras, gráfica, por canal y modelos que más venden (RPC `inicio_ventas_skus`, migración 0149: lo vendido por SKU en los cuatro canales, agrupado por `modeloUnificado`, sin los «D-» de David)—; utilidad solo en «Este mes» y «Hoy contra ayer» solo en Hoy. Sin «Para hoy» ni el aviso del plan (dueño, 19-oct-2026) | `src/app/page.tsx` |
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
