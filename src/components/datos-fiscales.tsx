"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Sección de datos fiscales: SOLO los SKUs que no tienen la información
 * cargada en MELI, agrupados por modelo. La captura es por modelo (misma
 * clave SAT, IVA y unidad para todos sus colores y tallas) y el envío corre
 * en segundo plano; aquí se ve avanzar la cola.
 *
 * La sugerencia por modelo es dato real: lo que otro color o talla del mismo
 * modelo ya tiene cargado en MELI. Nada se inventa.
 */

interface Resumen {
  catalogo: number;
  leidos: number;
  sinLeer: number;
  sinDatos: number;
  pendientes: number;
  errores: number;
}

interface ModeloFiscal {
  modelo: string;
  titulo: string | null;
  totalSkus: number;
  sinLeer: number;
  sinDatos: number;
  pendientes: number;
  errores: number;
  ultimoError: string | null;
  satSugerido: string | null;
  ivaSugerida: string | null;
  iepsSugerido: number | null;
  unidadSugerida: string | null;
  sugerenciaDe: "modelo" | "parecidos" | "catalogo" | null;
}

interface Captura {
  sat: string;
  iva: string;
  ieps: string;
  unidad: string;
}

const UNIDADES = [
  { clave: "H87", texto: "H87 — pieza" },
  { clave: "XPR", texto: "XPR — par" },
  { clave: "EA", texto: "EA — elemento" },
];

