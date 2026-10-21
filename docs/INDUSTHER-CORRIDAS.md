# Instrucciones para el sistema de Industher: leer las CORRIDAS del ERP de GETAC

> Este documento es para el Claude (o la persona) que programa el sistema de
> inventarios de Industher (`inventarios-industher.vercel.app`). Pégalo
> completo como instrucción.

## Qué es una corrida y para qué la quieres

GETAC vende calzado. Sus cajas vienen de China CERRADAS y **nunca se abren**.
Muchas cajas son **mixtas**: traen varias tallas del mismo modelo y color.
La **corrida** es la receta de una caja: cuántos pares de cada talla trae.

Ejemplo: una caja `IN10079 · GT221 · LT BROWN` con corrida
`{ "23": 5, "24": 10, "25": 13 }` trae 28 pares: 5 del 23, 10 del 24 y 13
del 25.

Hoy Industher registra cajas por pedido + modelo + color (y a veces talla).
Con la corrida, cada caja de tu bodega dice **qué pares trae adentro**, sin
abrirla y sin capturarlo a mano.

Hay dos clases de caja:

| Clase | Cómo se ve | Ejemplo |
|---|---|---|
| **Corrida** (mixta) | varias tallas en la misma caja | `IN10079 · GT221 · LT BROWN` → `{23:5, 24:10, 25:13}` |
| **Unitalla** | una sola talla por caja | `IN10121 · GT114 · TABACO BROWN` talla 25 → `{25:24}` |

## El API (solo lectura, el ERP no te escribe nada)

```
GET https://meli-erp-full.vercel.app/api/integracion/corridas
Header: x-api-key: <CORRIDAS_API_KEY>
```

La llave te la da el dueño (Abraham). Guárdala en tu variable de entorno
`GETAC_CORRIDAS_API_KEY`. **Nunca en el código ni en el repo.**

### Parámetros (query)

| Parámetro | Por omisión | Qué hace |
|---|---|---|
| `limit` | 1000 | renglones por página (1 a 1000) |
| `offset` | 0 | desde qué renglón |
| `desde` | — | fecha ISO (`2026-10-21T14:00:00Z`): solo las corridas creadas o cambiadas DESPUÉS de esa hora |

El orden es estable (`actualizadoEn`, pedido, modelo, color), así que
paginar con `offset` no pierde ni repite renglones.

### Respuesta

```json
{
  "ok": true,
  "generado": "2026-10-21T19:20:00.000Z",
  "total": 1612,
  "limit": 1000,
  "offset": 0,
  "hayMas": true,
  "corridas": [
    {
      "pedido": "IN10079",
      "modelo": "GT221",
      "color": "LT BROWN",
      "unitalla": false,
      "talla": null,
      "tallas": { "23": 5, "24": 10, "25": 13 },
      "paresPorCaja": 28,
      "barcode": "IN10079-GT221-LT-BROWN",
      "clave": "IN10079|GT221|LT BROWN",
      "origen": "proforma",
      "actualizadoEn": "2026-10-20T10:00:00.000Z"
    },
    {
      "pedido": "IN10121",
      "modelo": "GT114",
      "color": "TABACO BROWN",
      "unitalla": true,
      "talla": "25",
      "tallas": { "25": 24 },
      "paresPorCaja": 24,
      "barcode": "IN10121-GT114-TABACO-BROWN-25",
      "clave": "IN10121|GT114|TABACO BROWN-25",
      "origen": "sheet",
      "actualizadoEn": "2026-10-20T11:00:00.000Z"
    }
  ]
}
```

| Campo | Significado |
|---|---|
| `pedido` | el pedido a China (IN…, AR…) |
| `modelo` | modelo del zapato (GT221, GT104-5…) |
| `color` | color SIN la talla (así lo escribe el pedido de la fábrica) |
| `unitalla` | `true` = caja de una sola talla |
| `talla` | la talla de la caja unitalla; `null` en una caja de corrida |
| `tallas` | pares por talla DENTRO DE UNA CAJA (no son totales del pedido) |
| `paresPorCaja` | suma de `tallas` |
| `barcode` | la etiqueta de caja que se mandó a China: PEDIDO-MODELO-COLOR(-TALLA), espacios → guion. Es el mismo barcode del CSV «Bodega: productos» |
| `clave` | llave única de la corrida en el ERP. **Úsala como llave del upsert** |
| `origen` | de dónde salió (proforma, sheet, manual…). Solo informativo |
| `actualizadoEn` | última vez que cambió en el ERP |

