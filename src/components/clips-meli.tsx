"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Sección de Clips: por modelo (así agrupa el agrupador de variantes), qué
 * publicaciones activas tienen clip y a cuáles se les puede aplicar el video
 * de una hermana de la misma publicación agrupada. El escaneo y la subida
 * corren en segundo plano; aquí se revisa y se acepta con un botón.
 *
 * Nada se aplica solo: el botón encola y el proceso de fondo descarga el
 * video de la hermana y lo sube a MELI, que lo pasa por moderación.
 */

interface Resumen {
  activas: number;
  conClip: number;
  sinClip: number;
  sinLeer: number;
  enCola: number;
  errores: number;
  aplicables: number;
}

interface ItemClip {
  itemId: string;
  color: string | null;
  estado: string; // sin_leer | ok | sin_clip | pendiente | error
  ultimoError: string | null;
}

interface ModeloClips {
  modelo: string;
  titulo: string | null;
  activos: number;
  conClip: number;
  sinClip: number;
  sinLeer: number;
  enCola: number;
  errores: number;
  aplicables: number;
  origen: "hermana" | "erp" | null;
  items: ItemClip[];
}

const PUNTO: Record<string, { color: string; texto: string }> = {
  ok: { color: "var(--exito-texto, #2f9e44)", texto: "con clip" },
  sin_clip: { color: "var(--estado-critico, #c9564b)", texto: "sin clip" },
  pendiente: { color: "var(--ambar, #e8a33d)", texto: "en cola para subir" },
  error: { color: "var(--estado-critico, #c9564b)", texto: "error" },
  sin_leer: { color: "var(--ink-muted, #999)", texto: "sin escanear" },
};

