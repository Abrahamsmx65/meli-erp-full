"use client";

import { useState } from "react";
import type { ResultadoPrecio } from "@/lib/servicios/precios-modelos";
import { Aviso } from "@/components/ui/pagina";
import { confirmar } from "@/components/ui/confirmar";

export type ConfirmacionRelampagos = {
  modelos: number;
  inscritas: ResultadoPrecio[];
  fallidas: ResultadoPrecio[];
  omitidas: string[];
  avisos: string[];
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
  return j as ConfirmacionRelampagos;
}

/** Botón «Confirmar Buen Fin» con su resultado (Ofertas MELI y Números). */
export function ConfirmarBuenFin() {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ConfirmacionRelampagos | null>(null);
  const confirmarAhora = async () => {
    setError(null);
    try {
      setCargando(true);
      const r = await pedirConfirmarBuenFin();
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
          {cargando ? "Activando Buen Fin… (tarda unos minutos)" : "Confirmar Buen Fin"}
        </button>
      </div>
      {resultado ? <ResultadoRelampagos r={resultado} que="de Buen Fin activadas o corregidas" /> : null}
      {error ? <Aviso tono="critico">{error}</Aviso> : null}
    </div>
  );
}
