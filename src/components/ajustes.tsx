"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Parametros } from "@/lib/engine/types";

const CAMPOS: {
  clave: keyof Parametros;
  etiqueta: string;
  ayuda: string;
  paso?: number;
  min?: number;
}[] = [
  {
    clave: "enviosPorSemana",
    etiqueta: "Envíos por semana",
    ayuda: "Cada cuánto armas envío. Define el hueco que el colchón tiene que cubrir.",
    paso: 0.5,
    min: 0.25,
  },
  {
    clave: "leadTimeDias",
    etiqueta: "Lead time (días)",
    ayuda: "Desde que armas el envío hasta que MELI lo publica como disponible.",
    min: 0,
  },
  {
    clave: "horizonteDias",
    etiqueta: "Cobertura objetivo (días)",
    ayuda: "Cuántos días de venta quieres tener parados en Full.",
    min: 1,
  },
  {
    clave: "diasHistoria",
    etiqueta: "Historia a analizar (días)",
    ayuda: "Ventana de ventas que se estudia para estimar la demanda.",
    min: 14,
  },
  {
    clave: "nivelServicio",
    etiqueta: "Nivel de servicio",
    ayuda: "0.95 = aceptas quedarte sin stock 5% del tiempo. Más alto = más colchón.",
    paso: 0.01,
    min: 0.5,
  },
  {
    clave: "ssMinimoDias",
    etiqueta: "Colchón mínimo (días)",
    ayuda: "Piso del stock de seguridad, para SKUs de venta muy pareja.",
    min: 0,
  },
  {
    clave: "factorCorreccionMax",
    etiqueta: "Tope de corrección por agotamiento",
    ayuda: "Cuánto puede inflar la demanda la corrección. 3 = hasta el triple de la venta cruda.",
    paso: 0.5,
    min: 1,
  },
  {
    clave: "sobrestockFactor",
    etiqueta: "Umbral de sobrestock",
    ayuda: "Múltiplo del horizonte a partir del cual un SKU se marca con exceso.",
    paso: 0.1,
    min: 1,
  },
  {
    clave: "maxCajasPorEnvio",
    etiqueta: "Tope de cajas por envío",
    ayuda: "0 = sin tope. Úsalo si tu transporte tiene un límite fijo.",
    min: 0,
  },
];

export function FormularioParametros({ inicial }: { inicial: Parametros }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, number>>(
    Object.fromEntries(CAMPOS.map((c) => [c.clave, Number(inicial[c.clave] ?? 0)])),
  );
  const [estado, setEstado] = useState<"listo" | "enviando" | "ok" | "error">("listo");
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setEstado("enviando");
    setMensaje(null);
    try {
      const r = await fetch("/api/parametros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      setEstado("ok");
      setMensaje("Parámetros guardados. El plan se recalcula con estos valores.");
      router.refresh();
    } catch (err) {
      setEstado("error");
      setMensaje((err as Error).message);
    }
  }

  return (
    <form onSubmit={guardar} className="mt-4 flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {CAMPOS.map((c) => (
          <label key={String(c.clave)} className="flex flex-col gap-1">
            <span className="text-sm font-medium">{c.etiqueta}</span>
            <input
              type="number"
              step={c.paso ?? 1}
              min={c.min}
              value={v[c.clave as string]}
              onChange={(e) => setV({ ...v, [c.clave]: Number(e.target.value) })}
              className="cifra"
            />
            <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
              {c.ayuda}
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={estado === "enviando"}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--acento)" }}
        >
          {estado === "enviando" ? "Guardando…" : "Guardar parámetros"}
        </button>
        {mensaje ? (
          <span
            className="text-sm"
            style={{
              color: estado === "error" ? "var(--estado-critico)" : "var(--exito-texto)",
            }}
          >
            {mensaje}
          </span>
        ) : null}
      </div>
    </form>
  );
}
