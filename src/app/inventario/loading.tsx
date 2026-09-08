import { EncabezadoEsqueleto, EsqueletoFichas, EsqueletoTabla } from "@/components/ui/esqueleto";

/** La silueta real de Bodega: 6 fichas, dos tablas lado a lado y la grande. */
export default function CargandoInventario() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy="true" aria-live="polite" aria-label="Cargando Bodega">
      <EncabezadoEsqueleto />
      <EsqueletoFichas cuantas={6} columnas={6} />
      <div className="grid gap-4 md:grid-cols-2">
        <EsqueletoTabla filas={4} />
        <EsqueletoTabla filas={4} />
      </div>
      <EsqueletoTabla filas={8} />
    </div>
  );
}
