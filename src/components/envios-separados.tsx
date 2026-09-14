"use client";

import { Fragment, useMemo, useState } from "react";
import { partirPorOpcionales } from "@/lib/reporte/opcionales";
import { BotonDescarga } from "@/components/ui/boton-descarga";
import type { FilaCajaPlan } from "@/components/tablas-plan";

interface Grupo {
  grupo: string;
  nombre: string;
  almacenes: string[];
  /** códigos de las cajas del plan que van en este envío */
  codigos: string[];
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Los envíos ya separados por bodega.
 *
 * Cada tarjeta es UN envío que se da de alta en Mercado Libre: una dirección
 * de recolección, un número de cajas que esa dirección de verdad puede juntar.
 * Por eso el conteo de cajas está grande y arriba — es el número que se
 * captura en el alta del envío y el que tiene que cuadrar cuando llega el
 * transportista.
 *
 * Recibe las MISMAS cajas que la tabla del plan (una sola copia viaja al
 * navegador) y cada tarjeta resuelve las suyas por código.
 */
export function EnviosSeparados({
  grupos,
  cajas,
  sinConfigurar,
  destino = "Mercado Libre",
  excelBase = "/api/plan/excel?grupo=",
}: {
  grupos: Grupo[];
  cajas: FilaCajaPlan[];
  sinConfigurar: string[];
  /**
   * Dónde se da de alta cada envío: "Mercado Libre" (Full) o "Amazon" (FBA).
   * Las tarjetas son las mismas: un envío sale de UNA dirección de bodega
   * sin importar a qué canal vaya.
   */
  destino?: string;
  /**
   * URL del Excel de UN envío; se le pega la clave del grupo al final. Es una
   * cadena y no una función porque viene de un componente de servidor.
   */
  excelBase?: string;
}) {
  const porCodigo = useMemo(() => new Map(cajas.map((c) => [c.codigo, c])), [cajas]);

  if (!grupos.length) {
    return (
      <section className="tarjeta p-6 text-center">
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          El plan de hoy no manda cajas, así que no hay envíos que preparar.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Envíos a preparar</h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          {grupos.length === 1
            ? "Todo sale de una sola dirección, así que es un solo envío."
            : `Son ${grupos.length} envíos porque las cajas salen de direcciones distintas. Cada uno se da de alta por separado en ${destino}.`}
        </p>
      </div>

      {sinConfigurar.length ? (
        <p
          className="rounded-lg p-3 text-sm"
          style={{
            background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)",
          }}
        >
          {sinConfigurar.join(", ")} no está configurado como almacén, así que va en su
          propio envío por precaución. Si comparte dirección con otro, dilo en Ajustes y
          se juntan.
        </p>
      ) : null}

      {grupos.map((g) => (
        <TarjetaEnvio
          key={g.grupo}
          grupo={g}
          excelBase={excelBase}
          cajas={g.codigos.map((c) => porCodigo.get(c)).filter((c): c is FilaCajaPlan => c != null)}
        />
      ))}
    </div>
  );
}

function TarjetaEnvio({
  grupo,
  cajas,
  excelBase,
}: {
  grupo: Grupo;
  cajas: FilaCajaPlan[];
  excelBase: string;
}) {
  const [vista, setVista] = useState<"cajas" | "skus">("cajas");
  const [abierta, setAbierta] = useState<string | null>(null);

  // El envío NORMAL y el bloque de OPCIONALES van separados de verdad: el
  // número grande es el que se captura en el alta; las opcionales son una
  // decisión aparte, con sus propias cajas y pares. Memoizado: antes se
  // recalculaba el reparto completo en cada clic de la tarjeta.
  const { normales, opcionales, totales, porSku } = useMemo(() => {
    const { normales, opcionales } = partirPorOpcionales(cajas);
    const cajasOpc = opcionales.reduce((a, c) => a + c.cantidad, 0);
    const paresOpc = opcionales.reduce((a, c) => a + c.paresTotales, 0);
    const cajasNorm = normales.reduce((a, c) => a + c.cantidad, 0);
    const paresNorm = normales.reduce((a, c) => a + c.paresTotales, 0);

    // El contenido por SKU se deriva aquí de las mismas cajas (antes viajaba
    // aparte desde el servidor, duplicado).
    const acc = new Map<string, { talla: string; pares: number }>();
    for (const c of cajas) {
      for (const a of c.aporta) {
        const prev = acc.get(a.sku) ?? { talla: a.talla, pares: 0 };
        prev.pares += a.paresTotales;
        acc.set(a.sku, prev);
      }
    }
    const porSku = [...acc.entries()]
      .map(([sku, v]) => ({ sku, talla: v.talla, pares: v.pares }))
      .sort((a, b) => a.sku.localeCompare(b.sku, "es", { numeric: true }));

    return { normales, opcionales, porSku, totales: { cajasOpc, paresOpc, cajasNorm, paresNorm } };
  }, [cajas]);

  // El botón "Ya lo di de alta en MELI" se quitó a petición del usuario: lo
  // que va en camino ahora sale de los envíos pendientes del API de Industher
  // (los que empiezan con 7 u 8), no de un registro manual.
  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-center gap-4 border-b p-4 hairline">
        <div>
          <h3 className="font-semibold">{grupo.nombre}</h3>
          <p className="text-xs" style={{ color: "var(--ink-2)" }}>
            Recolección en {grupo.almacenes.join(" y ")}
          </p>
        </div>

        <div className="flex gap-6">
          <Dato titulo="Cajas del envío" valor={n(totales.cajasNorm)} grande />
          <Dato titulo="Pares" valor={n(totales.paresNorm)} />
          {totales.cajasOpc > 0 ? (
            <Dato
              titulo="Opcionales aparte"
              valor={`+${n(totales.cajasOpc)} (${n(totales.paresOpc)} pares)`}
              alerta
            />
          ) : null}
          <Dato titulo="SKUs" valor={n(porSku.length)} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div
            className="flex rounded-lg border text-xs"
            style={{ borderColor: "var(--borde)" }}
            role="tablist"
          >
            {(["cajas", "skus"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={vista === v}
                onClick={() => setVista(v)}
                className="px-3 py-1.5 font-medium first:rounded-l-lg last:rounded-r-lg"
                style={{
                  background: vista === v ? "var(--acento-suave)" : "transparent",
                  color: vista === v ? "var(--acento)" : "var(--ink-2)",
                }}
              >
                {v === "cajas" ? "Lista de carga" : "Contenido"}
              </button>
            ))}
          </div>

          <BotonDescarga
            href={`${excelBase}${encodeURIComponent(grupo.grupo)}`}
            variante="primario"
            chico
            title={`Excel solo con las cajas del envío ${grupo.nombre}`}
          >
            Excel de este envío
          </BotonDescarga>
        </div>
      </header>

      <div className="max-h-96 overflow-auto">
        {vista === "cajas" ? (
          <table className="datos">
            <thead>
              <tr>
                <th>Almacén</th>
                <th>Pedido</th>
                <th>Modelo</th>
                <th>Color</th>
                <th>Talla</th>
                <th className="num">Cajas</th>
                <th className="num">Hay</th>
                <th className="num">Pares</th>
              </tr>
            </thead>
            <tbody>
              {normales.map((c) => (
                <FilaCajaEnvio
                  key={`n-${c.codigo}`}
                  c={c}
                  abierta={abierta}
                  setAbierta={setAbierta}
                />
              ))}
              {opcionales.length > 0 ? (
                <tr
                  style={{
                    background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)",
                  }}
                >
                  <td colSpan={8} className="font-semibold text-sm">
                    Opcionales — {n(totales.cajasOpc)} cajas · {n(totales.paresOpc)} pares.
                    Entraron por el rescate de una talla que falta; el resto de la caja
                    sobra. Tú decides si van en el envío.
                  </td>
                </tr>
              ) : null}
              {opcionales.map((c) => (
                <FilaCajaEnvio
                  key={`o-${c.codigo}`}
                  c={c}
                  abierta={abierta}
                  setAbierta={setAbierta}
                  opcional
                />
              ))}
            </tbody>
          </table>
        ) : (
          <table className="datos">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Talla</th>
                <th className="num">Pares en este envío</th>
              </tr>
            </thead>
            <tbody>
              {porSku.map((s) => (
                <tr key={s.sku}>
                  <td className="font-medium">{s.sku}</td>
                  <td>{s.talla}</td>
                  <td className="num cifra">{n(s.pares)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function FilaCajaEnvio({
  c,
  abierta,
  setAbierta,
  opcional,
}: {
  c: FilaCajaPlan;
  abierta: string | null;
  setAbierta: (v: string | null) => void;
  opcional?: boolean;
}) {
  const clave = `${opcional ? "o" : "n"}-${c.codigo}`;
  const abierto = abierta === clave;
  // Ámbar para lo OPCIONAL: es una decisión, no una emergencia. El rojo
  // crítico queda reservado para agotamiento, como en el resto de la app.
  const colorOpcional = opcional ? { color: "var(--estado-alerta)" } : undefined;
  return (
    <Fragment>
      <tr
        onClick={() => setAbierta(abierto ? null : clave)}
        aria-expanded={abierto}
        style={{
          cursor: "pointer",
          ...(opcional
            ? { background: "color-mix(in oklab, var(--estado-alerta) 5%, transparent)" }
            : null),
        }}
      >
        <td>{c.almacen}</td>
        <td className="text-xs">{c.pedido || "—"}</td>
        <td className="font-medium" style={colorOpcional}>
          {c.modelo}
        </td>
        <td>{c.color || "—"}</td>
        <td>
          {c.esCorrida ? <span style={{ color: "var(--ink-2)" }}>corrida</span> : c.talla}
        </td>
        <td className="num cifra font-semibold" style={colorOpcional}>
          {n(c.cantidad)}
        </td>
        <td className="num cifra" style={{ color: "var(--ink-muted)" }}>
          {n(c.cajasDisponibles)}
        </td>
        <td className="num cifra">{n(c.paresTotales)}</td>
      </tr>

      {abierto ? (
        <tr>
          <td colSpan={8} style={{ background: "var(--surface-2)" }}>
            <div className="p-3 text-sm">
              <div className="text-xs font-semibold">
                Qué llevan estas {n(c.cantidad)} cajas
              </div>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                {c.aporta.map((a) => (
                  <span key={a.sku}>
                    <span style={{ color: "var(--ink-2)" }}>{a.sku}</span>{" "}
                    <strong className="cifra">{n(a.paresTotales)}</strong>
                  </span>
                ))}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function Dato({
  titulo,
  valor,
  grande,
  alerta,
}: {
  titulo: string;
  valor: string;
  grande?: boolean;
  alerta?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
        {titulo}
      </div>
      <div
        className={`cifra font-semibold ${grande ? "text-2xl" : "text-lg"}`}
        style={alerta ? { color: "var(--estado-alerta)" } : undefined}
      >
        {valor}
      </div>
    </div>
  );
}