export function DatosFiscales() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [modelos, setModelos] = useState<ModeloFiscal[]>([]);
  const [captura, setCaptura] = useState<Record<string, Captura>>({});
  const [estado, setEstado] = useState<Record<string, "guardando" | "ok" | "error">>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [leyendo, setLeyendo] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoEncendido = useRef(false);

  const encender = useCallback(async () => {
    const r = await fetch("/api/fiscal/procesar");
    if (!r.ok) throw new Error((await r.json())?.error ?? "No se pudo encender la lectura.");
  }, []);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/fiscal");
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo cargar el resumen.");
      setResumen(j.resumen);
      setModelos(j.modelos);
      setMensaje(null);

      // "Trabajando" lo dice el servidor (bitácora del proceso), no el hecho
      // de que haya trabajo: confundirlos dejaba el botón apagado y el
      // proceso sin arrancar jamás.
      const hayTrabajo = j.resumen.sinLeer > 0 || j.resumen.pendientes > 0;
      setLeyendo(Boolean(j.trabajando));

      // Ver al proceso trabajando re-arma el auto-encendido: si al terminar
      // queda (o llega) más trabajo, la página lo vuelve a encender sola.
      // Nunca puede martillar: cada encendido extra exige haber visto antes
      // una corrida viva.
      if (j.trabajando) autoEncendido.current = false;

      // Si hay trabajo y nadie lo está haciendo, se enciende solo UNA vez
      // por visita; si el proceso muere, el botón queda vivo para relanzar.
      if (hayTrabajo && !j.trabajando && !autoEncendido.current) {
        autoEncendido.current = true;
        try {
          await encender();
          setLeyendo(true);
        } catch {
          // El botón sigue disponible para encenderlo a mano.
        }
      }

      if (reloj.current) clearTimeout(reloj.current);
      if (hayTrabajo || j.trabajando) reloj.current = setTimeout(cargar, 6000);
      return j.resumen as Resumen;
    } catch (err) {
      setMensaje((err as Error).message);
      return null;
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

  const leerDeMeli = async () => {
    setLeyendo(true);
    setMensaje(null);
    try {
      await encender();
      if (reloj.current) clearTimeout(reloj.current);
      reloj.current = setTimeout(cargar, 4000);
    } catch (err) {
      setMensaje((err as Error).message);
      setLeyendo(false);
    }
  };

  const valoresDe = (m: ModeloFiscal): Captura =>
    captura[m.modelo] ?? {
      sat: m.satSugerido ?? "",
      iva: m.ivaSugerida ?? "16",
      ieps: String(m.iepsSugerido ?? 0),
      unidad: m.unidadSugerida ?? "H87",
    };

  const actualizar = (m: ModeloFiscal, cambios: Partial<Captura>) => {
    setCaptura((c) => ({ ...c, [m.modelo]: { ...valoresDe(m), ...cambios } }));
  };

  const rellenar = async (m: ModeloFiscal) => {
    const v = valoresDe(m);
    setEstado((e) => ({ ...e, [m.modelo]: "guardando" }));
    try {
      const r = await fetch("/api/fiscal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelo: m.modelo,
          sat: v.sat.trim(),
          iva: v.iva,
          ieps: Number(v.ieps || 0),
          unidad: v.unidad,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "error");
      setEstado((e) => ({ ...e, [m.modelo]: "ok" }));
      await cargar();
    } catch (err) {
      setEstado((e) => ({ ...e, [m.modelo]: "error" }));
      setMensaje((err as Error).message);
    }
  };

  const visibles = modelos.filter((m) => {
    const q = busqueda.trim().toUpperCase();
    if (!q) return true;
    return m.modelo.toUpperCase().includes(q) || (m.titulo ?? "").toUpperCase().includes(q);
  });

  const conSugerencia = visibles.filter(
    (m) => m.sinDatos > 0 && /^\d{8}$/.test(valoresDe(m).sat.trim()),
  );

  const rellenarTodos = async () => {
    for (const m of conSugerencia) {
      // Secuencial a propósito: cada POST encola y el proceso de fondo manda.
      // eslint-disable-next-line no-await-in-loop
      await rellenar(m);
    }
  };

  if (cargando) {
    return (
      <section className="tarjeta p-6 text-sm" style={{ color: "var(--ink-2)" }}>
        Cargando datos fiscales…
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {resumen ? (
        <section className="tarjeta flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <Dato etiqueta="SKUs en catálogo" valor={resumen.catalogo} />
          <Dato etiqueta="Leídos de MELI" valor={resumen.leidos} />
          <Dato etiqueta="Sin leer" valor={resumen.sinLeer} alerta={resumen.sinLeer > 0} />
          <Dato etiqueta="Sin datos fiscales" valor={resumen.sinDatos} alerta={resumen.sinDatos > 0} />
          <Dato etiqueta="En cola" valor={resumen.pendientes} />
          <Dato etiqueta="Errores" valor={resumen.errores} alerta={resumen.errores > 0} />
          <span className="ml-auto flex items-center gap-2">
            {leyendo ? (
              <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                trabajando en segundo plano…
              </span>
            ) : null}
            <button
              onClick={leerDeMeli}
              disabled={leyendo}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            >
              Leer catálogo de MELI
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
            onClick={rellenarTodos}
            disabled={!conSugerencia.length}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--acento)" }}
            title="Encola todos los modelos visibles con su clave sugerida (heredada del propio modelo, de los modelos parecidos o del catálogo) o la que hayas capturado. Puedes corregir cualquier renglón antes de confirmar."
          >
            Confirmar y rellenar los {conSugerencia.length} modelos
          </button>
        </header>

        {visibles.length === 0 ? (
          <p className="p-6 text-sm" style={{ color: "var(--ink-2)" }}>
            {resumen && resumen.sinLeer > 0
              ? "Todavía no se lee todo el catálogo: usa «Leer catálogo de MELI» y espera a que termine."
              : "No hay SKUs sin datos fiscales. Todo el catálogo leído tiene su información cargada."}
          </p>
        ) : (
          <div className="max-h-[40rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Producto</th>
                  <th className="num">Sin datos</th>
                  <th>Clave SAT</th>
                  <th>IVA %</th>
                  <th className="num">IEPS %</th>
                  <th>Unidad</th>
                  <th></th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((m) => {
                  const v = valoresDe(m);
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
                        {m.sinDatos}
                        <span style={{ color: "var(--ink-muted)" }}> / {m.totalSkus}</span>
                      </td>
                      <td>
                        <input
                          value={v.sat}
                          onChange={(e) => actualizar(m, { sat: e.target.value })}
                          placeholder="8 dígitos"
                          className="cifra w-28 rounded-lg border px-2 py-1 text-sm"
                          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                          title={
                            m.satSugerido
                              ? `Sugerido: ${m.satSugerido} (${
                                  m.sugerenciaDe === "modelo"
                                    ? "ya cargado en otro SKU de este modelo"
                                    : m.sugerenciaDe === "parecidos"
                                      ? "lo más usado en los modelos parecidos"
                                      : "lo más usado en tu catálogo — revisa que aplique"
                                })`
                              : "Clave del catálogo c_ClaveProdServ del SAT"
                          }
                        />
                        {m.sugerenciaDe && m.sugerenciaDe !== "modelo" ? (
                          <div className="text-[10px]" style={{ color: "var(--ink-muted)" }}>
                            {m.sugerenciaDe === "parecidos"
                              ? "de los modelos parecidos"
                              : "del catálogo: revísala"}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <select
                          value={v.iva}
                          onChange={(e) => actualizar(m, { iva: e.target.value })}
                          className="rounded-lg border px-2 py-1 text-sm"
                          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                        >
                          <option value="16">16</option>
                          <option value="8">8</option>
                          <option value="0">0</option>
                        </select>
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={v.ieps}
                          onChange={(e) => actualizar(m, { ieps: e.target.value })}
                          className="cifra w-16 rounded-lg border px-2 py-1 text-right text-sm"
                          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                        />
                      </td>
                      <td>
                        <select
                          value={v.unidad}
                          onChange={(e) => actualizar(m, { unidad: e.target.value })}
                          className="rounded-lg border px-2 py-1 text-sm"
                          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                        >
                          {UNIDADES.map((u) => (
                            <option key={u.clave} value={u.clave}>
                              {u.texto}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          onClick={() => rellenar(m)}
                          disabled={st === "guardando" || !m.sinDatos}
                          className="rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-50"
                          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                        >
                          Rellenar {m.sinDatos || m.errores}
                        </button>
                      </td>
                      <td className="text-xs">
                        {st === "guardando" ? (
                          <span style={{ color: "var(--ink-muted)" }}>…</span>
                        ) : m.pendientes ? (
                          <span style={{ color: "var(--ink-2)" }}>
                            {m.pendientes} en cola
                          </span>
                        ) : m.errores ? (
                          <span
                            style={{ color: "var(--estado-critico)" }}
                            title={m.ultimoError ?? ""}
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
