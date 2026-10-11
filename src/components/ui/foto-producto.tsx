/**
 * Miniatura de la foto del producto junto a su SKU (Contenedores, Catálogo y
 * costos). Sin foto, un cuadro vacío del mismo tamaño para que la columna no
 * brinque. Al pasar el mouse se ve en grande.
 */
export function FotoProducto({ url, alt = "", tamano = 40 }: { url: string | null | undefined; alt?: string; tamano?: number }) {
  const estilo = { width: tamano, height: tamano, borderColor: "var(--borde)" };
  if (!url) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded border text-[9px] texto-tenue"
        style={{ ...estilo, background: "var(--surface-2)" }}
        title="Sin foto en Amazon ni en TikTok"
      >
        sin foto
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
