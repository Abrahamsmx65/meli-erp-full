/**
 * La guardia del inventario de TikTok: corre en el fondo, no en una pantalla.
 *
 * Los tres números por SKU ya se cruzaban en /tiktok/desfases, pero era una
 * pantalla que nadie abría. Esto hace el mismo cruce en cada corrida del
 * cron, se acuerda DESDE CUÁNDO lleva mal cada SKU (`tiktok_desfases`) y
 * manda UN correo cuando el problema aguanta más de unas horas, que es
 * cuando dejó de ser un parpadeo. Lo que se compone solo desaparece sin
 * molestar a nadie.
 */
import { traerTodo, type DB } from "../datos/repos";
import { cualesAvisar, desfasesPeligrosos, HORAS_PARA_AVISAR, type LecturaSku } from "../tiktok/alarma";
import { correoConfigurado, destinatarioAvisos, enviarCorreo } from "./correo";
import { registrarCorreo } from "./tiktok-faltantes-correo";
import { estadoSalidas3pl } from "./tiktok-3pl";
import { leerEstanteTikTok } from "./tiktok-bodega";

export interface ResultadoAlarma {
  revisados: number;
  peligrosos: number;
  avisados: number;
  resueltos: number;
  correo: string | null;
}

export async function revisarDesfasesTikTok(db: DB, accountId: string): Promise<ResultadoAlarma> {
  const vacio: ResultadoAlarma = { revisados: 0, peligrosos: 0, avisados: 0, resueltos: 0, correo: null };

  const [inv, estante, salidas] = await Promise.all([
    traerTodo<any>(db, "tiktok_inventario", "sku, saldo, apartado", (q) => q.eq("account_id", accountId)),
    leerEstanteTikTok(db, accountId),
    estadoSalidas3pl(db, accountId).catch(() => ({ pendientes: new Map(), confirmadas: new Map() })),
  ]);
  if (!inv?.length) return vacio;

  const lecturas: LecturaSku[] = inv.map((r: any) => ({
    sku: r.sku,
    saldo: r.saldo ?? 0,
    // Sin lectura del 3PL no se juzga a nadie: no se puede distinguir
    // "la bodega tiene cero" de "el API no contestó".
    estante: estante.pares ? (estante.pares.get(r.sku) ?? 0) : null,
    salidasPendientes: salidas.pendientes.get(r.sku) ?? 0,
    apartado: r.apartado ?? 0,
  }));

  const peligrosos = desfasesPeligrosos(lecturas);
  const ahora = new Date().toISOString();

  // Lo que ya se venía arrastrando, para no perder desde cuándo.
  const previos = await traerTodo<any>(db, "tiktok_desfases", "sku, desde, avisado_en", (q) =>
    q.eq("account_id", accountId),
  ).catch(() => []);
  const desdeAntes = new Map<string, { desde: string; avisadoEn: string | null }>(
    (previos ?? []).map((p: any) => [p.sku as string, { desde: p.desde, avisadoEn: p.avisado_en ?? null }]),
  );

  if (peligrosos.length) {
    await db.from("tiktok_desfases").upsert(
      peligrosos.map((d) => ({
        account_id: accountId,
        sku: d.sku,
        desde: desdeAntes.get(d.sku)?.desde ?? ahora,
        visto_en: ahora,
        kardex: d.kardex,
        estante: d.estante,
        motivo: d.motivo,
        avisado_en: desdeAntes.get(d.sku)?.avisadoEn ?? null,
      })),
      { onConflict: "account_id,sku" },
    );
  }

  // Lo que ya cuadró se borra: la lista es la foto de lo que está mal HOY.
  const vivos = new Set(peligrosos.map((d) => d.sku));
  const resueltos = [...desdeAntes.keys()].filter((s) => !vivos.has(s));
  for (let i = 0; i < resueltos.length; i += 200) {
    await db
      .from("tiktok_desfases")
      .delete()
      .eq("account_id", accountId)
      .in("sku", resueltos.slice(i, i + 200));
  }

  // Y el aviso, solo para los que aguantaron las horas y nunca se avisaron.
  const porAvisar = cualesAvisar(
    peligrosos.map((d) => ({
      ...d,
      desde: desdeAntes.get(d.sku)?.desde ?? ahora,
      avisadoEn: desdeAntes.get(d.sku)?.avisadoEn ?? null,
    })),
  );

  let correo: string | null = null;
  if (porAvisar.length && correoConfigurado()) {
    const pares = porAvisar.reduce((a, d) => a + d.deMas, 0);
    const urgentes = porAvisar.filter((d) => d.urgente);
    const filas = porAvisar
      .map((d) => `<tr><td><b>${d.sku}</b></td><td align="right">${d.kardex}</td><td align="right">${d.estante ?? "—"}</td><td>${d.motivo}</td></tr>`)
      .join("");
    const r = await enviarCorreo({
      asunto: urgentes.length
        ? `TikTok: ${urgentes.length} SKU ${urgentes.length === 1 ? "desapareció" : "desaparecieron"} de la bodega con pedidos vendidos sin despachar`
        : `TikTok: ${pares} ${pares === 1 ? "par que no existe" : "pares que no existen"} se están ofreciendo`,
      html:
        (urgentes.length
          ? `<p><b>${urgentes.length} SKU ${urgentes.length === 1 ? "dejó" : "dejaron"} de aparecer en la bodega TikTok de Industher ` +
            `con pares vendidos sin despachar.</b> El kardex NO los dio de baja: hay que confirmar con un conteo ` +
            `si los pares están, o que Industher los regrese; mientras tanto el corte no surte esos pedidos.</p>`
          : "") +
        `<p>El kardex está por encima de lo que la bodega reporta en ${porAvisar.length} SKU` +
        (urgentes.length === porAvisar.length ? "" : `, desde hace más de ${HORAS_PARA_AVISAR} horas`) +
        `. A TikTok ya se le publica el número más bajo de los dos, ` +
        `así que no se está vendiendo de más — pero la diferencia sigue ahí y hay que cerrarla con un conteo.</p>` +
        `<table cellpadding="6" border="1" style="border-collapse:collapse"><tr><th>SKU</th><th>Kardex</th><th>Bodega</th><th>Qué pasa</th></tr>${filas}</table>`,
      texto: porAvisar.map((d) => `${d.sku}: kardex ${d.kardex}, bodega ${d.estante ?? "—"}. ${d.motivo}`).join("\n"),
    });
    correo = r.enviado ? "enviado" : (r.motivo ?? "no se pudo enviar");
    await registrarCorreo(db, accountId, "correo-alarma", destinatarioAvisos() ?? "", `TikTok: ${pares} pares que no existen se están ofreciendo`, r);
    if (r.enviado) {
      await db
        .from("tiktok_desfases")
        .update({ avisado_en: ahora })
        .eq("account_id", accountId)
        .in("sku", porAvisar.map((d) => d.sku));
    }
  }

  return {
    revisados: lecturas.length,
    peligrosos: peligrosos.length,
    avisados: correo === "enviado" ? porAvisar.length : 0,
    resueltos: resueltos.length,
    correo,
  };
}
