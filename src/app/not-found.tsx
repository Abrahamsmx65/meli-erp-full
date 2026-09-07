import Link from "next/link";
import { SearchX } from "lucide-react";

/** Página que no existe o SKU que no está en el catálogo. */
export default function NoEncontrado() {
  return (
    <div className="tarjeta mx-auto mt-10 max-w-lg p-8 text-center">
      <span
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--acento-suave)", color: "var(--acento)" }}
      >
        <SearchX size={22} />
      </span>
      <h1 className="titulo-seccion mt-4">No encontramos esa página</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
        Puede que el enlace esté mal escrito o que el SKU ya no exista en el catálogo.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href="/envios" className="boton boton-primario">
          Ir a Envíos a Full
        </Link>
        <Link href="/inventario" className="boton boton-secundario">
          Buscar en bodega
        </Link>
      </div>
    </div>
  );
}
