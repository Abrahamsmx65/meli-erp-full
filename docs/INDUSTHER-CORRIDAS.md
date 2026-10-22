# Instrucciones para el sistema de Industher: leer CORRIDAS y CONTENEDORES PENDIENTES del ERP de GETAC

> Este documento es para el Claude (o la persona) que programa el sistema de
> inventarios de Industher (`inventarios-industher.vercel.app`). Pégalo
> completo como instrucción.

## Qué se integra

El ERP de GETAC le ofrece a Industher dos lecturas, **en los mismos formatos
que Industher ya usa para cargar** (sus archivos `686_19.xlsx` y
`S260.xlsx`):

| Qué | Para qué | Formato |
|---|---|---|
| **Corridas** | qué pares por talla trae cada caja | `PEDIDO \| MODELO \| COLOR \| 23 \| 24 \| … \| TOTAL` (como `686_19.xlsx`) |
| **Contenedores pendientes** | lo que viene en camino, para darlo de alta como **BORRADOR de llegada** | `PARES POR CAJA \| Cantidad \| NUMERO DE CONTENEDOR \| Sku \| PRECIO \| TITULO` (como `S260.xlsx`) |

Las dos son **solo lectura**: Industher pide y el ERP contesta. El ERP no
escribe nada en Industher por aquí.

## Contexto del negocio (léelo antes de programar)

- GETAC vende calzado. Las cajas vienen de China **CERRADAS y nunca se
  abren**. Muchas son **mixtas**: varias tallas del mismo modelo y color.
- La **corrida** es la receta de una caja: cuántos pares de cada talla trae.
  `IN10126 · GT142 · CREAM` → 8 del 23, 14 del 24, 10 del 25, 9 del 26 y 7 del
  27 = 48 pares por caja.
- Hay cajas de **una sola talla** (unitalla). Su color lleva la talla pegada:
  `IN10121 · GT114 · TABACO BROWN-25` → 24 pares del 25.
- El **Sku de la caja** es `PEDIDO-MODELO-COLOR` (con `-TALLA` si es
  unitalla): `IN10079-GT228-LT BROWN`, `IN10121-GT114-TABACO BROWN-25`.
  **La corrida usa exactamente el mismo PEDIDO, MODELO y COLOR**, así que
  `PEDIDO + "-" + MODELO + "-" + COLOR` de una corrida = el `Sku` de la caja
  del contenedor. Ese es el amarre.
- Un contenedor pendiente es un **AVISO de lo que viene**, no existencia.
  Industher lo recibe de verdad cuando llega y cuenta las cajas.

## Autenticación

Las dos rutas usan la misma llave:

```
Header: x-api-key: <llave que te da el dueño (Abraham)>
```

Guárdala en una variable de entorno de Industher, por ejemplo
`GETAC_API_KEY`. **Nunca en el código ni en el repo.** Con una llave mala
el ERP contesta `401 { "error": "API Key inválida." }`.

Base: `https://meli-erp-full.vercel.app`

---

## 1. Corridas

```
GET /api/integracion/corridas?limit=1000&offset=0
GET /api/integracion/corridas?desde=2026-10-21T14:00:00Z       (solo lo que cambió después)
GET /api/integracion/corridas?contenedor=S271                   (solo las cajas de ese contenedor)
…&formato=xlsx                                                  (el Excel idéntico a 686_19.xlsx, sin paginar)
```

| Parámetro | Por omisión | Qué hace |
|---|---|---|
| `limit` | 1000 | renglones por página (1 a 1000) |
| `offset` | 0 | desde qué renglón |
| `desde` | — | solo corridas creadas o cambiadas DESPUÉS de esa hora (ISO) |
| `contenedor` | — | solo las corridas de las cajas de ese contenedor (`S271`); sin paginar |
| `formato` | JSON | `xlsx` = el Excel en el formato de Industher |

Respuesta JSON:

