"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Printer, Scissors } from "lucide-react";

export interface CorteResumen {
  id: number;
  numero: number;
  creadoEn: string;
  pedidos: number;
  pares: number;
  handover: string;
  errores: { orderId: string; error: string }[];
}

function cuando(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * La rutina de la mañana en un botón. "Hacer corte" confirma en TikTok todo
 * lo pendiente y lo deja guardado; de cada corte salen las etiquetas y la
 * lista de empaque, en el mismo orden y con los mismos números, y se
 * reimprimen cuantas veces haga falta.
 */
export function DespachoTikTok({ pendientes, cortes }: { pendientes: number; cortes: CorteResumen[] }) {
  const router = useRouter();
  const [handover, setHandover] = useState<"PICKUP" | "DROP_OFF">("PICKUP");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function hacerCorte() {
    setOcupado(true);
    setAviso(null);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/cortes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handover }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo hacer el corte.");
      const partes = [`Corte #${j.numero}: ${j.pedidos} pedidos, ${j.pares} pares confirmados en TikTok.`];
      if (j.publicados) partes.push(`${j.publicados} SKU republicados.`);
      if (j.errores?.length) partes.push(`${j.errores.length} pedidos no entraron (abajo el motivo).`);
      setAviso(partes.join(" "));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="tarjeta p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              {pendientes ? `${pendientes} pedidos por despachar` : "Nada por despachar"}
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
              Hacer corte confirma todos los envíos en TikTok de un jalón, descuenta del almacén,
              republica y deja el corte guardado con sus etiquetas y su lista.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={handover}
              onChange={(e) => setHandover(e.target.value as "PICKUP" | "DROP_OFF")}
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--grid)" }}
              aria-label="Cómo se entregan los paquetes"
            >
              <option value="PICKUP">Pasa el repartidor</option>
              <option value="DROP_OFF">Los llevo a la paquetería</option>
            </select>
            <button
              onClick={hacerCorte}
              disabled={ocupado || !pendientes}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: "var(--acento)" }}
            >
              <Scissors size={14} />
              {ocupado ? "Confirmando en TikTok…" : `Hacer corte (${pendientes})`}
            </button>
          </div>
        </div>
        {aviso ? <p className="mt-2 text-xs" style={{ color: "var(--exito-texto)" }}>{aviso}</p> : null}
        {error ? <p className="mt-2 text-xs" style={{ color: "var(--estado-critico)" }}>{error}</p> : null}
      </section>

      <section className="tarjeta overflow-hidden">
        <h2 className="px-4 pt-4 text-sm font-semibold">Cortes</h2>
        <p className="px-4 text-xs" style={{ color: "var(--ink-2)" }}>
          Etiquetas y lista van en orden de modelo → color → talla, con el mismo número en las dos.
          En la etiqueta el número y el SKU van abajo a la derecha.
        </p>
        <ul className="mt-3 divide-y" style={{ borderColor: "var(--grid)" }}>
          {cortes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hairline">
              <div>
                <div className="text-sm font-semibold">
                  Corte #{c.numero}
                  <span className="ml-2 text-xs font-normal" style={{ color: "var(--ink-2)" }}>
                    {cuando(c.creadoEn)} · {c.pedidos} pedidos · {c.pares} pares ·{" "}
                    {c.handover === "DROP_OFF" ? "a la paquetería" : "pasa el repartidor"}
                  </span>
                </div>
                {c.errores?.length ? (
                  <ul className="mt-1 text-xs" style={{ color: "var(--estado-critico)" }}>
                    {c.errores.map((e) => (
                      <li key={e.orderId}>
                        Pedido {e.orderId}: {e.error}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/tiktok/cortes/${c.id}/etiquetas`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                  style={{ background: "var(--acento)" }}
                >
                  <Printer size={14} /> Etiquetas PDF
                </a>
                <a
                  href={`/api/tiktok/cortes/${c.id}/lista`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
                  style={{ borderColor: "var(--grid)" }}
                >
                  <FileText size={14} /> Lista de empaque
                </a>
              </div>
            </li>
          ))}
          {!cortes.length ? (
            <li className="px-4 py-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>
              Todavía no hay cortes.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
