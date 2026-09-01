"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type {
  CategoriaStore,
  ModeloContenido,
  TotalesContenido,
} from "@/lib/servicios/contenido-amazon";

type Estado = "guardando" | "ok" | "error";

/** El palomeo del renglón: guarda al instante, sin botón de por medio. */
function Palomeo({
  valor,
  onCambio,
  deshabilitado,
}: {
  valor: boolean;
  onCambio: (v: boolean) => void;
  deshabilitado?: boolean;
}) {
  return (
    <input
      type="checkbox"
      checked={valor}
      disabled={deshabilitado}
      onChange={(e) => onCambio(e.target.checked)}
      className="h-4 w-4 cursor-pointer"
    />
  );
}

function Marca({ estado }: { estado?: Estado }) {
  if (!estado) return null;
  const texto = estado === "guardando" ? "…" : estado === "ok" ? "✓" : "✗";
  const color =
    estado === "error"
      ? "var(--estado-critico)"
      : estado === "ok"
        ? "var(--exito-texto)"
        : "var(--ink-muted)";
  return (
    <span className="text-xs" style={{ color }}>
      {texto}
    </span>
  );
}

export function ContenidoAmazonPanel({
  modelos,
  categorias,
  totales,
  verEliminados,
  sinRefrescar,
  soloLectura,
  token,
  linkPublico,
}: {
  modelos: ModeloContenido[];
  categorias: CategoriaStore[];
  totales: TotalesContenido;
  verEliminados: boolean;
  sinRefrescar: boolean;
  soloLectura: boolean;
  /** Puesto = se entró con el link sin contraseña, no con sesión. */
  token?: string;
  /** El link para compartir; solo lo ve el dueño. */
  linkPublico?: string | null;
}) {
  const router = useRouter();

  // Las dos puertas a la misma pantalla: la del dueño (con sesión) y la del
  // link sin contraseña. Cambia a dónde se guarda, no qué se guarda.
  const publico = Boolean(token);
  const rutaGuardar = publico ? `/api/contenido-publico/${token}` : "/api/amazon/contenido";
  const rutaCategorias = publico
    ? `/api/contenido-publico/${token}`
    : "/api/amazon/contenido/categorias";
  const rutaImagenes = (modelo: string) =>
    publico
      ? `/api/contenido-publico/${token}/imagenes/${encodeURIComponent(modelo)}`
      : `/api/amazon/contenido/${encodeURIComponent(modelo)}/imagenes`;
  const base = publico ? `/contenido/${token}` : "/amazon/contenido";

  const [filas, setFilas] = useState(modelos);
  const [cats, setCats] = useState(categorias);
  const [estado, setEstado] = useState<Record<string, Estado>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [zip, setZip] = useState<string | null>(null);
  const [refrescando, setRefrescando] = useState(false);

  // El link se guarda como ruta y se completa con el origen ya montado: el
  // servidor no conoce el dominio y armarlo aquí evita el brinco de hidratación.
  const [rutaLink, setRutaLink] = useState(linkPublico ?? null);
  const [origen, setOrigen] = useState("");
  const [rotando, setRotando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => setOrigen(window.location.origin), []);
  const link = rutaLink ? `${origen}${rutaLink}` : null;

  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<
    "todos" | "nuevos" | "activos" | "sinAplus" | "sinCategoria"
  >("todos");
  const [nuevaCategoria, setNuevaCategoria] = useState("");

  const marcar = (clave: string, e: Estado) => setEstado((s) => ({ ...s, [clave]: e }));

  /**
   * Guarda lo anotado a un modelo. Optimista y sin recargar la página: el
   * dueño va a pulsar ▲ cinco veces seguidas y el palomeo no puede titubear.
   * Por eso la lista se filtra y se cuenta aquí, no en el servidor.
   */
  async function guardar(modelo: string, cambios: Partial<ModeloContenido>) {
    setFilas((l) => l.map((m) => (m.modelo === modelo ? { ...m, ...cambios } : m)));
    marcar(modelo, "guardando");
    setAviso(null);
    try {
      const r = await fetch(rutaGuardar, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tipo: "modelo", modelo, ...cambios }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "No se pudo guardar.");
      marcar(modelo, "ok");
    } catch (err) {
      marcar(modelo, "error");
      setAviso((err as Error).message);
    }
  }

  async function guardarCategoria(
    nombre: string,
    cambios: Partial<CategoriaStore> & { accion?: string; nuevoNombre?: string },
  ) {
    const clave = `cat:${nombre}`;
    marcar(clave, "guardando");
    setAviso(null);
    try {
      const r = await fetch(rutaCategorias, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tipo: "categoria", nombre, ...cambios }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "No se pudo guardar.");
      marcar(clave, "ok");
      return true;
    } catch (err) {
      marcar(clave, "error");
      setAviso((err as Error).message);
      return false;
    }
  }

  async function agregarCategoria() {
    const nombre = nuevaCategoria.trim();
    if (!nombre) return;
    if (cats.some((c) => c.nombre.toUpperCase() === nombre.toUpperCase())) {
      setAviso("Esa categoría ya está en la lista.");
      return;
    }
    if (await guardarCategoria(nombre, {})) {
      setCats((l) =>
        [
          ...l,
          { nombre, creada: false, imagenes: false, paginaStore: false, notas: "", modelos: 0 },
        ].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
      );
      setNuevaCategoria("");
    }
  }

  async function borrarCategoria(nombre: string) {
    if (await guardarCategoria(nombre, { accion: "borrar" })) {
      setCats((l) => l.filter((c) => c.nombre !== nombre));
      // Los modelos que la tenían se quedaron sin categoría.
      setFilas((l) => l.map((m) => (m.categoria === nombre ? { ...m, categoria: null } : m)));
    }
  }

  /** Trae el ZIP por fetch para poder avisar mientras Amazon contesta. */
  async function descargar(modelo: string) {
    setZip(modelo);
    setAviso(null);
    try {
      const r = await fetch(rutaImagenes(modelo));
      if (!r.ok) throw new Error((await r.json())?.error ?? "No se pudieron traer las imágenes.");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${modelo} imagenes.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setAviso((err as Error).message);
    } finally {
      setZip(null);
    }
  }

  /** Genera un link nuevo y deja muerto el anterior. */
  async function regenerarLink() {
    if (!confirm("El link de ahora dejará de funcionar y habrá que mandar el nuevo. ¿Seguimos?")) {
      return;
    }
    setRotando(true);
    setAviso(null);
    try {
      const r = await fetch("/api/amazon/contenido/acceso", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo generar.");
      setRutaLink(`/contenido/${j.token}`);
      setCopiado(false);
    } catch (err) {
      setAviso((err as Error).message);
    } finally {
      setRotando(false);
    }
  }

  async function actualizarCatalogo() {
    setRefrescando(true);
    setAviso(null);
    try {
      const r = await fetch("/api/amazon/catalogo", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo actualizar.");
      setAviso(j.mensaje ?? "Listo.");
      if (j.estado === "cargado") router.refresh();
    } catch (err) {
      setAviso((err as Error).message);
    } finally {
      setRefrescando(false);
    }
  }

  /** Cuántos modelos usa cada categoría, contado sobre lo que se ve ahora. */
  const usoCategoria = useMemo(() => {
    const uso = new Map<string, number>();
    for (const m of filas) {
      if (m.eliminado || !m.categoria) continue;
      uso.set(m.categoria, (uso.get(m.categoria) ?? 0) + 1);
    }
    return uso;
  }, [filas]);

  // Los que se quitaron en esta sesión ya no están en la lista del servidor.
  const eliminados = verEliminados
    ? filas.filter((m) => m.eliminado).length
    : totales.eliminados + filas.filter((m) => m.eliminado).length;

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return filas.filter((m) => {
      if (m.eliminado && !verEliminados) return false;
      if (filtro === "nuevos" && !m.nuevo) return false;
      if (filtro === "activos" && !m.activo) return false;
      if (filtro === "sinAplus" && m.aplus) return false;
      if (filtro === "sinCategoria" && m.categoria) return false;
      if (!q) return true;
      return (
        m.modelo.includes(q) ||
        (m.titulo ?? "").toUpperCase().includes(q) ||
        (m.categoria ?? "").toUpperCase().includes(q)
      );
    });
  }, [filas, busqueda, filtro, verEliminados]);

  return (
    <div className="flex flex-col gap-6">
      {aviso ? (
        <div className="tarjeta p-3 text-sm" style={{ color: "var(--ink-2)" }}>
          {aviso}
        </div>
      ) : null}

      {!publico && link ? (
        <section className="tarjeta p-4">
          <h2 className="text-sm font-semibold">Acceso sin contraseña</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
            Este link abre SOLO esta sección, sin pedir usuario ni contraseña. Quien lo tenga
            puede palomear, anotar, quitar modelos y bajar imágenes; no ve nada más del sistema.
            Si se te sale de las manos, genera otro y el anterior deja de servir.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-[18rem] flex-1 rounded-lg border px-2 py-1.5 font-mono text-xs"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => setCopiado(true));
              }}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
              style={{ background: "var(--acento)" }}
            >
              {copiado ? "Copiado ✓" : "Copiar"}
            </button>
            <button
              type="button"
              onClick={() => void regenerarLink()}
              disabled={rotando}
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              style={{ borderColor: "var(--borde)", color: "var(--ink-2)" }}
            >
              {rotando ? "Generando…" : "Generar otro"}
            </button>
          </div>
        </section>
      ) : null}

      {sinRefrescar ? (
        <div
          className="tarjeta p-3 text-sm"
          style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
        >
          Esta lista sale del histórico de ventas. Dale a <strong>Actualizar desde Amazon</strong>{" "}
          para traer el catálogo completo, con las publicaciones que todavía no venden.
        </div>
      ) : null}

      {/* -------------------------- Categorías de la store ------------------ */}
      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b p-4 hairline">
          <h2 className="text-sm font-semibold">Categorías de la store</h2>
          <span className="text-xs" style={{ color: "var(--ink-2)" }}>
            {cats.length} capturadas
          </span>
          <div className="ml-auto flex items-center gap-2">
            <input
              value={nuevaCategoria}
              onChange={(e) => setNuevaCategoria(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void agregarCategoria();
              }}
              placeholder="Nueva categoría…"
              disabled={soloLectura}
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            />
            <button
              type="button"
              onClick={() => void agregarCategoria()}
              disabled={soloLectura || !nuevaCategoria.trim()}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: "var(--acento)" }}
            >
              Agregar
            </button>
          </div>
        </header>

        {cats.length === 0 ? (
          <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
            Todavía no hay categorías. Captura las que ocupas en la store y luego asígnaselas a los
            modelos.
          </p>
        ) : (
          <div className="max-h-[24rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Creada</th>
                  <th>Imágenes</th>
                  <th>Página en la store</th>
                  <th className="num">Modelos</th>
                  <th>Notas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.nombre}>
                    <td className="font-medium">{c.nombre}</td>
                    <td>
                      <Palomeo
                        valor={c.creada}
                        deshabilitado={soloLectura}
                        onCambio={(v) => {
                          setCats((l) =>
                            l.map((x) => (x.nombre === c.nombre ? { ...x, creada: v } : x)),
                          );
                          void guardarCategoria(c.nombre, { creada: v });
                        }}
                      />
                    </td>
                    <td>
                      <Palomeo
                        valor={c.imagenes}
                        deshabilitado={soloLectura}
                        onCambio={(v) => {
                          setCats((l) =>
                            l.map((x) => (x.nombre === c.nombre ? { ...x, imagenes: v } : x)),
                          );
                          void guardarCategoria(c.nombre, { imagenes: v });
                        }}
                      />
                    </td>
                    <td>
                      <Palomeo
                        valor={c.paginaStore}
                        deshabilitado={soloLectura}
                        onCambio={(v) => {
                          setCats((l) =>
                            l.map((x) => (x.nombre === c.nombre ? { ...x, paginaStore: v } : x)),
                          );
                          void guardarCategoria(c.nombre, { paginaStore: v });
                        }}
                      />
                    </td>
                    <td className="num cifra">{usoCategoria.get(c.nombre) ?? 0}</td>
                    <td>
                      <input
                        defaultValue={c.notas}
                        disabled={soloLectura}
                        onBlur={(e) => {
                          if (e.target.value !== c.notas) {
                            void guardarCategoria(c.nombre, { notas: e.target.value });
                          }
                        }}
                        placeholder="—"
                        className="w-full min-w-[10rem] rounded border px-2 py-1 text-sm"
                        style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                      />
                    </td>
                    <td className="whitespace-nowrap">
                      <Marca estado={estado[`cat:${c.nombre}`]} />{" "}
                      <button
                        type="button"
                        onClick={() => void borrarCategoria(c.nombre)}
                        disabled={soloLectura}
                        className="text-xs underline disabled:opacity-50"
                        style={{ color: "var(--ink-2)" }}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ----------------------------- Modelos ------------------------------ */}
      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b p-4 hairline">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar modelo, título o categoría…"
            className="min-w-[14rem] flex-1 rounded-lg border px-2 py-1.5 text-sm"
            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          />
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as typeof filtro)}
            className="rounded-lg border px-2 py-1.5 text-sm"
            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          >
            <option value="todos">Todos</option>
            <option value="nuevos">Nuevos</option>
            <option value="activos">Solo activos</option>
            <option value="sinAplus">Sin contenido A+</option>
            <option value="sinCategoria">Sin categoría</option>
          </select>
          {publico ? null : (
            <button
              type="button"
              onClick={() => void actualizarCatalogo()}
              disabled={refrescando}
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              style={{ borderColor: "var(--borde)", color: "var(--ink-2)" }}
            >
              {refrescando ? "Preguntando…" : "Actualizar desde Amazon"}
            </button>
          )}
          <Link
            href={verEliminados ? base : `${base}?eliminados=1`}
            className="text-sm underline"
            style={{ color: "var(--ink-2)" }}
          >
            {verEliminados ? "Volver a la lista" : `Ver eliminados (${eliminados})`}
          </Link>
        </header>

        <div className="max-h-[46rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th className="num">Prio</th>
                <th>Modelo</th>
                <th>Publicación</th>
                <th>Categoría</th>
                <th>Imágenes</th>
                <th>A+</th>
                <th>Notas</th>
                <th>Amazon</th>
                <th>Fotos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((m) => (
                <tr key={m.modelo} style={m.eliminado ? { opacity: 0.55 } : undefined}>
                  <td className="num whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => void guardar(m.modelo, { prioridad: Math.max(0, m.prioridad - 1) })}
                      disabled={soloLectura || m.prioridad <= 0}
                      className="px-1 disabled:opacity-30"
                      title="Bajar prioridad"
                    >
                      ▼
                    </button>
                    <span className="cifra px-1">{m.prioridad}</span>
                    <button
                      type="button"
                      onClick={() => void guardar(m.modelo, { prioridad: Math.min(5, m.prioridad + 1) })}
                      disabled={soloLectura || m.prioridad >= 5}
                      className="px-1 disabled:opacity-30"
                      title="Subir prioridad"
                    >
                      ▲
                    </button>
                  </td>
                  <td className="font-medium whitespace-nowrap">
                    {m.modelo} <Marca estado={estado[m.modelo]} />
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                        style={{
                          background: m.activo
                            ? "color-mix(in oklab, var(--estado-bien) 18%, transparent)"
                            : "color-mix(in oklab, var(--estado-alerta) 18%, transparent)",
                        }}
                      >
                        {m.activo ? "Activo" : "Inactivo"}
                      </span>
                      <span className="text-xs" style={{ color: "var(--ink-2)" }}>
                        {m.activos}/{m.skus} SKUs
                      </span>
                      {m.nuevo ? (
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                          style={{
                            background: "color-mix(in oklab, var(--acento) 18%, transparent)",
                            color: "var(--acento)",
                          }}
                        >
                          Nuevo
                        </span>
                      ) : null}
                    </div>
                    {m.titulo ? (
                      <div
                        className="mt-0.5 max-w-[26rem] truncate text-xs"
                        style={{ color: "var(--ink-muted)" }}
                        title={m.titulo}
                      >
                        {m.titulo}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <select
                      value={m.categoria ?? ""}
                      disabled={soloLectura}
                      onChange={(e) => void guardar(m.modelo, { categoria: e.target.value || null })}
                      className="rounded border px-2 py-1 text-sm"
                      style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                    >
                      <option value="">—</option>
                      {cats.map((c) => (
                        <option key={c.nombre} value={c.nombre}>
                          {c.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <Palomeo
                      valor={m.imagenes}
                      deshabilitado={soloLectura}
                      onCambio={(v) => void guardar(m.modelo, { imagenes: v })}
                    />
                  </td>
                  <td>
                    <Palomeo
                      valor={m.aplus}
                      deshabilitado={soloLectura}
                      onCambio={(v) => void guardar(m.modelo, { aplus: v })}
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={m.notas}
                      disabled={soloLectura}
                      onBlur={(e) => {
                        if (e.target.value !== m.notas) void guardar(m.modelo, { notas: e.target.value });
                      }}
                      placeholder="—"
                      className="w-full min-w-[9rem] rounded border px-2 py-1 text-sm"
                      style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                    />
                  </td>
                  <td>
                    {m.url ? (
                      <span className="flex items-center gap-2">
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm underline"
                          style={{ color: "var(--acento)" }}
                        >
                          Ver ↗
                        </a>
                        {m.padresExtra.map((p, i) => (
                          <a
                            key={p}
                            href={`https://www.amazon.com.mx/dp/${p}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs underline"
                            style={{ color: "var(--ink-2)" }}
                            title="Este modelo tiene más de una publicación"
                          >
                            +{i + 2}
                          </a>
                        ))}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                        sin ASIN
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => void descargar(m.modelo)}
                      disabled={zip !== null}
                      className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                      style={{ borderColor: "var(--borde)", color: "var(--ink-2)" }}
                    >
                      {zip === m.modelo ? "armando…" : "ZIP"}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => void guardar(m.modelo, { eliminado: !m.eliminado })}
                      disabled={soloLectura}
                      className="text-xs underline disabled:opacity-50"
                      style={{ color: "var(--ink-2)" }}
                    >
                      {m.eliminado ? "Restaurar" : "Quitar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="border-t p-3 text-xs hairline" style={{ color: "var(--ink-2)" }}>
          {visibles.length} de {filas.filter((m) => verEliminados || !m.eliminado).length} modelos
        </footer>
      </section>
    </div>
  );
}