export function ClipsMeli() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [modelos, setModelos] = useState<ModeloClips[]>([]);
  const [estado, setEstado] = useState<Record<string, "aplicando" | "ok" | "error">>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoEncendido = useRef(false);

  const encender = useCallback(async () => {
    const r = await fetch("/api/clips/procesar");
    if (!r.ok) throw new Error((await r.json())?.error ?? "No se pudo encender el proceso.");
  }, []);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/clips");
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo cargar el resumen.");
      setResumen(j.resumen);
      setModelos(j.modelos);
      setMensaje(j.procesoError ?? null);

      // "Trabajando" lo dice el servidor (bitácora del proceso), no el hecho
      // de que haya trabajo: confundirlos deja el botón apagado para siempre.
      const hayTrabajo = j.resumen.sinLeer > 0 || j.resumen.enCola > 0;
      setTrabajando(Boolean(j.trabajando));

      // Ver al proceso trabajando re-arma el auto-encendido: si al terminar
      // queda más trabajo, la página lo vuelve a encender sola.
      if (j.trabajando) autoEncendido.current = false;

      // Con la última corrida muerta no se relanza solo: repetiría el mismo
      // golpe. El botón queda vivo para reintentar a mano.
      if (hayTrabajo && !j.trabajando && !j.procesoError && !autoEncendido.current) {
        autoEncendido.current = true;
        try {
          await encender();
          setTrabajando(true);
        } catch {
          // El botón sigue disponible para encenderlo a mano.
        }
      }

      if (reloj.current) clearTimeout(reloj.current);
      if (hayTrabajo || j.trabajando) reloj.current = setTimeout(cargar, 6000);
    } catch (err) {
      setMensaje((err as Error).message);
    } finally {
      setCargando(false);
    }
  }, [encender]);

  useEffect(() => {
    cargar();
    return () => {
      if (reloj.current) clearTimeout(reloj.current);
    };
  }, [cargar]);

  const escanear = async () => {
    setTrabajando(true);
    setMensaje(null);
    try {
      const r = await fetch("/api/clips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accion: "escanear" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo escanear.");
      // Encender también desde el navegador: este camino lleva la sesión y
      // funciona aunque el disparo de servidor a servidor no prenda.
      await encender();
      if (reloj.current) clearTimeout(reloj.current);
      reloj.current = setTimeout(cargar, 4000);
    } catch (err) {
      setMensaje((err as Error).message);
      setTrabajando(false);
    }
  };

  const aplicar = async (modelo?: string) => {
    const clave = modelo ?? "*";
    setEstado((e) => ({ ...e, [clave]: "aplicando" }));
    setMensaje(null);
    try {
      const r = await fetch("/api/clips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accion: "aplicar", ...(modelo ? { modelos: [modelo] } : {}) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo encolar.");
      if (j.encolados === 0 && j.mensaje) setMensaje(j.mensaje);
      if (j.encolados > 0) await encender();
      setEstado((e) => ({ ...e, [clave]: "ok" }));
      await cargar();
    } catch (err) {
      setEstado((e) => ({ ...e, [clave]: "error" }));
      setMensaje((err as Error).message);
    }
  };

  const visibles = modelos.filter((m) => {
    const q = busqueda.trim().toUpperCase();
    if (!q) return true;
    return m.modelo.toUpperCase().includes(q) || (m.titulo ?? "").toUpperCase().includes(q);
  });

  const totalAplicable = visibles.reduce((s, m) => s + m.aplicables, 0);

  if (cargando) {
    return (
      <section className="tarjeta p-6 text-sm" style={{ color: "var(--ink-2)" }}>
        Cargando clips…
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {resumen ? (
        <section className="tarjeta flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <Dato etiqueta="Publicaciones activas" valor={resumen.activas} />
          <Dato etiqueta="Con clip" valor={resumen.conClip} />
          <Dato etiqueta="Sin clip" valor={resumen.sinClip} alerta={resumen.sinClip > 0} />
          <Dato etiqueta="Sin escanear" valor={resumen.sinLeer} alerta={resumen.sinLeer > 0} />
          <Dato etiqueta="En cola" valor={resumen.enCola} />
          <Dato etiqueta="Errores" valor={resumen.errores} alerta={resumen.errores > 0} />
          <span className="ml-auto flex items-center gap-2">
            {trabajando ? (
              <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                trabajando en segundo plano…
              </span>
            ) : null}
            <button
              onClick={escanear}
              disabled={trabajando}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
              title="Vuelve a preguntar a MELI qué publicaciones activas tienen clip. Tarda unos minutos; avanza solo."
            >
              Escanear clips de MELI
            </button>
          </span>
        </section>
      ) : null}

      {mensaje ? (
        <p
          className="rounded-lg p-3 text-sm"
          style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
        >
          {mensaje}
        </p>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b p-4 hairline">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar modelo o producto…"
            className="min-w-[16rem] flex-1 rounded-lg border px-2 py-1.5 text-sm"
            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          />
          <button
            onClick={() => aplicar()}
            disabled={!totalAplicable || estado["*"] === "aplicando"}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--acento)" }}
            title="Encola todas las publicaciones sin clip que tienen una hermana con video (o un video del ERP). La subida corre en segundo plano y MELI la modera."
          >
            Aplicar videos a las {totalAplicable} publicaciones
          </button>
        </header>

        {visibles.length === 0 ? (
          <p className="p-6 text-sm" style={{ color: "var(--ink-2)" }}>
            {resumen && resumen.sinLeer > 0
              ? "Todavía se está escaneando el catálogo: espera a que termine para ver qué falta."
              : resumen && resumen.sinClip > 0
                ? "Hay publicaciones sin clip, pero ninguna hermana de su modelo tiene un video con URL descargable ni hay video del ERP. Sube el clip a una variante del modelo (o genera un video en la sección Videos) y vuelve a escanear."
                : "Todas las publicaciones activas escaneadas tienen su clip. Nada que hacer."}
          </p>
        ) : (
          <div className="max-h-[44rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Producto</th>
                  <th className="num">Con clip</th>
                  <th>Variantes (cada punto es una publicación)</th>
                  <th>Fuente del video</th>
                  <th></th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((m) => {
                  const st = estado[m.modelo];
                  return (
                    <tr key={m.modelo}>
                      <td className="font-medium">{m.modelo}</td>
                      <td
                        className="max-w-64 truncate text-xs"
                        style={{ color: "var(--ink-2)" }}
                        title={m.titulo ?? ""}
                      >
                        {m.titulo ?? "—"}
                      </td>
                      <td className="num cifra">
                        {m.conClip}
                        <span style={{ color: "var(--ink-muted)" }}> / {m.activos}</span>
                      </td>
                      <td>
                        <span className="flex max-w-80 flex-wrap gap-1">
                          {m.items.map((i) => {
                            const p = PUNTO[i.estado] ?? PUNTO.sin_leer;
                            return (
                              <span
                                key={i.itemId}
                                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]"
                                style={{ borderColor: "var(--borde)" }}
                                title={`${i.itemId} — ${p.texto}${i.ultimoError ? `: ${i.ultimoError}` : ""}`}
                              >
                                <span
                                  className="inline-block h-2 w-2 rounded-full"
                                  style={{ background: p.color }}
                                />
                                {i.color ?? i.itemId.slice(-4)}
                              </span>
                            );
                          })}
                        </span>
                      </td>
                      <td className="text-xs" style={{ color: "var(--ink-2)" }}>
                        {m.aplicables
                          ? m.origen === "erp"
                            ? "video del ERP"
                            : "clip de una hermana"
                          : m.sinClip
                            ? "sin video disponible"
                            : "—"}
                      </td>
                      <td>
                        <button
                          onClick={() => aplicar(m.modelo)}
                          disabled={!m.aplicables || st === "aplicando"}
                          className="rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-50"
                          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                          title="Encola estas publicaciones para subirles el video en segundo plano."
                        >
                          Aplicar a {m.aplicables}
                        </button>
                      </td>
                      <td className="text-xs">
                        {st === "aplicando" ? (
                          <span style={{ color: "var(--ink-muted)" }}>…</span>
                        ) : m.enCola ? (
                          <span style={{ color: "var(--ink-2)" }}>{m.enCola} en cola</span>
                        ) : m.errores ? (
                          <span
                            style={{ color: "var(--estado-critico)" }}
                            title={m.items.find((i) => i.ultimoError)?.ultimoError ?? ""}
                          >
                            {m.errores} con error
                          </span>
                        ) : st === "ok" ? (
                          <span style={{ color: "var(--exito-texto)" }}>✓ encolado</span>
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
        )}
      </section>
    </div>
  );
}

function Dato({
  etiqueta,
  valor,
  alerta,
}: {
  etiqueta: string;
  valor: number;
  alerta?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <strong
        className="cifra text-base"
        style={{ color: alerta ? "var(--estado-critico)" : undefined }}
      >
        {valor}
      </strong>
      <span className="text-xs" style={{ color: "var(--ink-2)" }}>
        {etiqueta}
      </span>
    </span>
  );
}
