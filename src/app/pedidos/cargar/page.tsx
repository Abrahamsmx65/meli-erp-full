import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { listarPedidos } from "@/lib/servicios/pedidos";
import { configuracionSheetPedidos, faltantesDelSheet, type FaltantesSheet } from "@/lib/servicios/pedidos-sheet";
import { Ficha } from "@/components/tiles";
import { CargarPedido } from "@/components/cargar-pedido";
import { CargarPedidosLote } from "@/components/cargar-pedidos-lote";
import { ListaPedidos } from "@/components/lista-pedidos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Cargar pedidos: la pestaña de captura, aparte de la planificación.
 *
 * Arriba grita qué pedidos del sheet de pendientes todavía no están en el
 * ERP; en medio se suben las proformas (muchas de un jalón); abajo, todos
 * los pedidos con filtro por modelo, número de pedido o contenedor.
 */
export default async function CargarPedidos() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Los pedidos a China viven en tu cuenta; primero hay que conectarla.
        </p>
        <Link href="/ajustes" className="mt-3 inline-block underline" style={{ color: "var(--acento)" }}>
          Ir a Ajustes
        </Link>
      </div>
    );
  }

  // El sheet puede no contestar: la página sirve igual, avisando.
  const [pedidos, sheet] = await Promise.all([
    listarPedidos(supabase, cuenta.id),
    faltantesDelSheet(supabase, cuenta.id).then(
      (r): { ok: true; datos: FaltantesSheet } => ({ ok: true, datos: r }),
      (e: Error): { ok: false; error: string } => ({ ok: false, error: e.message }),
    ),
  ]);

  const vivos = pedidos.filter((p) => p.estado !== "recibido" && p.estado !== "cancelado").length;
  const faltan = sheet.ok ? sheet.datos.faltan : [];
  const urlSheet = configuracionSheetPedidos().url;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Cargar pedidos</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Sube las proformas de la fábrica y aquí quedan los pedidos con sus corridas.
          Qué conviene pedir se ve en{" "}
          <Link href="/pedidos" className="underline" style={{ color: "var(--acento)" }}>
            Planificación China
          </Link>
          .
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Ficha
          titulo="Faltan por cargar"
          valor={sheet.ok ? n(faltan.length) : "?"}
          nota={sheet.ok ? "Según el sheet de pedidos pendientes" : "No se pudo leer el sheet"}
          tono={!sheet.ok ? "alerta" : faltan.length > 0 ? "critico" : "bien"}
        />
        <Ficha
          titulo="En el sheet"
          valor={sheet.ok ? n(sheet.datos.faltan.length + sheet.datos.cargados.length) : "?"}
          nota={sheet.ok ? `${sheet.datos.ignorados.length} AR ignorados` : undefined}
        />
        <Ficha titulo="Pedidos vivos" valor={n(vivos)} nota="Sin recibir ni cancelar" />
        <Ficha titulo="Pedidos en total" valor={n(pedidos.length)} />
      </div>

      {/* ---- Faltantes según el sheet ------------------------------------- */}
      {!sheet.ok ? (
        <p
          className="rounded-lg p-3 text-sm"
          style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
        >
          No pude leer el sheet de pedidos pendientes: {sheet.error}{" "}
          <a href={urlSheet} target="_blank" rel="noreferrer" className="underline">
            Abrir el sheet
          </a>
        </p>
      ) : faltan.length ? (
        <section
          className="tarjeta overflow-hidden"
          style={{ borderColor: "color-mix(in oklab, var(--estado-critico) 40%, transparent)" }}
        >
          <header className="border-b p-3 hairline">
            <h2 className="text-sm font-semibold" style={{ color: "var(--estado-critico)" }}>
              Te faltan {faltan.length} pedidos por cargar
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
              Están en el{" "}
              <a href={urlSheet} target="_blank" rel="noreferrer" className="underline">
                sheet de pedidos pendientes
              </a>{" "}
              y no en el ERP. Los AR no cuentan. Sube su proforma aquí abajo.
            </p>
          </header>
          <div className="max-h-72 overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Fábrica</th>
                  <th>Modelos</th>
                  <th className="num">Pares</th>
                  <th>Embarque</th>
                </tr>
              </thead>
              <tbody>
                {faltan.map((p) => (
                  <tr key={p.pedido}>
                    <td className="font-medium">{p.pedido}</td>
                    <td className="text-xs">{p.fabrica ?? "—"}</td>
                    <td className="text-xs">{p.modelos ?? "—"}</td>
                    <td className="num cifra">{p.pares != null ? n(p.pares) : "—"}</td>
                    <td className="text-xs">{p.embarque ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <p className="rounded-lg p-3 text-sm" style={{ background: "color-mix(in oklab, var(--exito-texto) 12%, transparent)" }}>
          Todos los pedidos del{" "}
          <a href={urlSheet} target="_blank" rel="noreferrer" className="underline">
            sheet de pendientes
          </a>{" "}
          ya están cargados.
        </p>
      )}

      <CargarPedidosLote />

      <details className="tarjeta p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Cargar una sola proforma corrigiendo renglones (modelo, color, cajas completas)
        </summary>
        <div className="mt-3">
          <CargarPedido />
        </div>
      </details>

      <ListaPedidos pedidos={pedidos} />
    </div>
  );
}
