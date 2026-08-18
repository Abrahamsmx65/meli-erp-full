"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TALLAS = ["23", "24", "25", "26", "27", "28", "29", "30"];

/** Captura rápida de una corrida faltante, en línea con el renglón. */
export function FormularioCorrida({
  pedido,
  modelo,
  color,
  paresPorCaja,
}: {
  pedido: string;
  modelo: string;
  color: string;
  paresPorCaja: number;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [estado, setEstado] = useState<"listo" | "enviando" | "ok" | "error">("listo");
  const [mensaje, setMensaje] = useState<string | null>(null);

  const suma = Object.values(valores).reduce((a, v) => a + (Number(v) || 0), 0);
  const cuadra = paresPorCaja === 0 || suma === paresPorCaja;

  async function guardar() {
    setEstado("enviando");
    setMensaje(null);
    try {
      const r = await fetch("/api/corrida", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido, modelo, color, tallas: valores }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      setEstado("ok");
      router.refresh();
    } catch (e) {
      setEstado("error");
      setMensaje((e as Error).message);
    }
  }

  if (estado === "ok") {
    return (
      <span className="text-xs" style={{ color: "var(--exito-texto)" }}>
        ✓ Corrida guardada
      </span>
    );
  }

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="text-xs underline"
        style={{ color: "var(--acento)" }}
      >
        Capturar
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {TALLAS.map((t) => (
          <label key={t} className="flex flex-col items-center">
            <span className="text-[10px]" style={{ color: "var(--ink-muted)" }}>
              {t}
            </span>
            <input
              type="number"
              min={0}
              value={valores[t] ?? ""}
              onChange={(e) => setValores({ ...valores, [t]: e.target.value })}
              className="cifra w-12 px-1 py-0.5 text-center text-xs"
            />
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span style={{ color: cuadra ? "var(--exito-texto)" : "var(--estado-alerta)" }}>
          Suma {suma}
          {paresPorCaja > 0 ? ` de ${paresPorCaja}` : ""}
        </span>
        <button
          onClick={guardar}
          disabled={estado === "enviando" || suma <= 0}
          className="rounded px-2 py-0.5 text-white disabled:opacity-50"
          style={{ background: "var(--acento)" }}
        >
          {estado === "enviando" ? "…" : "Guardar"}
        </button>
        <button onClick={() => setAbierto(false)} style={{ color: "var(--ink-muted)" }}>
          Cancelar
        </button>
      </div>

      {mensaje ? (
        <span className="text-xs" style={{ color: "var(--estado-critico)" }}>
          {mensaje}
        </span>
      ) : null}
    </div>
  );
}

/** Amarre manual de un SKU de bodega a uno de Mercado Libre. */
export function FormularioMapeo({ skuConstruido }: { skuConstruido: string }) {
  const router = useRouter();
  const [valor, setValor] = useState("");
  const [estado, setEstado] = useState<"listo" | "enviando" | "ok" | "error">("listo");
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function guardar() {
    if (!valor.trim()) return;
    setEstado("enviando");
    setMensaje(null);
    try {
      const r = await fetch("/api/mapeo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuConstruido, skuMeli: valor.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo amarrar.");
      setEstado("ok");
      router.refresh();
    } catch (e) {
      setEstado("error");
      setMensaje((e as Error).message);
    }
  }

  if (estado === "ok") {
    return (
      <span className="text-xs" style={{ color: "var(--exito-texto)" }}>
        ✓ Amarrado
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && guardar()}
          placeholder="SKU en MELI"
          className="w-40 px-2 py-1 text-xs"
        />
        <button
          onClick={guardar}
          disabled={estado === "enviando" || !valor.trim()}
          className="rounded px-2 py-1 text-xs text-white disabled:opacity-50"
          style={{ background: "var(--acento)" }}
        >
          {estado === "enviando" ? "…" : "Amarrar"}
        </button>
      </div>
      {mensaje ? (
        <span className="text-xs" style={{ color: "var(--estado-critico)" }}>
          {mensaje}
        </span>
      ) : null}
    </div>
  );
}
