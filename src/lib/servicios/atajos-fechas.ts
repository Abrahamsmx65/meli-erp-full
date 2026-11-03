/**
 * Los rangos de los atajos del filtro de fechas (`components/filtro-fechas.tsx`):
 * 7 días, Hoy, 30 días, Este mes, 15 días y Ayer, en ese orden (lo que se
 * abre por omisión primero). El fondo los deja masticados para que picar un
 * atajo sea leer un renglón (dueño, 11-oct-2026: «cambio de fechas y toma
 * como 3 segundos», «en Hoy antes salían actualizados y ahora salen de hace
 * una hora»). Puro, con pruebas.
 */
export interface RangoAtajo {
  desde: string;
  hasta: string;
}

export function rangosDeAtajos(hoy: string): RangoAtajo[] {
  const hace = (dias: number) =>
    new Date(Date.parse(`${hoy}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
  const vistos = new Set<string>();
  const rangos: RangoAtajo[] = [];
  for (const r of [
    { desde: hace(6), hasta: hoy },
    { desde: hoy, hasta: hoy },
    { desde: hace(29), hasta: hoy },
    { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy },
    { desde: hace(14), hasta: hoy },
    { desde: hace(1), hasta: hace(1) },
  ]) {
    const clave = `${r.desde}:${r.hasta}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    rangos.push(r);
  }
  return rangos;
}
