import Link from "next/link";

export function EncabezadoPublico() {
  return (
    <header className="no-imprimir mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
      <Link href="/" className="caligrafia text-3xl leading-none" style={{ color: "var(--vino)" }}>
        Jalá le Zibug
      </Link>
      <Link href="/login" className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--tinta-suave)" }}>
        Organizador
      </Link>
    </header>
  );
}
