"use client";

import { useMemo, useState } from "react";
import type { ProductoConfig } from "@/lib/servicios/productos";

/**
 * Captura de categoría y costo por producto.
 *
 * Se guarda renglón por renglón al salir del campo: capturar cien costos no
 * debe requerir cien clics en "guardar". El estado de cada renglón se ve al
 * lado (guardando… / ✓ / error).
 */
export function TablaProductos({
  productos,
  categorias,
}: {
  productos: ProductoConfig[];
  categorias: string[];
}) {
  const [filas, setFilas] = useState(productos);
  const [estado, setEstado] = useState<Record<string, "guardando" | "ok" | "error">>({});
  const [busqueda, setBusqueda] = useState("");
  const [soloSinCosto, setSoloSinCosto] = useState(false);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return filas.filter((p) => {
      if (soloSinCosto && p.costoMxn != null) return false;
      if (!q) return true;
      return (
        p.modelo.toUpperCase().includes(q) ||
        p.color.toUpperCase().includes(q) ||
        (p.categoria ?? "").toUpperCase().includes(q) ||
        (p.titulo ?? "").toUpperCase().includes(q)
      );
    });
  }, [filas, busqueda, soloSinCosto]);

  const clave = (p: ProductoConfig) => `${p.modelo}|${p.color}`;

  const guardar = async (p: ProductoConfig) => {
    const k = clave(p);
    setEstado((e) => ({ ...e, [k]: "guardando" }));
    try {
      const r = await fetch("/api/productos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelo: p.modelo,
          color: p.color,
          categoria: p.categoria ?? "",
          costoMxn: p.costoMxn ?? 0,
        }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "error");
      setEstado((e) => ({ ...e, [k]: "ok" }));
    } catch {
      setEstado((e) => ({ ...e, [k]: "error" }));
    }
  };

  const actualizar = (k: string, cambios: Partial<ProductoConfig>) => {
    setFilas((l) => l.map((p) => (clave(p) === k ? { ...p, ...cambios } : p)));
  };

  const sinCosto = filas.filter((p) => p.costoMxn == null).length;

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b p-4 hairline">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar modelo, color o categoría…"
          className="min-w-[16rem] flex-1 rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
        />
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink-2)" }}>
          <input
            type="checkbox"
            checked={soloSinCosto}
            onChange={(e) => setSoloSinCosto(e.target.checked)}
          />
          Solo sin costo ({sinCosto})
        </label>
      </header>

      <div className="max-h-[40rem] overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Color</th>
              <th>Producto</th>
              <th className="num">Tallas</th>
              <th>Categoría</th>
              <th className="num">Costo (MXN/par)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => {
              const k = clave(p);
              const st = estado[k];
              return (
                <tr key={k}>
                  <td className="font-medium">{p.modelo}</td>
                  <td>{p.color || "—"}</td>
                  <td
                    className="max-w-72 truncate text-xs"
                    style={{ color: "var(--ink-2)" }}
                    title={p.titulo ?? ""}
                  >
                    {p.titulo ?? "—"}
                  </td>
                  <td className="num cifra">{p.tallas}</td>
                  <td>
                    <input
                      list="categorias-conocidas"
                      value={p.categoria ?? ""}
                      onChange={(e) => actualizar(k, { categoria: e.target.value })}
                      onBlur={() => guardar({ ...p })}
                      placeholder="corcho, EVA, pantufla…"
                      className="w-36 rounded-lg border px-2 py-1 text-sm"
                      style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={p.costoMxn ?? ""}
                      onChange={(e) =>
                        actualizar(k, {
                          costoMxn: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      onBlur={() => guardar({ ...p })}
                      placeholder="—"
                      className="cifra w-28 rounded-lg border px-2 py-1 text-right text-sm"
                      style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                    />
                  </td>
                  <td className="text-sm">
                    {st === "guardando" ? (
                      <span style={{ color: "var(--ink-muted)" }}>…</span>
                    ) : st === "ok" ? (
                      <span style={{ color: "var(--exito-texto)" }}>✓</span>
                    ) : st === "error" ? (
                      <span style={{ color: "var(--estado-critico)" }}>✗</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <datalist id="categorias-conocidas">
        {categorias.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </section>
  );
}
