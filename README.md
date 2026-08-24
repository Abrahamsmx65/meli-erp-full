# Planeador de envíos a Mercado Envíos Full

Decide **qué cajas mandar a Full** cada vez que armas un envío, corrigiendo la
demanda por los días en que el producto estuvo agotado.

El problema que resuelve: si un modelo estuvo sin stock 50 de los últimos 90
días, sus ventas se ven bajas y cualquier cálculo ingenuo te dice que casi no
se vende. Pero no es que no se venda — es que no había qué vender. Este sistema
reconstruye qué días hubo stock de verdad y calcula la demanda solo sobre esos
días. En pruebas con datos de verdad conocida, ese ajuste baja el error de
**65–71% a 9–12%** en los SKUs que se agotaban seguido.

---

## Cómo piensa el sistema

### 1. Reconstruye el historial de stock, día por día

Tres fuentes, en orden de confianza:

1. **Fotos diarias** que el propio sistema guarda en cada sincronización — es
   medición directa, no estimación. Por eso conviene dejar corriendo el cron
   desde el primer día aunque todavía no planees nada.
2. **Movimientos de inventario de MELI** (entradas, ventas, ajustes), que
   permiten caminar hacia atrás desde el stock de hoy.
3. **Inferencia por patrón de ventas**, solo cuando no hay nada más.

### 2. Cuenta los días con stock en fracciones, no en enteros

Un día que arrancó con 4 pares de un modelo que vende 20 al día **no fue un día
completo de venta**: fue como un quinto de día. Contarlo entero subestima la
demanda. La fracción se estima con la tasa de venta y, como la tasa depende de
la fracción, se itera hasta que converge.

La demanda real termina siendo `unidades vendidas ÷ días efectivos con stock`,
no `unidades ÷ días de calendario`.

### 3. Inclina hacia lo reciente y mide la tendencia

Los 90 días se parten en tres bloques de 30 con pesos 50/30/20. Un modelo que
creció 8% al mes no debe reponerse al ritmo que tenía hace tres meses. La
tendencia se acota entre −30% y +50% para que un mes raro no dispare el pedido.

### 4. Calcula cuánto necesitas

```
ventana de riesgo  = lead time + días entre envíos
stock de seguridad = Z × σ × √(ventana de riesgo)    (con piso en días)
nivel objetivo     = demanda diaria × horizonte + stock de seguridad
sugerido           = nivel objetivo − (disponible en Full + en transferencia)
```

Lo que ya viene en camino **cuenta**: si no, el sistema te haría mandar otra vez
algo que ya va en la carretera.

### 5. Decide qué cajas mandar

Aquí está lo particular de este negocio: **las cajas no se abren**. Una caja de
corrida trae varias tallas del mismo modelo y color según una receta, así que
toca varios SKUs de MELI a la vez. Nunca vas a poder darle a cada talla
exactamente lo que pidió.

El optimizador elige la combinación de cajas completas que menos daño hace,
midiendo el error **en días de cobertura, no en pares**. Quedarse 100 pares
corto en algo que vende 50 al día son 2 días de quiebre; en algo que vende 2 al
día son 50. Sin esa normalización el sistema maltrata sistemáticamente a los
modelos de baja rotación.

Quedarse corto pesa más que pasarse, y pasarse pesa más en un SKU que ya trae
sobrestock — mandar 900 pares de más de algo con 60 días de cobertura es pagar
bodega en MELI por inventario que no se va a mover.

---

## Puesta en marcha

### 1. Base de datos (Supabase)

Corre **todas** las migraciones de `supabase/migrations/` en orden numérico,
desde el SQL Editor. Antes de desplegar una versión nueva, aplica primero
cualquier migración que esa versión agregue.

RLS queda activo en todo. Los tokens de MELI viven en `meli_tokens`, que tiene
RLS **sin políticas**: solo el backend con `service_role` puede leerlos, nunca
el navegador.

### 2. Aplicación en Mercado Libre

En <https://developers.mercadolibre.com.mx/devcenter> crea una aplicación y
registra como Redirect URI exactamente:

```
https://TU-APP.vercel.app/api/meli/callback
```

### 3. Variables de entorno

Copia `.env.example` a `.env.local` (y cárgalas en Vercel):

| Variable | De dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la publishable / anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | la service_role key — **solo servidor** |
| `MELI_CLIENT_ID` / `MELI_CLIENT_SECRET` | tu app de MELI |
| `MELI_REDIRECT_URI` | idéntica a la registrada arriba |
| `CRON_SECRET` | invéntalo, largo y aleatorio |
| `NEXT_PUBLIC_APP_URL` | la URL pública de tu app |

