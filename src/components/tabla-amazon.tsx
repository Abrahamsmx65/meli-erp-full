"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PERIODOS, type RenglonAmazon } from "@/lib/servicios/amazon";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

/**
 * Color de la cobertura.
 *
 * Es el dato que decide qué reponer, así que se lee de un vistazo: menos de
 * dos semanas es crítico (el barco de China tarda más que eso), menos de un
 * mes es aviso. Sin ventas no hay cobertura que calcular.
 */
function tonoCobertura(dias: number | null): string {
  if (dias === null) return "var(--ink-muted)";
  if (dias < 14) return "var(--estado-critico)";
  if (dias < 30) return "var(--estado-alerta)";
  return "var(--ink-1)";
}

/**
 * Tabla de SKUs de Amazon: ventas del periodo, stock en FBA y cobertura.
 *
 * El filtro por días y la búsqueda viajan en la URL, no en el estado local.
 * Así se pueden compartir y recargar, y sobre todo: la búsqueda la resuelve
 * Postgres sobre los 10 mil SKUs, no el navegador sobre los 500 que alcanzó
 * a recibir.
 */
export function TablaAmazon({
  renglones,
  dias,
  busqueda,
  limite,
  totales,
}: {
  renglones: RenglonAmazon[];
  dias: number;
  busqueda: string;
  limite: number;
  /** Totales REALES del periodo (de la base), no de las filas recibidas. */
  totales?: { unidades: number; importe: number };
}) {
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();
  const [pendiente, iniciar] = useTransition();

  const [texto, setTexto] = useState(busqueda);
  const primeraVez = useRef(true);

  // La URL se actualiza sola tras una pausa: escribir no debe disparar una
  // consulta por cada tecla.
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    const t = setTimeout(() => {
      const siguientes = new URLSearchParams(params.toString());
      if (texto.trim()) siguientes.set("q", texto.trim());
      else siguientes.delete("q");
      iniciar(() => router.replace(`${ruta}?${siguientes.toString()}`));
    }, 350);
    return () => clearTimeout(t);
    // `params` cambia al navegar; incluirlo reengancharía el temporizador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const irA = (nuevosDias: number) => {
    const siguientes = new URLSearchParams(params.toString());
    siguientes.set("dias", String(nuevosDias));
    iniciar(() => router.replace(`${ruta}?${siguientes.toString()}`));
  };

  const truncado = renglones.length >= limite;

  // Sin búsqueda, el resumen usa los totales reales del periodo: sumar solo
  // las filas recibidas (topadas a `limite`) daba una cifra menor a la real
  // y contradecía a las fichas de arriba. Con búsqueda sí se suman las filas,
  // porque el resumen describe lo encontrado.
  const resumen = useMemo(() => {
    if (!busqueda && totales) return totales;
    return {
      unidades: renglones.reduce((a, r) => a + r.unidades, 0),
      importe: renglones.reduce((a, r) => a + r.importe, 0),
    };
  }, [renglones, busqueda, totales]);

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-col gap-3 border-b p-4 hairline">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por SKU, título o ASIN…"
            className="min-w-[18rem] flex-1"
            aria-label="Buscar SKUs de Amazon"
          />

          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Periodo">
            {PERIODOS.map((d) => {
              const act = d === dias;
              return (
                <button
                  key={d}
                  onClick={() => irA(d)}
                  aria-pressed={act}
                  className="rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap"
                  style={{
                    borderColor: act ? "var(--acento)" : "var(--borde)",
                    background: act ? "var(--acento-suave)" : "transparent",
                    color: act ? "var(--acento)" : "var(--ink-1)",
                  }}
                >
                  {d === 365 ? "1 año" : `${d} días`}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-sm" style={{ color: "var(--ink-2)", opacity: pendiente ? 0.5 : 1 }}>
          <strong className="cifra">{n(renglones.length)}</strong> SKUs ·{" "}
          <span className="cifra">{n(resumen.unidades)}</span> unidades ·{" "}
          <span className="cifra">{pesos(resumen.importe)}</span>
          {truncado ? (
            <>
              {" "}· mostrando los {n(limite)} más vendidos
              {busqueda ? "" : " — usa el buscador para llegar al resto"}
            </>
          ) : null}
        </p>
      </header>

      <div className="max-h-[42rem] overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Producto</th>
              <th className="num">Vendidas</th>
              <th className="num">Órdenes</th>
              <th className="num">Importe</th>
              <th className="num">FBA</th>
              <th className="num">En tránsito</th>
              <th className="num">Cobertura</th>
            </tr>
          </thead>
          <tbody>
            {renglones.map((r) => (
              <tr key={r.sku}>
                <td className="whitespace-nowrap font-medium">{r.sku}</td>
                <td className="max-w-[22rem] truncate" title={r.titulo ?? undefined}>
                  {r.titulo ?? <span style={{ color: "var(--ink-muted)" }}>—</span>}
                </td>
                <td className="num cifra">{n(r.unidades)}</td>
                <td className="num cifra">{n(r.ordenes)}</td>
                <td className="num cifra">{pesos(r.importe)}</td>
                <td
                  className="num cifra"
                  style={{ color: r.disponible === 0 ? "var(--estado-critico)" : undefined }}
                >
                  {n(r.disponible)}
                </td>
                <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                  {r.enTransferencia > 0 ? n(r.enTransferencia) : "—"}
                </td>
                <td className="num cifra" style={{ color: tonoCobertura(r.cobertura) }}>
                  {r.cobertura === null ? "—" : `${r.cobertura} d`}
                </td>
              </tr>
            ))}

            {renglones.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>
                  {busqueda
                    ? `Ningún SKU coincide con «${busqueda}».`
                    : "Sin datos para este periodo."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
