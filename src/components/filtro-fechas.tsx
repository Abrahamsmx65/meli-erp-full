import { AtajosFechas } from "./atajos-fechas";

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
  precargar = false,
}: {
  /** Ruta de la página, p. ej. "/ventas". */
  base: string;
  desde: string;
  hasta: string;
  /** La fecha de hoy en el huso del negocio (México). */
  hoy: string;
  /** Pedir por adelantado la pantalla de cada atajo (solo pantallas baratas). */
  precargar?: boolean;
}) {
  const hace = (dias: number) =>
    new Date(Date.parse(hoy) - dias * 86_400_000).toISOString().slice(0, 10);
  const inicioMes = `${hoy.slice(0, 8)}01`;

  const atajos: { texto: string; desde: string; hasta: string }[] = [
    { texto: "Hoy", desde: hoy, hasta: hoy },
    { texto: "Ayer", desde: hace(1), hasta: hace(1) },
    { texto: "7 días", desde: hace(6), hasta: hoy },
    { texto: "15 días", desde: hace(14), hasta: hoy },
    { texto: "30 días", desde: hace(29), hasta: hoy },
    { texto: "Este mes", desde: inicioMes, hasta: hoy },
  ];

  const activo = atajos.find((a) => a.desde === desde && a.hasta === hasta) ?? null;

  return (
    <div className="tarjeta flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm">
      <span className="texto-2 shrink-0">Periodo</span>
      <AtajosFechas
        atajos={atajos.map((a) => ({ texto: a.texto, href: `${base}?desde=${a.desde}&hasta=${a.hasta}` }))}
        activo={activo ? `${base}?desde=${activo.desde}&hasta=${activo.hasta}` : null}
        precargar={precargar}
      />

      <form method="get" action={base} className="ml-auto flex w-full items-center gap-2 sm:w-auto">
        <input
          type="date"
          name="desde"
          defaultValue={desde}
          max={hoy}
          className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs sm:flex-none"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          aria-label="Desde"
        />
        <span className="texto-tenue shrink-0">→</span>
        <input
          type="date"
          name="hasta"
          defaultValue={hasta}
          max={hoy}
          className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs sm:flex-none"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          aria-label="Hasta"
        />
        <button type="submit" className="boton boton-borde boton-chico shrink-0">
          Aplicar
        </button>
      </form>
    </div>
  );
}
