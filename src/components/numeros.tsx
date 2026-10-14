"use client";

import { useMemo, useState } from "react";
import { calcularNumeros, type EntradaNumeros } from "@/lib/finanzas/numeros";
import type { RenglonNumeros } from "@/lib/servicios/numeros";

const din = (x: number | null | undefined, dec = 2) =>
  x == null || !Number.isFinite(x) ? "—" : "$" + x.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const estiloEntrada = { borderColor: "var(--borde)", background: "var(--surface-2)" };

const pct = (x: number, dec = 0) => `${(x * 100).toFixed(dec)}%`;

/** Debajo de la cifra: con qué tasas salió (lo real de 30 días o tu estimación). */
function Fuente({ real, children }: { real: boolean; children: React.ReactNode }) {
  return (
    <div
      className="text-[11px]"
      style={{ color: real ? "var(--exito-texto)" : "var(--ink-3)" }}
      title={real ? "Lo que cobró la plataforma en los últimos 30 días" : "Tu estimación: el modelo no vendió lo suficiente en 30 días"}
    >
      {real ? "real " : "estimado "}
      {children}
    </div>
  );
}

type CampoNum = "envioMeli" | "precioRelampago" | "pvNormal" | "envioAmazon" | "pvpDeal" | "tiktokExtra" | "tiktokComision" | "tiktokOferta";

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

  const num = (modelo: string, campo: CampoNum, placeholder?: string, ancho?: string) => (
    <Celda
      key={`${modelo}-${campo}`}
      valor={entradas[modelo][campo] as number | null}
      placeholder={placeholder}
      ancho={ancho}
      onCambio={(v) => guardar(modelo, { [campo]: v } as Partial<EntradaNumeros>)}
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
              <th colSpan={6} className="text-center">TikTok</th>
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
              <th className="num">Lives</th>
              <th className="num">Relámpagos</th>
              <th className="num">Oferta campañas</th>
              <th className="num" title="Lo que se suma antes de dividir">+</th>
              <th className="num" title="Comisión (0.24 = 24 %)">Com.</th>
              <th className="num" title="Oferta = lives × este factor">×</th>
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
                    <Fuente real={u.meli.fuente === "real"}>
                      {pct(u.meli.comisionPct)} · {din(u.meli.envio)}
                      {u.meli.retencionPct > 0 ? ` · ret ${pct(u.meli.retencionPct, 1)}` : ""}
                    </Fuente>
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
                    <Fuente real={u.amazon.fuente === "real"}>
                      {pct(u.amazon.pctTotal, 1)}
                      {u.amazon.porPar != null ? ` + ${din(u.amazon.porPar)}` : ""}
                    </Fuente>
                  </td>
                  <td className="num">{num(m, "pvpDeal", c.pvpAmazon != null ? (c.pvpAmazon * 1.12).toFixed(2) : "")}</td>
                  <td className="num cifra">
                    {din(c.tiktokLives)}
                    <Fuente real={u.tiktok.fuente === "real"}>
                      {pct(u.tiktok.pctTotal, 1)} + {din(u.tiktok.fijo, 0)}
                    </Fuente>
                  </td>
                  <td className="num cifra">{din(c.tiktokRelampago)}</td>
                  <td className="num cifra">{din(c.tiktokOferta)}</td>
                  <td className="num">{num(m, "tiktokExtra", "8", "w-12")}</td>
                  <td className="num">{num(m, "tiktokComision", "0.24", "w-16")}</td>
                  <td className="num">{num(m, "tiktokOferta", "1.11", "w-14")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
