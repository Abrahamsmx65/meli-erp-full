# Guía de diseño de pantallas (9-oct-2026)

## Armazón y marca (9-oct-2026)

Marca GETAC: logo en `public/getac-logo.png` (sin fondo, `components/logo.tsx`)
y la app se llama solo «GETAC». Paleta del logo: crema (`--plane`,
`--sidebar`), arena y café (`--acento` #8b6640, AA sobre blanco), tinta café
oscuro. Letra: DM Sans para texto y cifras; Fraunces solo en títulos.
Gráficas con la paleta tierra validada (caramelo #a35f1c, mezclilla #3a72b8,
verde #2f9c63, mostaza #d3a52e); una sola serie va en `--acento`.
Menú crema con el logo arriba; login a pantalla completa con panel crema.

**Sin explicaciones en pantalla** (dueño, 9-oct-2026): `descripcion` del
encabezado y `ayuda`/`<Ayuda>` ya no se pintan; dentro de las pantallas solo
quedan títulos, etiquetas, datos, errores y avisos que piden acción.

Todas las pantallas del ERP se arman igual. Piezas en
`src/components/ui/pagina.tsx`; clases en `src/app/globals.css`. Pantalla
modelo: `src/app/cortes/page.tsx`.

## Estructura (siempre este orden)

```tsx
import { Pagina, Encabezado, Cifras, Seccion, Aviso, SinCuenta, Tabla, Ayuda } from "@/components/ui/pagina";
import { Ficha } from "@/components/tiles";

if (!cuenta) return <SinCuenta titulo="Ventas" />;            // servicio="amazon" | "tiktok" | "yapanizcel"

<Pagina>
  <Encabezado
    ceja="Mercado Libre"            // el título del grupo del menú
    titulo="Ventas"
    descripcion="Una sola línea: qué hay aquí."
    frescura={generadoEn}            // si la pantalla lee datos masticados
    acciones={<>…botones / descargas…</>}
    ayuda={<><p>…regla larga…</p><p>…</p></>}   // plegada en «¿Cómo se calcula?»
  />
  {/* filtros / periodo (si hay) */}
  <Cifras columnas={4}>…<Ficha …/>…</Cifras>
  {/* avisos que de verdad piden acción */}
  <Seccion titulo="Por modelo" descripcion="235 modelos" acciones={…} sinRelleno>
    <Tabla><table className="datos">…</table></Tabla>
  </Seccion>
</Pagina>
```

Cejas (= grupos del menú): «Negocio», «Inventario», «Mercado Libre»,
«Amazon», «TikTok Shop», «Abastecimiento», «Fundas», «Sistema».

## Pestañas

Cuando una pantalla junta varios bloques grandes, van en pestañas
(`<Pestanas>` de `@/components/ui/pestanas`): encabezado, filtros, avisos
urgentes y `<Cifras>` ARRIBA; los bloques abajo, de 2 a 5 pestañas, la
primera la más usada. Solo se pinta la activa y cambiar es instantáneo (sin
viaje al servidor); la pestaña viaja en `?pestana=`. Un bloque con trabajo
en curso (carga de archivo, ciclo que encadena, formulario largo) NO va en
una pestaña: se desmontaría al cambiar.

## Reglas de contenido

1. **Sin explicaciones**: la `descripcion` y la `ayuda` quedan en el código
   como nota, pero no se pintan. No se agregan párrafos que expliquen.
2. **Un aviso solo si pide acción o advierte algo raro.** Si repite lo que ya
   dice una ficha o el encabezado, se quita. Avisos con `<Aviso tono=…>`:
   `info`, `bien`, `alerta`, `critico`. Nada de recuadros armados a mano con
   `color-mix`.
3. **Cada botón vive en UN lugar.** Si dos pantallas tienen el mismo botón,
   se queda en la pantalla dueña de esa acción (Sincronizar → Sincronizar;
   recargar el sheet de fundas → Bodega fundas). Las acciones de la pantalla
   van en `acciones` del encabezado o de su sección.
4. **Sin cuenta conectada:** `<SinCuenta titulo="…" servicio="…" />`.
5. **Frescura:** si la pantalla lee un renglón masticado, `frescura` en el
   encabezado. Se retiran los «Datos de hace X min» sueltos.
6. **Cifras:** siempre dentro de `<Cifras columnas={3|4|5|6}>`, nunca un
   `grid-cols-…` propio. 4 por omisión; más de 6 fichas → dos filas o
   quitar las que se repiten.
7. **Tablas:** `table.datos` dentro de `<Tabla>` (o `.tabla-caja`). Columnas
   numéricas con `className="num cifra"` (encabezado `th className="num"`).
8. Textos: español, frases cortas, sin repetir lo que dice el título.

## Reglas de estilo

- Nada de `style={{ color: "var(--ink-2)" }}` → `className="texto-2"`;
  `var(--ink-muted)` → `texto-tenue`. Enlaces azules subrayados → `enlace`.
- Botones: `<Boton>` / `<EnlaceBoton>` de `@/components/ui/boton`, o las
  clases `boton boton-primario|boton-borde|boton-fantasma|boton-peligro
  [boton-chico]`. No armar el azul a mano con `style={{background:…}}`.
- Títulos de sección: `seccion-titulo` (o `<Seccion titulo>`), no
  `text-base font-semibold`, `text-lg`, etc.
- Espaciado: la página es `<Pagina>` (gap de 1.5 rem). Dentro de una tarjeta,
  `p-4`.
- Colores de estado en texto: `var(--exito-texto)`, `var(--alerta-texto)`,
  `var(--critico-texto)`. Fondos: `--bien-suave`, `--alerta-suave`,
  `--critico-suave`, `--info-suave`.

## Botones y avisos

- **Un solo botón azul por pantalla o sección**: la acción principal. Las
  demás, `boton-borde boton-chico`.
- Etiquetas con verbo + objeto («Descargar Excel», «Registrar envío»).
- Nada de botones que solo llevan a otra pantalla del menú (salvo dentro de
  un aviso que pide arreglar algo allá).
- Un aviso solo existe si depende de los datos y pide acción o señala un
  problema real. Lo que explica cómo funciona algo va plegado en `ayuda`.

## Lo que NO se toca

Ninguna regla del negocio, ningún número, ninguna consulta, ninguna ruta de
API. El rediseño cambia cómo se ve y dónde está cada cosa, nada más.
