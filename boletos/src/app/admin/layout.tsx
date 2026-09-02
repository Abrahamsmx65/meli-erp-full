import Link from "next/link";
import { adminActual } from "@/lib/auth";
import { accionSalir } from "./acciones";

const ENLACES = [
  { href: "/admin", texto: "Pedidos" },
  { href: "/admin/asistentes", texto: "Asistentes" },
  { href: "/admin/eventos", texto: "Eventos" },
  { href: "/admin/escanear", texto: "📷 Escanear" },
];

export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const admin = await adminActual();

  if (!admin) {
    return (
      <main className="mx-auto grid max-w-md gap-4 px-4 py-24 text-center">
        <h1 className="text-2xl font-extrabold">Sin permiso</h1>
        <p style={{ color: "var(--tinta-2)" }}>
          Tu cuenta entró, pero tu correo no está en la lista de administradores. Agrégalo en la tabla{" "}
          <code>ev_administradores</code>.
        </p>
        <form action={accionSalir}>
          <button className="boton boton-fantasma">Salir</button>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b" style={{ background: "var(--tinta)", borderColor: "transparent", color: "#fff" }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <Link href="/admin" className="font-extrabold">🎟️ Boletos</Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {ENLACES.map((e) => (
              <Link key={e.href} href={e.href} className="rounded-lg px-3 py-1.5 hover:bg-white/10">
                {e.texto}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs opacity-80">
            <span className="hidden sm:inline">{admin.correo}</span>
            <form action={accionSalir}>
              <button className="rounded-lg px-2 py-1 hover:bg-white/10">Salir</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
