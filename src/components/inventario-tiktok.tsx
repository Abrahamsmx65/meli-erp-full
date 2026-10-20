"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Aviso, Seccion } from "@/components/ui/pagina";
import { LigarTikTok } from "@/components/ligar-tiktok";
import type { RenglonTikTok } from "@/lib/servicios/tiktok-panel";
import { filtrarInventario, ordenarPorSku, totalesDeInventario } from "@/lib/tiktok/inventario-vista";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

interface ResultadoRetiroVista {
  referencia: string;
  detalle: { sku: string; retirados: number; apartados: number }[];
  sinDisponible: string[];
  paresRetirados: number;
  avisos: string[];
}

/**
 * La tabla del inventario del Almacén TikTok: ordenada por SKU, con
 * buscador y el total de lo que se está viendo arriba (pedido del dueño,
 * 18-sep-2026). Es solo vista: los renglones ya vienen masticados del
 * servidor (`cargarPanelTikTok`).
 *
 * Con `esDueno`, cada renglón lleva una casilla y «Retirar del almacén»
 * pone en cero lo DISPONIBLE de los SKU elegidos: salida en el kardex,
 * salida a Industher y cero publicado en TikTok (dueño, 20-oct-2026). Lo
 * apartado en pedidos se queda.
 */
export function InventarioTikTok({
  renglones,
  diasVenta,
  esDueno = false,
}: {
  renglones: RenglonTikTok[];
  diasVenta: number;
  esDueno?: boolean;
}) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  // Lo que tiene stock y NO está en línea: sin publicación activa en TikTok
  // (ninguna, en borrador o desactivada). Dueño, 2-oct-2026: «me haces una
  // lista de todo lo que hay stock TikTok que no está en línea».
  const [soloSinLinea, setSoloSinLinea] = useState(false);
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set());
  const [confirmaRetiro, setConfirmaRetiro] = useState(false);
  const [retirando, setRetirando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoRetiroVista | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ordenados = useMemo(() => ordenarPorSku(renglones), [renglones]);
  const vistos = useMemo(() => {
    const base = filtrarInventario(ordenados, busqueda);
    return soloSinLinea ? base.filter((r) => !r.publicable && r.disponible > 0) : base;
  }, [ordenados, busqueda, soloSinLinea]);
  const totales = useMemo(() => totalesDeInventario(vistos), [vistos]);
  const filtrando = busqueda.trim().length > 0 || soloSinLinea;
  const sinLinea = useMemo(() => renglones.filter((r) => !r.publicable && r.disponible > 0).length, [renglones]);

  // Lo elegido, con lo que de verdad se va a retirar (el disponible de hoy).
  const seleccion = useMemo(() => {
    const porSku = new Map(renglones.map((r) => [r.sku, r]));
    const filas = [...elegidos].map((sku) => porSku.get(sku)).filter((r): r is RenglonTikTok => Boolean(r));
    return {
      filas,
      pares: filas.reduce((a, r) => a + Math.max(0, r.disponible), 0),
      apartados: filas.reduce((a, r) => a + Math.max(0, r.apartado), 0),
      sinDisponible: filas.filter((r) => r.disponible <= 0).length,
    };
  }, [elegidos, renglones]);
  const todosLosVistosElegidos = vistos.length > 0 && vistos.every((r) => elegidos.has(r.sku));

  function alternar(sku: string) {
    setElegidos((prev) => {
      const s = new Set(prev);
      if (s.has(sku)) s.delete(sku);
      else s.add(sku);
      return s;
    });
    setConfirmaRetiro(false);
  }

  function alternarVistos() {
    setElegidos((prev) => {
      const s = new Set(prev);
      if (todosLosVistosElegidos) for (const r of vistos) s.delete(r.sku);
      else for (const r of vistos) s.add(r.sku);
      return s;
    });
    setConfirmaRetiro(false);
  }

  async function retirar() {
    if (!elegidos.size || !confirmaRetiro || retirando) return;
    setRetirando(true);
    setError(null);
    setResultado(null);
    try {
      const res = await fetch("/api/tiktok/retiro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: [...elegidos] }),
      });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(datos?.error ?? `Error ${res.status}`);
      setResultado(datos as ResultadoRetiroVista);
      setElegidos(new Set());
      setConfirmaRetiro(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetirando(false);
    }
  }

  const columnas = esDueno ? 8 : 7;

  return (
    <Seccion
      titulo="Inventario por SKU"
      sinRelleno
      acciones={
          <a
            href="/api/tiktok/resumen-modelos"
            className="boton boton-borde boton-chico"
            title="Un renglón por modelo: foto, categoría, ID y estado en TikTok, stock en la bodega TikTok, stock por bodega de cajas y ventas de MELI de toda la historia"
          >
            Excel por modelo
          </a>
      }
    >
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar SKU (GT134 BLK 24, navy…)"
          aria-label="Buscar en el inventario de TikTok"
          className="min-w-[16rem] flex-1 rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
        />
        <label className="flex items-center gap-1.5 text-xs" style={{ color: sinLinea ? "var(--alerta-texto)" : "var(--ink-2)" }}>
          <input type="checkbox" checked={soloSinLinea} onChange={(e) => setSoloSinLinea(e.target.checked)} />
          Solo con stock sin publicación activa ({n(sinLinea)})
        </label>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs texto-2">
          <span>
            <b className="num" style={{ color: "var(--ink)" }}>{n(totales.skus)}</b> SKU
            {filtrando ? ` de ${n(renglones.length)}` : ""}
          </span>
          <span>
            <b className="num" style={{ color: "var(--ink)" }}>{n(totales.saldo)}</b> en almacén
          </span>
          <span>
            <b className="num" style={{ color: "var(--ink)" }}>{n(totales.apartado)}</b> apartados
          </span>
          <span>
            <b className="num" style={{ color: "var(--ink)" }}>{n(totales.disponible)}</b> disponibles
          </span>
          <span>
            <b className="num" style={{ color: "var(--ink)" }}>{n(totales.ventas30)}</b> vendidos {diasVenta}d
          </span>
        </div>
      </div>

      {esDueno && elegidos.size > 0 ? (
        <div
          className="mx-4 mt-3 flex flex-wrap items-start gap-3 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "color-mix(in oklab, var(--estado-critico) 45%, var(--borde))", background: "var(--surface-2)" }}
        >
          <div className="flex-1 min-w-[16rem]">
            <b>{n(elegidos.size)} SKU</b> elegidos · se retiran <b className="num">{n(seleccion.pares)}</b> pares disponibles
            {seleccion.apartados > 0 ? (
              <span className="texto-2"> · {n(seleccion.apartados)} apartados en pedidos se quedan para despacharse</span>
            ) : null}
            {seleccion.sinDisponible > 0 ? (
              <span className="texto-2"> · {n(seleccion.sinDisponible)} sin disponible (no cambian)</span>
            ) : null}
            <span className="block text-xs texto-2 mt-1">
              El kardex baja a cero lo disponible, a Industher se le manda la salida con la referencia RETIRO-… para que
              descuente la caja de la bodega TikTok, y a TikTok se le publica el cero.
            </span>
            <label className="mt-1.5 flex items-start gap-1.5 text-xs">
              <input type="checkbox" checked={confirmaRetiro} onChange={(e) => setConfirmaRetiro(e.target.checked)} className="mt-0.5" />
              <span>Sí, retirar estos {n(elegidos.size)} SKU del almacén de TikTok.</span>
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" className="boton boton-borde boton-chico" onClick={() => { setElegidos(new Set()); setConfirmaRetiro(false); }} disabled={retirando}>
              Quitar selección
            </button>
            <button
              type="button"
              className="boton boton-peligro-lleno boton-chico"
              onClick={retirar}
              disabled={retirando || !confirmaRetiro || seleccion.pares <= 0}
            >
              {retirando ? "Retirando…" : "Retirar del almacén"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <Aviso tono="critico" className="mx-4 mt-3">
          {error}
        </Aviso>
      ) : null}
      {resultado ? (
        <Aviso tono={resultado.paresRetirados > 0 ? "bien" : "alerta"} titulo={resultado.paresRetirados > 0 ? `Retirados ${n(resultado.paresRetirados)} pares (${resultado.referencia})` : "No se retiró nada"} className="mx-4 mt-3">
          {resultado.detalle.length ? (
            <ul className="text-xs">
              {resultado.detalle.map((d) => (
                <li key={d.sku}>
                  {d.sku}: {n(d.retirados)} pares fuera{d.apartados > 0 ? ` · ${n(d.apartados)} apartados se quedan` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {resultado.sinDisponible.length ? (
            <p className="text-xs texto-2 mt-1">Sin disponible, no cambian: {resultado.sinDisponible.join(", ")}</p>
          ) : null}
          {resultado.avisos.map((a, i) => (
            <p key={i} className="text-xs mt-1">
              {a}
            </p>
          ))}
        </Aviso>
      ) : null}

      <div className="tabla-caja mt-3">
        <table className="datos">
          <thead>
            <tr>
              {esDueno ? (
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={todosLosVistosElegidos}
                    onChange={alternarVistos}
                    aria-label="Elegir todos los SKU que se ven"
                    title="Elegir todos los SKU que se ven"
                    disabled={!vistos.length}
                  />
                </th>
              ) : null}
              <th>SKU</th>
              <th className="num">En almacén</th>
              <th className="num">Apartado</th>
              <th className="num">Disponible</th>
              <th className="num">En TikTok</th>
              <th className="num">Venta {diasVenta}d</th>
              <th className="num">Cobertura</th>
            </tr>
          </thead>
          <tbody>
            {vistos.map((r) => (
              <tr key={r.sku} style={elegidos.has(r.sku) ? { background: "var(--surface-2)" } : undefined}>
                {esDueno ? (
                  <td>
                    <input
                      type="checkbox"
                      checked={elegidos.has(r.sku)}
                      onChange={() => alternar(r.sku)}
                      aria-label={`Elegir ${r.sku} para retirarlo del almacén`}
                    />
                  </td>
                ) : null}
                <td>
                  <span className="font-medium">{r.sku}</span>
                  {r.titulo ? (
                    <span className="block text-xs texto-2">
                      {r.titulo}
                    </span>
                  ) : null}
                  {!r.contado ? (
                    <span className="block text-xs" style={{ color: "var(--estado-alerta)" }}>
                      sin conteo inicial: no se publica a TikTok hasta una entrada o un ajuste
                    </span>
                  ) : !r.publicable ? (
                    <>
                      <span className="block text-xs" style={{ color: "var(--estado-alerta)" }}>
                        {r.estadoPublicacion === "DRAFT"
                          ? "publicación en BORRADOR en TikTok: no vende"
                          : r.estadoPublicacion === "SELLER_DEACTIVATED"
                            ? "publicación DESACTIVADA en TikTok: no vende"
                            : r.estadoPublicacion
                              ? `publicación en TikTok en estado ${r.estadoPublicacion}: no vende`
                              : "sin publicación ligada en TikTok"}
                      </span>
                      {r.estadoPublicacion ? null : <LigarTikTok sku={r.sku} sugerencias={r.sugerencias} />}
                    </>
                  ) : null}
                </td>
                <td className="num cifra" style={{ color: r.enRojo ? "var(--estado-critico)" : undefined }}>
                  {n(r.saldo)}
                </td>
                <td className="num cifra texto-2">
                  {r.apartado ? n(r.apartado) : "—"}
                </td>
                <td className="num cifra font-semibold">{n(r.disponible)}</td>
                <td
                  className="num cifra"
                  style={{ color: r.desfasado ? "var(--estado-critico)" : "var(--ink-2)" }}
                >
                  {r.publicado == null ? "—" : n(r.publicado)}
                </td>
                <td className="num cifra texto-2">
                  {r.ventas30 ? n(r.ventas30) : "—"}
                </td>
                <td className="num cifra texto-2">
                  {r.diasCobertura == null ? "—" : `${Math.round(r.diasCobertura)} d`}
                </td>
              </tr>
            ))}
            {!renglones.length ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm texto-2" colSpan={columnas}>
                  Todavía no hay nada en el almacén de TikTok.
                </td>
              </tr>
            ) : !vistos.length ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm texto-2" colSpan={columnas}>
                  Ningún SKU coincide con «{busqueda.trim()}».
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Seccion>
  );
}
