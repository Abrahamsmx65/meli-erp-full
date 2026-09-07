"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { LineaPlan, MotivoNoEnviar } from "@/lib/yapanizcel/plan";
import type { EnvioRegistrado } from "@/lib/yapanizcel/envios";
import { estiloInput } from "./comunes";

const MOTIVO: Record<MotivoNoEnviar, string> = {
  ok: "",
  sin_faltante: "Full ya cubre el objetivo",
  sin_inventario: "No hay en bodega (o el SKU no está amarrado)",
  menos_de_una_decena: "Hay menos de una decena en bodega",
  topado_por_bodega: "Sale lo que alcanza en bodega",
};

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

export type LineaPantalla = LineaPlan & { titulo: string | null };

/**
 * El plan editable: cada renglón trae lo que el sistema sugiere y una casilla
 * para ajustarlo. Al registrar, esas unidades cuentan como "en camino" hasta
 * que caducan o se marcan recibidas.
 */
export function PlanEnvios({ lineas, multiplo, envios }: { lineas: LineaPantalla[]; multiplo: number; envios: EnvioRegistrado[] }) {
  const router = useRouter();
  const [cantidades, setCantidades] = useState<Record<string, number>>(() => Object.fromEntries(lineas.map((l) => [l.sku, l.mandar])));
  const [soloConEnvio, setSoloConEnvio] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [folio, setFolio] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return lineas.filter((l) => {
      if (soloConEnvio && (cantidades[l.sku] ?? 0) <= 0 && l.mandar <= 0) return false;
      return !q || `${l.sku} ${l.titulo ?? ""}`.toUpperCase().includes(q);
    });
  }, [lineas, soloConEnvio, busqueda, cantidades]);

  const totalUnidades = lineas.reduce((a, l) => a + (cantidades[l.sku] ?? 0), 0);
  const totalSkus = lineas.filter((l) => (cantidades[l.sku] ?? 0) > 0).length;

  function fijar(sku: string, v: number) {
    setCantidades((c) => ({ ...c, [sku]: Math.max(0, Math.round(v)) }));
  }

  async function registrar() {
    const seleccion = lineas.filter((l) => (cantidades[l.sku] ?? 0) > 0).map((l) => ({ skuMeli: l.sku, unidades: cantidades[l.sku] }));
    if (!seleccion.length) {
      setError("No hay unidades que registrar.");
      return;
    }
    const fueraDeDecena = seleccion.filter((s) => s.unidades % multiplo !== 0);
    if (fueraDeDecena.length && !confirm(`${fueraDeDecena.length} SKU(s) no van en múltiplos de ${multiplo}. ¿Registrar de todos modos?`)) return;

    setOcupado("registrar");
    setError(null);
    setAviso(null);
    try {
      const r = await fetch("/api/yapanizcel/envios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineas: seleccion, folio }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo registrar.");
      setAviso(`Envío registrado: ${n(j.unidades)} unidades. Ya cuentan como en camino.`);
      setFolio("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function cambiarEstado(id: string, estado: string) {
    setOcupado(id);
    setError(null);
    try {
      const r = await fetch("/api/yapanizcel/envios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, estado }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo cambiar.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="tarjeta flex flex-wrap items-center gap-3 p-3 text-sm">
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar SKU…" className="w-56 rounded-lg border px-2 py-1 text-xs" style={estiloInput} />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={soloConEnvio} onChange={(e) => setSoloConEnvio(e.target.checked)} />
          Solo lo que se manda
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="Folio (opcional)" className="w-36 rounded-lg border px-2 py-1 text-xs" style={estiloInput} />
          <span className="text-xs" style={{ color: "var(--ink-2)" }}>
            {totalSkus} SKUs · <b>{n(totalUnidades)}</b> unidades
          </span>
          <button onClick={registrar} disabled={ocupado !== null || totalUnidades === 0} className="rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-60" style={{ background: "var(--acento)", color: "#fff" }}>
            {ocupado === "registrar" ? "Registrando…" : "Registrar envío"}
          </button>
        </div>
      </div>

      {aviso ? (
        <p className="text-sm" style={{ color: "var(--exito-texto)" }}>
          {aviso}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}

      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Título</th>
              <th className="px-3 py-2 text-right">Vend.</th>
              <th className="px-3 py-2 text-right">Venta/día</th>
              <th className="px-3 py-2 text-right">Tend.</th>
              <th className="px-3 py-2 text-right">En Full</th>
              <th className="px-3 py-2 text-right">Transf.+camino</th>
              <th className="px-3 py-2 text-right">Cobertura</th>
              <th className="px-3 py-2 text-right">Objetivo</th>
              <th className="px-3 py-2 text-right">Falta</th>
              <th className="px-3 py-2 text-right">Bodega</th>
              <th className="px-3 py-2 text-right">Mandar</th>
              <th className="px-3 py-2">Nota</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-6 text-center" style={{ color: "var(--ink-muted)" }}>
                  Nada que mandar con los datos de hoy.
                </td>
              </tr>
            ) : null}
            {visibles.map((l) => {
              const v = cantidades[l.sku] ?? 0;
              const critico = Number.isFinite(l.cobertura) && l.cobertura < 7;
              return (
                <tr key={l.sku} className="border-t" style={{ borderColor: "var(--grid)" }}>
                  <td className="num px-3 py-1.5 font-medium">{l.sku}</td>
                  <td className="max-w-[260px] truncate px-3 py-1.5" style={{ color: "var(--ink-2)" }} title={l.titulo ?? ""}>
                    {l.titulo ?? ""}
                  </td>
                  <td className="num px-3 py-1.5 text-right">{n(l.vendidas)}</td>
                  <td className="num px-3 py-1.5 text-right" title={l.porCalendario ? "Sin fotos suficientes: días de calendario" : `${l.diasConStock} días con stock`}>
                    {l.ventaDiaria.toFixed(1)}
                    {l.porCalendario ? "" : "*"}
                  </td>
                  <td
                    className="num px-3 py-1.5 text-right text-xs"
                    title="Última semana contra la anterior"
                    style={{ color: l.tendencia == null ? "var(--ink-muted)" : l.tendencia >= 0.1 ? "var(--exito-texto)" : l.tendencia <= -0.1 ? "var(--estado-critico)" : "var(--ink-2)" }}
                  >
                    {l.tendencia == null ? "—" : `${l.tendencia >= 0 ? "+" : ""}${Math.round(l.tendencia * 100)}%`}
                  </td>
                  <td className="num px-3 py-1.5 text-right">{n(l.enFull)}</td>
                  <td className="num px-3 py-1.5 text-right">{n(l.enTransferencia + l.enCamino)}</td>
                  <td className="num px-3 py-1.5 text-right" style={{ color: critico ? "var(--estado-critico)" : undefined }}>
                    {Number.isFinite(l.cobertura) ? `${Math.round(l.cobertura)} d` : "∞"}
                  </td>
                  <td className="num px-3 py-1.5 text-right">{n(l.objetivo)}</td>
                  <td className="num px-3 py-1.5 text-right">{n(l.falta)}</td>
                  <td className="num px-3 py-1.5 text-right">{n(l.enBodega)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <input type="number" min={0} step={multiplo} value={v} onChange={(e) => fijar(l.sku, Number(e.target.value))} className="num w-20 rounded-md border px-2 py-0.5 text-right text-sm" style={{ ...estiloInput, fontWeight: v !== l.mandar ? 700 : 500 }} />
                  </td>
                  <td className="px-3 py-1.5 text-xs" style={{ color: "var(--ink-muted)" }}>
                    {MOTIVO[l.motivo]}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
        Venta/día = 50% la última semana + 30% la anterior + 20% el resto de la ventana, hasta ayer (hoy va a medias). * corregida por los días que el SKU estuvo agotado (se activa cuando hay fotos diarias suficientes).
      </p>

      <h2 className="mt-2 font-semibold">Envíos registrados</h2>
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Folio</th>
              <th className="px-3 py-2 text-right">SKUs</th>
              <th className="px-3 py-2 text-right">Unidades</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {envios.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center" style={{ color: "var(--ink-muted)" }}>
                  Todavía no hay envíos registrados.
                </td>
              </tr>
            ) : null}
            {envios.map((e) => (
              <tr key={e.id} className="border-t" style={{ borderColor: "var(--grid)" }}>
                <td className="num px-3 py-1.5">{e.creado_en.slice(0, 10)}</td>
                <td className="px-3 py-1.5">{e.folio ?? "—"}</td>
                <td className="num px-3 py-1.5 text-right">{e.skus}</td>
                <td className="num px-3 py-1.5 text-right">{n(e.unidades)}</td>
                <td className="px-3 py-1.5">
                  {e.estado}
                  {e.caducado ? <span style={{ color: "var(--ink-muted)" }}> · caducado</span> : null}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap text-xs">
                  <a href={`/api/yapanizcel/envios/${e.id}/excel`} className="underline" style={{ color: "var(--acento)" }}>
                    Excel
                  </a>
                  {e.estado === "preparado" ? (
                    <button disabled={ocupado !== null} onClick={() => cambiarEstado(e.id, "enviado")} className="ml-2 underline">
                      Marcar enviado
                    </button>
                  ) : null}
                  {e.estado === "enviado" ? (
                    <button disabled={ocupado !== null} onClick={() => cambiarEstado(e.id, "recibido")} className="ml-2 underline">
                      Ya llegó a Full
                    </button>
                  ) : null}
                  {e.estado === "preparado" || e.estado === "enviado" ? (
                    <button disabled={ocupado !== null} onClick={() => cambiarEstado(e.id, "cancelado")} className="ml-2 underline" style={{ color: "var(--ink-muted)" }}>
                      Cancelar
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
