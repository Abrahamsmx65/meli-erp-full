/**
 * Miniatura de la foto del producto junto a su SKU (Contenedores, Catálogo y
 * costos). Sin foto, un cuadro vacío del mismo tamaño para que la columna no
 * brinque. Al pasar el mouse se ve en grande.
 */
export function FotoProducto({
  url,
  alt = "",
  tamano = 40,
  sinLetrero,
}: {
  url: string | null | undefined;
  alt?: string;
  tamano?: number;
  /** Sin el «sin foto» dentro del cuadro (miniaturas chicas): queda en el globo. */
  sinLetrero?: boolean;
}) {
  const estilo = { width: tamano, height: tamano, borderColor: "var(--borde)" };
  if (!url) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded border text-[11px] texto-tenue"
        style={{ ...estilo, background: "var(--surface-2)" }}
        title="Sin foto en Amazon ni en TikTok"
      >
        {sinLetrero ? null : "sin foto"}
      </span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="group relative inline-block shrink-0" title={alt}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} loading="lazy" className="rounded border bg-white object-contain" style={estilo} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        loading="lazy"
        className="pointer-events-none absolute left-full top-0 z-30 ml-2 hidden h-48 w-48 rounded-lg border bg-white object-contain shadow-lg group-hover:block"
        style={{ borderColor: "var(--borde)" }}
      />
    </a>
  );
}

/**
 * Un modelo con su miniatura al frente, para las tablas por modelo (Ventas,
 * Estado de resultados, Inicio). Las fundas no llevan foto (`conFoto`
 * falso): queda un hueco del mismo ancho para que la columna no brinque.
 */
export function ModeloConFoto({
  modelo,
  url,
  conFoto = true,
  tamano = 32,
}: {
  modelo: string;
  url: string | null | undefined;
  conFoto?: boolean;
  tamano?: number;
}) {
  return (
    <span className="flex items-center gap-2.5">
      {conFoto ? (
        <FotoProducto url={url} alt={modelo} tamano={tamano} sinLetrero />
      ) : (
        <span aria-hidden="true" className="inline-block shrink-0" style={{ width: tamano }} />
      )}
      <span className="whitespace-nowrap">{modelo}</span>
    </span>
  );
}

/** Un «modelo» que empieza con número es un diseño de funda (499, 662…): sin foto. */
export function esDisenoDeFunda(modelo: string): boolean {
  return /^\d/.test(modelo.trim());
}
