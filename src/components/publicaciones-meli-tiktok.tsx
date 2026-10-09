"use client";

import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Ayuda, Seccion } from "@/components/ui/pagina";
import type { PublicacionEnCola } from "@/lib/servicios/tiktok-publicar";
import type { PublicacionMeliParaTikTok } from "@/lib/tiktok/publicar";

/**
 * Publicaciones de MELI que juntan VARIOS modelos (GT117…GT122 en una sola
 * publicación): se publican en TikTok como UN producto con esos modelos de
 * variante («GT117 Café», «GT118 Negro»…). Pedido del dueño, 2-oct-2026:
 * «quiero crear en TikTok el listado GT117 a GT122, pero se agrupan en un
 * solo listado aunque son diferentes SKUs; ¿me ayudas a hacer un borrador?».
 */
export function PublicacionesMeliTikTok({
  publicaciones,
  cola,
  moneda,
  esDueno,
  borrador,
  onEncolar,
}: {
  publicaciones: PublicacionMeliParaTikTok[];
  cola: PublicacionEnCola[];
  moneda: string;
  esDueno: boolean;
  borrador: boolean;
  onEncolar: (pedidos: { itemId: string; precio: number; titulo: string }[]) => Promise<void>;
}) {
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [titulos, setTitulos] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<string | null>(null);

  if (!publicaciones.length) return null;
  const enCola = new Map<string, PublicacionEnCola>();
  for (const c of cola) if (c.itemId && !enCola.has(c.itemId)) enCola.set(c.itemId, c);
  const estiloCampo = { borderColor: "var(--grid)", color: "var(--ink-1)" } as const;

  async function publicar(p: PublicacionMeliParaTikTok) {
    const precio = Number(precios[p.itemId] ?? "");
    if (!(precio > 0)) return;
    const titulo = (titulos[p.itemId] ?? p.titulo).trim();
    if (
      !window.confirm(
        `¿Publicar en TikTok${borrador ? " como borrador" : ""} la publicación ${p.itemId} (${p.modelos.join(", ")}) como UN producto con ${p.variantes - p.enTikTok.length} variantes a ${precio} ${moneda}?`,
      )
    )
      return;
    setEnviando(p.itemId);
    try {
      await onEncolar([{ itemId: p.itemId, precio, titulo }]);
    } finally {
      setEnviando(null);
    }
  }

  return (
    <Seccion
      titulo="Publicaciones de MELI con varios modelos"
      descripcion="Se publican en TikTok como UN producto con variantes «modelo + color» y un precio único."
    >
      <Ayuda titulo="¿Cómo se arman?">
        <p>
          En MELI estas publicaciones juntan varios modelos como variantes. En TikTok se publican igual: UN producto cuyas
          variantes son «modelo + color» («GT117 Café», «GT118 Negro»…) con sus tallas, las fotos de cada variación de MELI,
          la descripción de la publicación y el SKU de MELI tal cual (el kardex y el amarre ya lo conocen).
        </p>
        <p>La casilla «Dejarlos como borrador» de arriba también aplica aquí.</p>
      </Ayuda>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs texto-2">
            <th className="px-2 py-1">Publicación</th>
            <th className="px-2 py-1">Modelos</th>
            <th className="px-2 py-1 text-right">Variantes</th>
            <th className="px-2 py-1 text-right">Precio MELI</th>
            {esDueno ? <th className="px-2 py-1">Precio TikTok</th> : null}
            <th className="px-2 py-1">Estado</th>
          </tr>
        </thead>
        <tbody>
          {publicaciones.map((p) => {
            const c = enCola.get(p.itemId) ?? null;
            const bloqueada = c?.estado === "pendiente" || c?.estado === "publicando";
            const todas = p.enTikTok.length >= p.variantes;
            const precio = precios[p.itemId] ?? "";
            return (
              <tr key={p.itemId} className="border-t align-top" style={{ borderColor: "var(--grid)" }}>
                <td className="px-2 py-2">
                  <div className="font-medium">{p.itemId}</div>
                  {esDueno && !todas ? (
                    <textarea
                      value={titulos[p.itemId] ?? p.titulo}
                      onChange={(e) => setTitulos((s) => ({ ...s, [p.itemId]: e.target.value }))}
                      rows={2}
                      className="mt-1 w-full min-w-64 rounded-lg border px-2 py-1 text-xs"
                      style={estiloCampo}
                      title="El título con el que se publica en TikTok; corrígelo aquí antes de confirmar"
                    />
                  ) : (
                    <div className="text-xs texto-2">
                      {p.titulo}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2">{p.modelos.join(", ")}</td>
                <td className="px-2 py-2 text-right">
                  {p.variantes}
                  <div className="text-xs texto-tenue">
                    {p.colores} modelo{p.colores === 1 ? "" : "s"} + color
                    {p.enTikTok.length ? ` · ${p.enTikTok.length} ya en TikTok` : ""}
                  </div>
                </td>
                <td className="px-2 py-2 text-right">
                  {p.precioMeli != null ? p.precioMeli.toLocaleString("es-MX", { style: "currency", currency: moneda }) : "—"}
                </td>
                {esDueno ? (
                  <td className="px-2 py-2">
                    {!todas ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={precio}
                          placeholder={p.precioMeli != null ? String(Math.round(p.precioMeli)) : ""}
                          onChange={(e) => setPrecios((s) => ({ ...s, [p.itemId]: e.target.value }))}
                          className="w-24 rounded-lg border px-2 py-1 text-sm"
                          style={estiloCampo}
                          disabled={bloqueada}
                        />
                        <button
                          onClick={() => publicar(p)}
                          disabled={bloqueada || enviando === p.itemId || !(Number(precio) > 0)}
                          className="boton boton-primario boton-chico gap-1.5"
                        >
                          {enviando === p.itemId ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                          {borrador ? "Borrador en TikTok" : "Publicar en TikTok"}
                        </button>
                      </div>
                    ) : null}
                  </td>
                ) : null}
                <td className="px-2 py-2 text-xs texto-2">
                  {todas
                    ? "TikTok ya vende todas sus variantes"
                    : c
                      ? c.estado === "publicado"
                        ? `Publicado${c.borrador ? " (borrador)" : ""} · producto ${c.productId ?? ""}`
                        : c.estado === "error"
                          ? `Error: ${c.error ?? ""}`
                          : c.estado === "publicando"
                            ? "Publicando…"
                            : "En cola"
                      : "Sin publicar en TikTok"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Seccion>
  );
}
