# Industher ↔ ERP: la bodega "TikTok"

Instrucciones para el sistema de Industher (`inventarios-industher.vercel.app`).
Quién lee esto: la persona que mantiene ese sistema. Qué se necesita: dos
cosas, una que ya debería funcionar y una nueva.

## Por qué

TikTok Shop se surte desde una bodega propia en Industher que se llama
"TikTok" (o "Tik Tok", da igual cómo esté escrita; el ERP la reconoce por
el nombre). La regla que acordamos es:

- **Industher SUMA**: cada vez que llega mercancía a esa bodega, Industher
  la registra. El ERP lee ese número y lo toma como ENTRADAS.
- **Industher NO descuenta por su cuenta.** Los pedidos de TikTok los
  descuenta el ERP: un pedido pagado aparta, y cuando en el ERP se hace el
  "corte" del día (se confirman los envíos a TikTok y se imprimen las guías),
  el ERP le MANDA a Industher las salidas de ese corte para que su número
  también baje.

Si Industher descontara solo, o el ERP no le mandara las salidas, los dos
sistemas se separarían y el ERP leería como "entradas" o "mermas" cosas que
no lo son.

## 1. La bodega TikTok tiene que venir en el endpoint de inventario

Endpoint que el ERP ya consume, con la llave que ya tiene:

```
GET https://inventarios-industher.vercel.app/api/integracion/inventario
x-api-key: <la misma llave de siempre>
```

Hoy la respuesta NO trae la bodega TikTok (o viene con otro nombre). Se
necesita que sus cajas aparezcan igual que las de las otras bodegas, con
`warehouse.name` que empiece con "TikTok" / "Tik Tok", y con el detalle de
SKU y piezas por caja, porque el ERP cuenta PARES:

```
pares del SKU = Σ (cajas físicas de la caja × piezas de ese SKU en la caja)
```

Se cuentan las cajas FÍSICAS (disponibles + apartadas): en esta bodega no
hay "apartado para Full".

Importante: esta bodega maneja PARES SUELTOS. Un pedido de TikTok saca un
par, no una caja. Si el sistema de Industher solo sabe de cajas completas,
para la bodega TikTok se necesita que una caja pueda quedar parcial (o que
cada par sea una "caja" de 1 pieza). Si no, la salida del punto 2 no se
puede aplicar.

## 2. Endpoint nuevo: recibir las salidas de cada corte

El ERP hace un POST después de cada corte (y lo reintenta cada 15 minutos
mientras no reciba un `200`):

```
POST https://inventarios-industher.vercel.app/api/integracion/salidas
x-api-key: <la misma llave>
content-type: application/json
```

Cuerpo:

```json
{
  "referencia": "TT-CORTE-7",
  "fecha": "2026-09-02T15:04:05.000Z",
  "almacen": "TikTok",
  "salidas": [
    { "sku": "GT135-DK BROWN-26", "modelo": "GT135", "color": "DK BROWN", "talla": "26", "pares": 1, "pedido": "5798xxxxxxxxxxxxxx" },
    { "sku": "GT150-CAMEL-25",    "modelo": "GT150", "color": "CAMEL",    "talla": "25", "pares": 2, "pedido": "5798yyyyyyyyyyyyyy" }
  ]
}
```

- `referencia`: única por lote. `TT-CORTE-n` para un corte; `TT-REINTENTO-…`
  cuando el cron vuelve a mandar lo que quedó sin confirmar.
- `sku`: el SKU tal cual está en el ERP (MODELO-COLOR-TALLA). `modelo`,
  `color` y `talla` van ya separados por si el amarre lo hacen por piezas.
- `pares`: cuántos pares descontar de ese SKU en la bodega TikTok.
- `pedido`: el número de pedido de TikTok, solo para rastrear.

Respuesta esperada:

```json
{ "ok": true, "aplicadas": 3 }
```

Reglas:

1. **Idempotente por `referencia`.** Si llega dos veces la misma
   referencia, la segunda contesta `200 { "ok": true, "aplicadas": 0 }` y no
   descuenta nada. Es lo que evita el doble descuento si el ERP reintenta.
2. Descontar los `pares` de la bodega TikTok, por SKU. No tocar ninguna
   otra bodega.
3. Si un SKU no existe o no alcanza, NO rechazar todo el lote: aplicar lo
   que se pueda y contestar `200` con `"ok": true` y una lista de lo que no
   se pudo, por ejemplo `"rechazadas": [{ "sku": "…", "motivo": "…" }]`. El
   ERP guarda el texto de la respuesta. Un `4xx`/`5xx` hace que el ERP
   reintente el lote completo cada 15 minutos.
4. Mientras el endpoint no exista, el ERP recibe `404` y lo reporta como
   "Industher todavía no tiene el endpoint de salidas"; no es un error del
   corte.
5. Una llave incorrecta debe contestar `401`.

Si prefieren otra ruta, solo hay que decirla: el ERP la lee de la
variable `INDUSTHER_SALIDAS_URL` (por omisión usa
`/api/integracion/salidas`, al lado del endpoint de inventario).

## Cómo comprobarlo

1. Registrar una entrada de prueba en la bodega TikTok (por ejemplo 2 pares
   de un SKU). En el ERP, botón "Sincronizar" en Almacén TikTok: debe
   aparecer una ENTRADA de 2 con referencia `industher:…`.
2. Hacer un corte en el ERP con un pedido de ese SKU. El ERP hace el POST;
   en `/tiktok/despacho` el corte muestra "Salidas 3PL" confirmadas.
3. Volver a sincronizar: el número de Industher bajó en 1 y el ERP lo
   atribuye a esa salida (no genera merma ni entrada).

## Lo que NO hay que hacer

- No descontar pedidos de TikTok por cuenta propia en Industher: el ERP
  ya los descuenta y se los manda.
- No borrar y volver a crear la mercancía de la bodega TikTok como
  "ajuste": el ERP lee las DIFERENCIAS del acumulado. Una baja que no
  corresponda a una salida mandada por el ERP se registra como MERMA en el
  kardex de TikTok.
