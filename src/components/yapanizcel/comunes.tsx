import Link from "next/link";

export function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

export function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

export function dias(x: number): string {
  if (!Number.isFinite(x)) return "∞";
  return `${Math.round(x)} d`;
}

/** Pantalla de "conecta primero", común a toda la sección. */
export function SinCuenta() {
  return (
    <div className="tarjeta mx-auto max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold">Conecta la cuenta de YAPANIZCEL</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
        Es otra cuenta de Mercado Libre, con su propia aplicación. Se conecta una sola vez
        desde Ajustes de fundas.
      </p>
      <Link href="/yapanizcel/ajustes" className="mt-3 inline-block underline" style={{ color: "var(--acento)" }}>
        Ir a Ajustes de fundas
      </Link>
    </div>
  );
}

export function Encabezado({ titulo, texto, children }: { titulo: string; texto?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{titulo}</h1>
        {texto ? (
          <p className="mt-0.5 max-w-3xl text-sm" style={{ color: "var(--ink-2)" }}>
            {texto}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export const estiloInput = {
  borderColor: "var(--borde)",
  background: "var(--surface-1)",
  color: "var(--ink-1)",
} as const;
