import { EncabezadoEsqueleto, EsqueletoFichas, EsqueletoTabla, Hueso } from "@/components/ui/esqueleto";

/** La silueta real del Plan de envío: frescura, 6 fichas y las tablas. */
export default function CargandoEnvios() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy="true" aria-live="polite" aria-label="Cargando el plan de envío">
      <EncabezadoEsqueleto />
      <div className="tarjeta px-4 py-2.5">
        <Hueso ancho="18rem" alto="0.9rem" />
      </div>
      <EsqueletoFichas cuantas={6} columnas={6} />
      <EsqueletoTabla filas={4} />
      <EsqueletoTabla filas={7} />
    </div>
  );
}
