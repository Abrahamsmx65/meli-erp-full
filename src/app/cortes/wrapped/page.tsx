import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { PRIMER_PERIODO_CORTES } from "@/lib/servicios/consolidado-cargar";
import { ejercicioDeFecha, nombreEjercicio } from "@/lib/finanzas/cuenta";
import { fechaMx } from "@/lib/servicios/ventas-monitor";
import { cargarWrapped } from "@/lib/servicios/wrapped-cargar";
import { leerFotosProducto } from "@/lib/servicios/fotos-producto";
import { fotoDeProducto } from "@/lib/fotos/producto";
import { Aviso, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";
import { WrappedGetac } from "@/components/wrapped-getac";

export const dynamic = "force-dynamic";

/**
 * GETAC Wrapped: el año del negocio (mayo a abril) contado en tarjetas, como
 * el Wrapped de Spotify (dueño, 18-oct-2026). Lee el año ya sumado y la venta
 * por día y hora, masticados en `app_cache` (`wrapped-cargar.ts`).
 */
export default async function WrappedPagina({ searchParams }: { searchParams: Promise<{ ejercicio?: string }> }) {
  const sp = await searchParams;
  const actual = ejercicioDeFecha(fechaMx(0));
  const primero = ejercicioDeFecha(`${PRIMER_PERIODO_CORTES}-01`);
  const pedido = Number(sp.ejercicio);
  const ejercicio = Number.isInteger(pedido) && pedido >= primero && pedido <= actual ? pedido : actual;

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="GETAC Wrapped" />;

  let error: string | null = null;
  let res: Awaited<ReturnType<typeof cargarWrapped>> | null = null;
  try {
    res = await cargarWrapped(supabase, cuenta, ejercicio);
  } catch (e) {
    error = (e as Error).message;
  }
  const fotos = res ? await leerFotosProducto(supabase, cuenta.id).catch(() => null) : null;
  const w = res?.datos;

  const ejercicios: number[] = [];
  for (let e = actual; e >= primero; e--) ejercicios.push(e);

  return (
    <Pagina>
      <Encabezado
        ceja="Negocio"
        titulo="GETAC Wrapped"
        descripcion={`${nombreEjercicio(ejercicio)}: tu año en tarjetas.`}
        frescura={res?.generadoEn ?? null}
        acciones={
          <Link href={`/cortes/anio?ejercicio=${ejercicio}`} className="boton boton-borde boton-chico">
            Ver los números
          </Link>
        }
      />

      {ejercicios.length > 1 ? (
        <nav aria-label="Ejercicio" className="flex flex-wrap justify-center gap-1.5">
          {ejercicios.map((e) => (
            <Link
              key={e}
              href={`/cortes/wrapped?ejercicio=${e}`}
              aria-current={e === ejercicio ? "page" : undefined}
              className="rounded-full border px-3 py-1 text-xs font-medium"
              style={
                e === ejercicio
                  ? { background: "var(--acento)", borderColor: "var(--acento)", color: "#fff" }
                  : { borderColor: "var(--borde)", background: "var(--surface-1)" }
              }
            >
              {nombreEjercicio(e)}
            </Link>
          ))}
        </nav>
      ) : null}

      {error ? <Aviso tono="critico">No se pudo armar el Wrapped: {error}</Aviso> : null}
      {w && w.unidades === 0 ? <Aviso tono="info">Este ejercicio todavía no tiene ventas guardadas.</Aviso> : null}
      {w && w.unidades > 0 ? (
        <WrappedGetac
          key={ejercicio}
          datos={w}
          nombreEjercicio={nombreEjercicio(ejercicio)}
          fotos={{
            estrella: w.modeloEstrella ? fotoDeProducto(fotos, w.modeloEstrella.modelo) : null,
            dejo: w.modeloQueMasDejo ? fotoDeProducto(fotos, w.modeloQueMasDejo.modelo) : null,
          }}
        />
      ) : null}
    </Pagina>
  );
}
