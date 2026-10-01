"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Trash2, Upload, XCircle } from "lucide-react";
import type { ProductosNuevosTikTok, PublicacionEnCola } from "@/lib/servicios/tiktok-publicar";
import type { ProductoAmazonParaTikTok } from "@/lib/tiktok/publicar";

function dinero(x: number | null | undefined, moneda: string): string {
  if (x == null) return "—";
  return x.toLocaleString("es-MX", { style: "currency", currency: moneda, maximumFractionDigits: 0 });
}

function cuando(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const ETIQUETA_ESTADO: Record<PublicacionEnCola["estado"], { texto: string; color: string }> = {
  pendiente: { texto: "En cola", color: "var(--ink-2)" },
  publicando: { texto: "Publicando…", color: "var(--acento)" },
  publicado: { texto: "Publicado", color: "var(--ok, #15803d)" },
  error: { texto: "Error", color: "var(--peligro, #b91c1c)" },
};

/**
 * Productos nuevos de TikTok: el catálogo de calzado de Amazon, listo para
 * publicarse en TikTok Shop con el precio que se le ponga. Se marcan los
 * modelos, se captura el precio (o uno para todos) y «Publicar en TikTok»
 * los deja en la cola; la publicación corre por atrás y la tabla de abajo
 * enseña cómo va.
 */
export function ProductosNuevosTikTok({ inicial, esDueno }: { inicial: ProductosNuevosTikTok; esDueno: boolean }) {
  const [datos, setDatos] = useState(inicial);
  const [filtro, setFiltro] = useState("");
  const [verPublicados, setVerPublicados] = useState(false);
  const [soloActivos, setSoloActivos] = useState(true);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [titulos, setTitulos] = useState<Record<string, string>>({});
  const [precioTodos, setPrecioTodos] = useState("");
  const [borrador, setBorrador] = useState(false);
  const [incluirApagados, setIncluirApagados] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const sondeo = useRef<ReturnType<typeof setInterval> | null>(null);

  const enCola = useMemo(() => {
    const m = new Map<string, PublicacionEnCola>();
    for (const c of datos.cola) if (!m.has(c.modelo)) m.set(c.modelo, c);
    return m;
  }, [datos.cola]);

  const trabajando = datos.cola.some((c) => c.estado === "pendiente" || c.estado === "publicando");

  async function recargar(refrescar = false) {
    const r = await fetch(`/api/tiktok/publicar-productos${refrescar ? "?refrescar=1" : ""}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "No se pudo leer la lista.");
    setDatos(j);
  }

  // Mientras haya algo en cola, se vuelve a leer cada 5 s.
  useEffect(() => {
    if (!trabajando) {
      if (sondeo.current) clearInterval(sondeo.current);
      sondeo.current = null;
      return;
    }
    if (sondeo.current) return;
    sondeo.current = setInterval(() => {
      recargar().catch(() => {});
    }, 5000);
    return () => {
      if (sondeo.current) clearInterval(sondeo.current);
      sondeo.current = null;
    };
  }, [trabajando]);

  const visibles = useMemo(() => {
    const q = normalizar(filtro.trim());
    return datos.productos.filter((p) => {
      const estado = enCola.get(p.modelo)?.estado;
      const bloqueado = estado === "pendiente" || estado === "publicando";
      if (!verPublicados && !p.coloresPorPublicar.length) return false;
      if (!verPublicados && bloqueado) return false;
      if (soloActivos && !p.activas) return false;
      if (q && !normalizar(`${p.modelo} ${p.titulo} ${p.colores.map((c) => c.color).join(" ")}`).includes(q)) return false;
      return true;
    });
  }, [datos.productos, enCola, filtro, verPublicados, soloActivos]);

  function marcar(modelo: string, si: boolean) {
    setMarcados((s) => {
      const n = new Set(s);
      if (si) n.add(modelo);
      else n.delete(modelo);
      return n;
    });
  }

  function marcarTodos(si: boolean) {
    setMarcados(si ? new Set(visibles.filter((p) => p.coloresPorPublicar.length).map((p) => p.modelo)) : new Set());
  }

  function aplicarPrecioATodos() {
    const n = Number(precioTodos);
    if (!(n > 0)) return;
    setPrecios((p) => {
      const nuevo = { ...p };
      for (const m of marcados) nuevo[m] = String(n);
      return nuevo;
    });
  }

  const coloresDe = (p: ProductoAmazonParaTikTok) => (incluirApagados ? p.coloresPorPublicar : p.coloresActivosPorPublicar);
  const porModelo = useMemo(() => new Map(datos.productos.map((p) => [p.modelo, p])), [datos.productos]);
  const listos = [...marcados].filter((m) => Number(precios[m]) > 0 && (coloresDe(porModelo.get(m)!)?.length ?? 0) > 0);
  const sinPrecio = [...marcados].filter((m) => !(Number(precios[m]) > 0)).length;
  const sinColores = [...marcados].filter((m) => Number(precios[m]) > 0 && !(coloresDe(porModelo.get(m)!)?.length)).length;

  async function publicar() {
    if (!listos.length) return;
    const n = listos.length;
    if (!window.confirm(`¿Publicar ${n} producto${n === 1 ? "" : "s"} en TikTok${borrador ? " como borrador" : ""}? Se crean con sus colores y tallas y el precio capturado.`)) return;
    setEnviando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await fetch("/api/tiktok/publicar-productos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productos: listos.map((m) => ({
            modelo: m,
            precio: Number(precios[m]),
            colores: coloresDe(porModelo.get(m)!),
            titulo: (titulos[m] ?? porModelo.get(m)!.titulo).trim(),
          })),
          borrador,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo encolar.");
      const rechazos = (j.rechazados ?? []) as { modelo: string; motivo: string }[];
      setAviso(
        `${j.encolados} en la cola; se publican por atrás.` +
          (rechazos.length ? ` No entraron: ${rechazos.map((x) => `${x.modelo} (${x.motivo})`).join(", ")}.` : ""),
      );
      setMarcados(new Set());
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function accion(accionNombre: "reintentar" | "quitar" | "continuar", id?: number) {
    setError(null);
    try {
      const r = await fetch("/api/tiktok/publicar-productos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: accionNombre, id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo.");
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function refrescarLista() {
    setRefrescando(true);
    setError(null);
    try {
      await recargar(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefrescando(false);
    }
  }

  const estiloCampo = { borderColor: "var(--grid)", color: "var(--ink-1)" } as const;
  const resumen = {
    productos: datos.productos.length,
    porPublicar: datos.productos.filter((p) => p.coloresPorPublicar.length).length,
    enTikTok: datos.productos.filter((p) => p.coloresEnTikTok.length).length,
  };

  return (
    <div className="flex flex-col gap-6">
      {datos.avisos.map((a) => (
        <div key={a} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "#f59e0b", color: "#92400e", background: "#fffbeb" }}>
          <AlertTriangle size={16} /> {a}
        </div>
      ))}

      <section className="tarjeta p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
            Buscar
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="GT134, sandalia, BLK…" className="w-56 rounded-lg border px-2 py-1.5 text-sm" style={estiloCampo} />
          </label>
          <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--ink-2)" }}>
            <input type="checkbox" checked={soloActivos} onChange={(e) => setSoloActivos(e.target.checked)} /> Solo con tallas activas en Amazon
          </label>
          <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--ink-2)" }}>
            <input type="checkbox" checked={verPublicados} onChange={(e) => setVerPublicados(e.target.checked)} /> Ver también lo que TikTok ya vende
          </label>
          <button onClick={refrescarLista} disabled={refrescando} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60" style={{ borderColor: "var(--grid)" }}>
            <RefreshCw size={14} className={refrescando ? "animate-spin" : ""} /> Releer Amazon
          </button>
          <span className="text-xs" style={{ color: "var(--ink-2)" }}>
            {resumen.productos} modelos en Amazon · {resumen.porPublicar} con colores por publicar · {resumen.enTikTok} ya en TikTok · lista de {cuando(datos.generadoEn)}
          </span>
        </div>

        {esDueno ? (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4" style={{ borderColor: "var(--grid)" }}>
            <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
              Mismo precio para los marcados ({datos.moneda})
              <div className="flex gap-1">
                <input type="number" min={1} step={1} value={precioTodos} onChange={(e) => setPrecioTodos(e.target.value)} className="w-28 rounded-lg border px-2 py-1.5 text-sm" style={estiloCampo} />
                <button onClick={aplicarPrecioATodos} disabled={!marcados.size || !(Number(precioTodos) > 0)} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60" style={{ borderColor: "var(--grid)" }}>
                  Aplicar
                </button>
              </div>
            </label>
            <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--ink-2)" }}>
              <input type="checkbox" checked={incluirApagados} onChange={(e) => setIncluirApagados(e.target.checked)} /> Incluir colores sin tallas activas en Amazon
            </label>
            <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--ink-2)" }}>
              <input type="checkbox" checked={borrador} onChange={(e) => setBorrador(e.target.checked)} /> Dejarlos como borrador en TikTok (revisar antes de vender)
            </label>
            <button onClick={publicar} disabled={enviando || !listos.length} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60" style={{ background: "var(--acento)" }}>
              {enviando ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Publicar en TikTok ({listos.length})
            </button>
            {sinPrecio > 0 ? (
              <span className="text-xs" style={{ color: "#92400e" }}>
                {sinPrecio} marcado{sinPrecio === 1 ? "" : "s"} sin precio: no se publica{sinPrecio === 1 ? "" : "n"} hasta capturarlo.
              </span>
            ) : null}
            {sinColores > 0 ? (
              <span className="text-xs" style={{ color: "#92400e" }}>
                {sinColores} marcado{sinColores === 1 ? "" : "s"} solo con colores apagados en Amazon: marca «Incluir colores sin tallas activas» para publicarlos.
              </span>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="mt-3 text-sm" style={{ color: "#b91c1c" }}>{error}</p> : null}
        {aviso ? <p className="mt-3 text-sm" style={{ color: "#15803d" }}>{aviso}</p> : null}
      </section>

      <section className="tarjeta overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs" style={{ color: "var(--ink-2)" }}>
              {esDueno ? (
                <th className="px-3 py-2">
                  <input type="checkbox" checked={visibles.length > 0 && visibles.every((p) => !p.coloresPorPublicar.length || marcados.has(p.modelo))} onChange={(e) => marcarTodos(e.target.checked)} />
                </th>
              ) : null}
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Colores</th>
              <th className="px-3 py-2 text-right">Tallas</th>
              <th className="px-3 py-2 text-right">Precio Amazon</th>
              {esDueno ? <th className="px-3 py-2">Precio TikTok</th> : null}
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <FilaProducto
                key={p.modelo}
                p={p}
                moneda={datos.moneda}
                esDueno={esDueno}
                marcado={marcados.has(p.modelo)}
                precio={precios[p.modelo] ?? ""}
                titulo={titulos[p.modelo] ?? p.titulo}
                enCola={enCola.get(p.modelo) ?? null}
                abierto={abierto === p.modelo}
                onAbrir={() => setAbierto(abierto === p.modelo ? null : p.modelo)}
                onMarcar={(si) => marcar(p.modelo, si)}
                onPrecio={(v) => setPrecios((s) => ({ ...s, [p.modelo]: v }))}
                onTitulo={(v) => setTitulos((s) => ({ ...s, [p.modelo]: v }))}
              />
            ))}
            {!visibles.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>
                  Nada que enseñar con estos filtros.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {datos.cola.length ? (
        <section className="tarjeta p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="titulo-seccion">Cola de publicación</h2>
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-2)" }}>
              {trabajando ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Publicando por atrás…
                </>
              ) : (
                "Sin trabajo pendiente."
              )}
              {esDueno && datos.cola.some((c) => c.estado === "pendiente") ? (
                <button onClick={() => accion("continuar")} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--grid)" }}>
                  Empujar la cola
                </button>
              ) : null}
            </div>
          </div>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: "var(--ink-2)" }}>
                <th className="px-2 py-1">Modelo</th>
                <th className="px-2 py-1">Colores</th>
                <th className="px-2 py-1 text-right">Precio</th>
                <th className="px-2 py-1">Estado</th>
                <th className="px-2 py-1">Detalle</th>
                <th className="px-2 py-1">Cuándo</th>
                {esDueno ? <th className="px-2 py-1"></th> : null}
              </tr>
            </thead>
            <tbody>
              {datos.cola.map((c) => {
                const e = ETIQUETA_ESTADO[c.estado];
                return (
                  <tr key={c.id} className="border-t" style={{ borderColor: "var(--grid)" }}>
                    <td className="px-2 py-1.5 font-medium">{c.modelo}</td>
                    <td className="px-2 py-1.5">{c.colores.join(", ")}</td>
                    <td className="px-2 py-1.5 text-right">{dinero(c.precio, datos.moneda)}</td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex items-center gap-1" style={{ color: e.color }}>
                        {c.estado === "publicado" ? <CheckCircle2 size={14} /> : c.estado === "error" ? <XCircle size={14} /> : c.estado === "publicando" ? <Loader2 size={14} className="animate-spin" /> : null}
                        {e.texto}
                        {c.borrador ? " (borrador)" : ""}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-xs" style={{ color: c.estado === "error" ? "#b91c1c" : "var(--ink-2)" }}>
                      {c.estado === "error" ? c.error : c.productId ? `Producto ${c.productId}` : c.intentos > 1 ? `Intento ${c.intentos}` : ""}
                      {c.avisos.length ? ` · TikTok avisa: ${c.avisos.join("; ")}` : ""}
                    </td>
                    <td className="px-2 py-1.5 text-xs" style={{ color: "var(--ink-2)" }}>{cuando(c.publicadoEn ?? c.creadoEn)}</td>
                    {esDueno ? (
                      <td className="px-2 py-1.5 text-right">
                        {c.estado === "error" ? (
                          <button onClick={() => accion("reintentar", c.id)} className="mr-2 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--grid)" }}>
                            <RefreshCw size={12} /> Reintentar
                          </button>
                        ) : null}
                        {c.estado === "error" || c.estado === "pendiente" ? (
                          <button onClick={() => accion("quitar", c.id)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--grid)" }}>
                            <Trash2 size={12} /> Quitar
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function FilaProducto({
  p,
  moneda,
  esDueno,
  marcado,
  precio,
  titulo,
  enCola,
  abierto,
  onAbrir,
  onMarcar,
  onPrecio,
  onTitulo,
}: {
  p: ProductoAmazonParaTikTok;
  moneda: string;
  esDueno: boolean;
  marcado: boolean;
  precio: string;
  titulo: string;
  enCola: PublicacionEnCola | null;
  abierto: boolean;
  onAbrir: () => void;
  onMarcar: (si: boolean) => void;
  onPrecio: (v: string) => void;
  onTitulo: (v: string) => void;
}) {
  const bloqueado = enCola?.estado === "pendiente" || enCola?.estado === "publicando";
  const publicable = p.coloresPorPublicar.length > 0 && !bloqueado;
  const estado = !p.coloresPorPublicar.length
    ? { texto: "Ya en TikTok", color: "#15803d" }
    : bloqueado
      ? { texto: enCola?.estado === "publicando" ? "Publicando…" : "En cola", color: "var(--acento)" }
      : enCola?.estado === "error"
        ? { texto: "Falló; ver cola", color: "#b91c1c" }
        : p.coloresEnTikTok.length
          ? { texto: `Faltan ${p.coloresPorPublicar.length} de ${p.colores.length} colores`, color: "#92400e" }
          : { texto: "Sin publicar", color: "var(--ink-2)" };

  return (
    <>
      <tr className="border-t align-top" style={{ borderColor: "var(--grid)", opacity: publicable ? 1 : 0.7 }}>
        {esDueno ? (
          <td className="px-3 py-2">
            <input type="checkbox" checked={marcado} disabled={!publicable} onChange={(e) => onMarcar(e.target.checked)} />
          </td>
        ) : null}
        <td className="px-3 py-2">
          <div className="flex items-start gap-3">
            {p.imagenUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imagenUrl} alt="" className="h-14 w-14 flex-none rounded-md object-cover" style={{ background: "var(--grid)" }} />
            ) : (
              <div className="h-14 w-14 flex-none rounded-md" style={{ background: "var(--grid)" }} />
            )}
            <div className="min-w-0 flex-1">
              <button onClick={onAbrir} className="font-semibold hover:underline">
                {p.modelo}
              </button>
              {esDueno && publicable ? (
                // El título con el que se publica: se puede corregir aquí antes de confirmar.
                <textarea
                  value={titulo}
                  onChange={(e) => onTitulo(e.target.value)}
                  rows={2}
                  maxLength={255}
                  className="mt-0.5 w-full min-w-64 rounded-lg border px-2 py-1 text-xs"
                  style={{ borderColor: "var(--grid)", color: "var(--ink-1)" }}
                  title="Título con el que se publica en TikTok (hasta 255 caracteres)"
                />
              ) : (
                <p className="line-clamp-2 text-xs" style={{ color: "var(--ink-2)" }} title={p.titulo}>
                  {p.titulo}
                </p>
              )}
            </div>
          </div>
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {p.colores.map((c) => (
              <span
                key={c.color}
                title={
                  (c.enTikTok.length ? `Ya en TikTok: ${c.enTikTok.join(", ")}. ` : `${c.activas} de ${c.tallas.length} tallas activas en Amazon. `) +
                  `Código en Amazon: ${c.color}` +
                  (c.traducido ? "" : " (sin traducción al español: se publica tal cual)")
                }
                className="rounded-full border px-2 py-0.5 text-xs"
                style={
                  c.enTikTok.length
                    ? { borderColor: "var(--grid)", color: "var(--ink-2)", textDecoration: "line-through" }
                    : { borderColor: "var(--acento)", color: "var(--ink-1)" }
                }
              >
                {c.nombre || c.color}
                {!c.traducido ? " ⚠" : ""}
                {!c.activas ? " (sin activas)" : ""}
              </span>
            ))}
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {p.skus}
          <span className="text-xs" style={{ color: "var(--ink-2)" }}>
            {" "}
            ({p.activas} act.)
          </span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{dinero(p.precioAmazon, moneda)}</td>
        {esDueno ? (
          <td className="px-3 py-2">
            <input
              type="number"
              min={1}
              step={1}
              value={precio}
              disabled={!publicable}
              placeholder={p.precioAmazon ? String(p.precioAmazon) : ""}
              onChange={(e) => onPrecio(e.target.value)}
              className="w-24 rounded-lg border px-2 py-1 text-sm"
              style={{ borderColor: "var(--grid)", color: "var(--ink-1)" }}
            />
          </td>
        ) : null}
        <td className="px-3 py-2 text-xs" style={{ color: estado.color }}>
          {estado.texto}
        </td>
      </tr>
      {abierto ? (
        <tr className="border-t" style={{ borderColor: "var(--grid)", background: "var(--fondo-suave, transparent)" }}>
          <td colSpan={7} className="px-3 py-2">
            <div className="flex flex-wrap gap-4">
              {p.colores.map((c) => (
                <div key={c.color} className="min-w-48 text-xs">
                  <div className="flex items-center gap-2">
                    {c.imagenUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.imagenUrl} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : null}
                    <span className="font-medium">{c.nombre || c.color}</span>
                    <span style={{ color: "var(--ink-2)" }}>{c.color}</span>
                    {c.enTikTok.length ? <span style={{ color: "#15803d" }}>ya en TikTok</span> : null}
                  </div>
                  <table className="mt-1">
                    <tbody>
                      {c.tallas.map((t) => (
                        <tr key={t.sellerSku} style={{ color: t.estado === "Active" ? "var(--ink-1)" : "var(--ink-2)" }}>
                          <td className="pr-2 tabular-nums">{t.talla}</td>
                          <td className="pr-2 font-mono">{t.skuTikTok}</td>
                          <td className="pr-2">{t.estado ?? "—"}</td>
                          <td className="tabular-nums">{dinero(t.precio, moneda)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
