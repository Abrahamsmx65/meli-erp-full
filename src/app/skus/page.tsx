import { Download } from "lucide-react";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaActiva as cuentaFundas } from "@/lib/yapanizcel/cuenta";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { resumenCatalogos, type Canal, type ResumenCanal } from "@/lib/servicios/catalogo-skus";

export const dynamic = "force-dynamic";

const COLUMNAS: Record<Canal, string[]> = {
  calzado: [
    "SKU", "Modelo", "Color", "Talla", "Título", "Código Full", "Item ID", "Variación",
    "User product", "Estado", "Precio", "FNSKU (Amazon)", "ASIN", "SKU Amazon",
  ],
  fundas: [
    "SKU", "Diseño", "Modelo (celular)", "Color", "Título", "Código Full", "Item ID",
    "Variación", "User product", "Estado", "Precio",
  ],
  amazon: [
    "SKU Amazon", "ASIN", "FNSKU", "Modelo", "Color", "Talla", "Título", "Estado",
    "Logística", "Precio", "Disponible FBA", "SKU MELI",
  ],
};

const NOTAS: Record<Canal, string> = {
  calzado:
    "Lo que MELI tiene publicado en la cuenta de calzado. El código Full es el que va en la etiqueta; el FNSKU y el ASIN se le ponen cuando el mismo par también está en Amazon.",
  fundas:
    "Las publicaciones de la cuenta de YAPANIZCEL. El modelo es el del celular y el diseño el de la funda.",
  amazon:
    "El catálogo completo de Amazon (activos, inactivos e incompletos) con el FNSKU del inventario de FBA. El SKU MELI es el par equivalente en la cuenta de calzado, cuando se amarra.",
};

function n(x: number): string {
  return x.toLocaleString("es-MX");
}

function fecha(iso: string | null): string {
  if (!iso) return "sin sincronizar";
  return new Date(iso).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Tarjeta({ r }: { r: ResumenCanal }) {
  return (
    <section className="tarjeta flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-base font-semibold">{r.nombre}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          {NOTAS[r.canal]}
        </p>
      </div>

      {r.conectado ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt style={{ color: "var(--ink-muted)" }}>SKUs</dt>
          <dd className="cifra font-medium">{n(r.skus)}</dd>
          {r.conFnsku !== null ? (
            <>
              <dt style={{ color: "var(--ink-muted)" }}>Con FNSKU</dt>
              <dd className="cifra font-medium">{n(r.conFnsku)}</dd>
            </>
          ) : null}
          <dt style={{ color: "var(--ink-muted)" }}>Última sincronización</dt>
          <dd>{fecha(r.actualizadoEn)}</dd>
        </dl>
      ) : (
        <p className="text-sm" style={{ color: "var(--estado-alerta)" }}>
          Este canal no está conectado; no hay nada que descargar.
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {COLUMNAS[r.canal].map((c) => (
          <span
            key={c}
            className="rounded-md border px-1.5 py-0.5 text-[11px] hairline"
            style={{ color: "var(--ink-2)" }}
          >
            {c}
          </span>
        ))}
      </div>

      <div className="mt-auto">
        {r.conectado && r.skus > 0 ? (
          <a
            href={`/api/skus/excel?canal=${r.canal}`}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: "var(--acento)" }}
          >
            <Download size={14} aria-hidden="true" />
            Descargar Excel
          </a>
        ) : (
          <span
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium hairline opacity-60"
            aria-disabled="true"
          >
            <Download size={14} aria-hidden="true" />
            Descargar Excel
          </span>
        )}
      </div>
    </section>
  );
}

export default async function Skus() {
  const supabase = await clienteServidor();
  const [calzado, fundas, amazon] = await Promise.all([
    cuentaActiva(supabase),
    cuentaFundas(supabase),
    cuentaAmazon(supabase),
  ]);

  const resumen = await resumenCatalogos(supabase, {
    calzado: calzado?.id ?? null,
    fundas: fundas?.id ?? null,
    amazon: amazon?.id ?? null,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">SKUs</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Todos los SKUs de cada canal, con su código de Full o su ASIN, título, talla o
          variante y FNSKU. Cada canal se descarga por separado en un Excel con filtros.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {resumen.map((r) => (
          <Tarjeta key={r.canal} r={r} />
        ))}
      </div>
    </div>
  );
}
