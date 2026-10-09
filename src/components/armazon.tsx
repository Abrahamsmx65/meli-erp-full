"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, LogOut, Menu, X } from "lucide-react";
import { MenuLateral, ubicacion } from "@/components/menu-lateral";
import { Logo } from "@/components/logo";
import { EstadoConexion } from "@/components/estado-conexion";
import { Avisos } from "@/components/ui/avisos";
import type { Rol } from "@/lib/acceso/roles";

/**
 * Armazón de la app (rediseño del 9-oct-2026): riel azul marino de la marca
 * a la izquierda con el logo y las secciones, barra superior blanca y
 * delgada con dónde estás, el buscador y la salida, y el área de trabajo
 * sobre gris muy claro. Ya no hay franja azul arriba: la pantalla es del
 * trabajo, no del marco.
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
      <div className="flex min-h-screen flex-col">
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

/** El marco de trabajo con sesión: riel, barra superior y área de trabajo. */
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
  return (
    <div className="flex min-h-dvh">
      <MenuLateral abierto={abierto} cerrar={() => setAbierto(false)} rol={rol} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Cabecera abierto={abierto} alternar={() => setAbierto((v) => !v)} rol={rol} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
      <Avisos />
    </div>
  );
}


/**
 * La barra superior: blanca y delgada, encima del área de trabajo. Solo
 * dónde estás (sección › pantalla) y la salida; el buscador, la hora de la
 * sincronización y los pendientes se quitaron por decisión del dueño
 * (9-oct-2026). En pantallas chicas también el botón del menú.
 */
function Cabecera({ abierto, alternar, rol = "dueño" }: { abierto: boolean; alternar: () => void; rol?: Rol }) {
  const ruta = usePathname();
  const donde = ubicacion(ruta, rol);

  return (
    <header
      aria-label="Barra superior"
      className="no-imprimir sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 md:gap-5 md:px-8"
      style={{ background: "rgba(255,255,255,.92)", borderColor: "var(--borde)", backdropFilter: "saturate(1.4) blur(6px)" }}
    >
      <button
        onClick={alternar}
        aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={abierto}
        className="-ml-1 rounded-md p-1.5 lg:hidden"
        style={{ color: "var(--ink-1)" }}
      >
        {abierto ? <X size={20} /> : <Menu size={20} />}
      </button>

      {donde ? (
        <nav aria-label="Ubicación" className="hidden min-w-0 items-center gap-1.5 text-[13px] md:flex">
          <span className="texto-tenue truncate">{donde.grupo}</span>
          <ChevronRight size={14} className="texto-tenue shrink-0" aria-hidden="true" />
          <span className="truncate font-medium" style={{ color: "var(--ink-1)" }}>
            {donde.pagina}
          </span>
        </nav>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {/* Invisible: mantiene vivo el latido mientras la app está abierta. */}
        <EstadoConexion oculto />
        <a
          href="/api/salir"
          className="salir flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium"
          style={{ color: "var(--ink-2)" }}
          title="Cerrar sesión"
        >
          <LogOut size={15} strokeWidth={2} />
          <span className="hidden sm:inline">Salir</span>
        </a>
      </div>
    </header>
  );
}
