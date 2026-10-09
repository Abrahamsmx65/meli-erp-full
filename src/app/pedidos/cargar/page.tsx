import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { listarPedidos } from "@/lib/servicios/pedidos";
import { configuracionSheetPedidos, faltantesDelSheet, type FaltantesSheet } from "@/lib/servicios/pedidos-sheet";
import { servirConCacheApp } from "@/lib/servicios/cache-app";
import { Ficha } from "@/components/tiles";
import { CargarPedido } from "@/components/cargar-pedido";
import { CargarPedidosLote } from "@/components/cargar-pedidos-lote";
import { ListaPedidos } from "@/components/lista-pedidos";
import { Aviso, Cifras, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

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

  if (!cuenta) return <SinCuenta titulo="Cargar pedidos" />;

  // El sheet puede no contestar: la página sirve igual, avisando. Y no se
  // descarga de Google en el clic: vive masticado en app_cache y, pasados
  // 10 minutos, se sirve lo guardado y se relee por atrás (la pestaña de
  // pendientes cambia unas veces al día). Solo sin renglón se lee en vivo.
  const [pedidos, sheet] = await Promise.all([
    listarPedidos(supabase, cuenta.id),
    servirConCacheApp(supabase, cuenta.id, "pedidos-sheet", 10 * 60_000, () => faltantesDelSheet(supabase, cuenta.id)).then(
      (r): { ok: true; datos: FaltantesSheet } => ({ ok: true, datos: r.datos }),
      (e: Error): { ok: false; error: string } => ({ ok: false, error: e.message }),
    ),
  ]);

  const vivos = pedidos.filter((p) => p.estado !== "recibido" && p.estado !== "cancelado").length;
  const faltan = sheet.ok ? sheet.datos.faltan : [];
  const urlSheet = configuracionSheetPedidos().url;

  return (
    <Pagina>
      <Encabezado
        ceja="Abastecimiento"
        titulo="Cargar pedidos"
        descripcion="Sube las proformas de la fábrica y aquí quedan los pedidos con sus corridas."
        acciones={
          <Link href="/pedidos" className="boton boton-borde">
            Planificación China
          </Link>
        }
      />

      <Cifras columnas={4}>
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
      </Cifras>

      {/* ---- Faltantes según el sheet ------------------------------------- */}
      {!sheet.ok ? (
        <Aviso tono="alerta">
          No pude leer el sheet de pedidos pendientes: {sheet.error}{" "}
          <a href={urlSheet} target="_blank" rel="noreferrer" className="underline">
            Abrir el sheet
          </a>
        </Aviso>
      ) : faltan.length ? (
        <section
          className="tarjeta overflow-hidden"
          style={{ borderColor: "color-mix(in oklab, var(--estado-critico) 40%, transparent)" }}
        >
          <header className="seccion-cabeza">
            <div className="min-w-0">
              <h2 className="seccion-titulo" style={{ color: "var(--critico-texto)" }}>
                Te faltan {faltan.length} pedidos por cargar
              </h2>
              <p className="texto-2 mt-0.5 text-[13px]">
                Están en el{" "}
                <a href={urlSheet} target="_blank" rel="noreferrer" className="enlace">
                  sheet de pedidos pendientes
                </a>{" "}
                y no en el ERP. Los AR no cuentan. Sube su proforma aquí abajo.
              </p>
            </div>
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
        <Aviso tono="bien">
          Todos los pedidos del{" "}
          <a href={urlSheet} target="_blank" rel="noreferrer" className="underline">
            sheet de pendientes
          </a>{" "}
          ya están cargados.
        </Aviso>
      )}

      <CargarPedidosLote />

      <details className="tarjeta p-4">
        <summary className="seccion-titulo cursor-pointer">
          Cargar una sola proforma corrigiendo renglones (modelo, color, cajas completas)
        </summary>
        <div className="mt-3">
          <CargarPedido />
        </div>
      </details>

      <ListaPedidos pedidos={pedidos} />
    </Pagina>
  );
}
