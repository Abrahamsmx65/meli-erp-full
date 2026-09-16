"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Eye, FileSpreadsheet, Save } from "lucide-react";
import { Ficha } from "./tiles";
import type { ResumenPedidoGuardado } from "@/lib/servicios/tiktok-pedidos-almacen";

function cuando(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Armar, ver y guardar el pedido de almacén. La vista previa no escribe
 * nada; «Guardar pedido» lo deja con número y de ahí sale el Excel.
 */
export function PedidosAlmacenTikTok({
  pedidos,
  desdeSugerido,
  hoy,
}: {
  pedidos: ResumenPedidoGuardado[];
  desdeSugerido: string;
  hoy: string;
}) {
  const router = useRouter();
  const [desde, setDesde] = useState(desdeSugerido);
  const [hasta, setHasta] = useState(hoy);
  const [modo, setModo] = useState<"vendido" | "cobertura">("vendido");
  const [diasObjetivo, setDiasObjetivo] = useState(15);
  const [vista, setVista] = useState<any>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const parametros = () =>
    new URLSearchParams({ desde, hasta, modo, diasObjetivo: String(diasObjetivo) }).toString();

  async function ver() {
    setCargando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await fetch(`/api/tiktok/pedidos-almacen?${parametros()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo armar el pedido.");
      setVista(j);
      setAbiertos(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function verGuardado(id: number) {
    setCargando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await fetch(`/api/tiktok/pedidos-almacen?id=${id}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer el pedido.");
      setVista(j);
      setAbiertos(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/pedidos-almacen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desde, hasta, modo, diasObjetivo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar el pedido.");
      setVista(j);
      setAviso(`Pedido #${j.numero} guardado: ${n(j.totales.pedir)} pares a pedir en ${j.totales.skus} SKU.`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  function alternar(modelo: string) {
    setAbiertos((s) => {
      const nuevo = new Set(s);
      if (nuevo.has(modelo)) nuevo.delete(modelo);
      else nuevo.add(modelo);
      return nuevo;
    });
  }

  const guardado = vista?.id != null;

  return (
    <div className="flex flex-col gap-6">
      <section className="tarjeta p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
            Ventas desde
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--grid)", color: "var(--ink-1)" }} />
          </label>
          <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
            Hasta
            <input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--grid)", color: "var(--ink-1)" }} />
          </label>
          <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
            Cómo pedir
            <select value={modo} onChange={(e) => setModo(e.target.value as "vendido" | "cobertura")} className="rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--grid)", color: "var(--ink-1)" }}>
              <option value="vendido">Reponer lo vendido</option>
              <option value="cobertura">Cobertura a N días</option>
            </select>
          </label>
          {modo === "cobertura" ? (
            <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
              Días de cobertura
              <input type="number" min={1} max={90} value={diasObjetivo} onChange={(e) => setDiasObjetivo(Number(e.target.value) || 15)} className="w-24 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--grid)", color: "var(--ink-1)" }} />
            </label>
          ) : null}
          <button onClick={ver} disabled={cargando} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60" style={{ borderColor: "var(--grid)" }}>
            <Eye size={14} /> {cargando ? "Armando…" : "Ver qué pedir"}
          </button>
          <button onClick={guardar} disabled={guardando} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60" style={{ background: "var(--acento)" }}>
            <Save size={14} /> {guardando ? "Guardando…" : "Guardar pedido"}
          </button>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>
          «Reponer lo vendido» pide par por par lo que salió en el periodo. «Cobertura» pide lo que falte
          para que el disponible en TikTok alcance N días de venta. Lo que ninguna bodega tiene no se pide
          ni sale en el Excel; solo se cuenta. Las bodegas guardan cajas cerradas: la hoja pide pares por
          talla y la bodega elige con qué cajas los cubre.
        </p>
        {aviso ? <p className="mt-2 text-xs" style={{ color: "var(--exito-texto)" }}>{aviso}</p> : null}
        {error ? <p className="mt-2 text-xs" style={{ color: "var(--estado-critico)" }}>{error}</p> : null}
      </section>

      {vista ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {guardado ? `Pedido #${vista.numero}` : "Vista previa (sin guardar)"}
              <span className="ml-2 text-xs font-normal" style={{ color: "var(--ink-2)" }}>
                ventas del {vista.desde} al {vista.hasta} · {vista.dias} días ·{" "}
                {vista.modo === "cobertura" ? `cobertura a ${vista.diasObjetivo} días` : "reponer lo vendido"}
              </span>
            </h2>
            {guardado ? (
              <a href={`/api/tiktok/pedidos-almacen/${vista.id}/excel`} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--grid)" }}>
                <FileSpreadsheet size={14} /> Excel del pedido
              </a>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Ficha titulo="Pares vendidos" valor={vista.totales.vendidos} nota={`${vista.totales.skus} SKU`} />
            <Ficha titulo="Pares a pedir" valor={vista.totales.pedir} tono="bien" />
            <Ficha
              titulo="De qué bodega"
              valor={vista.totales.porBodega.filter((b: any) => b.pares > 0).map((b: any) => `${b.almacen} ${n(b.pares)}`).join(" · ") || "—"}
            />
            <Ficha
              titulo="Vendido sin bodega (no se pide)"
              valor={vista.totales.faltante}
              tono={vista.totales.faltante ? "alerta" : "neutro"}
              nota={vista.sinBodega?.skus ? `${vista.sinBodega.skus} SKU sin nada en bodega: ${vista.sinBodega.lista.slice(0, 4).join(", ")}${vista.sinBodega.lista.length > 4 ? "…" : ""}` : undefined}
            />
          </div>

          <div className="tarjeta overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: "var(--ink-2)" }}>
                  <th className="px-4 py-2">Modelo</th>
                  <th className="px-2 py-2 text-right">SKU</th>
                  <th className="px-2 py-2 text-right">Vendidos</th>
                  <th className="px-2 py-2 text-right">Pedir</th>
                  <th className="px-2 py-2 text-right">Sin bodega</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {vista.porModelo.map((m: any) => (
                  <ModeloFila key={m.modelo} m={m} renglones={vista.renglones.filter((r: any) => r.modelo === m.modelo)} abierto={abiertos.has(m.modelo)} alternar={() => alternar(m.modelo)} />
                ))}
                {!vista.porModelo.length ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>
                      Sin ventas en ese periodo: no hay nada que pedir.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <h2 className="px-4 pt-4 text-sm font-semibold">Pedidos guardados</h2>
        <ul className="mt-3 divide-y" style={{ borderColor: "var(--grid)" }}>
          {pedidos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hairline">
              <div className="text-sm">
                <span className="font-semibold">Pedido #{p.numero}</span>
                <span className="ml-2 text-xs" style={{ color: "var(--ink-2)" }}>
                  {cuando(p.creadoEn)} · ventas del {p.desde} al {p.hasta} · {n(p.pares)} pares en {p.skus} SKU ·{" "}
                  {p.modo === "cobertura" ? `cobertura a ${p.diasObjetivo} días` : "reponer lo vendido"}
                </span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => verGuardado(p.id)} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--grid)" }}>
                  <ClipboardList size={14} /> Ver
                </button>
                <a href={`/api/tiktok/pedidos-almacen/${p.id}/excel`} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--grid)" }}>
                  <FileSpreadsheet size={14} /> Excel
                </a>
              </div>
            </li>
          ))}
          {!pedidos.length ? (
            <li className="px-4 py-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>
              Todavía no hay pedidos guardados.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

function ModeloFila({ m, renglones, abierto, alternar }: { m: any; renglones: any[]; abierto: boolean; alternar: () => void }) {
  return (
    <>
      <tr className="cursor-pointer hairline" onClick={alternar}>
        <td className="px-4 py-2 font-semibold">{m.modelo}</td>
        <td className="px-2 py-2 text-right cifra">{m.skus}</td>
        <td className="px-2 py-2 text-right cifra">{n(m.vendidos)}</td>
        <td className="px-2 py-2 text-right cifra font-semibold">{n(m.pedir)}</td>
        <td className="px-2 py-2 text-right cifra" style={{ color: m.faltante ? "var(--estado-alerta)" : "var(--ink-2)" }}>{n(m.faltante)}</td>
        <td className="px-2 py-2 text-right text-xs" style={{ color: "var(--ink-2)" }}>{abierto ? "cerrar" : "ver tallas"}</td>
      </tr>
      {abierto ? (
        <tr>
          <td colSpan={6} className="px-4 pb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ color: "var(--ink-2)" }}>
                  <th className="py-1">SKU</th>
                  <th className="py-1 text-right">Vendidos</th>
                  <th className="py-1 text-right">Disponible TikTok</th>
                  <th className="py-1 text-right">Días</th>
                  <th className="py-1 text-right">Pedir</th>
                  <th className="py-1 pl-3">De dónde</th>
                </tr>
              </thead>
              <tbody>
                {renglones.map((r: any) => (
                  <tr key={r.sku} className="hairline">
                    <td className="py-1">{r.sku}</td>
                    <td className="py-1 text-right cifra">{r.vendidos}</td>
                    <td className="py-1 text-right cifra">{r.disponible}</td>
                    <td className="py-1 text-right cifra">{r.diasCobertura == null ? "—" : Math.round(r.diasCobertura)}</td>
                    <td className="py-1 text-right cifra font-semibold">{r.pedir}</td>
                    <td className="py-1 pl-3" style={{ color: "var(--ink-2)" }}>
                      {r.surtir.filter((s: any) => s.pares > 0).map((s: any) => `${s.almacen} ${s.pares}`).join(" · ")}
                      {r.faltante ? <span style={{ color: "var(--estado-alerta)" }}>{r.surtir.some((s: any) => s.pares > 0) ? " · " : ""}sin bodega {r.faltante}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
    </>
  );
}
