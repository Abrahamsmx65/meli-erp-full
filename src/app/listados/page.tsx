import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarAgrupadores } from "@/lib/servicios/listados";
import { Listados } from "@/components/listados";

export const dynamic = "force-dynamic";

export default async function PaginaListados() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre</h1>
        <Link href="/ajustes" className="mt-3 inline-block underline" style={{ color: "var(--acento)" }}>
          Ir a Ajustes
        </Link>
      </div>
    );
  }

  const agrupadores = await cargarAgrupadores(supabase, cuenta.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Listados</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Busca un agrupador (el modelo: GT135, GT155…) y se leen EN VIVO todas sus
          publicaciones de MELI con sus variantes. Si un atributo trae valores distintos
          entre hermanas —el caso típico: el material, que parte el selector de la página
          del producto— aquí se ve dónde está la diferencia y se unifica con un clic.
        </p>
      </div>

      <Listados agrupadores={agrupadores} />
    </div>
  );
}
