import Link from "next/link";

export default function NoEncontrado() {
  return (
    <div className="contenedor pagina">
      <h1>No encontramos esta página</h1>
      <p className="suave">
        Puede que el producto ya no esté a la venta. <Link href="/">Ver el catálogo</Link>
      </p>
    </div>
  );
}
