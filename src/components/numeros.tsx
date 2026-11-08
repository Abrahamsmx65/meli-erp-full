"use client";

import { useMemo, useState } from "react";
import { calcularNumeros, type EntradaNumeros, type ResultadoNumeros } from "@/lib/finanzas/numeros";
import type { RenglonNumeros } from "@/lib/servicios/numeros";

const din = (x: number | null | undefined, dec = 2) =>
  x == null || !Number.isFinite(x) ? "—" : "$" + x.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const estiloEntrada = { borderColor: "var(--borde)", background: "var(--surface-2)" };

const pct = (x: number, dec = 0) => `${(x * 100).toFixed(dec)}%`;

/** Debajo de la cifra: con qué tasas salió (lo real de 30 días o tu estimación). */
function Fuente({ fuente, children }: { fuente: "real" | "general" | "estimado"; children: React.ReactNode }) {
  const t = {
    real: { color: "var(--exito-texto)", texto: "real ", title: "Lo que cobró la plataforma por este modelo en los últimos 30 días" },
    general: {
      color: "var(--exito-texto)",
      texto: "real cuenta ",
      title: "El modelo no vendió lo suficiente aquí: lo que la plataforma cobra hoy en toda la cuenta (30 días)",
    },
    estimado: { color: "var(--ink-3)", texto: "estimado ", title: "Tu estimación: no hay ventas suficientes para saber lo real" },
  }[fuente];
  return (
    <div className="text-[11px]" style={{ color: t.color }} title={t.title}>
      {t.texto}
      {children}
    </div>
  );
}

type CampoNum = "envioMeli" | "precioRelampago" | "pvNormal" | "envioAmazon" | "pvpDeal";

function Celda({
  valor,
  placeholder,
  onCambio,
  ancho = "w-20",
}: {
  valor: number | null;
  placeholder?: string;
  onCambio: (v: number | null) => void;
  ancho?: string;
}) {
  const [texto, setTexto] = useState(valor == null ? "" : String(valor));
  return (
    <input
      className={`${ancho} rounded border px-1.5 py-1 text-right text-[13px]`}
      style={estiloEntrada}
      inputMode="decimal"
      placeholder={placeholder}
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        const v = texto.trim() === "" ? null : Number(texto.replace(/[$,\s]/g, ""));
        if (v != null && !Number.isFinite(v)) {
          setTexto(valor == null ? "" : String(valor));
          return;
        }
        if (v !== valor) onCambio(v);
      }}
    />
  );
}

