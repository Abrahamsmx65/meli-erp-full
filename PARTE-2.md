# Parte 2 — qué trae y qué hay que hacer

Esto continúa la Parte 1. **No hace falta borrar nada**: se sustituye la carpeta
del proyecto por esta y se vuelve a desplegar.

---

## 1. Lo que hay que hacer una sola vez

### a) Subir el código

Es el mismo camino de la Parte 1: descomprimir, subir a GitHub, Vercel
redespliega solo.

### b) Las migraciones de la base

Ya están **aplicadas** en tu proyecto de Supabase. Los archivos en
`supabase/migrations/` están para que el repositorio y la base digan lo mismo;
no tienes que correr nada.

### c) La única cosa manual que falta

En Supabase → **Authentication → Policies → Passwords**, prende
*Leaked password protection*. Es un interruptor de tablero que no se puede
prender desde el código; compara tu contraseña contra la lista pública de
contraseñas filtradas.

---

## 2. Seguridad

Esto es lo que se cerró:

**El registro está cerrado.** Antes, cualquiera que encontrara la URL podía
crear una cuenta. No habría visto tus datos —eso ya lo impedía RLS— pero podía
entrar y conectar su propio Mercado Libre. Ahora hay una lista de correos
autorizados (`usuarios_permitidos`) y se aplica con un *trigger* sobre la tabla
de usuarios, no escondiendo el botón: tampoco se puede saltar pegándole directo
a la API. Tu correo ya está en la lista.

**Las funciones internas dejaron de estar publicadas.** Supabase convierte en
endpoint público toda función del esquema `public`. A `verificar_correo_permitido`
se le quitó el permiso a todo el mundo. A las dos funciones de RLS se les quitó
a los visitantes sin sesión; a los usuarios con sesión hay que dejárselas,
porque las reglas de RLS se evalúan con los permisos de quien consulta y sin
ese permiso el sistema entero deja de leer sus propios datos.

**El lector de Excel no usa `sheet_to_json`.** La versión de SheetJS que hay en
npm arrastra un fallo conocido de contaminación de prototipo, y el camino por
el que se explota es justo esa función. `leer-hoja.ts` lee las celdas una por
una por su dirección y solo saca su valor.

**Sigue pendiente de tu lado:** revoca el token de GitHub que me pasaste por
chat, en <https://github.com/settings/tokens>. Un token pegado en una
conversación hay que darlo por quemado.

---

## 3. Sincronización en vivo

Ya no hay que picar botones. Mercado Libre avisa solo cuando pasa algo.

**Falta un paso tuyo:** en tu aplicación de Mercado Libre
(<https://developers.mercadolibre.com.mx> → Mis aplicaciones → tu app →
Notificaciones), pon como URL de callback:

```
https://TU-DOMINIO/api/meli/webhook
```

y marca los temas **`orders_v2`**, **`items`** y **`stock-locations`** /
fulfillment. Mientras eso no esté puesto, sigue funcionando la sincronización
por horario (8 de la mañana) que ya quedó de la Parte 1.

Los avisos se guardan en una bandeja y se procesan aparte, porque Mercado Libre
exige una respuesta en menos de medio segundo o suspende la suscripción. Las
ventas se **recalculan** por día en lugar de sumarse: si MELI reintenta un
aviso, no se cuenta dos veces.

---

## 4. Las secciones nuevas

### Inventario

Cada SKU con sus cuatro ubicaciones en un solo renglón: en Full, viajando a
Full, en cajas cerradas en bodega, y en el barco desde China. Con desglose por
almacén y por número de pedido, y el histórico de 90 días de cada SKU al picarle.

### Pedidos a China

Dos cosas en una pantalla.

**Qué conviene pedir.** Junta la demanda diaria corregida de cada modelo+color
—la misma que usan los envíos a Full, ya arreglada por los días que estuvo
agotado— contra *todo* el inventario que existe. El objetivo son 45 días de
fábrica + 45 de barco + 90 de piso. Lo que falta se divide entre los pares por
caja de la corrida y se redondea hacia arriba, porque las cajas no se abren.

Al abrir un renglón sale la cuenta completa y, cuando se puede, la comparación
entre **la corrida que manda la fábrica y cómo se vende de verdad**. Eso es lo
que hay que negociar antes de confirmar: si la caja trae 15 pares del 27 y el 27
no se mueve, cada caja que llegue trae 15 pares que se van a quedar parados.

**Cargar un pedido.** Subes la Proforma Invoice tal como te llega de la fábrica.
Sale una ventana con todo lo que va a entrar —modelos, colores, la corrida por
talla, cajas, pares— y hasta que confirmas se guarda. El pedido queda *creado* y
pendiente de contenedor; con el botón **Contenedor** le pones el número y
cuántas cajas se van en él. Si el pedido se parte, repites con el segundo: lo
que no asignes sigue contando como pendiente de embarcar.

Probado contra tu archivo real `IN10151 GT104.xls`: 9 de 9 pruebas pasan —
pedido IN10151, 6 renglones, 380 cajas, 18,240 pares, y la corrida de GT104-1
sale exacta.

### Corridas

Las corridas que hay y —más importante— **las que faltan**: las cajas que están
en bodega y el planeador no puede mandar porque no sabe qué traen adentro. Esas
van hasta arriba con un botón para capturarlas.

Desde ahora esto se llena solo: cada proforma que cargas da de alta sus corridas.
Se guardan por pedido, así que si un modelo cambia de corrida entre pedidos, las
cajas viejas conservan la suya.

### Etiquetas

Pones el SKU y cuántas, y salen las etiquetas con su código Full en código de
barras, el título, la variante y el SKU. **El código Full, el título y la
variante los saca del sistema** — no hay que subir ningún archivo.

Tres formas de armar la lista: buscando por SKU o título, pegando una lista de
Excel (SKU y cantidad por renglón), o con un botón que trae de golpe todo lo que
va en el envío planeado de hoy.

El código de barras es Code 128 dibujado en vectores, no una imagen: en papel
sale con filo. Al imprimir, **deja la escala en 100%** y quita encabezados y
pies de página; si el navegador escala la hoja, las barras se angostan y el
escáner del almacén deja de leerlas.

### Envíos a Full, separados por bodega

El plan ahora se parte en los envíos que de verdad vas a dar de alta:
**Caseshop + Industher** juntos en uno, **EnvioPack** en el suyo. Cada tarjeta
trae su número de cajas —el que se captura al dar de alta el envío y el que
tiene que cuadrar con el transportista— y su propio Excel, con solo las cajas de
esa dirección.

No creo el envío en Mercado Libre por API; queda preparado y separado, que es lo
que pediste.

---

## 5. Lo que sigue pendiente

- **Amazon.** Las tablas ya están puestas y la vista que unifica las ventas de
  los dos canales también, pero falta conectar la cuenta y traer los datos.
- **Crear el envío en Mercado Libre por API.** Hoy queda preparado y separado.
- **El Excel de productos que no se mandan porque la corrida está mal en otras
  tallas.** Ya está diagnosticado: son 390 SKUs / 12,871 pares que ninguna caja
  del plan alcanza a cubrir.