### 4. Deploy

```bash
npm ci
npm test
npm run typecheck
npm run build
```

GitHub Actions ejecuta estos tres controles en cada pull request y en cada
push a `main`; no necesita secretos de producción.

Sube a Vercel. `vercel.json` ya deja programada la sincronización diaria a las
7:00 de la mañana (hora del centro de México).

### 5. Primer uso

1. **Ajustes → Conectar con Mercado Libre.**
2. **Sincronizar** — trae catálogo, stock en Full, 90 días de ventas y los
   movimientos de inventario.
3. **Importar** — sube `CORRIDAS BASE` y `Existencias globales`.
4. **Pendientes** — resuelve las cajas sin corrida y los SKUs sin amarrar.
5. **Plan de envío** — ahí está qué cajas mandar.

---

## Los dos archivos que sube el usuario

**CORRIDAS BASE** — la receta de tallas de cada caja. Se **acumula**: las
corridas viejas siguen sirviendo para el inventario de ese pedido.

| PEDIDO | MODELO | COLOR | 23 | 24 | 25 | 26 | 27 | TOTAL |
|---|---|---|---|---|---|---|---|---|
| S070 | GT103 | CAMEL | 5 | 10 | 13 | 10 | 10 | 48 |

**Existencias globales** — cuántas cajas hay y dónde. Se **reemplaza completo**
en cada importación: es una foto del momento, y conservar renglones viejos haría
planear con cajas que ya se movieron.

Talla `Corrida` = caja mixta con varias tallas. Talla `25` = caja de una sola talla.

Ambos se leen **por nombre de columna**, así que pueden traer columnas de más,
filas de título arriba, o venir en otro orden.

### Cuando el SKU no coincide

El SKU de MELI se arma como `MODELO-COLOR-TALLA` (`GT107-CAMEL-25`). El amarre
va en tres pasos: coincidencia exacta → forma canónica (`DK BROWN`, `dk-brown` y
`Dk  Brown` son lo mismo) → **mapeo manual** desde la pantalla de Pendientes.

Lo que no amarra **no desaparece**: se lista con cuántos pares está bloqueando,
para que se vea el costo de dejarlo sin resolver.

---

## Estructura

```
src/lib/engine/          motor puro, sin dependencias ni I/O
  stockHistory.ts        reconstrucción diaria y fracciones con stock
  demand.ts              demanda corregida, buckets, tendencia, variabilidad
  replenish.ts           stock de seguridad, nivel objetivo, urgencia
  boxes.ts               optimizador de cajas mixtas
src/lib/importar/        lectura de los Excel y armado del catálogo de cajas
src/lib/meli/            cliente de la API, OAuth y ETL
src/lib/servicios/       plan y sincronización (lo que usan app y cron)
src/app/                 páginas y rutas de API
supabase/migrations/     esquema y RLS
fixtures/                archivos reales usados por las pruebas
```

El motor no sabe nada de Supabase ni de HTTP: recibe datos y devuelve un plan.
Por eso se puede probar a fondo sin levantar nada.

## Pruebas

```bash
npm test
```

- **Motor (20)** — corren sobre datos sintéticos donde la demanda real se
  conoce de antemano, así que se puede verificar que el sistema la recupera
  aunque el producto haya estado agotado la mitad del periodo.
- **Importadores (15)** — corren contra los archivos **reales** en `fixtures/`.
  Si un export cambia de forma, truena aquí y no en producción.
- **Escala (3)** — el catálogo real completo: 448 tipos de caja y ~1,175 SKUs.
  Fija un techo de 3 segundos para que una regresión de rendimiento se detecte
  aquí; hoy corre en ~0.6s.

## Decisiones que vale la pena conocer

**La corrección por agotamiento tiene tope.** Un SKU con stock solo 3 de 90 días
daría una demanda absurda al extrapolar. El tope (3× por omisión, configurable)
se aplica **dentro de cada bloque de 30 días**, no solo al global: si no, un
bloque con stock de dos días se dispararía sin control y el tope global quedaría
sin efecto.

**σ tiene piso y techo.** Piso de Poisson (`√demanda`) porque la venta esporádica
nunca tiene varianza cero; techo de 3× la demanda para que un solo pico no
infle el colchón al infinito.

**"En transferencia" cuenta; "no disponible" no.** Lo dañado, perdido o en
revisión no se puede vender, así que no entra en la posición de inventario.

**El cron corre diario aunque planees dos veces por semana.** Cada corrida deja
una foto del stock. Esas fotos son lo que con el tiempo convierte la detección
de agotamientos de estimación en medición.
