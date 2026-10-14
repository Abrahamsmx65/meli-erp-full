"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { contenidoPorModelo, detalleModelos, resumenModelos, type OtroDelContenedor, type PendientePacking } from "@/lib/servicios/contenedores-vista";
import { LigarColores, type ColorFantasma, type ColorLigado } from "./ligar-colores";
import { sugerirRenglon, type RenglonParaSugerir } from "@/lib/servicios/packing-sugerencias";
import { FotoProducto } from "./ui/foto-producto";
import { cotejarConBl } from "@/lib/importar/bl";

/** Miniaturas por renglón del contenedor; el resto se cuenta como «+N». */
const FOTOS_POR_CONTENEDOR = 6;

/** Una foto por modelo + color, los que más cajas traen primero. */
function fotosDeModelos(modelos: Contenedor["modelos"]) {
  return [...modelos].sort((a, b) => b.cajas - a.cajas);
}

interface Contenedor {
  id: string;
  numero: string;
  numeroNaviera: string | null;
  naviera: string | null;
  fechaSalida: string | null;
  llegadaEst: string | null;
  llegadaReal: string | null;
  almacenDestino: string | null;
  estado: string;
  notas: string | null;
  cajas: number;
  pedidos: { pedido: string; cajas: number }[];
  modelos: { modelo: string; color: string; cajas: number; pares: number; foto?: string | null }[];
  pendientes?: PendientePacking[];
  /** colores en camino que MELI no tiene como los escribió la fábrica */
  sinSku?: ColorFantasma[];
  /** colores ya ligados a mano con MELI */
  ligados?: ColorLigado[];
  /** cajas del BL (número de control) */
  cajasBl?: number | null;
  blArchivo?: string | null;
  /** lo que viaja y no es calzado (bolsas de empaque…) */
  otros?: OtroDelContenedor[];
}

const ETIQUETA_ESTADO: Record<string, { texto: string; color: string }> = {
  borrador: { texto: "Borrador (Drive)", color: "var(--estado-alerta)" },
  en_transito: { texto: "En tránsito", color: "var(--acento)" },
  en_aduana: { texto: "En aduana", color: "var(--estado-alerta)" },
  recibido: { texto: "Recibido", color: "var(--exito-texto)" },
};

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function fecha(s: string | null): string {
  return s ? s.slice(0, 10) : "—";
}

/**
 * La tabla de contenedores, editable en el propio renglón. La llave es
 * NUESTRO ID (`numero`); el número de la naviera es solo para rastreo.
 * Confirmar la llegada nunca suma inventario.
 */
