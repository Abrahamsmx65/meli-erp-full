/**
 * Fichas de cifra. Cuando el dato es UN número, un número grande se lee
 * mejor que cualquier gráfica. La ficha lleva una línea de color arriba
 * solo cuando el tono dice algo (crítico, alerta, bien); la neutra va limpia.
 */

/**
 * De qué tamaño va la cifra para que QUEPA en su tarjeta.
 *
 * El tamaño fijo de antes (28 px) se salía del recuadro: en la rejilla más
 * apretada que usa la app —ocho columnas dentro de 1400 px— cada tarjeta mide
 * ~158 px, de los que ~126 son contenido, y "$5,301,760" a 28 px con dígitos
 * de ancho fijo necesita ~165. Un importe de siete cifras es lo normal en un
 * mes de venta, así que no era un caso raro.
 *
 * La medida se da en `cqi`: 1 % del ancho de la TARJETA, no de la pantalla.
 * Así la misma ficha se achica en la rejilla de ocho y se ve grande cuando va
 * en una de tres, sin depender de qué tan ancho tenga el navegador. El tope
 * en `rem` conserva los 28 px de siempre donde hay lugar, y baja por escalones
 * según cuántos caracteres trae la cifra, que es lo que de verdad decide si
 * cabe.
 */
export function tamanoDeCifra(texto: string): string {
  const n = texto.length;
  if (n <= 7) return "clamp(0.9rem, 16cqi, 1.75rem)";
  if (n <= 9) return "clamp(0.9rem, 15cqi, 1.75rem)";
  if (n <= 11) return "clamp(0.85rem, 13cqi, 1.5rem)";
  if (n <= 13) return "clamp(0.8rem, 11cqi, 1.25rem)";
  return "clamp(0.75rem, 9.5cqi, 1.1rem)";
}
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

  const texto = typeof valor === "number" ? valor.toLocaleString("es-MX") : valor;

  return (
    // La tarjeta es el contenedor de referencia: la cifra se mide contra SU
    // ancho, no contra el de la ventana.
    <div
      className="tarjeta relative overflow-hidden p-4"
      style={{ containerType: "inline-size" }}
    >
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
      <div
        className="cifra mt-2 leading-none font-semibold"
        style={{ color, fontSize: tamanoDeCifra(texto) }}
        title={texto}
      >
        {texto}
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
