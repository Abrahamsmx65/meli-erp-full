import Link from "next/link";

/**
 * La marca GETAC: el logo de la casa (arena con «SINCE 1981»), sin fondo,
 * en `public/getac-logo.png`. Va sobre el crema del menú y del login.
 */
export function Logo({ alto = 34 }: { alto?: number }) {
  return (
    <Link href="/" className="flex items-center" aria-label="GETAC, inicio">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/getac-logo.png" alt="GETAC" width={Math.round(alto * 1.83)} height={alto} style={{ height: alto, width: "auto" }} />
    </Link>
  );
}
