# Planificación China — cómo decide el ERP qué pedir

Motor en `src/lib/servicios/compras.ts` (`sugerirCompra`). Nada de esto se
estima con porcentajes: todo sale de ventas reales, stock real y pedidos
cargados.

## 1. La unidad es MODELO + COLOR, no la talla

La fábrica no fabrica tallas sueltas: fabrica cajas con una corrida adentro.
Por eso el pedido se decide por color, y la talla solo decide **cómo se
reparten** las cajas (corrida vs. unitalla).

**Familias: modelos que se piden juntos** (`modelos_familias`, migración
0148; `pedidos-china/familias.ts`; dueño, 20-oct-2026: «tengo un modelo que
es el GT117 a GT122, quiero juntarlo todo para que se pida junto»). GT117
BROWN, GT118 BLK, GT119 OLIVE, GT120 GREY, GT121 NAVY y GT122 BLK son el
mismo zapato en seis colores (una sola publicación en MELI, un solo IN de
Mingtai). El cálculo sigue siendo por modelo + color (cada número tiene su
propia receta y su propia venta), pero el renglón lleva `familia` y la
tabla «Pedido por modelo» los enseña como UN modelo con cada número como un
color más; el «Excel del pedido» de la familia trae todos sus modelos. En
Nuevo pedido todo lo que se pega junto ya es UN borrador (un IN, un Excel
con el modelo en cada renglón; dueño, 20-oct-2026) y la familia solo le da
el nombre. Se dan de alta en la propia pantalla («Modelos que se piden
juntos»).

## 2. El inventario que cuenta es TODO el que existe

    en Full + viajando a Full + en cajas en bodega + en FBA y viajando a FBA
    + libre en la bodega de TikTok (saldo del kardex − apartado)
    + en el barco (pedidos cargados que no han llegado)

- Contar solo la bodega pediría de más (lo de Full ya está comprado).
- Olvidar el barco pediría dos veces lo mismo: el error caro cuando el
  ciclo dura meses.
- Un pedido cargado cuenta como "en camino" hasta que su contenedor se
  marca recibido; lo que ya llegó lo trae el API de Industher como bodega.

## 3. La demanda es la de los TRES canales

Demanda diaria del color = suma de lo que cada SKU **vende cuando tiene
stock** en MELI **+** la venta diaria de esos SKUs en Amazon (corregida por
agotamiento con las fotos de FBA) **+** la venta diaria de TikTok. Pedir
solo con MELI deja corto todo lo que también vende en FBA y en TikTok.

**MELI: «según el stock alto»** (decisión del dueño, 11-oct-2026; motor en
`engine/demanda-surtida.ts`). De la ventana de 90 días se toman solo los
DÍAS SURTIDOS (stock al menos tres cuartas partes del día); los agotados y
los de poco stock no diluyen el promedio. Esos días se parten en tandas por
conteo (los últimos 30 surtidos, los 30 anteriores, el resto) que pesan
50 / 30 / 20: si las últimas semanas surtidas son las mejores, esas mandan,
pero nunca se extrapola más allá de lo que de verdad vendió. No hay tope de
3× ni tendencia: el GT104 BLK vendía 560 pares al mes surtido y el tope lo
dejaba en 480; el GT104 NAVY nunca pasó de 800 surtido y la tendencia lo
subía a 1,037. Una oferta de una semana entra con su peso (7 de 30 días al
50 %), no se vuelve la nueva normal; una que dura el mes entero sí sube la
demanda. Con menos de 14 días surtidos en la ventana (producto nuevo, o
agotado casi siempre) no hay dato y esa talla usa la demanda del plan de
Full, como antes; el renglón lo dice («N de M tallas usan la demanda del
plan de Full»). El plan de Full no cambia: su horizonte es de 30 días y ahí
la tendencia reciente sí ayuda.

**TikTok entra TAL CUAL se vendió** (unidades de los últimos 30 días ÷ 30),
sin corrección por agotamiento ni por tendencia. Decisión del dueño
(5-oct-2026): «no quiero que me tomes eso de que subes las ventas según la
tendencia porque no es predecible». Motor en
`servicios/tiktok-compras.ts`.

Un color que vende menos de `ventaMinimaDiaria` (0.1 pares al día) y no
tiene inventario, no aparece.

## 4. La cuenta

