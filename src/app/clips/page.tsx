import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { ClipsMeli } from "@/components/clips-meli";

export const dynamic = "force-dynamic";

export default async function Clips() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Los clips viven en las publicaciones de Mercado Libre; primero hay que conectarlo.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Clips en variantes</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Con el agrupador de variantes cada color es su propia publicación: el clip que subes a
          una se ve en la página agrupada, pero MELI se lo cuenta solo a esa y las hermanas
          pierden exposición. Aquí se ve qué publicaciones <strong>activas</strong> tienen clip
          y, con un botón, se aplica el video de una hermana a las que no lo tienen (MELI lo
          pasa por su moderación, tarda unas horas en verse).
        </p>
      </div>

      <ClipsMeli />
    </div>
  );
}
