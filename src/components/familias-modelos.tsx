"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Familia } from "@/lib/pedidos-china/familias";
import { nombreDeFamilia } from "@/lib/pedidos-china/familias";

/**
 * Modelos que se piden JUNTOS (familias): GT117…GT122 son un solo zapato en
 * seis colores. Planeación de compras los enseña como un modelo, el Excel
 * sale con todos y Nuevo pedido arma un solo IN. Pedido del dueño,
 * 20-oct-2026.
 */
export function FamiliasModelos({ familias: iniciales }: { familias: Familia[] }) {
  const router = useRouter();
  const [familias, setFamilias] = useState(iniciales);
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [modelos, setModelos] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lista = modelos.split(/[\s,;]+/).filter(Boolean);
  const sugerido = nombreDeFamilia(lista);

  async function mandar(cuerpo: Record<string, unknown>) {
    setTrabajando(true);
    setError(null);
    try {
      const r = await fetch("/api/pedidos/familias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      setFamilias(j.familias);
      setNombre("");
      setModelos("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <section className="tarjeta p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="seccion-titulo">Modelos que se piden juntos</h2>
          <p className="texto-2 mt-1 text-[13px]">
            Varios números que la fábrica hace como un solo zapato (GT117 a GT122): aquí se ven como un modelo, el Excel
            sale con todos y el pedido nuevo lleva un solo IN.
          </p>
        </div>
        <button className="boton boton-borde boton-chico" onClick={() => setAbierto((x) => !x)}>
          {abierto ? "Cerrar" : "Juntar modelos"}
        </button>
      </div>

      {familias.length ? (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {familias.map((f) => (
            <li key={f.familia} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{f.familia}</span>
              <span className="texto-2">{f.modelos.join(", ")}</span>
              <button
                className="boton boton-fantasma boton-chico"
                disabled={trabajando}
                onClick={() => {
                  setNombre(f.familia);
                  setModelos(f.modelos.join(" "));
                  setAbierto(true);
                }}
              >
                Editar
              </button>
              <button
                className="boton boton-fantasma boton-chico"
                disabled={trabajando}
                onClick={() => {
                  if (confirm(`¿Separar la familia ${f.familia}? Cada modelo volverá a pedirse por su cuenta.`)) mandar({ quitar: f.familia });
                }}
              >
                Separar
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="texto-tenue mt-3 text-sm">Ninguna familia todavía.</p>
      )}

      {abierto ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex min-w-72 flex-1 flex-col gap-1 text-xs">
            Modelos (separados por espacio)
            <input value={modelos} onChange={(e) => setModelos(e.target.value.toUpperCase())} placeholder="GT117 GT118 GT119 GT120 GT121 GT122" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Nombre de la familia
            <input className="w-44" value={nombre} onChange={(e) => setNombre(e.target.value.toUpperCase())} placeholder={sugerido || "GT117-GT122"} />
          </label>
          <button
            className="boton boton-primario"
            disabled={trabajando || lista.length < 2}
            onClick={() => mandar({ familia: nombre || sugerido, modelos: lista })}
          >
            {trabajando ? "Guardando…" : "Guardar familia"}
          </button>
        </div>
      ) : null}
      {error ? <div className="aviso aviso-critico mt-3 text-[13px]">{error}</div> : null}
    </section>
  );
}
