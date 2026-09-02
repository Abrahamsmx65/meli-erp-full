import Link from "next/link";

export function EncabezadoPublico() {
  return (
    <header className="no-imprimir mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-5">
      <Link href="/" className="text-lg font-extrabold tracking-tight">
        🎟️ Boletos
      </Link>
      <Link href="/login" className="text-sm" style={{ color: "var(--tinta-suave)" }}>
        Organizador
      </Link>
    </header>
  );
}