```json
{
  "ok": true,
  "generado": "2026-10-22T16:00:00.000Z",
  "total": 1612,
  "limit": 1000,
  "offset": 0,
  "hayMas": true,
  "ultimoCambio": "2026-10-21T14:06:48.325Z",
  "columnas": ["PEDIDO", "MODELO", "COLOR", "23", "24", "25", "26", "27", "28", "29", "30", "TOTAL"],
  "corridas": [
    { "PEDIDO": "IN10126", "MODELO": "GT142", "COLOR": "CREAM",
      "23": 8, "24": 14, "25": 10, "26": 9, "27": 7, "28": null, "29": null, "30": null, "TOTAL": 48 },
    { "PEDIDO": "IN10121", "MODELO": "GT114", "COLOR": "TABACO BROWN-25",
      "23": null, "24": null, "25": 24, "26": null, "27": null, "28": null, "29": null, "30": null, "TOTAL": 24 }
  ]
}
```

- Las columnas de talla son **todas las que aparecen en la respuesta**, en
  orden (pueden ser más o menos que 23–30; léelas de `columnas`, no las
  fijes en el código).
- Una talla que la caja no trae viene en `null` en JSON y como `-` en el
  Excel, igual que en `686_19.xlsx`.
- `TOTAL` = pares por caja.
- La paginación (`limit`, `offset`, `hayMas`) solo aplica al JSON sin
  `contenedor`. Con `contenedor` o con `formato=xlsx` llega todo junto.
- `ultimoCambio` es la hora de la corrida más reciente de la respuesta: es
  el `desde` de la siguiente lectura incremental.

## 2. Contenedores pendientes

```
GET /api/integracion/contenedores                  (todos los pendientes)
GET /api/integracion/contenedores?numero=S271      (uno)
…&formato=xlsx                                     (el Excel idéntico a S260.xlsx)
```

«Pendiente» = el ERP todavía no lo marca como recibido: está en
`borrador` (el ERP aún revisa el packing list) o en `en_transito`
(confirmado, viene en camino). Cuando el ERP lo marca recibido, deja de salir
aquí. Con `numero` y un contenedor que ya no está pendiente contesta `404`.

Con `formato=xlsx` y `numero`, el archivo trae una hoja `Sheet1`, igual que
`S260.xlsx`. Sin `numero`, una hoja por contenedor con su nombre (S261,
S263…).

Respuesta JSON (los números son de ejemplo):

```json
{
  "ok": true,
  "generado": "2026-10-22T16:00:00.000Z",
  "total": 10,
  "contenedores": [
    {
      "numero": "S271",
      "numeroNaviera": "MIEU3920536",
      "naviera": null,
      "estadoErp": "en_transito",
      "fechaSalida": null,
      "fechaLlegadaEstimada": "2026-11-05",
      "cajasBl": 713,
      "cajas": 572,
      "pares": 27456,
      "tabla": {
        "columnas": ["PARES POR CAJA", "Cantidad", "NUMERO DE CONTENEDOR", "Sku", "PRECIO", "TITULO"],
        "filas": [
          { "PARES POR CAJA": 24, "Cantidad": 50, "NUMERO DE CONTENEDOR": "S271",
            "Sku": "IN10079-GT228-LT BROWN", "PRECIO": 2916, "TITULO": "PANTUFLAS" }
        ]
      },
      "otros": [ { "descripcion": "POLYBAG", "color": "WHITE", "cajas": 35, "piezas": 55000 } ],
      "avisos": ["Sin costo en Productos y costos (Valor reposicion en blanco): GT303."]
    }
  ]
}
```

| Campo | Significado |
|---|---|
| `PARES POR CAJA` | pares que trae UNA caja (= `TOTAL` de su corrida) |
| `Cantidad` | número de cajas de ese Sku en el contenedor |
| `NUMERO DE CONTENEDOR` | la referencia del embarque, sin el año (S271) |
| `Sku` | `PEDIDO-MODELO-COLOR(-TALLA)`; amarra con la corrida |
| `PRECIO` | valor de reposición de UNA caja (el doble del costo por par × pares); `null` si el modelo aún no tiene costo |
| `TITULO` | tipo de producto: PANTUFLAS, BOTAS, ZAPATOS, SANDALIAS, TENIS o CALZADO |
| `numeroNaviera` | el número ISO del contenedor de la naviera |
| `estadoErp` | `borrador` o `en_transito` |
| `cajasBl` | cajas que declara el BL de la naviera (número de control; incluye `otros`) |
| `otros` | lo que viaja y **no es calzado** (bolsas, cajas de empaque): cuenta contra el BL, no es producto ni inventario |
| `avisos` | lo que le falta al ERP para ese contenedor (costo, variante en MELI…); solo informativo |