Errores: `401` si la llave no es válida y `400` si un parámetro está mal
(el cuerpo trae `{ "error": "…" }`).

## Qué programar en Industher

### 1. Tabla propia de corridas

Algo así (ajústalo a tu base):

```sql
create table getac_corridas (
  clave           text primary key,       -- "IN10079|GT221|LT BROWN"
  pedido          text not null,
  modelo          text not null,
  color           text not null,
  unitalla        boolean not null,
  talla           text,
  tallas          jsonb not null,          -- {"23":5,"24":10}
  pares_por_caja  integer not null,
  barcode         text not null,
  actualizado_en  timestamptz,             -- el actualizadoEn del ERP
  leido_en        timestamptz not null default now()
);
create index on getac_corridas (pedido, modelo, color);
create index on getac_corridas (barcode);
```

### 2. Sincronización (cron)

- **Completa una vez al día** (de madrugada): pide todas las páginas
  (`offset` 0, 1000, 2000…, hasta `hayMas = false`) y haz **upsert por
  `clave`**. Al terminar, las claves de tu tabla que NO llegaron en esta
  lectura ya no existen en el ERP: bórralas. **Solo borra si TODAS las
  páginas se leyeron bien.** Si alguna falló, no borres nada.
- **Incremental cada 15–30 min**: guarda el mayor `actualizadoEn` que
  hayas recibido y pide `?desde=<ese valor>` (también paginando). Upsert por
  `clave`. La incremental no borra.
- Si el API no contesta o da error, **no toques lo guardado**. Reintenta en
  la siguiente vuelta y deja constancia en tu bitácora.

Pseudocódigo:

```ts
async function leerCorridas(desde?: string) {
  const todas = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL("https://meli-erp-full.vercel.app/api/integracion/corridas");
    url.searchParams.set("limit", "1000");
    url.searchParams.set("offset", String(offset));
    if (desde) url.searchParams.set("desde", desde);
    const r = await fetch(url, {
      headers: { "x-api-key": process.env.GETAC_CORRIDAS_API_KEY! },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`ERP contestó ${r.status}: ${await r.text()}`);
    const cuerpo = await r.json();
    todas.push(...cuerpo.corridas);
    if (!cuerpo.hayMas || cuerpo.corridas.length === 0) break;
    if (offset > 100_000) throw new Error("demasiadas páginas, ¿ciclo?");
  }
  return todas;
}
```

### 3. Cómo amarrar una caja de tu bodega con su corrida

Para cada caja en tu inventario, en este orden:

1. **Por barcode**: si la caja tiene la etiqueta escaneada, compara con
   `barcode`. Es el amarre más seguro.
2. **Por pedido + modelo + color (+ talla)**: compara SIN importar
   mayúsculas, espacios dobles ni guiones vs espacios (`"LT BROWN"` =
   `"LT-BROWN"` = `"lt  brown"`). Quita el sufijo `-MX` si tu SKU lo trae.
   - Si la caja tiene talla, busca la corrida con `unitalla = true` y esa
     `talla`.
   - Si la caja no tiene talla, busca la de `unitalla = false`.
3. **Sin amarre**: déjala marcada como «sin corrida». **No adivines** con
   otro pedido ni con otro color: la caja de otro pedido puede traer otras
   tallas.

Con la corrida amarrada:

- **pares de la caja** = `paresPorCaja`
- **pares por talla** en tu bodega = cajas disponibles × `tallas[talla]`

### 4. Reglas que no se rompen

- **Solo lectura.** No mandes nada de regreso a este endpoint.
- **Las cajas nunca se abren.** La corrida describe la caja completa. No
  partas una caja en tallas sueltas para despacharla: solo sirve para saber
  qué trae.
- `tallas` es POR CAJA, no el total del pedido.
- La **llave es `clave`**, no `barcode`. Dos corridas viejas pueden dar el
  mismo barcode si el color se escribió distinto; `clave` nunca se repite.
- La misma caja puede tener corrida distinta en otro pedido (el modelo
  cambió de surtido): siempre amarra **con el pedido**.
- No guardes la llave en el repo. Si se filtra, se cambia en Vercel del
  lado de GETAC (`CORRIDAS_API_KEY`) y en tu variable.

### 5. Cómo probarlo

```bash
curl -s -H "x-api-key: $GETAC_CORRIDAS_API_KEY" \
  "https://meli-erp-full.vercel.app/api/integracion/corridas?limit=2" | jq
```

Debe contestar `ok: true`, `total` alrededor de 1,600 (21-oct-2026) y dos
corridas. Con una llave equivocada contesta `401`.
