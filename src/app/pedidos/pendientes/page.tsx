import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarPendientes, CBM_CONTENEDOR } from "@/lib/servicios/pedidos-pendientes";
import { Ficha } from "@/components/tiles";
import { Aviso, Cifras, Encabezado, Pagina, SinCuenta, Tabla } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function dinero(x: number | null, m: string | null): string {
  if (x == null) return "sin precio";
  const s = x.toLocaleString("es-MX", { maximumFractionDigits: 0 });
  return `${m === "RMB" ? "¥" : "$"}${s}${m ? ` ${m}` : " (moneda ?)"}`;
}

/**
 * Pedidos pendientes por enviar: lo pedido a China que todavía no está en
 * ningún contenedor, con su dinero y sus CBM aproximados. Un pedido sale de
 * aquí cuando un packing list mete sus cajas a un contenedor. Lectura
 * ligera (los pedidos vivos son decenas): se calcula en el request.
 */
export default async function PendientesPorEnviar() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Pendientes por enviar" />;

  const r = await cargarPendientes(supabase, cuenta.id);
  const t = r.totales;

  return (
    <Pagina>
      <Encabezado
        ceja="Abastecimiento"
        titulo="Pendientes por enviar"
        acciones={
          <Link href="/pedidos/nuevo" className="boton boton-primario">
            Nuevo pedido
          </Link>
        }
      />

      <Cifras columnas={5}>
        <Ficha titulo="Pedidos" valor={n(t.pedidos)} nota={`${n(t.cajas)} cajas · ${n(t.pares)} pares`} />
        <Ficha titulo="Dólares" valor={`$${n(t.usd)}`} nota="USD por pagar en lo pendiente" />
        <Ficha titulo="Yuanes" valor={`¥${n(t.rmb)}`} nota="RMB por pagar en lo pendiente" />
        <Ficha
          titulo="CBM aprox."
          valor={t.cbm.toLocaleString("es-MX", { maximumFractionDigits: 1 })}
          nota={t.cajasSinMedida ? `${n(t.cajasSinMedida)} cajas sin medida` : "Todas las cajas con medida"}
          tono={t.cajasSinMedida ? "alerta" : "neutro"}
        />
        <Ficha titulo="Contenedores" valor={`≈ ${t.contenedores}`} nota={`De ${CBM_CONTENEDOR} m³ (40' HQ)`} />
      </Cifras>

      {t.pedidosSinPrecio || t.sinMoneda ? (
        <Aviso tono="alerta">
          {t.pedidosSinPrecio ? `${t.pedidosSinPrecio} pedidos tienen renglones sin precio y no suman dinero. ` : ""}
          {t.sinMoneda ? `${dinero(t.sinMoneda, null)} son de fábricas sin moneda conocida: vuelve a subir su proforma.` : ""}
        </Aviso>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="seccion-cabeza">
          <h2 className="seccion-titulo">Por fábrica</h2>
        </header>
        <Tabla vacia={!r.porFabrica.length} textoVacio="No hay nada pendiente: todo está en un contenedor.">
          <table className="datos">
            <thead>
              <tr>
                <th>Fábrica</th>
                <th className="num">Pedidos</th>
                <th className="num">Cajas</th>
                <th className="num">Pares</th>
                <th className="num">Dinero</th>
                <th className="num">CBM aprox.</th>
              </tr>
            </thead>
            <tbody>
              {r.porFabrica.map((f) => (
                <tr key={`${f.fabrica}|${f.moneda}`}>
                  <td className="font-medium">{f.fabrica}</td>
                  <td className="num cifra">{n(f.pedidos)}</td>
                  <td className="num cifra">{n(f.cajas)}</td>
                  <td className="num cifra">{n(f.pares)}</td>
                  <td className="num cifra">{dinero(f.dinero, f.moneda)}</td>
                  <td className="num cifra">
                    {f.cbm.toFixed(1)}
                    {f.cajasSinMedida ? <span className="texto-tenue text-[11px]"> (+{n(f.cajasSinMedida)} cajas sin medida)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tabla>
      </section>

      <section className="tarjeta overflow-hidden">
        <header className="seccion-cabeza">
          <h2 className="seccion-titulo">Pedidos</h2>
        </header>
        <Tabla vacia={!r.pedidos.length} alta>
          <table className="datos">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Fábrica</th>
                <th>Modelos</th>
                <th className="num">Días</th>
                <th className="num">Cajas por subir</th>
                <th className="num">Pares</th>
                <th className="num">Dinero</th>
                <th className="num">CBM</th>
              </tr>
            </thead>
            <tbody>
              {r.pedidos.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium whitespace-nowrap">
                    {p.pedido}
                    {p.origen === "sistema" ? (
                      <span className="insignia ml-1.5" title="Armado en Nuevo pedido; falta la proforma firmada de la fábrica">
                        sin proforma
                      </span>
                    ) : null}
                  </td>
                  <td className="text-xs">{p.fabrica}</td>
                  <td className="text-xs">{p.modelos.join(", ")}</td>
                  <td className="num cifra">{p.dias ?? "—"}</td>
                  <td className="num cifra">
                    {n(p.cajasPendientes)}
                    {p.cajasPendientes < p.cajas ? <span className="texto-tenue text-[11px]"> de {n(p.cajas)}</span> : null}
                  </td>
                  <td className="num cifra">{n(p.paresPendientes)}</td>
                  <td className="num cifra">{dinero(p.dineroPendiente, p.moneda)}</td>
                  <td className="num cifra">
                    {p.cbmPendiente ? p.cbmPendiente.toFixed(2) : "—"}
                    {p.cajasSinMedida ? <span className="texto-tenue text-[11px]"> ({n(p.cajasSinMedida)} sin medida)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tabla>
      </section>
    </Pagina>
  );
}
