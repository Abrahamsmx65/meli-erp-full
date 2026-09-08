# Kit UI semilla

Una sola jerarquía de controles para toda la app. Aditivo: las clases viejas
(`.boton`, `.boton-secundario`, `.boton-fantasma`) siguen existiendo; las
familias nuevas (`.boton-borde`, `.boton-peligro`, `.boton-peligro-lleno`,
`.boton-chico`) viven en `globals.css`. Todos traen hover/focus/disabled,
teclado y bloqueo de doble clic.

## Boton / EnlaceBoton

```tsx
import { Boton, EnlaceBoton } from "@/components/ui/boton";

<Boton onClick={guardar} cargando={ocupado} textoCargando="Guardando…">
  Guardar
</Boton>
<Boton variante="peligro-lleno" onClick={borrar}>Borrar el corte</Boton>
<Boton variante="fantasma" chico>Cancelar</Boton>
<EnlaceBoton href="/ajustes" variante="borde">Ir a Ajustes</EnlaceBoton>
```

`cargando` deshabilita, pone `aria-busy` y cambia el texto: el doble clic no
existe. Variantes: `primario` (por omisión) · `secundario` · `borde` ·
`fantasma` · `peligro` · `peligro-lleno`.

## BotonDescarga

Para los Excel/PDF que tardan (hasta 300 s): estado «Generando…», el nombre
del archivo sale del `Content-Disposition`, y el 504 explica en cristiano.

```tsx
import { BotonDescarga } from "@/components/ui/boton-descarga";

<BotonDescarga href={`/api/inventario/excel?q=${q}`} chico>
  Excel de esta vista
</BotonDescarga>
```

## DialogoConfirmar

`<dialog>` nativo (Escape y foco de verdad). Para retirar los `confirm()`
del navegador. La acción destructiva SIEMPRE dice su consecuencia.

```tsx
import { DialogoConfirmar } from "@/components/ui/dialogo-confirmar";

<DialogoConfirmar
  abierto={confirmando}
  titulo="¿Marcar recibido?"
  cuerpo={`${n(e.pares)} pares dejarán de contar como en camino.`}
  peligro
  ocupado={guardando}
  onConfirmar={recibir}
  onCancelar={() => setConfirmando(false)}
/>
```

## Avisos (toasts)

`<Avisos />` ya está montado en el armazón; desde cualquier cliente:

```tsx
import { avisar } from "@/components/ui/avisos";

avisar("exito", "El envío quedó registrado.");
avisar("error", (err as Error).message);
```

## Esqueleto

Piezas para los `loading.tsx` por ruta, con la silueta real de la página:

```tsx
import { EncabezadoEsqueleto, EsqueletoFichas, EsqueletoTabla } from "@/components/ui/esqueleto";

<EncabezadoEsqueleto />
<EsqueletoFichas cuantas={6} columnas={6} />
<EsqueletoTabla filas={7} />
```

## El patrón de mutación («actualización local confirmada»)

Nada de optimismo ni `router.refresh()` completo: estado de carga →
esperar el 2xx → actualizar SOLO la fila afectada → `avisar()`. En error,
la vista no cambia y el error se enseña. Ejemplos vivos:
`envios-en-camino.tsx` y `pendientes-industher.tsx`.
