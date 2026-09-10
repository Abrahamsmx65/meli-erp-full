import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { configDrive, enlaceDrive, listarCarpetaDrive } from "@/lib/servicios/drive";
import { numeroDeEmbarque } from "@/lib/servicios/drive-packing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Los documentos que la fábrica dejó en la carpeta de Drive de ESTE
 * embarque, con su enlace, para mandarlos por correo desde la pantalla
 * (decisión del dueño: el borrador se abre en su correo con todo dentro).
 * Se entra SOLO a la subcarpeta del contenedor, no a toda la carpeta.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta Mercado Libre." }, { status: 400 });

  const { data: contenedor } = await supabase
    .from("contenedores")
    .select("numero, numero_naviera")
    .eq("id", id)
    .eq("account_id", cuenta.id)
    .maybeSingle();
  if (!contenedor) return NextResponse.json({ error: "Contenedor no encontrado." }, { status: 404 });

  const embarque = numeroDeEmbarque(contenedor.numero);
  if (embarque == null) {
    return NextResponse.json(
      { error: `De "${contenedor.numero}" no sale un número de embarque (S259…), así que no sé qué carpeta de Drive es.` },
      { status: 400 },
    );
  }

  try {
    const archivos = await listarCarpetaDrive(configDrive(), {
      omitirCarpeta: (nombre) => numeroDeEmbarque(nombre) !== embarque,
    });
    const suyos = archivos
      .filter((a) => numeroDeEmbarque(a.carpeta) === embarque || numeroDeEmbarque(a.nombre) === embarque)
      .map((a) => ({ nombre: a.nombre, carpeta: a.carpeta ?? null, enlace: enlaceDrive(a) }));
    return NextResponse.json({
      numero: contenedor.numero,
      numeroNaviera: contenedor.numero_naviera ?? null,
      archivos: suyos,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
