# Planificación China — cómo decide el ERP qué pedir

Motor en `src/lib/servicios/compras.ts` (`sugerirCompra`). Nada de esto se
estima con porcentajes: todo sale de ventas reales, stock real y pedidos
cargados.

## 1. La unidad es MODELO + COLOR, no la talla

La fábrica no fabrica tallas sueltas: fabrica cajas con una corrida adentro.
Por eso el pedido se decide por color, y la talla solo decide **cómo se
reparten** las cajas (corrida vs. unitalla).

## 2. El inventario que cuenta es TODO el que existe

    en Full + viajando a Full + en cajas en bodega + en FBA y viajando a FBA
    + en el barco (pedidos cargados que no han llegado)

- Contar solo la bodega pediría de más (lo de Full ya está comprado).
- Olvidar el barco pediría dos veces lo mismo: el error caro cuando el
  ciclo dura meses.
- Un pedido cargado cuenta como "en camino" hasta que su contenedor se
  marca recibido; lo que ya llegó lo trae el API de Industher como bodega.

## 3. La demanda es la de los DOS canales

Demanda diaria del color = suma de la demanda corregida de sus SKUs en MELI
(la misma del plan de Full: venta real ÷ días con stock, corregida por
agotamiento) **+** la venta diaria de esos SKUs en Amazon. Pedir solo con
MELI deja corto todo lo que también vende en FBA.

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
- **Unitalla**: una talla se separa en cajas de una sola talla cuando ella
  sola justifica al menos 5 cajas (`UNITALLA_MIN_CAJAS`). No hay mínimo por
  color: exigirlo obligaba a inflar la corrida entera para acompletar una
  talla corta.
- **Corrida**: el resto del faltante se reparte entre tallas en proporción
  a su faltante, en enteros que suman exacto.
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

- No pide para TikTok (su bodega no existe para el calzado).
- No estima demanda de productos sin venta: un producto nuevo entra por su
  venta real en cuanto la tiene.
- No descuenta stock "a medias": el faltante es exacto siempre.

## Para ajustar

Los cuatro parámetros viven en Ajustes. Subir `diasCobertura` pide más
piso; subir `diasTransito` adelanta el pedido. El Excel del pedido trae el
Detalle SKU con cada número que alimenta la sugerencia, para auditar de
dónde sale cada caja.
