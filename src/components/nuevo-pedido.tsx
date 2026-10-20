"use client";

/**
 * Nuevo pedido a China: se pega la lista que se le manda a la fábrica, sale
 * un BORRADOR por modelo con su IN, se revisa (fábrica, precios, cajas) y al
 * confirmar se da de alta y se manda por correo con el Excel en el formato
 * de la fábrica. Ver `servicios/pedidos-borradores.ts`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Borrador, AjustesPedidos, OpcionFabrica } from "@/lib/servicios/pedidos-borradores";
import type { LineaBorrador } from "@/lib/pedidos-china/armar";
import { totalesDeBorrador } from "@/lib/pedidos-china/armar";
import { confirmar } from "@/components/ui/confirmar";

type Moneda = "USD" | "RMB";

const EJEMPLO = `GT179 CTNS OF 12
BROWN
26	22
27	26

GT181 BLK
CTNS OF 12
25	12
26	8`;

function dinero(n: number | null | undefined, m: Moneda | null): string {
  if (n == null) return "—";
  const s = n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${m === "RMB" ? "¥" : "$"}${s}${m ? ` ${m}` : ""}`;
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

async function llamar<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/pedidos/borradores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j as T;
}

export function NuevoPedido() {
  const [cargando, setCargando] = useState(true);
  const [borradores, setBorradores] = useState<Borrador[]>([]);
  const [ajustes, setAjustes] = useState<AjustesPedidos | null>(null);
  const [fabricas, setFabricas] = useState<OpcionFabrica[]>([]);
  const [siguiente, setSiguiente] = useState<number | null>(null);
  const [texto, setTexto] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinEntender, setSinEntender] = useState<string[]>([]);

  const recargar = useCallback(async () => {
    const r = await fetch("/api/pedidos/borradores");
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "No se pudieron leer los borradores.");
    setBorradores(j.borradores);
    setAjustes(j.ajustes);
    setFabricas(j.fabricas);
    setSiguiente(j.siguiente);
  }, []);

  useEffect(() => {
    recargar()
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }, [recargar]);

  async function armar() {
    setTrabajando(true);
    setError(null);
    try {
      const r = await llamar<{ creados: Borrador[]; sinEntender: string[] }>({ accion: "armar", texto });
      setSinEntender(r.sinEntender);
      setTexto("");
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  }

  const reemplazar = (b: Borrador) => setBorradores((xs) => xs.map((x) => (x.id === b.id ? b : x)));
  const vivos = borradores.filter((b) => b.estado === "borrador");
  const confirmados = borradores.filter((b) => b.estado === "confirmado");

  return (
    <div className="flex flex-col gap-4">
      {error ? <div className="aviso aviso-critico">{error}</div> : null}

      <section className="tarjeta p-4">
        <h2 className="seccion-titulo">Pega la lista del pedido</h2>
        <p className="texto-2 mt-1 text-[13px]">
          Un bloque por modelo: el modelo (con el color y «CTNS OF 12» si quieres), el color y luego «talla cajas».
          Para corridas: las tallas en una línea y los pares con «x 20» cajas, o «misma corrida x 20». Cada modelo sale en
          su propio pedido{siguiente ? `, empezando en IN${siguiente}` : ""}; los modelos de una familia (los que se piden
          juntos en Planeación de compras) salen en uno solo.
        </p>
        <textarea
          className="mt-3 w-full font-mono text-[13px]"
          rows={10}
          placeholder={EJEMPLO}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="boton boton-primario" disabled={trabajando || !texto.trim()} onClick={armar}>
            {trabajando ? "Armando…" : "Armar borradores"}
          </button>
        </div>
        {sinEntender.length ? (
          <div className="aviso aviso-alerta mt-3">
            No entendí: {sinEntender.join(" · ")}
          </div>
        ) : null}
      </section>

      {cargando ? <div className="texto-tenue text-sm">Cargando…</div> : null}

      {vivos.map((b) => (
        <TarjetaBorrador
          key={b.id}
          b={b}
          fabricas={fabricas}
          destinatarios={ajustes?.destinatarios ?? []}
          alCambiar={reemplazar}
          alQuitar={() => setBorradores((xs) => xs.filter((x) => x.id !== b.id))}
          alConfirmar={(nb) => reemplazar(nb)}
        />
      ))}

      {confirmados.length ? (
        <section className="tarjeta overflow-hidden">
          <header className="seccion-cabeza">
            <h2 className="seccion-titulo">Confirmados</h2>
          </header>
          <div className="overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Modelo</th>
                  <th>Fábrica</th>
                  <th className="num">Cajas</th>
                  <th className="num">Pares</th>
                  <th className="num">Importe</th>
                  <th>Correo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {confirmados.map((b) => (
                  <FilaConfirmado key={b.id} b={b} alCambiar={reemplazar} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {ajustes ? <Ajustes ajustes={ajustes} alGuardar={(a) => setAjustes(a)} /> : null}
    </div>
  );
}

function FilaConfirmado({ b, alCambiar }: { b: Borrador; alCambiar: (b: Borrador) => void }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function reenviar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await llamar<{ borrador: Borrador }>({ accion: "correo", id: b.id });
      alCambiar(r.borrador);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <tr>
      <td className="font-medium">{b.pedido}</td>
      <td>{b.modelo}</td>
      <td className="text-xs">{b.proveedor ?? "—"}</td>
      <td className="num cifra">{n(b.totales.cajas)}</td>
      <td className="num cifra">{n(b.totales.pares)}</td>
      <td className="num cifra">{dinero(b.totales.importe, b.moneda)}</td>
      <td className="text-xs">
        {b.correo?.enviado ? (
          <span>Enviado a {b.correo.para.join(", ")}</span>
        ) : (
          <span style={{ color: "var(--critico-texto)" }}>No salió: {b.correo?.motivo ?? "sin intento"}</span>
        )}
        {b.correo?.etiquetas ? (
          <div className="texto-tenue">Sin etiquetas adjuntas: {b.correo.etiquetas}</div>
        ) : null}
        {error ? <div style={{ color: "var(--critico-texto)" }}>{error}</div> : null}
      </td>
      <td className="whitespace-nowrap">
        <a className="boton boton-borde boton-chico" href={`/api/pedidos/borradores/${b.id}/excel`}>
          Excel
        </a>{" "}
        <button className="boton boton-borde boton-chico" disabled={enviando} onClick={reenviar}>
          {enviando ? "Enviando…" : "Reenviar"}
        </button>
      </td>
    </tr>
  );
}

function TarjetaBorrador({
  b,
  fabricas,
  destinatarios,
  alCambiar,
  alQuitar,
  alConfirmar,
}: {
  b: Borrador;
  fabricas: OpcionFabrica[];
  destinatarios: string[];
  alCambiar: (b: Borrador) => void;
  alQuitar: () => void;
  alConfirmar: (b: Borrador) => void;
}) {
  const [lineas, setLineas] = useState<LineaBorrador[]>(b.lineas);
  const [descripcion, setDescripcion] = useState(b.descripcion);
  const [sucio, setSucio] = useState(false);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLineas(b.lineas);
    setDescripcion(b.descripcion);
    setSucio(false);
  }, [b]);

  const totales = useMemo(() => totalesDeBorrador(lineas), [lineas]);

  async function hacer(nombre: string, cuerpo: Record<string, unknown>, despues?: (r: { borrador?: Borrador }) => void) {
    setTrabajando(nombre);
    setError(null);
    try {
      const r = await llamar<{ borrador?: Borrador }>({ id: b.id, ...cuerpo });
      if (despues) despues(r);
      else if (r.borrador) alCambiar(r.borrador);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(null);
    }
  }

  const guardar = () => hacer("guardar", { accion: "actualizar", lineas, descripcion });

  function cambiarLinea(i: number, cambio: Partial<LineaBorrador>) {
    setLineas((ls) => ls.map((l, k) => (k === i ? { ...l, ...cambio } : l)));
    setSucio(true);
  }

  function numero(v: string): number | null {
    if (!v.trim()) return null;
    const x = Number(v.replace(",", "."));
    return Number.isFinite(x) ? x : null;
  }

  const faltan = sucio ? [] : b.faltantes;
  // Borrador de FAMILIA (GT117…GT122): cada renglón dice de qué modelo es.
  const familia = lineas.some((l) => l.modelo);

  return (
    <section className="tarjeta p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--acento)" }}>
            Borrador
          </div>
          <h2 className="text-lg font-semibold">
            {b.pedido} · {b.modelo}
          </h2>
          {familia ? (
            <div className="texto-2 text-xs">Familia: {[...new Set(lineas.map((l) => l.modelo).filter(Boolean))].join(", ")}</div>
          ) : null}
        </div>
        <div className="texto-2 text-sm">
          {n(totales.cajas)} cajas · {n(totales.pares)} pares · {dinero(totales.importe, b.moneda)}
          {totales.cbm != null ? ` · ≈ ${totales.cbm.toFixed(2)} CBM` : ""}
          {totales.cajasSinMedida ? ` (${n(totales.cajasSinMedida)} cajas sin medida)` : ""}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          Fábrica
          <select
            value={b.fabrica ?? ""}
            disabled={Boolean(trabajando)}
            onChange={(e) => hacer("fabrica", { accion: "actualizar", fabrica: e.target.value || null })}
          >
            <option value="">Sin fábrica (Excel sencillo)</option>
            {fabricas.map((f) => (
              <option key={f.clave} value={f.clave}>
                {f.nombre}
                {f.formatoPropio ? "" : " (formato sencillo)"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Moneda
          <select
            value={b.moneda ?? ""}
            disabled={Boolean(trabajando)}
            onChange={(e) => hacer("moneda", { accion: "actualizar", moneda: e.target.value || null })}
          >
            <option value="">—</option>
            <option value="USD">USD</option>
            <option value="RMB">RMB</option>
          </select>
        </label>
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs">
          Descripción
          <input
            value={descripcion}
            onChange={(e) => {
              setDescripcion(e.target.value);
              setSucio(true);
            }}
            placeholder="BOTA CABALLERO"
          />
        </label>
      </div>

      {b.avisos.length ? (
        <div className="aviso aviso-alerta mt-3 text-[13px]">
          {b.avisos.map((a, i) => (
            <div key={i}>{a}</div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              {familia ? <th>Modelo</th> : null}
              <th>Color</th>
              <th>Talla / corrida</th>
              <th className="num">Cajas</th>
              <th className="num">Pares x caja</th>
              <th className="num">Pares</th>
              <th className="num">Precio ({b.moneda ?? "?"})</th>
              <th className="num">Importe</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => {
              const t = totalesDeBorrador([l]);
              return (
                <tr key={i}>
                  {familia ? <td className="font-medium">{l.modelo}</td> : null}
                  <td>
                    <input className="w-36" value={l.color} onChange={(e) => cambiarLinea(i, { color: e.target.value.toUpperCase() })} />
                  </td>
                  <td className="text-xs">
                    {l.unitalla
                      ? `Talla ${l.unitalla}`
                      : Object.entries(l.corrida)
                          .map(([talla, x]) => `${talla}×${x}`)
                          .join("  ")}
                  </td>
                  <td className="num">
                    <input
                      className="w-20 text-right"
                      inputMode="numeric"
                      value={l.cajas || ""}
                      onChange={(e) => cambiarLinea(i, { cajas: Math.max(0, Math.round(numero(e.target.value) ?? 0)) })}
                    />
                  </td>
                  <td className="num">
                    {l.unitalla ? (
                      <input
                        className="w-16 text-right"
                        inputMode="numeric"
                        value={l.paresPorCaja || ""}
                        onChange={(e) => cambiarLinea(i, { paresPorCaja: Math.max(0, Math.round(numero(e.target.value) ?? 0)) })}
                      />
                    ) : (
                      <span className="cifra">{l.paresPorCaja}</span>
                    )}
                  </td>
                  <td className="num cifra">{n(t.pares)}</td>
                  <td className="num">
                    {l.preciosTalla ? (
                      <div className="flex flex-wrap justify-end gap-1">
                        {Object.keys(l.corrida).map((talla) => (
                          <label key={talla} className="flex items-center gap-1 text-[11px]">
                            {talla}
                            <input
                              className="w-16 text-right"
                              inputMode="decimal"
                              value={l.preciosTalla?.[talla] ?? ""}
                              onChange={(e) => {
                                const p = numero(e.target.value);
                                const pt = { ...(l.preciosTalla ?? {}) };
                                if (p == null) delete pt[talla];
                                else pt[talla] = p;
                                cambiarLinea(i, { preciosTalla: pt });
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    ) : (
                      <input
                        className="w-24 text-right"
                        inputMode="decimal"
                        value={l.precio ?? ""}
                        style={l.precio == null ? { borderColor: "var(--estado-critico)" } : undefined}
                        onChange={(e) => cambiarLinea(i, { precio: numero(e.target.value), precioDe: null })}
                      />
                    )}
                    {l.precioDe ? <div className="texto-tenue text-[11px]">de {l.precioDe}</div> : null}
                  </td>
                  <td className="num cifra">{dinero(t.importe, null)}</td>
                  <td>
                    <button
                      className="boton boton-fantasma boton-chico"
                      title="Quitar renglón"
                      onClick={() => {
                        setLineas((ls) => ls.filter((_, k) => k !== i));
                        setSucio(true);
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {faltan.length ? (
        <div className="aviso aviso-critico mt-3 text-[13px]">Para confirmar falta {faltan.join(", ")}.</div>
      ) : null}
      {error ? <div className="aviso aviso-critico mt-3 text-[13px]">{error}</div> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {sucio ? (
          <button className="boton boton-primario" disabled={Boolean(trabajando)} onClick={guardar}>
            {trabajando === "guardar" ? "Guardando…" : "Guardar cambios"}
          </button>
        ) : (
          <button
            className="boton boton-primario"
            disabled={Boolean(trabajando) || b.faltantes.length > 0}
            title={destinatarios.length ? `Se manda a ${destinatarios.join(", ")}` : "No hay correos en «Mandar a»"}
            onClick={() => hacer("confirmar", { accion: "confirmar" }, (r) => r.borrador && alConfirmar(r.borrador))}
          >
            {trabajando === "confirmar" ? "Confirmando…" : "Confirmar y mandar por correo"}
          </button>
        )}
        <a className="boton boton-borde" href={`/api/pedidos/borradores/${b.id}/excel`} aria-disabled={sucio || !b.fabrica}>
          Descargar Excel
        </a>
        <button
          className="boton boton-peligro"
          disabled={Boolean(trabajando)}
          onClick={async () => {
            if (await confirmar({ titulo: `¿Descartar el borrador ${b.pedido} (${b.modelo})?`, confirmar: "Descartar", peligro: true }))
              hacer("descartar", { accion: "descartar" }, () => alQuitar());
          }}
        >
          Descartar
        </button>
        <span className="texto-tenue text-xs">
          {destinatarios.length ? `Al confirmar se manda a ${destinatarios.join(", ")}` : "Agrega los correos en «Mandar a» (abajo)"}
        </span>
      </div>

      <details className="mt-3">
        <summary className="texto-tenue cursor-pointer text-xs">Lista original</summary>
        <pre className="texto-2 mt-1 whitespace-pre-wrap text-xs">{b.texto}</pre>
      </details>
    </section>
  );
}

function Ajustes({ ajustes, alGuardar }: { ajustes: AjustesPedidos; alGuardar: (a: AjustesPedidos) => void }) {
  const [correos, setCorreos] = useState(ajustes.destinatarios.join(", "));
  const [ultimo, setUltimo] = useState(String(ajustes.ultimoIn));
  const [estado, setEstado] = useState<string | null>(null);

  async function guardar() {
    setEstado("Guardando…");
    try {
      const r = await llamar<{ ajustes: AjustesPedidos }>({
        accion: "ajustes",
        destinatarios: correos.split(/[,;\s]+/).filter(Boolean),
        ultimoIn: Number(ultimo),
      });
      alGuardar(r.ajustes);
      setEstado("Guardado");
    } catch (e) {
      setEstado((e as Error).message);
    }
  }

  return (
    <section className="tarjeta p-4">
      <h2 className="seccion-titulo">Mandar a</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-80 flex-1 flex-col gap-1 text-xs">
          Correos (separados por coma)
          <input value={correos} onChange={(e) => setCorreos(e.target.value)} placeholder="tu@correo.com, papa@correo.com, joanne@correo.com" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Último IN usado fuera del ERP
          <input className="w-28" inputMode="numeric" value={ultimo} onChange={(e) => setUltimo(e.target.value)} />
        </label>
        <button className="boton boton-borde" onClick={guardar}>
          Guardar
        </button>
        {estado ? <span className="texto-tenue text-xs">{estado}</span> : null}
      </div>
    </section>
  );
}