## Qué programar en Industher

### A. Corridas

1. Tabla propia con llave **PEDIDO + MODELO + COLOR** (comparando sin
   importar mayúsculas ni espacios dobles) y las tallas en un JSON
   `{ "23": 8, "24": 14 }` o en columnas, como ya las cargan hoy.
2. **Lectura completa cada noche**: pide todas las páginas hasta
   `hayMas = false` y haz upsert. Al terminar, las corridas que ya no
   llegaron se pueden borrar **solo si TODAS las páginas se leyeron bien**.
3. **Lectura incremental cada 15–30 min**: `?desde=<ultimoCambio guardado>`,
   upsert, no borra.
4. Si prefieren seguir cargando por archivo, `?formato=xlsx` da el mismo
   Excel que hoy suben a mano.

### B. Contenedores pendientes como BORRADOR

1. Cada **1 hora** (o con un botón «Traer de GETAC») lee
   `/api/integracion/contenedores`.
2. Por cada contenedor:
   - Si no existe en Industher, **créalo como BORRADOR** (estado propio de
     Industher, por ejemplo «Por llegar»), con su `numero`, `numeroNaviera`,
     `fechaLlegadaEstimada` y sus renglones (`tabla.filas`), igual que si
     hubieran subido el `S260.xlsx`.
   - Si ya existe y **sigue en borrador**, reemplaza sus renglones con los
     que llegaron (el ERP pudo corregir el packing list).
   - Si ya se **recibió** en Industher, no lo toques.
3. **Un borrador NO es existencia.** No sumes sus cajas al inventario
   disponible ni a «en almacén». Solo se vuelve existencia cuando Industher
   lo recibe físicamente y cuenta las cajas (como hoy).
4. Antes de crear un borrador, **asegúrate de tener las corridas de sus
   Sku** (`/api/integracion/corridas?contenedor=S271`): así cada caja ya sabe
   qué pares trae.
5. Si un contenedor que tienes en borrador deja de salir en la lista, el ERP
   ya lo marcó recibido. No lo borres: déjalo como está para que se reciba
   normal al llegar.
6. Los renglones de `otros` no son producto: si quieren verlos, como nota
   del contenedor.

### C. Cómo amarrar una caja con su corrida

1. **Por Sku**: `Sku` del contenedor = `PEDIDO-MODELO-COLOR` de la corrida.
   Compara sin importar mayúsculas ni espacios dobles.
2. Si la caja física trae la etiqueta de China (`IN10079-GT228-LT-BROWN`, con
   guiones en lugar de espacios), quita guiones y espacios de los dos lados
   y compara.
3. **Sin amarre**: déjala como «sin corrida». **No adivines** con otro pedido
   ni con otro color: la caja de otro pedido puede traer otras tallas.

### D. Reglas que no se rompen

- **Solo lectura.** No mandes nada a estas rutas.
- **Las cajas nunca se abren.** La corrida describe la caja completa; sirve
  para saber qué trae, no para partirla.
- Las tallas de la corrida son POR CAJA, no el total del pedido.
- Un borrador de contenedor **nunca** cuenta como inventario.
- La llave va en una variable de entorno; si se filtra, se cambia en los dos
  lados.

## Cómo probarlo

```bash
curl -s -H "x-api-key: $GETAC_API_KEY" \
  "https://meli-erp-full.vercel.app/api/integracion/corridas?limit=2" | jq
curl -s -H "x-api-key: $GETAC_API_KEY" \
  "https://meli-erp-full.vercel.app/api/integracion/contenedores" | jq '.contenedores[] | {numero, estadoErp, cajas}'
curl -s -H "x-api-key: $GETAC_API_KEY" -o S271.xlsx \
  "https://meli-erp-full.vercel.app/api/integracion/contenedores?numero=S271&formato=xlsx"
```

El 22-oct-2026 había ~1,600 corridas y 10 contenedores pendientes
(S261–S271 en tránsito y S274 en borrador).
