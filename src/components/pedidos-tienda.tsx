"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Aviso, Vacio } from "@/components/ui/pagina";
import { NOMBRE_ESTADO, type EstadoTienda, type PedidoTienda } from "@/lib/tienda/estados";

const ORDEN: EstadoTienda[] = ["pagado", "sin_stock", "pendiente_pago", "enviado", "entregado", "cancelado", "expirado"];

const COLOR: Partial<Record<EstadoTienda, string>> = {
  pagado: "var(--estado-serio)",
  sin_stock: "var(--estado-critico)",
  pendiente_pago: "var(--ink-muted)",
  enviado: "var(--estado-bien)",
  entregado: "var(--estado-bien)",
};

const pesos = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const fecha = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function direccionEnTexto(d: Record<string, string>): string {
  return [
    [d.calle, d.numero].filter(Boolean).join(" "),
    d.interior ? `Int. ${d.interior}` : "",
    d.colonia,
    [d.cp, d.ciudad].filter(Boolean).join(" "),
    d.estado,
    d.referencias ? `Ref: ${d.referencias}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export function PedidosTienda({
  pedidos,
  productosActivos,
  catalogoLeidoEn,
}: {
  pedidos: PedidoTienda[];
  productosActivos: number;
  catalogoLeidoEn: string | null;
}) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<EstadoTienda | "todos">("pagado");
  const [ocupado, setOcupado] = useState<number | "catalogo" | null>(null);
  const [mensaje, setMensaje] = useState<{ texto: string; error?: boolean } | null>(null);
  const [guias, setGuias] = useState<Record<number, { guia: string; paqueteria: string }>>({});

  const cuenta = useMemo(() => {
    const c = new Map<EstadoTienda, number>();
    for (const p of pedidos) c.set(p.estado, (c.get(p.estado) ?? 0) + 1);
    return c;
  }, [pedidos]);
  const visibles = filtro === "todos" ? pedidos : pedidos.filter((p) => p.estado === filtro);
  const porSurtir = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pedidos) if (p.estado === "pagado") for (const it of p.items) m.set(it.skuInterno, (m.get(it.skuInterno) ?? 0) + it.cantidad);
    return [...m].sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }));
  }, [pedidos]);

  async function accion(id: number, cuerpo: Record<string, unknown>) {
    setOcupado(id);
    setMensaje(null);
    try {
      const res = await fetch(`/api/tiktok/tienda/pedidos/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
      setMensaje({ texto: `Listo: ${NOMBRE_ESTADO[j.estado as EstadoTienda] ?? j.estado}.${j.avisos?.length ? " " + j.avisos.join(" · ") : ""}` });
      router.refresh();
    } catch (err) {
      setMensaje({ texto: (err as Error).message, error: true });
    } finally {
      setOcupado(null);
    }
  }

  async function actualizarCatalogo() {
    setOcupado("catalogo");
    setMensaje(null);
    try {
      const res = await fetch("/api/tiktok/tienda/catalogo", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
      setMensaje({
        texto:
          `Catálogo: ${j.leidos} productos leídos de TikTok` +
          (j.fallidos ? `, ${j.fallidos} con error` : "") +
          (j.pendientes ? `, faltan ${j.pendientes} (dale otra vez)` : "") +
          (j.avisos?.length ? `. ${j.avisos.join(" · ")}` : "."),
        error: Boolean(j.fallidos),
      });
      router.refresh();
    } catch (err) {
      setMensaje({ texto: (err as Error).message, error: true });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="tarjeta flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div>
          <b className="num">{productosActivos}</b> productos a la venta · catálogo leído de TikTok {fecha(catalogoLeidoEn)}
        </div>
        <button
          className="boton boton-borde boton-chico"
          onClick={actualizarCatalogo}
          disabled={ocupado !== null}
          title="El precio se copia cada 15 min; fotos, colores y tallas se releen cada 12 h o con este botón"
        >
          <RefreshCw size={14} className={ocupado === "catalogo" ? "girando" : ""} /> Actualizar catálogo
        </button>
      </div>

      {mensaje && (
        <Aviso tono={mensaje.error ? "critico" : "bien"}>{mensaje.texto}</Aviso>
      )}

      <div className="flex flex-wrap gap-2">
        {ORDEN.map((e) => (
          <button
            key={e}
            className={`chip ${filtro === e ? "boton-primario" : ""}`}
            onClick={() => setFiltro(e)}
            style={{ cursor: "pointer" }}
          >
            {NOMBRE_ESTADO[e]} <span className="num">({cuenta.get(e) ?? 0})</span>
          </button>
        ))}
        <button className={`chip ${filtro === "todos" ? "boton-primario" : ""}`} onClick={() => setFiltro("todos")} style={{ cursor: "pointer" }}>
          Todos <span className="num">({pedidos.length})</span>
        </button>
      </div>

      {filtro === "pagado" && porSurtir.length > 0 && (
        <div className="tarjeta p-4">
          <h2 className="seccion-titulo">Surtir para los pedidos pagados</h2>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {porSurtir.map(([sku, n]) => (
              <span key={sku}>
                <span className="num">{sku}</span> ×{n}
              </span>
            ))}
          </div>
        </div>
      )}

      {!visibles.length && <div className="tarjeta"><Vacio>No hay pedidos en este estado.</Vacio></div>}

      <div className="flex flex-col gap-3">
        {visibles.map((p) => {
          const g = guias[p.id] ?? { guia: "", paqueteria: "" };
          return (
            <div key={p.id} className="tarjeta p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <b className="num">{p.folio}</b>
                    <span className="insignia" style={{ color: COLOR[p.estado] ?? "var(--ink-2)" }}>
                      {NOMBRE_ESTADO[p.estado] ?? p.estado}
                    </span>
                  </div>
                  <div className="mt-1 text-xs texto-2">
                    Creado {fecha(p.creadoEn)}
                    {p.pagadoEn ? ` · pagado ${fecha(p.pagadoEn)}` : ""}
                    {p.enviadoEn ? ` · enviado ${fecha(p.enviadoEn)}` : ""}
                    {p.mpPago ? ` · Mercado Pago #${p.mpPago} (${p.pagoEstado ?? "—"})` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="num font-semibold">{pesos(p.total)}</div>
                  <div className="text-xs texto-2">
                    {pesos(p.subtotal)} + envío {pesos(p.envio)}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <div className="font-medium">{p.nombre}</div>
                  <div className="texto-2">
                    {p.email}
                    {p.telefono ? ` · ${p.telefono}` : ""}
                  </div>
                  <div className="mt-1">{direccionEnTexto(p.direccion)}</div>
                  {p.guia && (
                    <div className="mt-1">
                      Guía <span className="num">{p.guia}</span> {p.paqueteria ? `(${p.paqueteria})` : ""}
                    </div>
                  )}
                  {p.nota && <div className="mt-1 text-xs texto-2">Nota: {p.nota}</div>}
                </div>
                <ul className="flex flex-col gap-1">
                  {p.items.map((it, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="num">{it.skuInterno}</span>
                        <span className="texto-2"> · {[it.color, it.talla].filter(Boolean).join(" / ")}</span>
                      </span>
                      <span className="num">
                        ×{it.cantidad} · {pesos(it.precio)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="no-imprimir mt-3 flex flex-wrap items-center gap-2">
                {p.estado === "pagado" && (
                  <>
                    <input
                      className="rounded border px-2 py-1 text-sm"
                      style={{ borderColor: "var(--borde)" }}
                      placeholder="Número de guía"
                      value={g.guia}
                      onChange={(e) => setGuias({ ...guias, [p.id]: { ...g, guia: e.target.value } })}
                    />
                    <input
                      className="rounded border px-2 py-1 text-sm"
                      style={{ borderColor: "var(--borde)" }}
                      placeholder="Paquetería"
                      value={g.paqueteria}
                      onChange={(e) => setGuias({ ...guias, [p.id]: { ...g, paqueteria: e.target.value } })}
                    />
                    <button
                      className="boton boton-primario boton-chico"
                      disabled={ocupado !== null || !g.guia.trim()}
                      onClick={() => accion(p.id, { accion: "enviar", ...g })}
                    >
                      Marcar enviado
                    </button>
                  </>
                )}
                {p.estado === "enviado" && (
                  <button className="boton boton-borde boton-chico" disabled={ocupado !== null} onClick={() => accion(p.id, { accion: "entregado" })}>
                    Marcar entregado
                  </button>
                )}
                {["pendiente_pago", "pagado", "sin_stock"].includes(p.estado) && (
                  <button
                    className="boton boton-peligro boton-chico"
                    disabled={ocupado !== null}
                    onClick={() => {
                      const pagado = p.estado !== "pendiente_pago";
                      if (!confirm(`¿Cancelar ${p.folio}?${pagado ? " Se devuelve el dinero en Mercado Pago." : ""}`)) return;
                      const nota = prompt("Motivo (opcional)") ?? "";
                      accion(p.id, { accion: "cancelar", nota });
                    }}
                  >
                    Cancelar{p.estado !== "pendiente_pago" ? " y devolver" : ""}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
