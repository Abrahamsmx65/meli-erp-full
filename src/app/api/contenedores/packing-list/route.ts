import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { importarPackingList } from "@/lib/importar/packing-list";
import { aplicarPackingList, casarPackingList } from "@/lib/servicios/packing-list";
import { avisarFotosDeContenedor } from "@/lib/servicios/fotos-contenedor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Packing list de la fábrica → contenedor, en dos pasos:
 *
 *   accion=previsualizar -> lee el archivo, lo casa con los pedidos y
 *                           devuelve qué VA a pasar, sin guardar.
 *   accion=confirmar     -> vuelve a leer y casar (contra la base de este
 *                           momento) y aplica.
 *
 * Separados a propósito: un contenedor mal capturado cambia lo que el
 * planeador ve "en camino" y el estado de los pedidos.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta Mercado Libre." }, { status: 400 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Se esperaba un archivo." }, { status: 400 });

  const archivo = form.get("archivo");
  const accion = String(form.get("accion") ?? "previsualizar");
  const texto = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };

  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo del packing list." }, { status: 400 });
  }
  if (archivo.size > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo pesa más de 8 MB." }, { status: 400 });
  }

  let packing;
  try {
    const buffer = Buffer.from(await archivo.arrayBuffer());
    packing = await importarPackingList(buffer, { nombre: archivo.name });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Nuestro ID = la referencia del embarque (S259-2026); el ISO del
  // contenedor es el número de la naviera.
  const numero = texto("numero") || packing.referencia || packing.contenedor || "";

  try {
    const casado = await casarPackingList(supabase, cuenta.id, packing, numero);

    if (accion === "previsualizar") {
      return NextResponse.json({ ok: true, packing, casado, archivo: archivo.name });
    }

    if (!casado.numero) {
      return NextResponse.json(
        { error: "Falta el número de contenedor: el archivo no lo trae, ponlo a mano." },
        { status: 400 },
      );
    }

    const r = await aplicarPackingList(supabase, cuenta.id, casado, {
      numeroNaviera: texto("numeroNaviera") || packing.contenedor || null,
      naviera: texto("naviera") || null,
      fechaSalida: texto("fechaSalida") || null,
      fechaLlegadaEst: texto("fechaLlegadaEst") || null,
      estado: texto("estado") || "en_transito",
      notas: texto("notas") || (packing.referencia ? `Packing list ${packing.referencia}` : null),
    });

    // Contenedor nuevo → correo con las fotos que faltan (decisión del
    // dueño), después de contestar: revisa MELI y Amazon y tarda.
    if (!r.existia) {
      const accountId = cuenta.id;
      after(() => avisarFotosDeContenedor(clienteAdmin(), accountId, r.contenedorId));
    }

    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
