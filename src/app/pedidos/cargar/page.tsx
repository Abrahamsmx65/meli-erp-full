import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { listarPedidos } from "@/lib/servicios/pedidos";
import {
  configuracionSheetPedidos,
  confirmacionDePedidos,
  DIAS_PEDIDO_NUEVO,
  faltantesDelSheet,
  type FaltantesSheet,
} from "@/lib/servicios/pedidos-sheet";
import { servirConCacheApp } from "@/lib/servicios/cache-app";
import { ultimaRevisionConfirmacion } from "@/lib/servicios/confirmacion-pedidos";
import { Ficha } from "@/components/tiles";
import { CargarPedido } from "@/components/cargar-pedido";
import { CargarPedidosLote } from "@/components/cargar-pedidos-lote";
import { ListaPedidos } from "@/components/lista-pedidos";
import { Aviso, Cifras, Encabezado, Frescura, Pagina, SinCuenta } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Cargar pedidos: la pestaña de captura, aparte de la planificación.
 *
 * La ficha de arriba grita cuántos pedidos del sheet de pendientes todavía
 * no están en el ERP; en medio se suben las proformas (muchas de un jalón);
 * abajo, en pestañas, todos los pedidos con filtro por modelo, número de
 * pedido o contenedor, y la lista de los que faltan por cargar.
 */
