"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calcularNumeros, type EntradaNumeros, type NumerosVivo, type ResultadoNumeros } from "@/lib/finanzas/numeros";
import type { RenglonNumeros } from "@/lib/servicios/numeros";

const din = (x: number | null | undefined, dec = 2) =>
  x == null || !Number.isFinite(x) ? "—" : "$" + x.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const estiloEntrada = { borderColor: "var(--borde)", background: "var(--surface-2)" };

const pct = (x: number, dec = 0) => `${(x * 100).toFixed(dec)}%`;

/** Debajo de la cifra: con qué tasas salió (lo real de 30 días o tu estimación). */
function Fuente({ fuente, children }: { fuente: "vivo" | "real" | "general" | "estimado"; children: React.ReactNode }) {
  const t = {
    vivo: { color: "var(--exito-texto)", texto: "en vivo ", title: "Lo que la plataforma contesta HOY a este precio" },
    real: { color: "var(--exito-texto)", texto: "real 30 d ", title: "Lo que cobró la plataforma por este modelo en los últimos 30 días" },
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

const leerNumero = (t: string): number | null | undefined => {
  if (t.trim() === "") return null;
  const v = Number(t.replace(/[$,\s]/g, ""));
  return Number.isFinite(v) ? v : undefined;
};

function Celda({
  valor,
  placeholder,
  onCambio,
  onTecleo,
  ancho = "w-20",
}: {
  valor: number | null;
  placeholder?: string;
  onCambio: (v: number | null) => void;
  /** mientras se teclea: la fila se recalcula sin guardar todavía */
  onTecleo?: (v: number | null) => void;
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
      onChange={(e) => {
        setTexto(e.target.value);
        const v = leerNumero(e.target.value);
        if (v !== undefined) onTecleo?.(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onBlur={() => {
        const v = leerNumero(texto);
        if (v === undefined) {
          setTexto(valor == null ? "" : String(valor));
          onTecleo?.(valor);
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
  // Lo que se está tecleando (sin guardar): la fila se recalcula al momento
  // (dueño, 8-nov-2026: «si juego con el precio que se recalcule»).
  const [tecleo, setTecleo] = useState<{ modelo: string; cambio: Partial<EntradaNumeros> } | null>(null);
  // Lo leído EN VIVO de MELI y Amazon por modelo (a los precios de ese momento).
  const [vivos, setVivos] = useState<Record<string, NumerosVivo>>({});
  const [leyendo, setLeyendo] = useState<Record<string, boolean>>({});
  const ultimaLectura = useRef<Record<string, number>>({});
  const relojes = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  async function pedirVivo(entrada: EntradaNumeros) {
    const modelo = entrada.modelo;
    if (entrada.precioRelampago == null) return;
    const id = (ultimaLectura.current[modelo] ?? 0) + 1;
    ultimaLectura.current[modelo] = id;
    setLeyendo((l) => ({ ...l, [modelo]: true }));
    try {
      const r = await fetch("/api/finanzas/numeros/vivo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entrada),
      });
      const j = await r.json().catch(() => ({}));
      if (ultimaLectura.current[modelo] !== id) return;
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer en vivo.");
      setVivos((v) => ({ ...v, [modelo]: j as NumerosVivo }));
    } catch (err) {
      if (ultimaLectura.current[modelo] === id)
        setVivos((v) => ({ ...v, [modelo]: { leidoEn: new Date().toISOString(), meli: [], amazon: null, avisos: [(err as Error).message] } }));
    } finally {
      if (ultimaLectura.current[modelo] === id) setLeyendo((l) => ({ ...l, [modelo]: false }));
    }
  }

  /** Pregunta en vivo cuando se deja de teclear un momento. */
  function vivoEnUnRato(entrada: EntradaNumeros, ms = 900) {
    clearTimeout(relojes.current[entrada.modelo]);
    relojes.current[entrada.modelo] = setTimeout(() => void pedirVivo(entrada), ms);
  }
  const [soloConCosto, setSoloConCosto] = useState(true);

  async function guardar(modelo: string, cambio: Partial<EntradaNumeros>) {
    const nueva = { ...entradas[modelo], ...cambio };
    setEntradas((e) => ({ ...e, [modelo]: nueva }));
    setTecleo(null);
    if ("precioRelampago" in cambio || "pvNormal" in cambio) vivoEnUnRato(nueva, 0);
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

  // Los pocos modelos que se están viendo (una búsqueda) se leen en vivo solos.
  useEffect(() => {
    if (visibles.length > 5) return;
    for (const r of visibles) if (!vivos[r.entrada.modelo] && !leyendo[r.entrada.modelo]) void pedirVivo(entradas[r.entrada.modelo]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibles]);

  const num = (modelo: string, campo: CampoNum, placeholder?: string, ancho?: string) => {
    // Mientras se teclea el relámpago, el PV normal y el deal fijados se sueltan también en pantalla.
    const suelto = tecleo?.modelo === modelo && "precioRelampago" in tecleo.cambio && (campo === "pvNormal" || campo === "pvpDeal");
    const valor = suelto ? null : (entradas[modelo][campo] as number | null);
    return (
      <Celda
        key={`${modelo}-${campo}-${valor ?? ""}`}
        valor={valor}
        placeholder={placeholder}
        ancho={ancho}
        onCambio={(v) => guardar(modelo, cambioDe(campo, v))}
        onTecleo={(v) => {
          const cambio = cambioDe(campo, v);
          setTecleo({ modelo, cambio });
          if (campo === "precioRelampago" || campo === "pvNormal") vivoEnUnRato({ ...entradas[modelo], ...cambio });
        }}
      />
    );
  };

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
              // Con lo tecleado encima, para ver los números a ese precio antes de guardar.
              const e = tecleo?.modelo === m ? { ...entradas[m], ...tecleo.cambio } : entradas[m];
              const vivo = vivos[m] ?? null;
              const c = calcularNumeros(e, r.costo, r.reales, vivo);
              const u = c.usado;
              const st = estado[m];
              return (
                <tr key={m}>
                  <td className="font-medium">
                    {m}
                    <div className="text-[11px] font-normal">
                      <button
                        type="button"
                        className="enlace"
                        disabled={leyendo[m]}
                        onClick={() => void pedirVivo(e)}
                        title="Preguntar ahora a MELI y Amazon lo que cobran a estos precios"
                      >
                        {leyendo[m] ? "leyendo…" : vivo ? "releer en vivo" : "leer en vivo"}
                      </button>
                      {vivo?.avisos.length ? (
                        <div style={{ color: "var(--alerta-texto)" }} title={vivo.avisos.join("\n")}>
                          {vivo.avisos.length} aviso{vivo.avisos.length > 1 ? "s" : ""}
                        </div>
                      ) : null}
                    </div>
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
                  <td className="num">
                    {u.meli.envioFuente === "tuyo" ? (
                      <>
                        {num(m, "envioMeli", "", "w-16")}
                        <div className="texto-tenue text-[11px]" title="MELI no tiene medidas ni ventas de este modelo en ese tramo de precio: se usa el que capturaste">
                          tuyo
                        </div>
                      </>
                    ) : (
                      <span className="cifra">
                        {din(u.meli.envio)}
                        <div
                          className="text-[11px]"
                          style={{ color: "var(--exito-texto)" }}
                          title={
                            u.meli.envioFuente === "vivo"
                              ? "Lo que MELI contesta HOY a este precio con las medidas que ella capturó (abajo de $299 y desde $499 cambia)"
                              : u.meli.envioFuente === "meli"
                                ? "Lo que MELI cobra con las medidas que ella capturó, a un precio del mismo tramo ($299 / $499) que el relámpago"
                                : "Mediana de lo que MELI cobró en las ventas directas de 30 días"
                          }
                        >
                          {u.meli.envioFuente === "vivo" ? "en vivo" : u.meli.envioFuente === "meli" ? "MELI (tramo)" : "real ventas"}
                        </div>
                      </span>
                    )}
                  </td>
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
  const cargos = `${pct(u.comisionPct, 1)}${u.fijo ? ` + ${din(u.fijo)} fijo` : ""} · envío ${din(u.envio)}${u.retencionPct > 0 ? ` · ret ${pct(u.retencionPct, 1)}` : ""}`;
  const linea =
    r.fuente === "real" ? (
      <div
        className="text-[11px]"
        style={{ color: "var(--exito-texto)" }}
        title={`Lo que Mercado Pago depositó por par en ${r.pares.toLocaleString("es-MX")} ventas a este precio en 30 días (reventa incluida).`}
      >
        real a {din(r.precio)}: recibes {din(r.porPar)}/par
      </div>
    ) : r.fuente === "vivo" ? (
      <div className="text-[11px]" style={{ color: "var(--exito-texto)" }} title="Comisión y envío que MELI contesta HOY a este precio">
        a {din(r.precio)} recibes {din(r.porPar)}/par
        <div>en vivo: {cargos}</div>
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
      <div
        className="text-[11px]"
        style={{ color: u.fuente === "real" ? "var(--exito-texto)" : "var(--ink-3)" }}
        title="Sin ventas cerca de este precio: comisión, envío y retención de MELI de 30 días."
      >
        a {din(r.precio)} recibirías {din(r.porPar)}/par
        <div className="texto-tenue">
          {u.fuente === "real" ? "tasas reales" : "estimado"} {cargos}
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
