import type { Metadata } from "next";
import { Carrito } from "@/components/vista-carrito";

export const metadata: Metadata = { title: "Carrito" };

export default function PaginaCarrito() {
  return (
    <div className="contenedor pagina">
      <h1>Tu carrito</h1>
      <Carrito />
    </div>
  );
}
