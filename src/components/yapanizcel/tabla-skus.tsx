"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RenglonBodega } from "@/lib/yapanizcel/inventario";
import type { NivelAmarre } from "@/lib/yapanizcel/sku";
import { estiloInput } from "./comunes";

const ETIQUETA: Record<NivelAmarre, string> = {
  manual: "Manual",
  exacto: "Exacto",
  canonico: "Mayúsculas/guiones",
  aplastado: "Guion movido",
  prefijo_nc: "N o C de más",
  color: "Color escrito distinto",
  prefijo: "Prefijo distinto",
  nucleo: "Letra de más",
  ordenado: "Otro orden",
  sin_amarre: "Sin amarre",
};

type Filtro = "pendientes" | "sugeridos" | "amarrados" | "ignorados" | "todos";

/**
 * La sección de SKUs: dónde se resuelve, una sola vez, cada SKU de bodega
 * que no coincide con el de Mercado Libre.
 *
 * Arriba lo que falta (con su sugerencia cuando la hay), abajo lo que ya
 * quedó. Confirmar una sugerencia escribe un amarre manual: a partir de ahí
 * ese SKU deja de depender de cómo lo escriban en el sheet.
 */
export function TablaSkus({ renglones }: { renglones: RenglonBodega[] }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [busqueda, setBusqueda] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  // Sugerencias del SKU de MELI mientras se escribe: se piden al servidor
  // (20 a la vez) en vez de mandar el catálogo completo en un <datalist>.
  const [opciones, setOpciones] = useState<string[]>([]);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pedido = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      pedido.current?.abort();
    },
    [],
  );

  function buscarSkusMeli(q: string) {
    if (temporizador.current) clearTimeout(temporizador.current);
    if (q.trim().length < 2) {
      setOpciones([]);
      return;
    }
    temporizador.current = setTimeout(async () => {
      pedido.current?.abort();
      const control = new AbortController();
      pedido.current = control;
      try {
        const r = await fetch(`/api/yapanizcel/skus/buscar?q=${encodeURIComponent(q.trim())}`, { signal: control.signal });
        const j = await r.json().catch(() => ({}));
        if (r.ok && Array.isArray(j.skus)) setOpciones(j.skus);
      } catch {
        // Cancelada por la siguiente tecla o sin red: se queda lo anterior.
      }
    }, 200);
  }

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return renglones.filter((r) => {
      if (q && !`${r.skuBodega} ${r.skuMeli ?? ""} ${r.hoja ?? ""}`.toUpperCase().includes(q)) return false;
      const pendiente = !r.skuMeli && !r.ignorado;
      const sugerido = pendiente && r.candidatos.length > 0;
      switch (filtro) {
        case "pendientes":
          return pendiente;
        case "sugeridos":
          return sugerido;
        case "amarrados":
          return Boolean(r.skuMeli);
        case "ignorados":
          return r.ignorado;
        default:
          return true;
      }
    });
  }, [renglones, filtro, busqueda]);

  const cuenta = (f: Filtro) =>
    renglones.filter((r) => {
      const pendiente = !r.skuMeli && !r.ignorado;
      if (f === "pendientes") return pendiente;
      if (f === "sugeridos") return pendiente && r.candidatos.length > 0;
      if (f === "amarrados") return Boolean(r.skuMeli);
      if (f === "ignorados") return r.ignorado;
      return true;
    }).length;

  async function mandar(cuerpo: Record<string, unknown>, clave: string) {
    setOcupado(clave);
    setError(null);
    try {
      const r = await fetch("/api/yapanizcel/mapeo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se guardó.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const filtros: [Filtro, string][] = [
    ["pendientes", "Sin amarrar"],
    ["sugeridos", "Con sugerencia"],
    ["amarrados", "Amarrados"],
    ["ignorados", "Ignorados"],
    ["todos", "Todos"],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="tarjeta flex flex-wrap items-center gap-2 p-3 text-sm">
        {filtros.map(([f, t]) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className="rounded-full border px-3 py-1 text-xs font-medium"
            style={filtro === f ? { background: "var(--acento)", color: "#fff", borderColor: "var(--acento)" } : { borderColor: "var(--borde)" }}
          >
            {t} · {cuenta(f)}
          </button>
        ))}
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar SKU…"
          className="ml-auto rounded-lg border px-2 py-1 text-xs"
          style={estiloInput}
        />
      </div>

      {error ? (
        <p className="text-sm" style={{ color: "var(--critico-texto)" }}>
          {error}
        </p>
      ) : null}

      <datalist id="yz-skus-meli">
        {opciones.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider texto-tenue">
              <th className="px-3 py-2">SKU en bodega</th>
              <th className="px-3 py-2">Pestaña</th>
              <th className="px-3 py-2 text-right">Unidades</th>
              <th className="px-3 py-2">Cómo se amarró</th>
              <th className="px-3 py-2">SKU en Mercado Libre</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center texto-tenue">
                  Nada aquí.
                </td>
              </tr>
            ) : null}
            {filtrados.map((r) => {
              const pendiente = !r.skuMeli && !r.ignorado;
              const valorManual = manual[r.skuBodega] ?? "";
              return (
                <tr key={r.skuBodega} className="border-t align-top" style={{ borderColor: "var(--grid)" }}>
                  <td className="num px-3 py-2 font-medium">{r.skuBodega}</td>
                  <td className="px-3 py-2 texto-2">
                    {r.hoja ?? ""}
                  </td>
                  <td className="num px-3 py-2 text-right">{r.cantidad.toLocaleString("es-MX")}</td>
                  <td className="px-3 py-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{
                        background: r.ignorado ? "var(--grid)" : r.skuMeli ? "var(--acento-suave)" : r.candidatos.length ? "hsl(37 91% 57% / 0.18)" : "hsl(0 70% 50% / 0.12)",
                        color: "var(--ink-1)",
                      }}
                    >
                      {r.ignorado ? "Ignorado" : r.ambiguo ? `Empate (${ETIQUETA[r.nivel]})` : ETIQUETA[r.nivel]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.skuMeli ? (
                      <span className="num">{r.skuMeli}</span>
                    ) : pendiente ? (
                      <div className="flex flex-col gap-1">
                        {r.candidatos.map((c) => (
                          <button
                            key={c}
                            disabled={ocupado !== null}
                            onClick={() => mandar({ skuBodega: r.skuBodega, skuMeli: c }, r.skuBodega)}
                            className="num rounded-md border px-2 py-0.5 text-left text-xs hover:opacity-80"
                            style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
                            title="Confirmar este amarre"
                          >
                            ✓ {c}
                          </button>
                        ))}
                        <div className="flex gap-1">
                          <input
                            list="yz-skus-meli"
                            value={valorManual}
                            onChange={(e) => {
                              const valor = e.target.value;
                              setManual((m) => ({ ...m, [r.skuBodega]: valor }));
                              buscarSkusMeli(valor);
                            }}
                            placeholder="Escribir SKU de MELI…"
                            className="num w-48 rounded-md border px-2 py-0.5 text-xs"
                            style={estiloInput}
                          />
                          <button
                            disabled={ocupado !== null || !valorManual.trim()}
                            onClick={() => mandar({ skuBodega: r.skuBodega, skuMeli: valorManual.trim() }, r.skuBodega)}
                            className="boton boton-primario boton-chico"
                          >
                            Amarrar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="texto-tenue">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.nivel === "manual" ? (
                      <button
                        disabled={ocupado !== null}
                        onClick={() => mandar({ skuBodega: r.skuBodega, skuMeli: "" }, r.skuBodega)}
                        className="text-xs underline texto-tenue"
                      >
                        Quitar amarre
                      </button>
                    ) : null}
                    {pendiente ? (
                      <button
                        disabled={ocupado !== null}
                        onClick={() => mandar({ skuBodega: r.skuBodega, ignorar: true }, r.skuBodega)}
                        className="ml-2 text-xs underline texto-tenue"
                      >
                        Ignorar
                      </button>
                    ) : null}
                    {r.ignorado ? (
                      <button
                        disabled={ocupado !== null}
                        onClick={() => mandar({ skuBodega: r.skuBodega, ignorar: false }, r.skuBodega)}
                        className="text-xs underline texto-tenue"
                      >
                        Volver a considerar
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