export default async function CargarPedidos() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) return <SinCuenta titulo="Órdenes de compra" />;

  // El sheet puede no contestar: la página sirve igual, avisando. Y no se
  // descarga de Google en el clic: vive masticado en app_cache y, pasados
  // 10 minutos, se sirve lo guardado y se relee por atrás (la pestaña de
  // pendientes cambia unas veces al día). Solo sin renglón se lee en vivo.
  const [pedidos, sheet, revision] = await Promise.all([
    listarPedidos(supabase, cuenta.id),
    servirConCacheApp(supabase, cuenta.id, "pedidos-sheet", 10 * 60_000, () => faltantesDelSheet(supabase, cuenta.id)).then(
      (r): { ok: true; datos: FaltantesSheet; generadoEn: string | null; refrescando: boolean } => ({
        ok: true,
        datos: r.datos,
        generadoEn: r.generadoEn,
        refrescando: r.refrescando,
      }),
      (e: Error): { ok: false; error: string } => ({ ok: false, error: e.message }),
    ),
    ultimaRevisionConfirmacion(supabase, cuenta.id).catch(() => null),
  ]);

  const vivos = pedidos.filter((p) => p.estado !== "recibido" && p.estado !== "cancelado").length;
  const faltan = sheet.ok ? sheet.datos.faltan : [];
  const urlSheet = configuracionSheetPedidos().url;

  // Al revés del de arriba: los pedidos del ERP SIN BARCO contra el sheet.
  // China confirma un pedido subiéndolo ahí (dueño, 21-oct-2026); el cron de
  // las 8:00 relee el sheet y avisa, y aquí cada pedido sin barco lo dice.
  const confirmacion = sheet.ok
    ? confirmacionDePedidos(pedidos, [...sheet.datos.cargados, ...sheet.datos.faltan])
    : [];
  const porConfirmar = confirmacion.filter((c) => c.estado === "falta");
  const confirmacionPorPedido = new Map(confirmacion.map((c) => [c.pedido, c]));
  const pedidosConChina = pedidos.map((p) => {
    const c = confirmacionPorPedido.get(p.pedido);
    return c ? { ...p, confirmacionChina: { estado: c.estado, fecha: c.fechaConfirm } } : p;
  });

  return (
    <Pagina>
      <Encabezado
        ceja="Abastecimiento"
        titulo="Órdenes de compra"
        descripcion="Sube las proformas de la fábrica y aquí quedan los pedidos con sus corridas."
      />

      <Cifras columnas={4}>
        <Ficha
          titulo="Falta confirmar en China"
          valor={sheet.ok ? n(porConfirmar.length) : "?"}
          nota={
            sheet.ok
              ? porConfirmar.length
                ? porConfirmar.map((c) => c.pedido).join(", ")
                : confirmacion.length
                  ? `Los ${n(confirmacion.length)} sin barco ya están en el sheet`
                  : "No hay pedidos sin barco"
              : "No se pudo leer el sheet"
          }
          tono={!sheet.ok ? "alerta" : porConfirmar.length > 0 ? "critico" : "bien"}
        />
        <Ficha
          titulo="Faltan por cargar"
          valor={sheet.ok ? n(faltan.length) : "?"}
          nota={sheet.ok ? "Según el sheet de pedidos pendientes" : "No se pudo leer el sheet"}
          tono={!sheet.ok ? "alerta" : faltan.length > 0 ? "critico" : "bien"}
        />
        <Ficha titulo="Pedidos vivos" valor={n(vivos)} nota="Sin recibir ni cancelar" />
        <Ficha
          titulo="En el sheet"
          valor={sheet.ok ? n(sheet.datos.faltan.length + sheet.datos.cargados.length) : "?"}
          nota={sheet.ok ? `${sheet.datos.ignorados.length} AR ignorados · ${n(pedidos.length)} en el ERP` : undefined}
        />
      </Cifras>

      {sheet.ok ? (
        <p className="texto-tenue -mt-2 text-xs">
          Sheet de China leído <Frescura generadoEn={sheet.generadoEn} refrescando={sheet.refrescando} />.{" "}
          {revision
            ? revision.error
              ? `La revisión automática de las 8:00 falló (${revision.error}).`
              : `Última revisión automática: ${fechaHora(revision.revisadoEn)} (${revision.faltan.length} por confirmar, ${revision.confirmados.length} confirmados).`
            : "La revisión automática corre todos los días a las 8:00."}
        </p>
      ) : null}

      {/* ---- El sheet no contestó ----------------------------------------- */}
      {!sheet.ok ? (
        <Aviso tono="alerta">
          No pude leer el sheet de pedidos pendientes: {sheet.error}{" "}
          <a href={urlSheet} target="_blank" rel="noreferrer" className="enlace">
            Abrir el sheet
          </a>
        </Aviso>
      ) : null}

      <CargarPedidosLote />

      <details className="tarjeta p-4">
        <summary className="seccion-titulo cursor-pointer">
          Cargar una proforma corrigiendo renglones
        </summary>
        <div className="mt-3">
          <CargarPedido />
        </div>
      </details>

      {/* Pestañas: la lista de pedidos y, si el sheet dice que faltan, la
           lista de faltantes. La carga de proformas se queda arriba, fuera de
           las pestañas, para que cambiar de pestaña no tire una carga a medias. */}
      <Pestanas
        pestanas={[
          {
            id: "pedidos",
            titulo: "Pedidos",
            cuenta: pedidos.length,
            contenido: <ListaPedidos pedidos={pedidosConChina} />,
          },
          confirmacion.length > 0 && {
            id: "china",
            titulo: "Confirmación de China",
            cuenta: porConfirmar.length || undefined,
            alerta: porConfirmar.length > 0,
            contenido: (
              <section className="tarjeta overflow-hidden">
                <header className="seccion-cabeza">
                  <div className="min-w-0">
                    <h2 className="seccion-titulo">
                      {porConfirmar.length
                        ? `${porConfirmar.length} ${porConfirmar.length === 1 ? "pedido sin barco falta" : "pedidos sin barco faltan"} por confirmar`
                        : "Todos los pedidos sin barco están confirmados"}
                    </h2>
                    <p className="texto-2 mt-0.5 text-[13px]">
                      Un pedido cuenta como confirmado cuando China lo sube al{" "}
                      <a href={urlSheet} target="_blank" rel="noreferrer" className="enlace">
                        sheet de pedidos pendientes
                      </a>
                      ; la fecha es la de su columna «Confirm». Un pedido con más de {DIAS_PEDIDO_NUEVO} días que ya
                      no aparece ahí no falta: China lo quitó de pendientes.
                    </p>
                  </div>
                </header>
                <div className="max-h-96 overflow-auto">
                  <table className="datos">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Modelos</th>
                        <th className="num">Pares</th>
                        <th>Creado</th>
                        <th>Fábrica (sheet)</th>
                        <th>Embarque (sheet)</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {confirmacion.map((c) => (
                        <tr key={c.pedido}>
                          <td className="font-medium">{c.pedido}</td>
                          <td className="text-xs">{c.modelos.join(", ") || "—"}</td>
                          <td className="num cifra">
                            {n(c.paresErp)}
                            {c.paresSheet != null && c.paresSheet !== c.paresErp ? (
                              <div className="text-[11px]" style={{ color: "var(--alerta-texto)" }}>
                                sheet: {n(c.paresSheet)}
                              </div>
                            ) : null}
                          </td>
                          <td className="text-xs">{c.creadoEn.slice(0, 10)}</td>
                          <td className="text-xs">{c.fabrica ?? "—"}</td>
                          <td className="text-xs">{c.embarque ?? "—"}</td>
                          <td
                            className="text-xs font-medium"
                            style={{
                              color:
                                c.estado === "falta"
                                  ? "var(--critico-texto)"
                                  : c.estado === "fuera"
                                    ? "var(--ink-muted)"
                                    : "var(--exito-texto)",
                            }}
                            title={
                              c.estado === "fuera"
                                ? `Tiene más de ${DIAS_PEDIDO_NUEVO} días y China ya lo quitó del sheet: ¿se embarcó sin amarrarse a un contenedor, o se canceló?`
                                : undefined
                            }
                          >
                            {c.estado === "falta"
                              ? "Falta confirmar"
                              : c.estado === "fuera"
                                ? "Ya no está en el sheet"
                                : `Confirmado${c.fechaConfirm ? ` · ${c.fechaConfirm}` : ""}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ),
          },
          faltan.length > 0 && {
            id: "faltan",
            titulo: "Faltan por cargar",
            cuenta: faltan.length,
            alerta: true,
            contenido: (
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
                      <a href={urlSheet} target="_blank" rel="noreferrer" className="enlace">
                        Sheet de pedidos pendientes
                      </a>
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
            ),
          },
        ]}
      />
    </Pagina>
  );
}
