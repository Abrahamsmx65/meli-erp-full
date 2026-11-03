"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu, Search, X } from "lucide-react";
import { MenuLateral, abrirPaleta } from "@/components/menu-lateral";
import { Logo } from "@/components/logo";
import { EstadoConexion } from "@/components/estado-conexion";
import { Avisos } from "@/components/ui/avisos";
import { Paleta } from "@/components/ui/paleta";
import type { Rol } from "@/lib/acceso/roles";

/**
 * Armazón de la app (rediseño del 9-oct-2026; 19-oct-2026 sin barra
 * superior en escritorio): riel crema a la izquierda con el logo, las
 * secciones y al pie Buscar (⌘K) y Cerrar sesión, y el área de trabajo
 * sobre crema. La barra blanca de arriba solo repetía la ceja de la
 * pantalla y se quitó; en el celular queda una barra delgada con el menú,
 * el logo, buscar y salir.
 *
 * Las pantallas SIN sesión (login, el link de contenido de Amazon y la
 * estación de preparar pedidos) reciben solo la franja de marca: quien entra
 * por ahí no debe ver ni los nombres del resto del ERP.
 */
export function Armazon({ children, rol = "dueño" }: { children: React.ReactNode; rol?: Rol }) {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);

  // Al navegar se cierra el cajón del menú en pantallas chicas.
  useEffect(() => {
    setAbierto(false);
  }, [ruta]);

  const publica =
    ruta.startsWith("/contenido/") || ruta.startsWith("/preparar/") || ruta.startsWith("/login");

  // El login se dibuja a pantalla completa, sin marco.
  if (ruta.startsWith("/login")) return <>{children}</>;

  if (publica) {
    return (
      <div className="flex min-h-dvh flex-col">
        <header
          aria-label="Barra superior"
          className="no-imprimir flex h-14 items-center px-5"
          style={{ background: "var(--sidebar)", borderBottom: "1px solid var(--sidebar-borde)" }}
        >
          <Logo alto={30} />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-6">{children}</main>
      </div>
    );
  }

  return <Marco rol={rol} abierto={abierto} setAbierto={setAbierto}>{children}</Marco>;
}

/** El marco de trabajo con sesión: riel, barra del celular y área de trabajo. */
export function Marco({
  children,
  rol = "dueño",
  abierto = false,
  setAbierto = () => {},
}: {
  children: React.ReactNode;
  rol?: Rol;
  abierto?: boolean;
  setAbierto?: (v: boolean | ((v: boolean) => boolean)) => void;
}) {
  // Esc cierra el cajón del menú en el celular.
  useEffect(() => {
    if (!abierto) return;
    function tecla(ev: KeyboardEvent) {
      if (ev.key === "Escape") setAbierto(false);
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [abierto, setAbierto]);

  return (
    <div className="flex min-h-dvh">
      <MenuLateral abierto={abierto} cerrar={() => setAbierto(false)} rol={rol} />
      <div className="flex min-w-0 flex-1 flex-col">
        <BarraMovil abierto={abierto} alternar={() => setAbierto((v) => !v)} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
      {/* Invisible: mantiene vivo el latido mientras la app está abierta. */}
      <EstadoConexion oculto />
      <Paleta rol={rol} />
      <Avisos />
    </div>
  );
}

/**
 * Barra delgada SOLO en pantallas chicas: abrir el menú, el logo, buscar y
 * salir. En escritorio todo eso vive en el riel.
 */
function BarraMovil({ abierto, alternar }: { abierto: boolean; alternar: () => void }) {
  return (
    <header
      aria-label="Barra superior"
      className="no-imprimir sticky top-0 z-30 flex h-12 items-center gap-1 border-b px-2 lg:hidden"
      style={{ background: "var(--sidebar)", borderColor: "var(--sidebar-borde)" }}
    >
      <button
        type="button"
        onClick={alternar}
        aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={abierto}
        aria-controls="menu-lateral"
        className="salir grid h-10 w-10 place-items-center rounded-md"
        style={{ color: "var(--ink-1)" }}
      >
        {abierto ? <X size={20} /> : <Menu size={20} />}
      </button>
      <Logo alto={28} />
      <div className="ml-auto flex items-center">
        <button
          type="button"
          onClick={abrirPaleta}
          aria-label="Buscar pantalla"
          className="salir grid h-10 w-10 place-items-center rounded-md"
          style={{ color: "var(--ink-2)" }}
        >
          <Search size={19} strokeWidth={2} />
        </button>
        <a
          href="/api/salir"
          aria-label="Cerrar sesión"
          className="salir grid h-10 w-10 place-items-center rounded-md"
          style={{ color: "var(--ink-2)" }}
        >
          <LogOut size={18} strokeWidth={2} />
        </a>
      </div>
    </header>
  );
}