| Parámetro (Ajustes)      | Hoy | Qué es                                  |
|--------------------------|-----|-----------------------------------------|
| `diasProduccion`         | 45  | lo que tarda la fábrica                 |
| `diasTransito`           | 45  | barco + aduana + traslado a bodega      |
| `diasCobertura`          | 90  | venta que quieres tener en piso al llegar |
| `umbralAgotamientoDias`  | 100 | solo clasifica el mensaje (ver 6)       |

    ciclo     = producción + tránsito                 (90 días)
    horizonte = ciclo + cobertura                     (180 días)
    objetivo  = demanda diaria × horizonte
    faltante  = objetivo − inventario total           (nunca negativo)
    cajas     = faltante ÷ pares por caja, redondeado HACIA ARRIBA

Se redondea hacia arriba a propósito: una caja de más cuesta el inventario
de una caja; una de menos cuesta quedarse sin talla a medio ciclo y esperar
tres meses.

## 5. El faltante se mide POR TALLA, exacto

El agregado engaña: 500 pares de sobra en la 29 "tapan" el faltante de la
25 y el color se quedaba sin pedir justo lo que se le agotó. Por eso la
puerta del pedido es el faltante por talla: demanda de esa talla en el
horizonte menos TODO su stock, sin amortiguar (decisión del dueño: el
Pedido tiene que cuadrar con el Detalle SKU).

## 6. Cómo se reparte en cajas

- **Pares por caja**: el total histórico de la corrida llevado al tamaño
  real de fábrica más cercano (12 / 24 / 36 / 48; en empate, la grande).
  **Sin receta de ese color, la caja se supone** (`cajaDeRespaldo`; dueño,
  18-oct-2026: «¿para qué necesitas la proforma para poder calcular qué
  hay que pedir?»): primero la receta más reciente del MISMO MODELO en otro
  color, si no la caja ESTÁNDAR de la fábrica (la más frecuente entre todas
  las recetas de la cuenta). La corrida se propone por venta, como siempre,
  y el renglón dice qué caja se supuso. Solo sin NINGUNA receta en la
  cuenta queda sin cajas.
- **Unitalla**: una talla se separa en cajas de una sola talla cuando ella
  sola justifica al menos 5 cajas (`UNITALLA_MIN_CAJAS`). No hay mínimo por
  color: exigirlo obligaba a inflar la corrida entera para acompletar una
  talla corta. **Una talla que va unitalla va SOLO unitalla** (dueño,
  18-oct-2026: «muchas veces me pides del mismo modelo y talla caja unitalla
  y caja de corrida; mejor dame solo unitalla»): su faltante completo se
  redondea a cajas hacia arriba y esa talla sale de la corrida. Antes el
  pico que no llenaba caja se colaba a la corrida.
- **Corrida**: el faltante de las tallas que NO van unitalla se reparte
  entre ellas en proporción a su faltante, en enteros que suman exacto.
- **Corrida vs. venta real**: si la caja trae 3 pares del 25 y 15 del 27
  pero el 25 es el que se mueve, el renglón lo dice. No cambia lo que se
  pide (la caja viene como viene); es lo que hay que reclamarle a la
  fábrica antes de confirmar.

## 7. La urgencia (semáforo)

    cobertura = inventario total ÷ demanda diaria   (días)

| Urgencia  | Cuándo                                   |
|-----------|------------------------------------------|
| quiebre   | cobertura 0                              |
| urgente   | cobertura < medio ciclo (45 días)        |
| pronto    | cobertura < un ciclo (90 días)           |
| ok        | entre un ciclo y 2.5 ciclos              |
| sobrado   | cobertura > 2.5 ciclos (225 días)        |

`regimen` solo cambia el texto del renglón: "se agota" si el stock se acaba
antes de que llegue el pedido (cobertura < `umbralAgotamientoDias`),
"repone" si va a sobrar. La fecha de quiebre es hoy + cobertura.

## 8. Qué NO hace

- No corrige la venta de TikTok: entra la observada, punto (ver 3).
- No estima demanda de productos sin venta: un producto nuevo entra por su
  venta real en cuanto la tiene.
- No descuenta stock "a medias": el faltante es exacto siempre.

## Para ajustar

Los cuatro parámetros viven en Ajustes. Subir `diasCobertura` pide más
piso; subir `diasTransito` adelanta el pedido. El Excel del pedido trae el
Detalle SKU con cada número que alimenta la sugerencia, para auditar de
dónde sale cada caja.