export function TablaContenedores({ contenedores }: { contenedores: Contenedor[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [contenido, setContenido] = useState<Contenedor | null>(null);
  const [ligando, setLigando] = useState<Contenedor | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avisosBodega, setAvisosBodega] = useState<{ numero: string; avisos: string[] } | null>(null);

  function abrirEdicion(c: Contenedor) {
    setEditando(c.id);
    setError(null);
    setForm({
      numeroNaviera: c.numeroNaviera ?? "",
      naviera: c.naviera ?? "",
      fechaSalida: c.fechaSalida?.slice(0, 10) ?? "",
      fechaLlegadaEst: c.llegadaEst?.slice(0, 10) ?? "",
      estado: c.estado,
      notas: c.notas ?? "",
    });
  }

  async function mandar(cuerpo: Record<string, unknown>, id: string) {
    setOcupado(id);
    setError(null);
    try {
      const r = await fetch("/api/contenedores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...cuerpo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      setEditando(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  /**
   * Abre un borrador de correo con los documentos que la fábrica dejó en la
   * carpeta de Drive de ese embarque. El correo lleva los ENLACES: un
   * `mailto:` no puede llevar archivos adjuntos, y así quien lo reciba abre
   * el original en Drive.
   */
  async function compartirDocumentos(c: Contenedor) {
    setOcupado(c.id);
    setError(null);
    try {
      const r = await fetch(`/api/contenedores/${c.id}/documentos`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudieron leer los documentos de Drive.");
      if (!j.archivos?.length) {
        throw new Error(`La carpeta de Drive de ${c.numero} no tiene archivos.`);
      }
      const asunto = `Documentos del contenedor ${c.numero}${c.numeroNaviera ? ` (${c.numeroNaviera})` : ""}`;
      const cuerpo = [
        `Documentos del contenedor ${c.numero}${c.numeroNaviera ? ` · naviera ${c.numeroNaviera}` : ""}:`,
        "",
        ...j.archivos.map((a: { nombre: string; enlace: string }) => `${a.nombre}\n${a.enlace}`),
        "",
      ].join("\n");
      window.location.href = `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  /**
   * Los dos archivos para avisarle a la bodega lo que llega: alta de
   * PRODUCTOS (sin lo que ya viajó en otro contenedor) y PACKING LIST.
   */
  async function bajarBodega(c: Contenedor, archivo: "productos" | "packing") {
    setOcupado(c.id);
    setError(null);
    setAvisosBodega(null);
    try {
      const r = await fetch(`/api/contenedores/${c.id}/bodega?archivo=${archivo}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo armar el archivo.");
      const url = URL.createObjectURL(new Blob([j.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = j.nombre;
      a.click();
      URL.revokeObjectURL(url);
      if (j.avisos?.length) setAvisosBodega({ numero: c.numero, avisos: j.avisos });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  /** Solo borradores: un contenedor que llegó de Drive por error (duplicado, proforma). */
  async function borrar(c: Contenedor) {
    if (!window.confirm(`¿Borrar el borrador ${c.numero} (${n(c.cajas)} cajas)? Sus renglones se quitan y los pedidos vuelven a contar esas cajas como pendientes.`)) return;
    setOcupado(c.id);
    setError(null);
    try {
      const r = await fetch(`/api/contenedores?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo borrar.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function confirmarLlegada(c: Contenedor) {
    const seguro = window.confirm(
      `¿Confirmar que el contenedor ${c.numero} ya llegó (${n(c.cajas)} cajas)? ` +
        "No se suma inventario: las existencias llegan del API de Industher. " +
        "Solo deja de contar como en camino.",
    );
    if (!seguro) return;
    await mandar({ accion: "confirmarLlegada" }, c.id);
  }

  if (!contenedores.length) {
    return (
      <section className="tarjeta p-6 text-center">
        <p className="texto-2 text-sm">
          Todavía no hay contenedores.
        </p>
      </section>
    );
  }

  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b p-3 hairline">
        <h2 className="seccion-titulo">Contenedores</h2>
      </header>

      {error ? (
        <p className="px-3 pt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
      {avisosBodega ? (
        <div className="px-3 pt-3 text-sm" style={{ color: "var(--estado-alerta)" }}>
          <p className="font-medium">Archivo de bodega de {avisosBodega.numero}:</p>
          <ul className="list-disc pl-5">
            {avisosBodega.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>Nuestro ID</th>
              <th>Naviera</th>
              <th>Salida</th>
              <th>Llegada est.</th>
              <th>Llegada real</th>
              <th className="num">Cajas</th>
              <th>Qué viene</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {contenedores.map((c) => {
              const e = ETIQUETA_ESTADO[c.estado] ?? {
                texto: c.estado,
                color: "var(--ink-muted)",
              };
              const abierto = editando === c.id;
              return (
                <tr
                  key={c.id}
                  style={{
                    ...(abierto ? { background: "var(--surface-2)" } : {}),
                    ...(c.sinSku?.length ? { boxShadow: "inset 3px 0 0 var(--estado-critico)" } : {}),
                  }}
                >
                  <td className="font-medium">
                    {c.numero}
                    {c.notas && !abierto ? (
                      <div
                        className="texto-tenue max-w-48 truncate text-[11px]"
                        title={c.notas}
                      >
                        {c.notas}
                      </div>
                    ) : null}
                  </td>
                  <td className="text-xs">
                    {abierto ? (
                      <div className="flex flex-col gap-1">
                        <input
                          value={form.naviera}
                          onChange={(ev) => setForm((f) => ({ ...f, naviera: ev.target.value }))}
                          placeholder="Naviera"
                          className="w-32 rounded border px-1.5 py-0.5"
                          style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
                        />
                        <input
                          value={form.numeroNaviera}
                          onChange={(ev) =>
                            setForm((f) => ({ ...f, numeroNaviera: ev.target.value.toUpperCase() }))
                          }
                          placeholder="Núm. de la naviera"
                          className="w-32 rounded border px-1.5 py-0.5"
                          style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
                        />
                      </div>
                    ) : (
                      <>
                        {c.naviera || "—"}
                        {c.numeroNaviera ? (
                          <div className="texto-tenue cifra text-[11px]">
                            {c.numeroNaviera}
                          </div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="text-xs">
                    {abierto ? (
                      <input
                        type="date"
                        value={form.fechaSalida}
                        onChange={(ev) => setForm((f) => ({ ...f, fechaSalida: ev.target.value }))}
                        className="rounded border px-1.5 py-0.5"
                        style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
                      />
                    ) : (
                      <span className="cifra">{fecha(c.fechaSalida)}</span>
                    )}
                  </td>
                  <td className="text-xs">
                    {abierto ? (
                      <input
                        type="date"
                        value={form.fechaLlegadaEst}
                        onChange={(ev) =>
                          setForm((f) => ({ ...f, fechaLlegadaEst: ev.target.value }))
                        }
                        className="rounded border px-1.5 py-0.5"
                        style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
                      />
                    ) : (
                      <span className="cifra">{fecha(c.llegadaEst)}</span>
                    )}
                  </td>
                  <td className="cifra text-xs">{fecha(c.llegadaReal)}</td>
                  <td className="num">
                    <span className="cifra">{n(c.cajas)}</span>
                    {cajasOtros(c) ? (
                      <span className="block text-[11px] texto-tenue" title="Bolsas de empaque y otros artículos que no son calzado">
                        + {n(cajasOtros(c))} otros
                      </span>
                    ) : null}
                    <ContraBl cargadas={c.cajas + cajasOtros(c)} pendientes={(c.pendientes ?? []).reduce((a, p) => a + p.cajas, 0)} cajasBl={c.cajasBl} archivo={c.blArchivo} />
                  </td>
                  {/* Una línea por contenedor: el detalle sale al pasar el mouse. */}
                  <td className="text-xs">
                    {/* Computadora: todo lo que viene, por modelo y color, sin abrir «Contenido». */}
                    {c.modelos.length ? (
                      <ul className="hidden min-w-72 flex-col gap-1.5 lg:flex">
                        {contenidoPorModelo(c.modelos).map((m) => (
                          <li key={m.modelo} className="flex items-start gap-2">
                            <FotoProducto url={m.foto} alt={m.modelo} tamano={32} />
                            <span className="leading-tight">
                              <span className="font-semibold">{m.modelo}</span>{" "}
                              <span className="cifra texto-tenue">· {n(m.cajas)} cajas</span>
                              <span className="block texto-2">
                                {m.colores.map((x) => `${x.color || "—"} ${n(x.cajas)}`).join(" · ")}
                              </span>
                            </span>
                          </li>
                        ))}
                        {(c.otros ?? []).map((o) => (
                          <li key={`otro|${o.descripcion}|${o.color}`} className="flex items-start gap-2">
                            <FotoProducto url={null} alt={o.descripcion} tamano={32} />
                            <span className="leading-tight">
                              <span className="font-semibold">{nombreOtro(o)}</span>{" "}
                              <span className="cifra texto-tenue">· {n(o.cajas)} cajas</span>
                              <span className="block texto-tenue">
                                {o.piezas ? `${n(o.piezas)} piezas · ` : ""}no es calzado
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {/* Celular: una línea con fotos; el detalle en «Contenido». */}
                    <div className="lg:hidden">
                    {c.modelos.length ? (
                      <div className="mb-1 flex flex-wrap items-center gap-1">
                        {fotosDeModelos(c.modelos)
                          .slice(0, FOTOS_POR_CONTENEDOR)
                          .map((m) => (
                            <FotoProducto
                              key={`${m.modelo}|${m.color}`}
                              url={m.foto}
                              alt={`${m.modelo} ${m.color} · ${n(m.cajas)} cajas`}
                              tamano={28}
                            />
                          ))}
                        {c.modelos.length > FOTOS_POR_CONTENEDOR ? (
                          <span className="texto-tenue">+{c.modelos.length - FOTOS_POR_CONTENEDOR}</span>
                        ) : null}
                      </div>
                    ) : null}
                    {c.modelos.length ? (
                      <span
                        className="block max-w-56 cursor-help truncate"
                        title={detalleModelos(c)}
                      >
                        {resumenModelos(c.modelos)}
                      </span>
                    ) : (
                      <span className="texto-tenue">—</span>
                    )}
                    {(c.otros ?? []).length ? (
                      <span className="block max-w-56 truncate texto-tenue">
                        + {(c.otros ?? []).map((o) => `${nombreOtro(o)} ${n(o.cajas)}`).join(", ")}
                      </span>
                    ) : null}
                    </div>
                    {c.sinSku?.length ? (
                      <button
                        onClick={() => setLigando(c)}
                        className="mt-0.5 block max-w-56 truncate text-left text-[11px] font-medium"
                        style={{ color: "var(--estado-critico)" }}
                        title={c.sinSku
                          .map((s) => `${s.modelo} ${s.color}: MELI tiene ${s.coloresMeli.join(", ") || "ningún color"}`)
                          .join("\n")}
                      >
                        ⚠ {c.sinSku.length} {c.sinSku.length === 1 ? "color" : "colores"} sin SKU en MELI:{" "}
                        {c.sinSku.map((s) => `${s.modelo} ${s.color}`).join(", ")}
                      </button>
                    ) : null}
                  </td>
                  <td>
                    {abierto ? (
                      <select
                        value={form.estado}
                        onChange={(ev) => setForm((f) => ({ ...f, estado: ev.target.value }))}
                        className="rounded border px-1.5 py-0.5 text-xs"
                        style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
                      >
                        <option value="borrador">Borrador</option>
                        <option value="en_transito">En tránsito</option>
                        <option value="en_aduana">En aduana</option>
                        <option value="recibido">Recibido</option>
                      </select>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1">
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            background: `color-mix(in oklab, ${e.color} 15%, transparent)`,
                            color: e.color,
                          }}
                        >
                          {e.texto}
                        </span>
                        {/* Lo que el packing list no pudo amarrar: se resuelve en Contenido. */}
                        {c.pendientes?.length ? (
                          <button
                            onClick={() => setContenido(c)}
                            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                            style={{
                              background: "color-mix(in oklab, var(--estado-critico) 12%, transparent)",
                              color: "var(--estado-critico)",
                            }}
                            title={c.pendientes
                              .map((p) => `${p.modelo} ${p.color} · ${n(p.cajas)} cajas · ${p.motivo}`)
                              .join("\n")}
                          >
                            {n(c.pendientes.reduce((a, p) => a + p.cajas, 0))} cajas por confirmar
                          </button>
                        ) : null}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {abierto ? (
                        <>
                          <button
                            onClick={() =>
                              mandar(
                                {
                                  numeroNaviera: form.numeroNaviera,
                                  naviera: form.naviera,
                                  fechaSalida: form.fechaSalida,
                                  fechaLlegadaEst: form.fechaLlegadaEst,
                                  estado: form.estado,
                                  notas: form.notas,
                                },
                                c.id,
                              )
                            }
                            disabled={ocupado === c.id}
                            className="boton boton-primario boton-chico disabled:opacity-50"
                          >
                            {ocupado === c.id ? "Guardando…" : "Guardar"}
                          </button>
                          <button
                            onClick={() => setEditando(null)}
                            disabled={ocupado === c.id}
                            className="boton boton-borde boton-chico"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => abrirEdicion(c)}
                            className="boton boton-borde boton-chico"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => setContenido(c)}
                            className="boton boton-borde boton-chico"
                          >
                            Contenido
                          </button>
                          {/* Colores en camino que MELI no tiene como los escribió la
                              fábrica: se ligan a mano con la variante publicada. */}
                          {c.sinSku?.length || c.ligados?.length ? (
                            <button
                              onClick={() => setLigando(c)}
                              className="rounded-lg border px-2 py-1 text-xs font-medium"
                              style={
                                c.sinSku?.length
                                  ? {
                                      borderColor: "var(--estado-critico)",
                                      color: "var(--estado-critico)",
                                      background: "color-mix(in oklab, var(--estado-critico) 10%, transparent)",
                                    }
                                  : { borderColor: "var(--borde)" }
                              }
                            >
                              {c.sinSku?.length ? `Ligar a MELI (${c.sinSku.length})` : "Amarres"}
                            </button>
                          ) : null}
                          <a
                            href={`/api/contenedores/${c.id}/packing-list`}
                            className="boton boton-borde boton-chico"
                          >
                            Packing list
                          </a>
                          <button
                            onClick={() => bajarBodega(c, "productos")}
                            disabled={ocupado === c.id}
                            className="boton boton-borde boton-chico disabled:opacity-50"
                            title="Alta de productos para la bodega (sin los que ya venían en un contenedor anterior)"
                          >
                            Bodega: productos
                          </button>
                          <button
                            onClick={() => bajarBodega(c, "packing")}
                            disabled={ocupado === c.id}
                            className="boton boton-borde boton-chico disabled:opacity-50"
                            title="Lo que llega en este contenedor, para la bodega"
                          >
                            Bodega: llegada
                          </button>
                          <button
                            onClick={() => compartirDocumentos(c)}
                            disabled={ocupado === c.id}
                            className="boton boton-borde boton-chico disabled:opacity-50"
                            title="Abre un correo con los enlaces a los documentos de este embarque en Drive"
                          >
                            {ocupado === c.id ? "…" : "Compartir docs"}
                          </button>
                          {c.estado === "borrador" ? (
                            <button
                              onClick={() => mandar({ estado: "en_transito" }, c.id)}
                              disabled={ocupado === c.id}
                              className="boton boton-borde boton-chico disabled:opacity-50"
                              title="Lo revisaste y está bien: pasa a en tránsito"
                            >
                              {ocupado === c.id ? "…" : "Confirmar"}
                            </button>
                          ) : null}
                          {c.estado === "borrador" ? (
                            <button
                              onClick={() => borrar(c)}
                              disabled={ocupado === c.id}
                              className="rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50"
                              style={{ borderColor: "var(--estado-critico)", color: "var(--estado-critico)" }}
                              title="Quita este borrador y sus renglones"
                            >
                              Borrar
                            </button>
                          ) : null}
                          {c.estado !== "recibido" ? (
                            <button
                              onClick={() => confirmarLlegada(c)}
                              disabled={ocupado === c.id}
                              className="rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50"
                              style={{
                                borderColor: "var(--exito-texto)",
                                color: "var(--exito-texto)",
                              }}
                            >
                              {ocupado === c.id ? "…" : "Llegó"}
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {contenido ? (
        <ContenidoContenedor
          contenedor={contenido}
          onCerrar={() => setContenido(null)}
          onGuardado={() => {
            setContenido(null);
            router.refresh();
          }}
        />
      ) : null}

      {ligando ? (
        <LigarColores
          titulo={`Contenedor ${ligando.numero}`}
          fantasmas={ligando.sinSku ?? []}
          ligados={ligando.ligados ?? []}
          onCerrar={() => setLigando(null)}
          onCambio={() => router.refresh()}
        />
      ) : null}
    </section>
  );
}

/**
 * Las cajas cargadas contra el BL de la carpeta de Drive (idea del dueño,
 * 11-oct-2026): si no cuadran se dice en rojo cuántas faltan o sobran y
 * cuántas están por confirmar en Contenido.
 */
/** Cajas de lo que viaja y no es calzado (bolsas de empaque…): cuentan contra el BL. */
function cajasOtros(c: { otros?: { cajas: number }[] }): number {
  return (c.otros ?? []).reduce((a, o) => a + o.cajas, 0);
}

function nombreOtro(o: { descripcion: string; color: string }): string {
  return `${o.descripcion}${o.color ? ` ${o.color}` : ""}`;
}

function ContraBl({
  cargadas,
  pendientes,
  cajasBl,
  archivo,
}: {
  cargadas: number;
  pendientes: number;
  cajasBl?: number | null;
  archivo?: string | null;
}) {
  const c = cotejarConBl(cargadas, cajasBl);
  if (c.estado === "sin_bl") return <span className="block text-[11px] texto-tenue">sin BL</span>;
  const titulo = `BL: ${n(cajasBl ?? 0)} cajas${archivo ? ` (${archivo})` : ""}`;
  if (c.estado === "cuadra") {
    return (
      <span className="block text-[11px]" style={{ color: "var(--exito-texto)" }} title={titulo}>
        ✓ BL {n(cajasBl ?? 0)}
      </span>
    );
  }
  return (
    <span className="block text-[11px] font-medium" style={{ color: "var(--estado-critico)" }} title={titulo}>
      BL {n(cajasBl ?? 0)} · {c.estado === "faltan" ? `faltan ${n(-c.diferencia)}` : `sobran ${n(c.diferencia)}`}
      {c.estado === "faltan" && pendientes > 0 ? <span className="block font-normal">{n(pendientes)} por confirmar</span> : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

interface LineaContenido {
  pedidoLineaId: string;
  pedido: string;
  modelo: string;
  color: string;
  talla: string | null;
  cajasPedido: number;
  paresPorCaja: number;
  enEste: number;
  enOtros: number;
  /** color de la variante de MELI con la que amarra el renglón del pedido (null si no amarra) */
  colorMeli?: string | null;
  /** foto del producto (fotos-producto) */
  foto?: string | null;
}

/**
 * Edición de lo EMBARCADO en un contenedor: corrige cajas mal capturadas
 * (0 = quitar el renglón) y permite agregar renglones de los mismos pedidos
 * que faltaban. Nunca deja pasar del pedido menos lo de otros contenedores.
 */
function ContenidoContenedor({
  contenedor,
  onCerrar,
  onGuardado,
}: {
  contenedor: Contenedor;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [lineas, setLineas] = useState<LineaContenido[] | null>(null);
  const [cajas, setCajas] = useState<Record<string, number>>({});
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [pendientes, setPendientes] = useState<PendientePacking[]>(contenedor.pendientes ?? []);
  const [eleccion, setEleccion] = useState<Record<string, string>>({});
  const [eligiendoOtro, setEligiendoOtro] = useState<Record<string, boolean>>({});
  const [recordar, setRecordar] = useState<Record<string, boolean>>({});
  const claveP = (p: PendientePacking) => `${p.pedido ?? ""}|${p.modelo}|${p.color}|${p.talla ?? ""}`;
  const [todoElPedido, setTodoElPedido] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/contenedores/${contenedor.id}/lineas`)
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        const ls: LineaContenido[] = j.lineas ?? [];
        setLineas(ls);
        const inicial: Record<string, number> = {};
        for (const l of ls) inicial[l.pedidoLineaId] = l.enEste;
        setCajas(inicial);
      })
      .catch(() => {
        if (vivo) setLineas([]);
      });
    return () => {
      vivo = false;
    };
  }, [contenedor.id]);

  /**
   * Qué renglón del pedido ES el que la fábrica escribió distinto
   * (`packing-sugerencias.ts`): por ELIMINACIÓN si del pedido ya entraron
   * los demás colores y solo queda uno, si no por parecido. Se enseña con
   * su porqué y el dueño CONFIRMA; nunca se aplica solo.
   */
  function renglonesParaSugerir(): RenglonParaSugerir[] {
    return (lineas ?? []).map((l) => {
      const enEste = cajas[l.pedidoLineaId] ?? l.enEste;
      return {
        pedidoLineaId: l.pedidoLineaId,
        pedido: l.pedido,
        modelo: l.modelo,
        color: l.color,
        talla: l.talla,
        libres: Math.max(0, l.cajasPedido - l.enOtros - enEste),
        enEste,
      };
    });
  }

  async function confirmar(p: PendientePacking, pedidoLineaId: string) {
    const l = (lineas ?? []).find((x) => x.pedidoLineaId === pedidoLineaId);
    if (!l) return;
    const actual = cajas[pedidoLineaId] ?? l.enEste;
    const libres = Math.max(0, l.cajasPedido - l.enOtros - actual);
    setCajas((c) => ({ ...c, [pedidoLineaId]: actual + Math.min(p.cajas, libres) }));
    setPendientes((ps) => ps.filter((x) => claveP(x) !== claveP(p)));
    // Recordar el nombre que usa la fábrica en el packing list: la próxima
    // vez amarra solo (`colorPorAlias`), traducidos los dos a MELI.
    if ((recordar[claveP(p)] ?? true) && l.colorMeli && p.color) {
      try {
        const r = await fetch("/api/pedidos/amarre-color", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelo: p.modelo, color: p.color, colorMeli: l.colorMeli }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setAvisos((a) => [...a, `No se pudo recordar «${p.color}» = ${l.colorMeli}: ${j.error ?? r.status}`]);
        }
      } catch (e) {
        setAvisos((a) => [...a, `No se pudo recordar «${p.color}» = ${l.colorMeli}: ${(e as Error).message}`]);
      }
    }
  }

  const filtro = busqueda.trim().toUpperCase();
  // Decisión del dueño (10-sep-2026): aquí se ve LO QUE TRAE EL CONTENEDOR.
  // El resto del pedido solo estorba; se enseña a mano cuando hay que
  // agregar un renglón que faltó.
  const enEsteAhora = (l: LineaContenido) => cajas[l.pedidoLineaId] ?? l.enEste;
  const visibles = (lineas ?? []).filter(
    (l) =>
      (todoElPedido || enEsteAhora(l) > 0) &&
      (!filtro || `${l.pedido} ${l.modelo} ${l.color} ${l.talla ?? ""}`.toUpperCase().includes(filtro)),
  );
  const fueraDelContenedor = (lineas ?? []).filter((l) => enEsteAhora(l) <= 0).length;
  const totalCajas = Object.values(cajas).reduce((a, b) => a + (Number(b) || 0), 0);

  async function guardar() {
    if (!lineas) return;
    setGuardando(true);
    setError(null);
    try {
      const cambios = lineas
        .filter((l) => (cajas[l.pedidoLineaId] ?? l.enEste) !== l.enEste)
        .map((l) => ({ pedidoLineaId: l.pedidoLineaId, cajas: cajas[l.pedidoLineaId] ?? 0 }));
      const pendientesCambiaron = pendientes.length !== (contenedor.pendientes ?? []).length;
      if (!cambios.length && !pendientesCambiaron) {
        onCerrar();
        return;
      }
      if (cambios.length) {
        const r = await fetch(`/api/contenedores/${contenedor.id}/lineas`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cambios }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
        if (Array.isArray(j.recortes) && j.recortes.length) {
          setAvisos(j.recortes);
        }
      }
      // Lo que el dueño ya resolvió (o descartó) deja de estar pendiente.
      if (pendientesCambiaron) {
        const r2 = await fetch("/api/contenedores", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: contenedor.id, pendientes }),
        });
        if (!r2.ok) throw new Error((await r2.json()).error ?? "No se pudo guardar lo pendiente.");
      }
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: "rgba(0,0,0,.45)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Contenido del contenedor ${contenedor.numero}`}
    >
      <div className="tarjeta my-8 w-full max-w-3xl p-5" style={{ background: "var(--surface-1)" }}>
        <h3 className="titulo-seccion">Contenido de {contenedor.numero}</h3>
        {(contenedor.otros ?? []).length ? (
          <section className="mt-3 rounded-lg border p-3 text-xs" style={{ borderColor: "var(--borde)" }}>
            <h4 className="text-sm font-semibold">Otros artículos (no son calzado)</h4>
            <ul className="mt-1.5 flex flex-col gap-1">
              {(contenedor.otros ?? []).map((o) => (
                <li key={`${o.descripcion}|${o.color}`} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{nombreOtro(o)}</span>
                  <span className="cifra">{n(o.cajas)} cajas</span>
                  {o.piezas ? <span className="cifra texto-tenue">{n(o.piezas)} piezas</span> : null}
                  {o.pedido ? <span className="texto-tenue">{o.pedido}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {pendientes.length ? (
          <section
            className="mt-3 rounded-lg border p-3"
            style={{ borderColor: "var(--estado-critico)", background: "color-mix(in oklab, var(--estado-critico) 6%, transparent)" }}
          >
            <h4 className="text-sm font-semibold" style={{ color: "var(--estado-critico)" }}>
              {pendientes.length === 1 ? "1 renglón del packing list" : `${pendientes.length} renglones del packing list`} por
              confirmar
            </h4>
            <ul className="mt-2 flex flex-col gap-2">
              {pendientes.map((p) => {
                const k = claveP(p);
                const sugerencia = lineas === null ? null : sugerirRenglon(p, renglonesParaSugerir());
                const opciones = sugerencia ? [...(sugerencia.renglon ? [sugerencia.renglon] : []), ...sugerencia.otras] : [];
                const elegidoId = eleccion[k] ?? sugerencia?.renglon?.pedidoLineaId ?? "";
                const elegido = opciones.find((o) => o.pedidoLineaId === elegidoId) ?? null;
                const lineaElegida = (lineas ?? []).find((l) => l.pedidoLineaId === elegidoId) ?? null;
                const mostrarSelector = Boolean(eligiendoOtro[k]) || !sugerencia?.renglon;
                const tono =
                  sugerencia?.confianza === "eliminacion"
                    ? "var(--exito-texto)"
                    : sugerencia?.confianza === "parecido"
                      ? "var(--estado-alerta)"
                      : "var(--ink-2)";
                return (
                  <li
                    key={k}
                    className="rounded-lg border p-2.5 text-xs"
                    style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <FotoProducto url={p.foto} alt={`${p.modelo} ${p.color}`} tamano={32} />
                      <span className="texto-tenue">Packing list{p.pedido ? ` · ${p.pedido}` : ""}:</span>
                      <span className="font-semibold">
                        {p.modelo} {p.color}
                        {p.talla ? ` talla ${p.talla}` : ""}
                      </span>
                      <span className="cifra font-medium">{n(p.cajas)} cajas</span>
                    </div>

                    {lineas === null ? (
                      <div className="texto-tenue mt-1">
                        Cargando el pedido…
                      </div>
                    ) : !opciones.length ? (
                      <div className="texto-tenue mt-1">
                        {sugerencia?.porQue ?? p.motivo}
                      </div>
                    ) : (
                      <>
                        {sugerencia?.renglon && !mostrarSelector ? (
                          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span style={{ color: tono }}>→ {sugerencia.confianza === "eliminacion" ? "Es" : "Parece ser"}</span>
                            <span className="font-semibold">
                              {sugerencia.renglon.modelo} {sugerencia.renglon.color}
                              {sugerencia.renglon.talla ? ` talla ${sugerencia.renglon.talla}` : ""}
                            </span>
                            <span className="texto-2">
                              del pedido {sugerencia.renglon.pedido} · {n(sugerencia.renglon.libres)} cajas sin barco
                            </span>
                          </div>
                        ) : (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="texto-2">¿Cuál es?</span>
                            <select
                              value={elegidoId}
                              onChange={(ev) => setEleccion((e) => ({ ...e, [k]: ev.target.value }))}
                              className="rounded border px-1.5 py-0.5"
                              style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
                              aria-label={`Renglón del pedido para ${p.modelo} ${p.color}`}
                            >
                              {opciones.map((o) => (
                                <option key={o.pedidoLineaId} value={o.pedidoLineaId}>
                                  {o.modelo} {o.color}
                                  {o.talla ? ` T${o.talla}` : ""} · {o.pedido} · {n(o.libres)} sin barco
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        {sugerencia?.porQue ? (
                          <div className="texto-tenue mt-0.5">
                            {sugerencia.porQue}
                          </div>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => elegido && void confirmar(p, elegido.pedidoLineaId)}
                            disabled={!elegido}
                            className="boton boton-primario boton-chico disabled:opacity-50"
                          >
                            Sí, es este
                          </button>
                          {sugerencia?.renglon && sugerencia.otras.length ? (
                            <button
                              onClick={() => setEligiendoOtro((e) => ({ ...e, [k]: !e[k] }))}
                              className="boton boton-borde boton-chico"
                            >
                              {mostrarSelector ? "Volver a la sugerencia" : `Es otro (${sugerencia.otras.length} más)`}
                            </button>
                          ) : null}
                          <button
                            onClick={() => setPendientes((ps) => ps.filter((x) => claveP(x) !== k))}
                            className="boton boton-borde boton-chico"
                            title="No es ninguno: quítalo del aviso"
                          >
                            Descartar
                          </button>
                          {lineaElegida?.colorMeli && p.color ? (
                            <label className="texto-2 flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={recordar[k] ?? true}
                                onChange={(ev) => setRecordar((r) => ({ ...r, [k]: ev.target.checked }))}
                              />
                              Recordar: «{p.color}» de {p.modelo} = {lineaElegida.colorMeli} en MELI
                            </label>
                          ) : null}
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar modelo, color, talla o pedido…"
            className="min-w-56 flex-1 rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          />
          {fueraDelContenedor ? (
            <button
              onClick={() => setTodoElPedido((v) => !v)}
              className="boton boton-borde boton-chico"
              title="Los renglones de los mismos pedidos que este contenedor no trae"
            >
              {todoElPedido
                ? "Ver solo lo del contenedor"
                : `Agregar renglones del pedido (${n(fueraDelContenedor)})`}
            </button>
          ) : null}
        </div>

        <div className="mt-3 max-h-96 overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th className="w-12">Foto</th>
                <th>Pedido</th>
                <th>Modelo</th>
                <th>Color</th>
                <th>Talla</th>
                <th className="num">Del pedido</th>
                <th className="num">En otros</th>
                <th className="num">En este</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((l) => {
                const tope = Math.max(0, l.cajasPedido - l.enOtros);
                const valor = cajas[l.pedidoLineaId] ?? l.enEste;
                return (
                  <tr key={l.pedidoLineaId}>
                    <td>
                      <FotoProducto url={l.foto} alt={`${l.modelo} ${l.color}`} />
                    </td>
                    <td className="text-xs">{l.pedido}</td>
                    <td className="font-medium">{l.modelo}</td>
                    <td>{l.color}</td>
                    <td className="cifra">
                      {l.talla || <span className="texto-tenue">corrida</span>}
                    </td>
                    <td className="num cifra">{l.cajasPedido}</td>
                    <td className="num cifra">{l.enOtros || "—"}</td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        max={tope}
                        value={valor}
                        onChange={(e) =>
                          setCajas((c2) => ({
                            ...c2,
                            [l.pedidoLineaId]: Math.max(
                              0,
                              Math.min(tope, Number(e.target.value) || 0),
                            ),
                          }))
                        }
                        className="cifra w-20 rounded-lg border px-2 py-1 text-right text-sm"
                        style={{
                          borderColor: valor !== l.enEste ? "var(--acento)" : "var(--borde)",
                          background: "var(--surface-2)",
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lineas === null ? (
            <p className="texto-2 p-4 text-sm">
              Cargando contenido…
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
            {error}
          </p>
        ) : null}
        {avisos.map((a, i) => (
          <p key={i} className="mt-1 text-xs" style={{ color: "var(--estado-alerta)" }}>
            {a}
          </p>
        ))}

        <div className="mt-4 flex items-center gap-3">
          <span className="texto-2 text-sm">
            Quedan <strong className="cifra">{n(totalCajas)}</strong> cajas en este
            contenedor.
          </span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={onCerrar}
              disabled={guardando}
              className="boton boton-borde"
            >
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={guardando || lineas === null}
              className="boton boton-primario disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
