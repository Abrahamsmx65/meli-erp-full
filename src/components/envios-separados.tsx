"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";

interface Caja {
  codigo: string;
  skuCaja: string;
  pedido: string;
  modelo: string;
  color: string;
  almacen: string;
  esCorrida: boolean;
  talla: string;
  cantidad: number;
  /** cuántas cajas de este tipo hay en bodega, para saber si quedan */
  cajasDisponibles: number;
  paresTotales: number;
  aporta: { sku: string; talla: string; paresTotales: number }[];
}

interface Envio {
  grupo: string;
  nombre: string;
  almacenes: string[];
  cajas: Caja[];
  totalCajas: number;
  totalPares: number;
  skus: number;
  porSku: { sku: string; talla: string; pares: number }[];
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
 */
export function EnviosSeparados({
  envios,
  sinConfigurar,
}: {
  envios: Envio[];
  sinConfigurar: string[];
}) {
  if (!envios.length) {
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
          {envios.length === 1
            ? "Todo sale de una sola dirección, así que es un solo envío."
            : `Son ${envios.length} envíos porque las cajas salen de direcciones distintas. Cada uno se da de alta por separado en Mercado Libre.`}
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

      {envios.map((e) => (
        <TarjetaEnvio key={e.grupo} envio={e} />
      ))}
    </div>
  );
}

function TarjetaEnvio({ envio }: { envio: Envio }) {
  const [vista, setVista] = useState<"cajas" | "skus">("cajas");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // "Ya lo di de alta en MELI": desde este clic, las cajas del envío dejan
  // de contar como disponibles y sus pares cuentan como en camino. Es lo que
  // evita que el plan vuelva a sugerir lo que ya va en la carretera.
  const registrar = async () => {
    if (registrando) return;
    if (!confirm(`¿Ya diste de alta este envío (${n(envio.totalCajas)} cajas) en Mercado Libre?`)) return;
    setRegistrando(true);
    setError(null);
    try {
      const r = await fetch("/api/envios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grupo: envio.grupo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo registrar.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setRegistrando(false);
    }
  };

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-center gap-4 border-b p-4 hairline">
        <div>
          <h3 className="font-semibold">{envio.nombre}</h3>
          <p className="text-xs" style={{ color: "var(--ink-2)" }}>
            Recolección en {envio.almacenes.join(" y ")}
          </p>
        </div>

        <div className="flex gap-6">
          <Dato titulo="Cajas" valor={n(envio.totalCajas)} grande />
          <Dato titulo="Pares" valor={n(envio.totalPares)} />
          <Dato titulo="SKUs" valor={n(envio.skus)} />
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

          <a
            href={`/api/plan/excel?grupo=${encodeURIComponent(envio.grupo)}`}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: "var(--acento)" }}
          >
            Excel de este envío
          </a>

          <button
            onClick={registrar}
            disabled={registrando}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium"
            style={{
              borderColor: "var(--exito-texto)",
              color: "var(--exito-texto)",
              opacity: registrando ? 0.6 : 1,
            }}
          >
            {registrando ? "Registrando…" : "Ya lo di de alta en MELI"}
          </button>
        </div>
        {error ? (
          <p className="w-full text-sm" style={{ color: "var(--estado-critico)" }}>
            {error}
          </p>
        ) : null}
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
              {envio.cajas.map((c) => (
                <Fragment key={c.codigo}>
                  <tr
                    onClick={() => setAbierta(abierta === c.codigo ? null : c.codigo)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{c.almacen}</td>
                    <td className="text-xs">{c.pedido || "—"}</td>
                    <td className="font-medium">{c.modelo}</td>
                    <td>{c.color || "—"}</td>
                    <td>
                      {c.esCorrida ? (
                        <span style={{ color: "var(--ink-2)" }}>corrida</span>
                      ) : (
                        c.talla
                      )}
                    </td>
                    <td className="num cifra font-semibold">{n(c.cantidad)}</td>
                    <td className="num cifra" style={{ color: "var(--ink-muted)" }}>
                      {n(c.cajasDisponibles)}
                    </td>
                    <td className="num cifra">{n(c.paresTotales)}</td>
                  </tr>

                  {abierta === c.codigo ? (
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
              {envio.porSku.map((s) => (
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

function Dato({ titulo, valor, grande }: { titulo: string; valor: string; grande?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
        {titulo}
      </div>
      <div className={`cifra font-semibold ${grande ? "text-2xl" : "text-lg"}`}>{valor}</div>
    </div>
  );
}