/** Números por modelo: lo que se fija se edita aquí; lo demás se calcula al momento. */
export function TablaNumeros({ renglones }: { renglones: RenglonNumeros[] }) {
  const [entradas, setEntradas] = useState<Record<string, EntradaNumeros>>(() =>
    Object.fromEntries(renglones.map((r) => [r.entrada.modelo, r.entrada])),
  );
  const [estado, setEstado] = useState<Record<string, "guardando" | "ok" | string>>({});
  const [busca, setBusca] = useState("");
  const [soloConCosto, setSoloConCosto] = useState(true);

  async function guardar(modelo: string, cambio: Partial<EntradaNumeros>) {
    const nueva = { ...entradas[modelo], ...cambio };
    setEntradas((e) => ({ ...e, [modelo]: nueva }));
    setEstado((s) => ({ ...s, [modelo]: "guardando" }));
    try {
      const r = await fetch("/api/finanzas/numeros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nueva),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      setEstado((s) => ({ ...s, [modelo]: "ok" }));
    } catch (err) {
      setEstado((s) => ({ ...s, [modelo]: (err as Error).message }));
    }
  }

  const visibles = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return renglones.filter(
      (r) =>
        (!q || r.entrada.modelo.includes(q.replace(/\s/g, "")) || (r.categoria ?? "").toUpperCase().includes(q)) &&
        (!soloConCosto || r.costo != null),
    );
  }, [renglones, busca, soloConCosto]);

  // Cambiar el relámpago recalcula todo lo demás (dueño, 8-nov-2026): el PV
  // normal y el PVP deal fijados a mano se sueltan para que sigan al relámpago.
  const cambioDe = (campo: CampoNum, v: number | null): Partial<EntradaNumeros> =>
    campo === "precioRelampago" ? { precioRelampago: v, pvNormal: null, pvpDeal: null } : ({ [campo]: v } as Partial<EntradaNumeros>);

  const num = (modelo: string, campo: CampoNum, placeholder?: string, ancho?: string) => (
    <Celda
      key={`${modelo}-${campo}-${entradas[modelo][campo] ?? ""}`}
      valor={entradas[modelo][campo] as number | null}
      placeholder={placeholder}
      ancho={ancho}
      onCambio={(v) => guardar(modelo, cambioDe(campo, v))}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input className="rounded-lg border px-2 py-1.5 text-sm" style={estiloEntrada} placeholder="Buscar modelo o categoría" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="texto-2 flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={soloConCosto} onChange={(e) => setSoloConCosto(e.target.checked)} />
          Solo con costo
        </label>
        <span className="texto-tenue text-[13px]">{visibles.length} modelos</span>
      </div>
      <div className="tabla-caja alta">
        <table className="datos">
          <thead>
            <tr>
              <th colSpan={3} />
              <th colSpan={7} className="text-center">Mercado Libre</th>
              <th colSpan={4} className="text-center">Amazon</th>
              <th colSpan={3} className="text-center">TikTok</th>
            </tr>
            <tr>
              <th>Modelo</th>
              <th>Categoría</th>
              <th className="num">Costo</th>
              <th className="num">Envío</th>
              <th className="num">Relámpago</th>
              <th className="num">Ganancia</th>
              <th className="num">%</th>
              <th className="num">PV normal</th>
              <th className="num">Ganancia normal</th>
              <th title="Restar también la retención del 10.5 %">Ret.</th>
              <th className="num">Recibir</th>
              <th className="num">Envío</th>
              <th className="num">PVP sin ads</th>
              <th className="num">PVP deal</th>
              <th className="num" title="El precio que deja en TikTok lo mismo que el relámpago de MELI">Gana igual</th>
              <th className="num">Relámpagos</th>
              <th className="num">Oferta campañas</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((r) => {
              const m = r.entrada.modelo;
              const e = entradas[m];
              const c = calcularNumeros(e, r.costo, r.reales);
              const u = c.usado;
              const st = estado[m];
              return (
                <tr key={m}>
                  <td className="font-medium">
                    {m}
                    {st && st !== "ok" ? (
                      <div className="text-[11px]" style={{ color: st === "guardando" ? "var(--ink-3)" : "var(--estado-critico)" }}>
                        {st === "guardando" ? "guardando…" : st}
                      </div>
                    ) : null}
                  </td>
                  <td className="texto-2 text-[12px]">{r.categoria ?? "—"}</td>
                  <td className="num cifra">
                    {din(r.costo)}
                    <div className="texto-tenue text-[11px]">
                      {r.fuenteCosto === "contenedor" ? r.contenedor : r.fuenteCosto === "catalogo" ? "catálogo" : ""}
                    </div>
                  </td>
                  <td className="num">{num(m, "envioMeli", "", "w-16")}</td>
                  <td className="num">{num(m, "precioRelampago")}</td>
                  <td className="num cifra" style={{ color: c.ganancia != null && c.ganancia < 0 ? "var(--estado-critico)" : undefined }}>
                    {din(c.ganancia)}
                    <RecibidoMeli c={c} />
                  </td>
                  <td className="num cifra">{c.porcentaje == null ? "—" : `${(c.porcentaje * 100).toFixed(0)}%`}</td>
                  <td className="num">{num(m, "pvNormal", c.pvNormal != null ? c.pvNormal.toFixed(2) : "")}</td>
                  <td className="num cifra">{din(c.gananciaNormal)}</td>
                  <td>
                    <input type="checkbox" checked={e.retencion} onChange={(ev) => guardar(m, { retencion: ev.target.checked })} />
                  </td>
                  <td className="num cifra">{din(c.recibirAmazon)}</td>
                  <td className="num">{num(m, "envioAmazon", "", "w-16")}</td>
                  <td className="num cifra">
                    {din(c.pvpAmazon)}
                    <Fuente fuente={u.amazon.fuente}>
                      {pct(u.amazon.pctTotal, 1)}
                      {u.amazon.porPar != null ? ` + ${din(u.amazon.porPar)}` : ""}
                    </Fuente>
                  </td>
                  <td className="num">{num(m, "pvpDeal", c.pvpAmazon != null ? (c.pvpAmazon * 1.12).toFixed(2) : "")}</td>
                  <td className="num cifra">
                    {din(c.tiktokLives)}
                    <Fuente fuente={u.tiktok.fuente}>
                      {pct(u.tiktok.pctTotal, 1)} + {din(u.tiktok.fijo, 0)}
                    </Fuente>
                  </td>
                  <td className="num cifra">{din(c.tiktokRelampago)}</td>
                  <td className="num cifra">{din(c.tiktokOferta)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Debajo de la ganancia: cuánto deposita MELI al relámpago de aquí y de dónde salió. */
function RecibidoMeli({ c }: { c: ResultadoNumeros }) {
  const r = c.recibidoMeli;
  const u = c.usado.meli;
  if (!r) return null;
  const linea =
    r.fuente === "real" ? (
      <div className="text-[11px]" style={{ color: "var(--exito-texto)" }} title={`Lo que Mercado Pago depositó por par en ${r.pares.toLocaleString("es-MX")} ventas a este precio en 30 días (reventa incluida).`}>
        real a {din(r.precio)}: recibes {din(r.porPar)}/par
      </div>
    ) : r.fuente === "desde_ventas" && r.base ? (
      <div
        className="text-[11px]"
        style={{ color: "var(--exito-texto)" }}
        title={`No hubo ventas a ${din(r.precio)}. Lo que MELI se quedó de verdad en las ${r.base.pares.toLocaleString("es-MX")} ventas a ${din(r.base.precio, 0)} (recibiste ${din(r.base.porPar)}/par), llevado a este precio con envío de ${din(u.envio)}.`}
      >
        a {din(r.precio)} recibirías {din(r.porPar)}/par
        <div className="texto-tenue">según lo real a {din(r.base.precio, 0)}</div>
      </div>
    ) : (
      <div className="text-[11px]" style={{ color: u.fuente === "real" ? "var(--exito-texto)" : "var(--ink-3)" }} title="Sin ventas cerca de este precio: comisión, envío y retención de MELI.">
        a {din(r.precio)} recibirías {din(r.porPar)}/par
        <div className="texto-tenue">
          {u.fuente === "real" ? "tasas reales" : "estimado"} {pct(u.comisionPct)} · {din(u.envio)}
          {u.retencionPct > 0 ? ` · ret ${pct(u.retencionPct, 1)}` : ""}
        </div>
      </div>
    );
  return (
    <>
      {linea}
      {c.relampagoMeli && Math.abs(c.relampagoMeli.precio - r.precio) > 1 ? (
        <div className="texto-tenue text-[11px]" title="El precio más bajo con volumen al que se vendió en MELI en 30 días">
          relámpago real en MELI: {din(c.relampagoMeli.precio, 0)} → {din(c.relampagoMeli.porPar)}/par
        </div>
      ) : null}
      {c.promedioMeli ? (
        <div className="texto-tenue text-[11px]" title="Promedio depositado por par en 30 días, a todos los precios">
          promedio mes: {din(c.promedioMeli.porPar)}/par
        </div>
      ) : null}
    </>
  );
}
