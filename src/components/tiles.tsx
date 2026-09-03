/**
 * Fichas de cifra. Cuando el dato es UN número, un número grande se lee
 * mejor que cualquier gráfica. La ficha lleva una línea de color arriba
 * solo cuando el tono dice algo (crítico, alerta, bien); la neutra va limpia.
 */
export function Ficha({
  titulo,
  valor,
  nota,
  tono = "neutro",
}: {
  titulo: string;
  valor: string | number;
  nota?: string;
  tono?: "neutro" | "critico" | "alerta" | "bien";
}) {
  const color =
    tono === "critico"
      ? "var(--estado-critico)"
      : tono === "alerta"
        ? "var(--estado-alerta)"
        : tono === "bien"
          ? "var(--exito-texto)"
          : "var(--ink-1)";

  return (
    <div className="tarjeta relative overflow-hidden p-4">
      {tono !== "neutro" ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{ background: color }}
        />
      ) : null}
      <div className="text-[12px] font-medium" style={{ color: "var(--ink-2)" }}>
        {titulo}
      </div>
      <div className="cifra mt-2 text-[28px] leading-none font-semibold" style={{ color }}>
        {typeof valor === "number" ? valor.toLocaleString("es-MX") : valor}
      </div>
      {nota ? (
        <div className="mt-1.5 text-xs" style={{ color: "var(--ink-muted)" }}>
          {nota}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Barra de cobertura en días, contra el horizonte objetivo.
 * La referencia (el horizonte) se dibuja como una marca fina, no como
 * una segunda barra: es un umbral, no un dato comparable.
 */
export function BarraCobertura({
  dias,
  horizonte,
  color,
  maximo,
}: {
  dias: number;
  horizonte: number;
  color: string;
  maximo?: number;
}) {
  const tope = maximo ?? Math.max(horizonte * 2, 60);
  const finito = Number.isFinite(dias);
  const ancho = finito ? Math.min(100, (dias / tope) * 100) : 100;
  const marca = Math.min(100, (horizonte / tope) * 100);

  return (
    <div
      className="relative w-full"
      style={{ background: "var(--grid)", height: 8, borderRadius: 4 }}
      role="img"
      aria-label={
        finito
          ? `${dias.toFixed(0)} días de cobertura; objetivo ${horizonte} días`
          : "Sin venta medible"
      }
    >
      <div
        className="barra absolute left-0 top-0"
        style={{ width: `${ancho}%`, background: color }}
      />
      <div
        className="absolute top-[-2px] h-3 w-px"
        style={{ left: `${marca}%`, background: "var(--axis)" }}
        aria-hidden="true"
      />
    </div>
  );
}
