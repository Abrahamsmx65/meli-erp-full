"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, FileText, Printer, ScanLine, Scissors, ShieldCheck } from "lucide-react";

export interface CorteResumen {
  id: number;
  numero: number;
  creadoEn: string;
  pedidos: number;
  pares: number;
  handover: string;
  errores: { orderId: string; error: string }[];
  /** paquetes que ya pasaron los tres escaneos */
  preparados: number;
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
  const [preparandoTodo, setPreparandoTodo] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulacion, setSimulacion] = useState<any>(null);
  const [simulando, setSimulando] = useState(false);

  async function simular() {
    setSimulando(true);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/cortes/simular");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo simular.");
      setSimulacion(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSimulando(false);
    }
  }

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
      if (j.al3pl?.sinEndpoint) partes.push("Salidas al 3PL: Industher todavía no tiene el endpoint; se reintentan solas.");
      else if (j.al3pl?.error) partes.push(`Salidas al 3PL: ${j.al3pl.error}`);
      else if (j.al3pl?.confirmadas) partes.push(`${j.al3pl.confirmadas} salidas descontadas en Industher.`);
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
              onClick={simular}
              disabled={simulando || !pendientes}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
              style={{ borderColor: "var(--grid)" }}
              title="Ver qué haría el corte sin confirmar nada"
            >
              <Eye size={14} />
              {simulando ? "Simulando…" : "Simular"}
            </button>
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

        {simulacion ? (
          <div className="mt-4 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--grid)" }}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                Simulación: {simulacion.pedidos.length} pedidos · {simulacion.totalPares} pares
              </span>
              <button onClick={() => setSimulacion(null)} className="text-xs underline" style={{ color: "var(--ink-2)" }}>
                cerrar
              </button>
            </div>
            <ul className="mt-2 flex flex-col gap-1">
              {simulacion.pedidos.map((p: any) => (
                <li key={p.orderId} className="flex flex-wrap items-center gap-2">
                  <span className="cifra text-xs" style={{ color: "var(--ink-2)" }}>{p.orderId}</span>
                  <span>{p.pares.map((x: any) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(", ")}</span>
                  <span
                    className="rounded-full px-2 text-[11px] font-semibold"
                    style={{
                      background: p.recoleccion === true ? "var(--acento-suave)" : p.recoleccion === false ? "color-mix(in oklab, var(--estado-alerta) 18%, transparent)" : "var(--grid)",
                      color: p.recoleccion === true ? "var(--exito-texto)" : "var(--ink-2)",
                    }}
                  >
                    {p.recoleccion === true ? "recolección disponible" : p.recoleccion === false ? "solo drop-off" : "sin dato"}
                  </span>
                  {p.aviso ? <span className="text-xs" style={{ color: "var(--ink-2)" }}>{p.aviso}</span> : null}
                </li>
              ))}
            </ul>
            <div className="mt-3 text-xs" style={{ color: "var(--ink-2)" }}>
              Al 3PL se mandarían: {simulacion.salidasAl3pl.map((x: any) => `${x.sku} ×${x.pares}`).join(", ") || "nada"}
              {" · "}endpoint: {simulacion.endpoint3pl ?? "sin configurar"}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>Nada de esto se ha confirmado. Es solo lo que pasaría.</p>
          </div>
        ) : null}
      </section>

      <section className="tarjeta overflow-hidden">
        <h2 className="px-4 pt-4 text-sm font-semibold">Cortes</h2>
        <p className="px-4 text-xs" style={{ color: "var(--ink-2)" }}>
          Etiquetas y lista van en orden de modelo → color → talla, con el mismo número en las dos.
          En la etiqueta, abajo a la derecha, van el número, el SKU con su cantidad y el código de
          barras del producto (FNSKU). En la lista, cada renglón trae ese mismo FNSKU para
          escanear: hoja, etiqueta y caja llevan el mismo código.
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
                  <span
                    className="ml-2 rounded-full px-2 text-[11px] font-semibold"
                    style={{
                      background: c.preparados >= c.pedidos && c.pedidos > 0 ? "var(--acento-suave)" : "var(--grid)",
                      color: c.preparados >= c.pedidos && c.pedidos > 0 ? "var(--exito-texto)" : "var(--ink-2)",
                    }}
                  >
                    {c.preparados} / {c.pedidos} preparados
                  </span>
                </div>
                {c.errores?.filter((e) => !e.error.includes("solo drop-off")).length ? (
                  <ul className="mt-1 text-xs" style={{ color: "var(--estado-critico)" }}>
                    {c.errores.filter((e) => !e.error.includes("solo drop-off")).map((e) => (
                      <li key={e.orderId}>
                        Pedido {e.orderId}: {e.error}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/tiktok/despacho/${c.id}/preparar`}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium"
                  style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
                >
                  <ScanLine size={14} /> Preparar pedidos
                </Link>
                {c.pedidos > 0 && c.preparados < c.pedidos ? (
                  <button
                    type="button"
                    disabled={preparandoTodo === c.id}
                    onClick={async () => {
                      const faltan = c.pedidos - c.preparados;
                      const pin = window.prompt(
                        `Dar por preparado TODO el corte #${c.numero} sin escanear (faltan ${faltan}). Clave de supervisor:`,
                      );
                      if (pin == null) return;
                      setPreparandoTodo(c.id);
                      try {
                        const r = await fetch(`/api/tiktok/cortes/${c.id}/preparar-todo`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ pin }),
                        });
                        const j = await r.json();
                        if (!r.ok) throw new Error(j.error ?? "No se pudo.");
                        router.refresh();
                      } catch (e) {
                        alert((e as Error).message);
                      } finally {
                        setPreparandoTodo(null);
                      }
                    }}
                    title="Da por preparados todos los paquetes pendientes del corte, con constancia SUPERVISOR"
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
                    style={{ borderColor: "var(--grid)", color: "var(--ink-2)" }}
                  >
                    <ShieldCheck size={14} /> {preparandoTodo === c.id ? "Preparando…" : "Todo con clave"}
                  </button>
                ) : null}
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
                  href={`/api/tiktok/cortes/${c.id}/salidas`}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
                  style={{ borderColor: "var(--grid)" }}
                  title="Las salidas del corte para el 3PL (CSV)"
                >
                  Salidas 3PL
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
