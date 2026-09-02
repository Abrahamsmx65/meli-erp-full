import { FormularioLogin } from "./formulario";

export default async function PaginaLogin({ searchParams }: { searchParams: Promise<{ volver?: string }> }) {
  const { volver } = await searchParams;
  return (
    <main className="mx-auto grid min-h-dvh max-w-sm content-center gap-6 px-4">
      <div className="text-center">
        <div className="text-3xl">🎟️</div>
        <h1 className="mt-2 text-2xl font-extrabold">Panel del organizador</h1>
        <p className="text-sm" style={{ color: "var(--tinta-suave)" }}>
          Entra con tu correo y contraseña.
        </p>
      </div>
      <div className="tarjeta p-6">
        <FormularioLogin volver={volver && volver.startsWith("/admin") ? volver : "/admin"} />
      </div>
    </main>
  );
}
