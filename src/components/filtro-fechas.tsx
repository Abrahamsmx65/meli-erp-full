import Link from "next/link";

/**
 * Filtro de fechas de los paneles de ventas: atajos para los periodos de
 * siempre y dos calendarios para un rango exacto. Va por la URL (GET) para
 * que el rango se pueda compartir y recargar sin perderse.
 */
export function FiltroFechas({
  base,
  desde,
  hasta,
  hoy,
}: {
  /** Ruta de la página, p. ej. "/ventas". */
  base: string;
  desde: string;
  hasta: string;
  /** La fecha de hoy en el huso del negocio (México). */
  hoy: string;
}) {
  const hace = (dias: number) =>
    new Date(Date.parse(hoy) - dias * 86_400_000).toISOString().slice(0, 10);
  const inicioMes = `${hoy.slice(0, 8)}01`;

  const atajos: { texto: string; desde: string; hasta: string }[] = [
    { texto: "7 días", desde: hace(6), hasta: hoy },
    { texto: "15 días", desde: hace(14), hasta: hoy },
    { texto: "30 días", desde: hace(29), hasta: hoy },
    { texto: "Este mes", desde: inicioMes, hasta: hoy },
  ];

  return (
    <div className="tarjeta flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm">
      <span style={{ color: "var(--ink-2)" }}>Periodo</span>
      {atajos.map((a) => {
        const activo = a.desde === desde && a.hasta === hasta;
        return (
          <Link
            key={a.texto}
            href={`${base}?desde=${a.desde}&hasta=${a.hasta}`}
            className="rounded-full border px-3 py-1 text-xs font-medium"
            style={
              activo
                ? { background: "var(--acento)", color: "#fff", borderColor: "var(--acento)" }
                : { borderColor: "var(--borde)" }
            }
          >
            {a.texto}
          </Link>
        );
      })}

      <form method="get" action={base} className="ml-auto flex flex-wrap items-center gap-2">
        <input
          type="date"
          name="desde"
          defaultValue={desde}
          max={hoy}
          className="rounded-lg border px-2 py-1 text-xs"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          aria-label="Desde"
        />
        <span style={{ color: "var(--ink-muted)" }}>→</span>
        <input
          type="date"
          name="hasta"
          defaultValue={hasta}
          max={hoy}
          className="rounded-lg border px-2 py-1 text-xs"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          aria-label="Hasta"
        />
        <button
          type="submit"
          className="rounded-lg border px-3 py-1 text-xs font-medium"
          style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
        >
          Aplicar
        </button>
      </form>
    </div>
  );
}
