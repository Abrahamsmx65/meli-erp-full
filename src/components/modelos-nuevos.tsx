"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FOTOS_MINIMAS,
  calcularFaltantes,
  type ModeloNuevo,
} from "@/lib/engine/modelos-nuevos";
import type { SugerenciaModelo } from "@/lib/servicios/modelos-nuevos";

/**
 * Modelos nuevos: qué le falta a cada listado nuevo para poder venderse.
 *
 * Cada renglón guarda solo al cambiar (palomeos, fecha, notas) y la lista de
 * faltantes se recalcula aquí mismo con el motor puro, sin recargar. La
 * categoría y el precio van a /api/costos (su dueño); lo demás a
 * /api/modelos-nuevos. "Revisar" pregunta EN VIVO a MELI y Amazon por fotos,
 * video y A+, y recarga la página con lo que encontró.
 */

type Estado = "guardando" | "ok" | "error";
type Filtro = "pendientes" | "todos" | "listos";

const estiloEntrada = { borderColor: "var(--borde)", background: "var(--surface-2)" } as const;

const pesos = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

function fecha(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

function Marca({ estado }: { estado?: Estado }) {
  if (!estado) return null;
  const texto = estado === "guardando" ? "…" : estado === "ok" ? "✓" : "✗";
  const color =
    estado === "error" ? "var(--estado-critico)" : estado === "ok" ? "var(--exito-texto)" : "var(--ink-muted)";
  return (
    <span className="text-xs" style={{ color }}>
      {texto}
    </span>
  );
}

function Chip({ texto, tono, titulo }: { texto: string; tono: "bien" | "alerta" | "critico" | "neutro"; titulo?: string }) {
  const color =
    tono === "bien"
      ? "var(--exito-texto)"
      : tono === "alerta"
        ? "var(--estado-alerta)"
        : tono === "critico"
          ? "var(--estado-critico)"
          : "var(--ink-2)";
  return (
    <span
      className="chip"
      title={titulo}
      style={{ background: `color-mix(in oklab, ${color} 12%, transparent)`, color }}
    >
      {texto}
    </span>
  );
}

function Palomeo({
  texto,
  valor,
  onCambio,
  deshabilitado,
}: {
  texto: string;
  valor: boolean;
  onCambio: (v: boolean) => void;
  deshabilitado?: boolean;
}) {
  return (
    <label className="flex items-center gap-1.5 whitespace-nowrap text-xs">
      <input
        type="checkbox"
        checked={valor}
        disabled={deshabilitado}
        onChange={(e) => onCambio(e.target.checked)}
        className="h-4 w-4 cursor-pointer"
      />
      {texto}
    </label>
  );
}

export function ModelosNuevosPanel({
  modelos,
  sugerencias,
  categorias,
  hayAmazon,
  faltaMigracion,
}: {
  modelos: ModeloNuevo[];
  sugerencias: SugerenciaModelo[];
  categorias: string[];
  hayAmazon: boolean;
  faltaMigracion: boolean;
}) {
  const router = useRouter();
  const [filas, setFilas] = useState(modelos);
  const [pendientesDeAgregar, setPendientes] = useState(sugerencias);
  const [estado, setEstado] = useState<Record<string, Estado>>({});
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [nuevo, setNuevo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [revisando, setRevisando] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const marcar = (modelo: string, e: Estado) => setEstado((s) => ({ ...s, [modelo]: e }));

  /** Cambia un renglón en pantalla y recalcula sus faltantes. */
  function actualizar(modelo: string, cambios: Partial<ModeloNuevo>) {
    setFilas((l) =>
      l.map((m) => {
        if (m.modelo !== modelo) return m;
        const nuevo = { ...m, ...cambios };
        return { ...nuevo, faltantes: nuevo.listo ? [] : calcularFaltantes(nuevo, { hayAmazon }) };
      }),
    );
  }

  async function enviar(ruta: string, cuerpo: Record<string, unknown>, modelo: string) {
    marcar(modelo, "guardando");
    setAviso(null);
    try {
      const r = await fetch(ruta, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "No se pudo guardar.");
      marcar(modelo, "ok");
      return true;
    } catch (err) {
      marcar(modelo, "error");
      setAviso((err as Error).message);
      return false;
    }
  }

  /** Palomeos, fecha, notas y "listo". */
  function guardarSeguimiento(modelo: string, cambios: Partial<ModeloNuevo>) {
    actualizar(modelo, cambios);
    void enviar("/api/modelos-nuevos", { modelo, ...cambios }, modelo);
  }

  /** Categoría y precio: viven en Costos. */
  function guardarCosto(modelo: string, cambios: { categoria?: string; precioNormal?: number | null }) {
    void enviar("/api/costos", { modelo, ...cambios }, modelo);
  }

  async function agregar(modelo: string) {
    const m = modelo.trim().toUpperCase();
    if (!m) return;
    if (filas.some((f) => f.modelo === m)) {
      setAviso(`${m} ya está en la lista.`);
      return;
    }
    if (await enviar("/api/modelos-nuevos", { modelo: m }, m)) {
      setNuevo("");
      setPendientes((l) => l.filter((s) => s.modelo !== m));
      // La página lo arma completo (catálogo, costos, llegada): se recarga.
      router.refresh();
    }
  }

  async function quitar(modelo: string) {
    if (!window.confirm(`¿Quitar ${modelo} de la lista de modelos nuevos? No borra costos ni catálogo.`)) return;
    if (await enviar("/api/modelos-nuevos", { modelo, accion: "quitar" }, modelo)) {
      setFilas((l) => l.filter((f) => f.modelo !== modelo));
    }
  }

  async function revisar(modelos: string[] | null) {
    setRevisando(modelos ? modelos.join(",") : "*");
    setAviso(null);
    try {
      const r = await fetch("/api/modelos-nuevos/revisar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelos: modelos ?? [] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo revisar.");
      const partes = [`Revisados: ${j.revisados?.length ?? 0}.`];
      if (j.pendientes?.length) partes.push(`Sin plazo para ${j.pendientes.length}; vuelve a dar clic.`);
      if (j.avisos?.length) partes.push(...j.avisos);
      setAviso(partes.join(" "));
      router.refresh();
    } catch (err) {
      setAviso((err as Error).message);
    } finally {
      setRevisando(null);
    }
  }

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return filas.filter((m) => {
      if (filtro === "pendientes" && m.listo) return false;
      if (filtro === "listos" && !m.listo) return false;
      if (!q) return true;
      return (
        m.modelo.includes(q) ||
        (m.titulo ?? "").toUpperCase().includes(q) ||
        (m.categoria ?? "").toUpperCase().includes(q) ||
        m.faltantes.some((f) => f.toUpperCase().includes(q))
      );
    });
  }, [filas, busqueda, filtro]);

  const pendientes = filas.filter((m) => !m.listo).length;

  return (
    <div className="flex flex-col gap-6">
      {aviso ? (
        <div className="tarjeta p-3 text-sm" style={{ color: "var(--ink-2)" }}>
          {aviso}
        </div>
      ) : null}

      {pendientesDeAgregar.length ? (
        <section className="tarjeta p-4">
          <h2 className="text-sm font-semibold">Vienen en un pedido a China y todavía no se siguen aquí</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {pendientesDeAgregar.map((s) => (
              <button
                key={s.modelo}
                type="button"
                className="boton boton-secundario !px-2.5 !py-1 text-xs"
                title={s.llegada.texto}
                disabled={faltaMigracion}
                onClick={() => void agregar(s.modelo)}
              >
                + {s.modelo}
                <span className="font-normal" style={{ opacity: 0.8 }}>
                  {s.llegada.fecha ? ` · ${fecha(s.llegada.fecha)}` : ` · ${s.llegada.texto}`}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b p-4 hairline">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar modelo, categoría o faltante…"
            className="min-w-[14rem] flex-1 rounded-lg border px-2 py-1.5 text-sm"
            style={estiloEntrada}
          />
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as Filtro)}
            className="rounded-lg border px-2 py-1.5 text-sm"
            style={estiloEntrada}
          >
            <option value="pendientes">Pendientes ({pendientes})</option>
            <option value="todos">Todos ({filas.length})</option>
            <option value="listos">Listos ({filas.length - pendientes})</option>
          </select>
          <button
            type="button"
            className="boton boton-primario !py-1.5"
            disabled={faltaMigracion || revisando !== null || pendientes === 0}
            onClick={() => void revisar(null)}
            title="Pregunta a MELI y Amazon por las fotos, el video y el A+ de todos los pendientes"
          >
            {revisando === "*" ? "Revisando…" : "Revisar en MELI y Amazon"}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <input
              value={nuevo}
              onChange={(e) => setNuevo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void agregar(nuevo);
              }}
              placeholder="Agregar modelo (GT280…)"
              disabled={faltaMigracion}
              className="w-44 rounded-lg border px-2 py-1.5 text-sm"
              style={estiloEntrada}
            />
            <button
              type="button"
              className="boton boton-secundario !py-1.5"
              disabled={faltaMigracion}
              onClick={() => void agregar(nuevo)}
            >
              Agregar
            </button>
          </div>
        </header>

        <div className="max-h-[44rem] overflow-auto">
          <table className="datos text-[13px]">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Categoría</th>
                <th className="num">Precio venta</th>
                <th>Llegada</th>
                <th>Imágenes de China</th>
                <th>Mercado Libre</th>
                {hayAmazon ? <th>Amazon</th> : null}
                <th>Falta</th>
                <th>Notas</th>
                <th>Listo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((m) => {
                const abierto = abiertos.has(m.modelo);
                const rm = m.resumen.meli;
                const ra = m.resumen.amazon;
                const columnas = hayAmazon ? 11 : 10;
                return (
                  <FilaConDetalle key={m.modelo} abierto={abierto} columnas={columnas} m={m}>
                    <td className="whitespace-nowrap align-top">
                      <button
                        type="button"
                        className="font-medium underline-offset-2 hover:underline"
                        onClick={() =>
                          setAbiertos((s) => {
                            const n = new Set(s);
                            if (n.has(m.modelo)) n.delete(m.modelo);
                            else n.add(m.modelo);
                            return n;
                          })
                        }
                        title="Ver el detalle por publicación y color"
                      >
                        {abierto ? "▾" : "▸"} {m.modelo}
                      </button>
                      {m.titulo ? (
                        <div className="max-w-48 truncate text-[11px]" style={{ color: "var(--ink-muted)" }} title={m.titulo}>
                          {m.titulo}
                        </div>
                      ) : null}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.publicadoMeli ? <Chip texto="en MELI" tono="neutro" /> : <Chip texto="sin publicar en MELI" tono="alerta" />}
                        {hayAmazon ? (
                          m.publicadoAmazon ? <Chip texto="en Amazon" tono="neutro" /> : <Chip texto="sin publicar en Amazon" tono="alerta" />
                        ) : null}
                      </div>
                    </td>
                    <td className="align-top">
                      <input
                        list="categorias-modelos-nuevos"
                        defaultValue={m.categoria ?? ""}
                        placeholder="EVA, CORCHO…"
                        disabled={faltaMigracion}
                        onBlur={(e) => {
                          const v = e.target.value.trim().toUpperCase();
                          if (v === (m.categoria ?? "")) return;
                          actualizar(m.modelo, { categoria: v || null });
                          guardarCosto(m.modelo, { categoria: v });
                        }}
                        className="w-32 rounded-lg border px-1.5 py-1 text-sm"
                        style={estiloEntrada}
                      />
                    </td>
                    <td className="num align-top">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={m.precioNormal ?? ""}
                        placeholder="PV normal"
                        disabled={faltaMigracion}
                        onBlur={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          if (v === m.precioNormal) return;
                          actualizar(m.modelo, { precioNormal: v });
                          guardarCosto(m.modelo, { precioNormal: v });
                        }}
                        className="cifra w-24 rounded-lg border px-1.5 py-1 text-right text-sm"
                        style={estiloEntrada}
                      />
                      <div className="mt-1 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                        {m.costoTotal != null ? `costo ${pesos(m.costoTotal)}` : "sin costo"}
                        {m.precioRelampago ? ` · relámpago ${pesos(m.precioRelampago)}` : ""}
                      </div>
                    </td>
                    <td className="align-top">
                      <input
                        type="date"
                        defaultValue={m.llegadaEstimada ?? ""}
                        disabled={faltaMigracion}
                        onBlur={(e) => {
                          const v = e.target.value || null;
                          if (v === m.llegadaEstimada) return;
                          guardarSeguimiento(m.modelo, { llegadaEstimada: v });
                        }}
                        className="rounded-lg border px-1.5 py-1 text-sm"
                        style={estiloEntrada}
                        title="Fecha a mano; si se deja vacía se usa la del contenedor"
                      />
                      {m.llegadaAuto ? (
                        <div className="mt-1 text-[11px]" style={{ color: m.llegadaAuto.estado === "llego" ? "var(--exito-texto)" : "var(--ink-2)" }}>
                          {m.llegadaAuto.texto}
                          {m.llegadaAuto.fecha ? ` ${fecha(m.llegadaAuto.fecha)}` : ""}
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                          sin pedido a China
                        </div>
                      )}
                    </td>
                    <td className="align-top">
                      <div className="flex flex-col gap-1">
                        <Palomeo texto="Recibidas de China" valor={m.imagenesRecibidas} deshabilitado={faltaMigracion} onCambio={(v) => guardarSeguimiento(m.modelo, { imagenesRecibidas: v })} />
                        <Palomeo texto="Mandadas a cargar" valor={m.imagenesEnviadas} deshabilitado={faltaMigracion} onCambio={(v) => guardarSeguimiento(m.modelo, { imagenesEnviadas: v })} />
                      </div>
                    </td>
                    <td className="align-top">
                      <div className="flex flex-col gap-1">
                        {rm ? (
                          <div className="flex flex-wrap gap-1">
                            <Chip
                              texto={`${rm.publicaciones} pub. · fotos ${rm.fotosMin === rm.fotosMax ? rm.fotosMin : `${rm.fotosMin}–${rm.fotosMax}`}`}
                              tono={rm.sinFotos > 0 ? (rm.sinFotos === rm.publicaciones ? "critico" : "alerta") : "bien"}
                              titulo={`Portada + secundarias: mínimo ${FOTOS_MINIMAS} fotos por publicación`}
                            />
                            {rm.conVideo ? <Chip texto={`video en ${rm.conVideo}`} tono="neutro" titulo="Video (YouTube) de la publicación; el clip no se ve por API" /> : null}
                          </div>
                        ) : (
                          <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                            {m.publicadoMeli ? "sin revisar" : "—"}
                          </span>
                        )}
                        <Palomeo texto="Clip cargado" valor={m.meliClip} deshabilitado={faltaMigracion} onCambio={(v) => guardarSeguimiento(m.modelo, { meliClip: v })} />
                      </div>
                    </td>
                    {hayAmazon ? (
                      <td className="align-top">
                        <div className="flex flex-col gap-1">
                          {ra ? (
                            <div className="flex flex-wrap gap-1">
                              <Chip
                                texto={`${ra.colores} col. · fotos ${ra.fotosMin == null ? "?" : ra.fotosMin === ra.fotosMax ? ra.fotosMin : `${ra.fotosMin}–${ra.fotosMax}`}`}
                                tono={ra.sinFotos > 0 ? (ra.sinFotos === ra.colores ? "critico" : "alerta") : ra.fotosMin == null ? "neutro" : "bien"}
                              />
                              <Chip
                                texto={ra.aplusDesconocido === ra.colores ? "A+ ?" : `A+ ${ra.conAplus}/${ra.colores}`}
                                tono={ra.aplusDesconocido === ra.colores ? "neutro" : ra.conAplus === ra.colores ? "bien" : ra.conAplus > 0 ? "alerta" : "critico"}
                                titulo="Colores con contenido A+ publicado, según Amazon"
                              />
                            </div>
                          ) : (
                            <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                              {m.publicadoAmazon ? "sin revisar" : "—"}
                            </span>
                          )}
                          <Palomeo texto="A+ mandado a cargar" valor={m.aplusCargado} deshabilitado={faltaMigracion} onCambio={(v) => guardarSeguimiento(m.modelo, { aplusCargado: v })} />
                          <Palomeo texto="Video cargado" valor={m.amazonVideo} deshabilitado={faltaMigracion} onCambio={(v) => guardarSeguimiento(m.modelo, { amazonVideo: v })} />
                        </div>
                      </td>
                    ) : null}
                    <td className="align-top">
                      {m.listo ? (
                        <Chip texto="listo" tono="bien" />
                      ) : m.faltantes.length === 0 ? (
                        <Chip texto="nada: márcalo listo" tono="bien" />
                      ) : (
                        <div className="flex max-w-56 flex-wrap gap-1">
                          {m.faltantes.map((f) => (
                            <Chip key={f} texto={f} tono={/sin revisar|sin confirmar/.test(f) ? "neutro" : "alerta"} />
                          ))}
                        </div>
                      )}
                      {m.revisadoEn ? (
                        <div className="mt-1 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                          revisado {fecha(m.revisadoEn)}
                        </div>
                      ) : null}
                    </td>
                    <td className="align-top">
                      <textarea
                        defaultValue={m.notas}
                        rows={2}
                        placeholder="—"
                        disabled={faltaMigracion}
                        onBlur={(e) => {
                          if (e.target.value === m.notas) return;
                          guardarSeguimiento(m.modelo, { notas: e.target.value });
                        }}
                        className="w-40 rounded-lg border px-1.5 py-1 text-sm"
                        style={estiloEntrada}
                      />
                    </td>
                    <td className="align-top">
                      <input
                        type="checkbox"
                        checked={m.listo}
                        disabled={faltaMigracion}
                        onChange={(e) => guardarSeguimiento(m.modelo, { listo: e.target.checked })}
                        className="h-4 w-4 cursor-pointer"
                        title="Ya no le falta nada"
                      />
                    </td>
                    <td className="whitespace-nowrap align-top">
                      <div className="flex flex-col items-start gap-1">
                        <Marca estado={estado[m.modelo]} />
                        <button
                          type="button"
                          className="text-xs underline"
                          style={{ color: "var(--acento)" }}
                          disabled={faltaMigracion || revisando !== null || (!m.publicadoMeli && !m.publicadoAmazon)}
                          onClick={() => void revisar([m.modelo])}
                          title="Preguntar a MELI y Amazon solo por este modelo"
                        >
                          {revisando === m.modelo ? "revisando…" : "revisar"}
                        </button>
                        <button
                          type="button"
                          className="text-xs underline"
                          style={{ color: "var(--ink-muted)" }}
                          disabled={faltaMigracion}
                          onClick={() => void quitar(m.modelo)}
                        >
                          quitar
                        </button>
                      </div>
                    </td>
                  </FilaConDetalle>
                );
              })}
              {visibles.length === 0 ? (
                <tr>
                  <td colSpan={hayAmazon ? 11 : 10} className="py-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
                    {filas.length === 0
                      ? "Todavía no hay modelos nuevos. Agrega uno arriba o toma los que vienen en un pedido a China."
                      : "Nada que mostrar con ese filtro."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <datalist id="categorias-modelos-nuevos">
        {categorias.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

/** El renglón y, abierto, el detalle de la última revisión debajo. */
function FilaConDetalle({
  m,
  abierto,
  columnas,
  children,
}: {
  m: ModeloNuevo;
  abierto: boolean;
  columnas: number;
  children: React.ReactNode;
}) {
  const rev = m.revision;
  return (
    <>
      <tr>{children}</tr>
      {abierto ? (
        <tr>
          <td colSpan={columnas} style={{ background: "var(--surface-2)" }}>
            {!rev ? (
              <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                Todavía no se ha revisado en MELI ni en Amazon. Dale a "revisar".
              </p>
            ) : (
              <div className="grid gap-4 text-xs md:grid-cols-2">
                <div>
                  <h3 className="mb-1 font-semibold">Mercado Libre</h3>
                  {rev.meli ? (
                    <>
                      {rev.meli.error ? <p style={{ color: "var(--estado-alerta)" }}>{rev.meli.error}</p> : null}
                      <ul className="flex flex-col gap-0.5">
                        {rev.meli.publicaciones.map((p) => (
                          <li key={p.itemId} className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{p.color ?? "—"}</span>
                            {p.permalink ? (
                              <a href={p.permalink} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--acento)" }}>
                                {p.itemId}
                              </a>
                            ) : (
                              <span>{p.itemId}</span>
                            )}
                            <span style={{ color: "var(--ink-muted)" }}>{p.estado}</span>
                            <span style={{ color: p.fotos < FOTOS_MINIMAS ? "var(--estado-critico)" : "var(--exito-texto)" }}>
                              {p.fotos} foto{p.fotos === 1 ? "" : "s"}
                            </span>
                            {p.video ? <span>video</span> : null}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p style={{ color: "var(--ink-muted)" }}>Sin publicaciones en el catálogo.</p>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 font-semibold">Amazon</h3>
                  {rev.amazon ? (
                    <>
                      {rev.amazon.error ? <p style={{ color: "var(--estado-alerta)" }}>{rev.amazon.error}</p> : null}
                      {rev.amazon.aplusAviso ? <p style={{ color: "var(--ink-muted)" }}>{rev.amazon.aplusAviso}</p> : null}
                      <ul className="flex flex-col gap-0.5">
                        {rev.amazon.colores.map((c) => (
                          <li key={`${c.modelo}-${c.color}`} className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{c.color}</span>
                            {c.url && c.asin ? (
                              <a href={c.url} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--acento)" }}>
                                {c.asin}
                              </a>
                            ) : (
                              <span>{c.asin ?? "sin ASIN"}</span>
                            )}
                            <span style={{ color: "var(--ink-muted)" }}>{c.estado ?? ""}</span>
                            <span style={{ color: c.fotos == null ? "var(--ink-muted)" : c.fotos < FOTOS_MINIMAS ? "var(--estado-critico)" : "var(--exito-texto)" }}>
                              {c.fotos == null ? "fotos ?" : `${c.fotos} foto${c.fotos === 1 ? "" : "s"}`}
                            </span>
                            <span style={{ color: c.aplus == null ? "var(--ink-muted)" : c.aplus ? "var(--exito-texto)" : "var(--estado-critico)" }}>
                              {c.aplus == null ? "A+ ?" : c.aplus ? "A+ sí" : "A+ no"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p style={{ color: "var(--ink-muted)" }}>Sin publicaciones en el catálogo de Amazon.</p>
                  )}
                </div>
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
