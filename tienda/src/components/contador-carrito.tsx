"use client";

import Link from "next/link";
import { useCarrito } from "./carrito";

export function ContadorCarrito() {
  const { piezas } = useCarrito();
  return (
    <Link href="/carrito" aria-label={`Carrito, ${piezas} pares`}>
      Carrito{piezas > 0 && <span className="contador">{piezas}</span>}
    </Link>
  );
}
