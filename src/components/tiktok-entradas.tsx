"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

interface Renglon {
  sku: string;
  tipo: string;
  cantidad: string;
  motivo: string;
}

const VACIO: Renglon = { sku: "", tipo: "entrada", cantidad: "", motivo: "" };

const TIPOS: { valor: string; texto: string; ayuda: string }[] = [
  { valor: "entrada", texto: "Entrada", ayuda: "Llegó mercancía al almacén de TikTok" },
  { valor: "salida", texto: "Salida a mano", ayuda: "Salió sin pedido de TikTok de por medio" },
  { valor: "devolucion", texto: "Devolución", ayuda: "Un par regresó al almacén" },
  { valor: "merma", texto: "Merma", ayuda: "Dañado, perdido o robado" },
  { valor: "ajuste", texto: "Ajuste por conteo", ayuda: "La cantidad es el saldo que contaste" },
];

/**
 * Captura de movimientos del almacén de TikTok.
 *
 * Se captura en varios renglones de un jalón porque así llega la mercancía:
 * una corrida completa de un modelo, doce tallas. Al guardar, el disponible
 * nuevo se le escribe a TikTok en el mismo clic — que es todo el chiste: la
 * publicación deja de ofrecer lo que ya no hay, y vuelve a ofrecer lo que
 * acaba de entrar.
 */
export function EntradasTikTok() {
  const router = useRouter();
  const [renglones, setRenglones] = useState<Renglon[]>([{ ...VACIO }]);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function cambiar(i: number, campo: keyof Renglon, valor: string) {
    setRenglones((prev) => prev.map((r, j) => (j === i ? { ...r, [campo]: valor } : r)));
  }

  const ayuda = TIPOS.find((t) => t.valor === renglones[0]?.tipo)?.ayuda ?? "";

  async function guardar() {
    const movimientos = renglones
      .filter((r) => r.sku.trim() && r.cantidad !== "")
      .map((r) => ({
        sku: r.sku.trim(),
        tipo: r.tipo,
        cantidad: Number(r.cantidad),
        motivo: r.motivo.trim() || null,
      }));

    if (!movimientos.length) {
      setError("Captura al menos un SKU con su cantidad.");
      return;
    }

    setGuardando(true);
    setAviso(null);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/inventario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movimientos }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");

      const pub = j.publicacion;
      const cola = pub?.error
        ? ` El movimiento quedó guardado, pero TikTok no lo aceptó: ${pub.error}`
        : pub?.publicados
          ? ` ${pub.publicados} SKU actualizados en TikTok.`
          : "";
      setAviso(`${j.registrados} movimientos registrados.${cola}`);
      setRenglones([{ ...VACIO }]);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="tarjeta p-4">
      <h2 className="text-sm font-semibold">Capturar movimientos</h2>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
        Lo que entra sube el disponible y se le publica a TikTok en el mismo clic.
        {ayuda ? ` ${ayuda}.` : ""}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {renglones.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              value={r.sku}
              onChange={(e) => cambiar(i, "sku", e.target.value)}
              placeholder="SKU (GT135-DK BROWN-26)"
              className="min-w-[13rem] flex-1 rounded-lg border px-2.5 py-1.5 text-sm"
              style={{ borderColor: "var(--grid)" }}
            />
            <select
              value={r.tipo}
              onChange={(e) => cambiar(i, "tipo", e.target.value)}
              className="rounded-lg border px-2.5 py-1.5 text-sm"
              style={{ borderColor: "var(--grid)" }}
            >
              {TIPOS.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.texto}
                </option>
              ))}
            </select>
            <input
              value={r.cantidad}
              onChange={(e) => cambiar(i, "cantidad", e.target.value)}
              inputMode="numeric"
              placeholder="Pares"
              className="w-24 rounded-lg border px-2.5 py-1.5 text-sm"
              style={{ borderColor: "var(--grid)" }}
            />
            <input
              value={r.motivo}
              onChange={(e) => cambiar(i, "motivo", e.target.value)}
              placeholder="Motivo (opcional)"
              className="min-w-[10rem] flex-1 rounded-lg border px-2.5 py-1.5 text-sm"
              style={{ borderColor: "var(--grid)" }}
            />
            <button
              onClick={() => setRenglones((p) => (p.length === 1 ? [{ ...VACIO }] : p.filter((_, j) => j !== i)))}
              aria-label={`Quitar el renglón ${i + 1}`}
              className="rounded-lg border p-1.5"
              style={{ borderColor: "var(--grid)", color: "var(--ink-2)" }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setRenglones((p) => [...p, { ...VACIO }])}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm"
          style={{ borderColor: "var(--grid)" }}
        >
          <Plus size={14} /> Otro renglón
        </button>
        <button
          onClick={guardar}
          disabled={guardando}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--acento)" }}
        >
          {guardando ? "Guardando y publicando…" : "Guardar y publicar"}
        </button>
      </div>

      {aviso ? (
        <p className="mt-2 text-xs" style={{ color: "var(--exito-texto)" }}>
          {aviso}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
