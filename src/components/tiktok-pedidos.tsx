"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, PackageCheck } from "lucide-react";

export interface PedidoPorEnviar {
  orderId: string;
  estado: string;
  creadoEn: string | null;
  destinatario: string | null;
  /** TIKTOK = guía de TikTok; SELLER = paquetería propia */
  shippingType: string | null;
  /** solicitud de muestra gratis: se manda igual, no es venta */
  esMuestra?: boolean;
  renglones: { sku: string; pares: number }[];
}

function cuando(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Lo que hay que empacar, pedido por pedido, con los dos botones que cierran
 * el ciclo desde el ERP: la guía para pegarla en la caja y la confirmación
 * del envío. Ese clic es el que descuenta del almacén y republica en TikTok
 * en el mismo acto — sin esperar a que TikTok avise.
 */
export function PedidosTikTok({ pedidos }: { pedidos: PedidoPorEnviar[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Record<string, { ok: boolean; texto: string }>>({});
  const [handover, setHandover] = useState<Record<string, "PICKUP" | "DROP_OFF">>({});
  const [guias, setGuias] = useState<Record<string, { guia: string; proveedorId: string }>>({});

  if (!pedidos.length) return null;

  async function confirmar(p: PedidoPorEnviar) {
    const propio = p.shippingType === "SELLER";
    const g = guias[p.orderId] ?? { guia: "", proveedorId: "" };
    if (propio && (!g.guia.trim() || !g.proveedorId.trim())) {
      setMensajes((m) => ({ ...m, [p.orderId]: { ok: false, texto: "Con paquetería propia hace falta la guía y el id del proveedor." } }));
      return;
    }

    setOcupado(p.orderId);
    try {
      const r = await fetch(`/api/tiktok/pedidos/${encodeURIComponent(p.orderId)}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handover: handover[p.orderId] ?? "PICKUP",
          guia: propio ? g.guia.trim() : null,
          proveedorId: propio ? g.proveedorId.trim() : null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "TikTok no aceptó el envío.");
      const texto = [
        `Envío confirmado (${j.paquetes?.length ?? 0} paquete${j.paquetes?.length === 1 ? "" : "s"}).`,
        j.salidas ? `${j.salidas} salida${j.salidas === 1 ? "" : "s"} del almacén.` : "",
        j.publicados ? `${j.publicados} SKU republicados en TikTok.` : "",
        j.avisos?.length ? `Avisos: ${j.avisos.join(" · ")}` : "",
      ].filter(Boolean).join(" ");
      setMensajes((m) => ({ ...m, [p.orderId]: { ok: true, texto } }));
      router.refresh();
    } catch (e) {
      setMensajes((m) => ({ ...m, [p.orderId]: { ok: false, texto: (e as Error).message } }));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="tarjeta p-4">
      <h2 className="text-sm font-semibold">Qué hay que empacar</h2>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
        Pagados y sin salir: sus pares ya están apartados. Imprime la guía, empaca, y al confirmar
        el envío aquí se descuenta del almacén y se republica en TikTok en el mismo clic.
      </p>

      <ul className="mt-3 flex flex-col gap-3">
        {pedidos.map((p) => {
          const propio = p.shippingType === "SELLER";
          const msg = mensajes[p.orderId];
          const g = guias[p.orderId] ?? { guia: "", proveedorId: "" };
          return (
            <li key={p.orderId} className="rounded-lg border p-3" style={{ borderColor: "var(--grid)" }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    Pedido {p.orderId}
                    {p.esMuestra ? (
                      <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: "var(--acento-suave)", color: "var(--acento)" }}>
                        Muestra
                      </span>
                    ) : null}
                    <span className="ml-2 text-xs font-normal" style={{ color: "var(--ink-2)" }}>
                      {cuando(p.creadoEn)}
                      {propio ? " · paquetería propia" : " · guía de TikTok"}
                    </span>
                  </div>
                  {p.destinatario ? (
                    <div className="text-xs" style={{ color: "var(--ink-2)" }}>{p.destinatario}</div>
                  ) : null}
                  <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
                    {p.renglones.map((r) => (
                      <li key={r.sku}>
                        <span className="font-medium">{r.sku}</span>
                        <span style={{ color: "var(--ink-2)" }}> × {r.pares}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`/api/tiktok/pedidos/${encodeURIComponent(p.orderId)}/etiqueta`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm"
                    style={{ borderColor: "var(--grid)" }}
                  >
                    <ExternalLink size={14} /> Etiqueta
                  </a>
                  <select
                    value={handover[p.orderId] ?? "PICKUP"}
                    onChange={(e) => setHandover((h) => ({ ...h, [p.orderId]: e.target.value as "PICKUP" | "DROP_OFF" }))}
                    className="rounded-lg border px-2 py-1.5 text-sm"
                    style={{ borderColor: "var(--grid)" }}
                    aria-label="Cómo se entrega el paquete"
                  >
                    <option value="PICKUP">Pasa el repartidor</option>
                    <option value="DROP_OFF">Lo llevo a la paquetería</option>
                  </select>
                  <button
                    onClick={() => confirmar(p)}
                    disabled={ocupado !== null}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                    style={{ background: "var(--acento)" }}
                  >
                    <PackageCheck size={14} />
                    {ocupado === p.orderId ? "Confirmando…" : "Confirmar envío"}
                  </button>
                </div>
              </div>

              {propio ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={g.guia}
                    onChange={(e) => setGuias((x) => ({ ...x, [p.orderId]: { ...g, guia: e.target.value } }))}
                    placeholder="Número de guía"
                    className="min-w-[12rem] rounded-lg border px-2.5 py-1.5 text-sm"
                    style={{ borderColor: "var(--grid)" }}
                  />
                  <input
                    value={g.proveedorId}
                    onChange={(e) => setGuias((x) => ({ ...x, [p.orderId]: { ...g, proveedorId: e.target.value } }))}
                    placeholder="Id de paquetería en TikTok"
                    className="min-w-[12rem] rounded-lg border px-2.5 py-1.5 text-sm"
                    style={{ borderColor: "var(--grid)" }}
                  />
                </div>
              ) : null}

              {msg ? (
                <p className="mt-2 text-xs" style={{ color: msg.ok ? "var(--exito-texto)" : "var(--estado-critico)" }}>
                  {msg.texto}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
