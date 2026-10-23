"use client";

import { useEffect, useState } from "react";
import type { AceptarBuenFin, ResultadoPrecio } from "@/lib/servicios/precios-modelos";
import { Aviso } from "@/components/ui/pagina";
import { confirmar } from "@/components/ui/confirmar";
import { agruparPorFamilia, partesDeDonde } from "@/lib/precios/buen-fin-grupos";

export type ConfirmacionRelampagos = {
  modelos: number;
  inscritas: ResultadoPrecio[];
  fallidas: ResultadoPrecio[];
  omitidas: string[];
  avisos: string[];
  /** Buen Fin: lo aceptado a mano después de la corrida (por `donde`). */
  aceptadas?: ResultadoPrecio[];
};

export function ResultadoRelampagos({ r, que = "relámpago inscritas" }: { r: ConfirmacionRelampagos; que?: string }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <Aviso tono={r.fallidas.length ? "alerta" : r.inscritas.length ? "bien" : "info"}>
        {r.inscritas.length} {que} · {r.fallidas.length} rechazadas por MELI · {r.omitidas.length} omitidas ·{" "}
        {r.modelos} modelos revisados
      </Aviso>
      {[...r.inscritas, ...r.fallidas].length ? (
        <ul className="flex flex-col gap-0.5">
          {[...r.fallidas, ...r.inscritas].map((x, i) => (
            <li key={i}>
              <span className="cifra">{x.donde}</span>{" "}
              <span style={{ color: x.ok ? "var(--exito-texto)" : "var(--estado-critico)" }}>
                {x.ok ? "✓" : "✗"} {x.detalle}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {r.omitidas.map((o, i) => (
        <div key={i} className="texto-tenue">
          {o}
        </div>
      ))}
    </div>
  );
}

/** Pide la confirmación e inscribe; lo mismo que el cron de las 10:00, a mano. */
export async function pedirConfirmarRelampagos(): Promise<ConfirmacionRelampagos | null> {
  if (
    !(await confirmar({
      titulo: "¿Inscribir todas las relámpago?",
      mensaje: "Se van a inscribir TODAS las relámpago candidatas al precio relámpago de Números (5 pares o lo que pida MELI).",
      confirmar: "Inscribir",
    }))
  )
    return null;
  const r = await fetch("/api/finanzas/numeros/relampagos", { method: "POST" });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error ?? "No se pudieron confirmar las relámpago.");
  return j as ConfirmacionRelampagos;
}

/** Botón «Confirmar relámpagos» con su resultado (Ofertas MELI). */
export function ConfirmarRelampagos() {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ConfirmacionRelampagos | null>(null);
  const confirmarAhora = async () => {
    setError(null);
    try {
      setCargando(true);
      const r = await pedirConfirmarRelampagos();
      if (r) setResultado(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <button type="button" className="boton boton-primario" disabled={cargando} onClick={() => void confirmarAhora()}>
          {cargando ? "Confirmando relámpagos… (tarda unos minutos)" : "Confirmar relámpagos"}
        </button>
      </div>
      {resultado ? <ResultadoRelampagos r={resultado} /> : null}
      {error ? <Aviso tono="critico">{error}</Aviso> : null}
    </div>
  );
}

/** Pide la confirmación y activa todo Buen Fin al PV normal de Números. */
export async function pedirConfirmarBuenFin(): Promise<ConfirmacionRelampagos | null> {
  if (
    !(await confirmar({
      titulo: "¿Activar todo Buen Fin?",
      mensaje:
        "Se van a inscribir o corregir TODAS las promociones de Buen Fin al PV normal de Números (a .99). No se tocan las que ya están a ese precio ni las que con el aporte de MELI te harían pagar envío.",
      confirmar: "Activar",
    }))
  )
    return null;
  const r = await fetch("/api/finanzas/numeros/buen-fin", { method: "POST" });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error ?? "No se pudo activar Buen Fin.");
  const iniciado = String(j?.iniciado ?? new Date().toISOString());
  // Trabaja por atrás: se pregunta por la bitácora hasta que aparezca esta corrida.
  const limite = Date.now() + 20 * 60_000;
  while (Date.now() < limite) {
    await new Promise((listo) => setTimeout(listo, 10_000));
    const ultima = await leerUltimoBuenFin();
    if (ultima && Date.parse(ultima.fin) >= Date.parse(iniciado)) {
      if (ultima.error) throw new Error(ultima.error);
      return ultima.r;
    }
  }
  throw new Error("Sigue trabajando por atrás; vuelve a abrir Números en unos minutos para ver el resultado.");
}

/** La última corrida de Buen Fin (manual o del cron) guardada en la bitácora. */
export async function leerUltimoBuenFin(): Promise<{ fin: string; error?: string; r: ConfirmacionRelampagos } | null> {
  const u = await fetch("/api/finanzas/numeros/buen-fin").catch(() => null);
  const ultima = u?.ok ? await u.json().catch(() => null) : null;
  if (!ultima?.fin) return null;
  const d = ultima.detalle ?? {};
  return {
    fin: ultima.fin,
    error: d.error,
    r: {
      modelos: d.modelos ?? 0,
      inscritas: d.inscritas ?? [],
      fallidas: d.fallidas ?? [],
      omitidas: d.omitidas ?? [],
      avisos: d.avisos ?? [],
      aceptadas: ultima.aceptadas ?? [],
    },
  };
}

const din = (x: number) => "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Resultado de Buen Fin con lo que MELI rechazó por precio: el precio más
 * alto que acepta, cuánto se aleja del precio de Números y un botón para aceptarla
 * ahí mismo (dueño, 22-oct-2026).
 */
export function ResultadoBuenFin({ r, fin }: { r: ConfirmacionRelampagos; fin?: string }) {
  const clave = (a: AceptarBuenFin) => `${a.itemId}|${a.promoId ?? ""}`;
  // Lo ya aceptado después de la corrida llega de la bitácora y cuenta igual
  // que lo aceptado en esta pantalla.
  const [aceptadas, setAceptadas] = useState<Record<string, ResultadoPrecio>>(() => {
    const porDonde = new Map((r.aceptadas ?? []).map((x) => [x.donde, x]));
    const inicial: Record<string, ResultadoPrecio> = {};
    for (const f of r.fallidas) {
      const x = f.aceptar ? porDonde.get(f.donde) : undefined;
      if (x && f.aceptar) inicial[clave(f.aceptar)] = x;
    }
    return inicial;
  });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Familias marcadas para aceptar juntas al final (dueño, 23-oct-2026).
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const porAceptar = r.fallidas.filter((f) => f.aceptar?.razon === "credibilidad" && f.aceptar.precio != null);
  const pendientes = porAceptar.filter((f) => !aceptadas[clave(f.aceptar as AceptarBuenFin)]?.ok);
  const otras = r.fallidas.filter((f) => !f.aceptar || (f.aceptar.razon === "credibilidad" && f.aceptar.precio == null));
  // Por familia: mismo modelo, promoción y precios = un renglón con un solo botón.
  const familiasPorAceptar = agruparPorFamilia(porAceptar, (f) => `${f.aceptar?.queriamos}|${f.aceptar?.precio}`);
  const faltanDe = (g: (typeof familiasPorAceptar)[number]) => g.renglones.filter((f) => !aceptadas[clave(f.aceptar as AceptarBuenFin)]?.ok);
  const familiasConFaltantes = familiasPorAceptar.filter((g) => faltanDe(g).length);
  const familiasMarcadas = familiasConFaltantes.filter((g) => marcadas.has(g.clave));
  const seleccionadas = familiasMarcadas.flatMap(faltanDe);
  // Solo lo pendiente (dueño, 23-oct-2026: «si ya acepté e inscribí manualmente
  // ya no me interesa que salga»): lo aceptado a su máximo y lo que ya está
  // inscrito más barato no se enseñan.
  const porResolver = pendientes.length + otras.length;
  const familiasOtras = agruparPorFamilia(otras, (f) => f.detalle);

  const aceptar = async (lista: ResultadoPrecio[], quien: string) => {
    setError(null);
    setOcupado(quien);
    try {
      const res = await fetch("/api/finanzas/numeros/buen-fin/aceptar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ renglones: lista.map((f) => ({ ...(f.aceptar as AceptarBuenFin), donde: f.donde })) }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? "No se pudieron aceptar.");
      const nuevas: Record<string, ResultadoPrecio> = {};
      (j.resultados as ResultadoPrecio[]).forEach((x) => {
        const f = lista.find((y) => y.donde === x.donde);
        if (f?.aceptar) nuevas[clave(f.aceptar)] = x;
      });
      setAceptadas((a) => ({ ...a, ...nuevas }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const diferencia = (a: AceptarBuenFin, precio: number) => {
    const d = precio - a.queriamos;
    const pct = a.queriamos > 0 ? (d / a.queriamos) * 100 : 0;
    return `${d >= 0 ? "+" : "−"}${din(Math.abs(d))} (${d >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)} %)`;
  };

  return (
    <div className="flex flex-col gap-2 text-xs">
      <Aviso tono={porResolver ? "alerta" : r.inscritas.length ? "bien" : "info"}>
        {fin ? `Última corrida ${new Date(fin).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })} · ` : ""}
        {r.inscritas.length} de Buen Fin activadas o corregidas · {porResolver ? `${porResolver} pendientes` : "nada pendiente"}
      </Aviso>

      {porAceptar.length ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong>
              MELI no aceptó el precio por «no creíble» ({pendientes.length} en {familiasConFaltantes.length} familias)
            </strong>
            {pendientes.length ? (
              <button type="button" className="boton boton-secundario" disabled={!!ocupado} onClick={() => void aceptar(pendientes, "todas")}>
                {ocupado === "todas" ? "Aceptando…" : `Aceptar todas a su máximo (${pendientes.length})`}
              </button>
            ) : null}
          </div>
          {familiasConFaltantes.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={familiasConFaltantes.length > 0 && familiasConFaltantes.every((g) => marcadas.has(g.clave))}
                  onChange={(e) => setMarcadas(e.target.checked ? new Set(familiasConFaltantes.map((g) => g.clave)) : new Set())}
                />
                Marcar todas
              </label>
              <button
                type="button"
                className="boton boton-primario"
                disabled={!!ocupado || !seleccionadas.length}
                onClick={() => void aceptar(seleccionadas, "seleccion").then(() => setMarcadas(new Set()))}
              >
                {ocupado === "seleccion"
                  ? "Aceptando…"
                  : `Aceptar seleccionadas (${familiasMarcadas.length} ${familiasMarcadas.length === 1 ? "familia" : "familias"} · ${seleccionadas.length} publicaciones)`}
              </button>
            </div>
          ) : null}
          <ul className="flex flex-col gap-1">
            {familiasConFaltantes.map((g) => {
              const a = g.renglones[0].aceptar as AceptarBuenFin;
              const resultados = g.renglones.map((f) => aceptadas[clave(f.aceptar as AceptarBuenFin)]);
              const bien = resultados.filter((x) => x?.ok).length;
              const mal = resultados.filter((x) => x && !x.ok).length;
              const faltan = g.renglones.filter((f) => !aceptadas[clave(f.aceptar as AceptarBuenFin)]?.ok);
              return (
                <li key={g.clave} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {faltan.length ? (
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${g.modelo}`}
                        checked={marcadas.has(g.clave)}
                        onChange={(e) =>
                          setMarcadas((m) => {
                            const n = new Set(m);
                            if (e.target.checked) n.add(g.clave);
                            else n.delete(g.clave);
                            return n;
                          })
                        }
                      />
                    ) : null}
                    <strong>{g.modelo}</strong>
                    <span className="texto-tenue">
                      {g.promocion} · {g.renglones.length} {g.renglones.length === 1 ? "publicación" : "publicaciones"} · querías{" "}
                      {din(a.queriamos)}
                    </span>
                    <span>
                      MELI acepta hasta <strong>{din(a.precio as number)}</strong>{" "}
                      <span style={{ color: "var(--estado-alerta)" }}>{diferencia(a, a.precio as number)}</span>
                    </span>
                    {bien ? <span style={{ color: "var(--exito-texto)" }}>✓ {bien} aceptadas</span> : null}
                    {mal ? <span style={{ color: "var(--estado-critico)" }}>✗ {mal} rechazadas</span> : null}
                    {faltan.length ? (
                      <button type="button" className="boton boton-secundario" disabled={!!ocupado} onClick={() => void aceptar(faltan, g.clave)}>
                        {ocupado === g.clave
                          ? "Aceptando…"
                          : faltan.length === 1
                            ? `Aceptar a ${din(a.precio as number)}`
                            : `Aceptar las ${faltan.length} a ${din(a.precio as number)}`}
                      </button>
                    ) : null}
                  </div>
                  <details>
                    <summary className="texto-tenue">ver publicaciones</summary>
                    {g.renglones.map((f, i) => {
                      const hecho = aceptadas[clave(f.aceptar as AceptarBuenFin)];
                      return (
                        <div key={i} className="cifra texto-tenue">
                          {partesDeDonde(f.donde).item}
                          {hecho ? (
                            <span style={{ color: hecho.ok ? "var(--exito-texto)" : "var(--estado-critico)" }}>
                              {" "}
                              {hecho.ok ? "✓" : "✗"} {hecho.detalle}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {otras.length ? (
        <div className="flex flex-col gap-0.5">
          {familiasOtras.map((g) => (
            <details key={g.clave}>
              <summary>
                <strong>{g.modelo}</strong>{" "}
                <span className="texto-tenue">
                  {g.promocion} · {g.renglones.length} {g.renglones.length === 1 ? "publicación" : "publicaciones"}
                </span>{" "}
                <span style={{ color: "var(--estado-critico)" }}>✗ {g.renglones[0].detalle}</span>
                {g.renglones[0].aceptar?.razon === "credibilidad" ? (
                  <span className="texto-tenue"> · MELI no dijo hasta qué precio acepta</span>
                ) : null}
              </summary>
              {g.renglones.map((f, i) => (
                <div key={i} className="cifra texto-tenue">
                  {partesDeDonde(f.donde).item}
                </div>
              ))}
            </details>
          ))}
        </div>
      ) : null}

      {error ? <Aviso tono="critico">{error}</Aviso> : null}
    </div>
  );
}

/** Botón «Confirmar Buen Fin» con su resultado (Ofertas MELI y Números). */
export function ConfirmarBuenFin() {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ConfirmacionRelampagos | null>(null);
  const [fin, setFin] = useState<string | undefined>(undefined);
  useEffect(() => {
    void leerUltimoBuenFin().then((u) => {
      if (u && !u.error) {
        setResultado((r) => r ?? u.r);
        setFin((f) => f ?? u.fin);
      }
    });
  }, []);
  const confirmarAhora = async () => {
    setError(null);
    try {
      setCargando(true);
      const r = await pedirConfirmarBuenFin();
      if (r) {
        setResultado(r);
        setFin(new Date().toISOString());
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <button type="button" className="boton boton-primario" disabled={cargando} onClick={() => void confirmarAhora()}>
          {cargando ? "Activando Buen Fin… (tarda unos minutos)" : "Confirmar Buen Fin"}
        </button>
      </div>
      {resultado ? <ResultadoBuenFin key={fin} r={resultado} fin={fin} /> : null}
      {error ? <Aviso tono="critico">{error}</Aviso> : null}
    </div>
  );
}
