/**
 * Fichas de cifra. Cuando el dato es UN número, un número grande se lee
 * mejor que cualquier gráfica.
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
    <div className="tarjeta p-4">
      <div className="text-xs uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
        {titulo}
      </div>
      <div className="cifra mt-1 text-3xl font-semibold" style={{ color }}>
        {typeof valor === "number" ? valor.toLocaleString("es-MX") : valor}
      </div>
      {nota ? (
        <div className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
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
