"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu, Package, Search, X } from "lucide-react";
import { MenuLateral } from "@/components/menu-lateral";
import { EstadoConexion } from "@/components/estado-conexion";

/**
 * Armazón de la app: barra superior azul marino, menú lateral blanco y el
 * área de trabajo sobre gris frío. Es el esqueleto de un panel de vendedor
 * (Seller Central, el de MELI), que es donde el dueño pasa el resto del día:
 * así la herramienta se siente parte del mismo escritorio y no un sistema
 * aparte.
 *
 * Las pantallas SIN sesión (login, el link de contenido de Amazon y la
 * estación de preparar pedidos) reciben solo la franja de marca: quien entra
 * por ahí no debe ver ni los nombres del resto del ERP.
 */
export function Armazon({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);

  // Al navegar se cierra el cajón del menú en pantallas chicas.
  useEffect(() => {
    setAbierto(false);
  }, [ruta]);

  const publica =
    ruta.startsWith("/contenido/") || ruta.startsWith("/preparar/") || ruta.startsWith("/login");

  if (publica) {
    return (
      <div className="flex min-h-screen flex-col">
        <header
          aria-label="Barra superior"
          className="no-imprimir flex h-12 items-center px-5"
          style={{ background: "linear-gradient(90deg, var(--marca), var(--marca-2))" }}
        >
          <Logo />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-6">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Cabecera abierto={abierto} alternar={() => setAbierto((v) => !v)} />

      <div className="flex flex-1">
        <MenuLateral abierto={abierto} cerrar={() => setAbierto(false)} />
        <div className="min-w-0 flex-1">
          <main className="aparece mx-auto max-w-[1400px] px-4 py-6 md:px-6" key={ruta}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="GETAC, inicio">
      <span
        className="flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: "var(--acento)", color: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,.25)" }}
      >
        <Package size={18} strokeWidth={2.5} />
      </span>
      <span className="leading-none">
        <span className="block text-[15px] font-extrabold tracking-tight" style={{ color: "var(--marca-texto)" }}>
          GETAC
        </span>
        <span
          className="mt-0.5 block text-[9px] font-bold uppercase tracking-[0.16em]"
          style={{ color: "rgba(255,255,255,.6)" }}
        >
          Control de inventario
        </span>
      </span>
    </Link>
  );
}

/**
 * La barra superior. Lleva el logo, el buscador de SKUs (va directo a Bodega
 * con el filtro puesto), el estado de la conexión con MELI y la salida.
 */
function Cabecera({ abierto, alternar }: { abierto: boolean; alternar: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    const t = q.trim();
    if (!t) return;
    router.push(`/inventario?q=${encodeURIComponent(t)}`);
  }

  return (
    <header
      aria-label="Barra superior"
      className="no-imprimir sticky top-0 z-40 flex h-14 items-center gap-3 px-4 md:gap-5 md:px-5"
      style={{
        background: "linear-gradient(90deg, var(--marca), var(--marca-2))",
        boxShadow: "0 1px 0 rgba(0,0,0,.2), 0 2px 8px rgba(15,27,45,.18)",
      }}
    >
      <button
        onClick={alternar}
        aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={abierto}
        className="-ml-1 rounded-md p-1.5 lg:hidden"
        style={{ color: "var(--marca-texto)" }}
      >
        {abierto ? <X size={20} /> : <Menu size={20} />}
      </button>

      <div className="hidden sm:block">
        <Logo />
      </div>

      <form
        onSubmit={buscar}
        role="search"
        className="relative mx-auto flex w-full max-w-xl items-stretch"
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar SKU, modelo o color en bodega…"
          aria-label="Buscar en bodega"
          className="h-9 w-full rounded-r-none border-0 pr-2"
          style={{ borderRadius: "var(--radio) 0 0 var(--radio)" }}
        />
        <button
          type="submit"
          aria-label="Buscar"
          className="flex h-9 w-11 shrink-0 items-center justify-center"
          style={{
            background: "var(--acento)",
            color: "#fff",
            borderRadius: "0 var(--radio) var(--radio) 0",
          }}
        >
          <Search size={17} strokeWidth={2.2} />
        </button>
      </form>

      <div className="ml-auto hidden items-center gap-3 md:flex">
        <EstadoConexion />
        <a
          href="/api/salir"
          className="salir flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-semibold"
          style={{ color: "rgba(255,255,255,.85)" }}
          title="Cerrar sesión"
        >
          <LogOut size={15} strokeWidth={2.2} />
          Salir
        </a>
      </div>
    </header>
  );
}
