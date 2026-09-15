/**
 * Revisión general: el sistema se delata solo.
 *
 * Decisión del dueño (11-sep-2026), después de tres rondas de «tú lo
 * encuentras, yo lo parcho»: Amazon desapareció del corte de julio por un
 * timeout, fundas desapareció del de mayo por otro, y la facturación de MELI
 * de mayo, junio y julio nunca se leyó. En los TRES casos el sistema YA lo
 * sabía —estaba escrito en los avisos del renglón guardado— y el dueño tuvo
 * que ir a buscarlo pantalla por pantalla.
 *
 * Aquí se juntan esos hechos en un solo lugar, separados en dos montones:
 *
 *  · GRAVE: hay un número EN PANTALLA que está mal o incompleto sin que se
 *    note. Un canal caído, un mes que no cuadra contra sus propios canales,
 *    una fuente que se murió por timeout, un saldo negativo.
 *  · FALTA: el dato todavía no llega y el sistema ya lo declara. No está
 *    mal, está incompleto, y se completa solo.
 *
 * Las reglas son funciones PURAS y se prueban con los casos reales que
 * pasaron. La lectura va por RPC (`salud_cortes`, migración 0085) porque
 * `consolidado_cache.datos` pesa megas por mes.
 */
import type { DB } from "../datos/repos";

export type Severidad = "grave" | "falta";

export interface Hallazgo {
  area: string;
  periodo: string | null;
  severidad: Severidad;
  /** Qué está mal, en una línea, sin jerga. */
  que: string;
  /** El dato que lo prueba. */
  detalle: string;
}

/** Los canales que un corte general debe traer siempre. */
export const CANALES_ESPERADOS = ["amazon", "meli_calzado", "meli_fundas"] as const;

export const NOMBRE_CANAL: Record<string, string> = {
  meli_calzado: "Calzado · Mercado Libre",
  meli_fundas: "Fundas · Mercado Libre",
  amazon: "Amazon",
};

export interface MesDeCorte {
  periodo: string;
  generadoEn: string | null;
  vigente: boolean;
  motivo: string | null;
  canales: string[];
  ventaTotal: number | null;
  ventaCanales: number | null;
  exacto: boolean;
  avisos: number;
  avisosTimeout: number;
}

/**
 * Lo que le pasa a UN mes del corte general. Puro.
 *
 * `canalesEsperados` se pasa para no gritar por un canal que el negocio
 * todavía no tiene conectado.
 */
export function hallazgosDelMes(
  m: MesDeCorte,
  canalesEsperados: readonly string[] = CANALES_ESPERADOS,
): Hallazgo[] {
  const out: Hallazgo[] = [];
  const area = "Corte general";

  // 1. Un canal que no está. Así desapareció Amazon de julio y fundas de mayo.
  const faltantes = canalesEsperados.filter((c) => !m.canales.includes(c));
  for (const canal of faltantes) {
    out.push({
      area,
      periodo: m.periodo,
      severidad: "grave",
      que: `${NOMBRE_CANAL[canal] ?? canal} no está en el corte: el mes se está enseñando SIN ese canal.`,
      detalle: m.motivo
        ? `El renglón guardado dice: ${m.motivo}`
        : `El corte trae ${m.canales.length} canal(es): ${m.canales.map((c) => NOMBRE_CANAL[c] ?? c).join(", ") || "ninguno"}.`,
    });
  }

  // 2. Una fuente que se murió. El aviso ya lo dice; aquí se grita.
  if (m.avisosTimeout > 0 && faltantes.length === 0) {
    out.push({
      area,
      periodo: m.periodo,
      severidad: "grave",
      que: "Una fuente del mes no respondió (timeout o error) y el corte se armó sin ella.",
      detalle: `${m.avisosTimeout} aviso(s) del mes hablan de una fuente caída. Ábrelos en Cortes.`,
    });
  }

  // 3. El invariante que no se negocia: el total tiene que ser la suma de
  //    sus canales. Si no cuadra, hay un número inventado en la pantalla.
  if (m.ventaTotal != null && m.ventaCanales != null) {
    const diferencia = Math.abs(m.ventaTotal - m.ventaCanales);
    if (diferencia > Math.max(1, Math.abs(m.ventaTotal) * 0.0001)) {
      out.push({
        area,
        periodo: m.periodo,
        severidad: "grave",
        que: "La venta del mes no cuadra con la suma de sus canales.",
        detalle: `Total ${pesos(m.ventaTotal)} contra ${pesos(m.ventaCanales)} sumando los canales: sobran ${pesos(diferencia)}.`,
      });
    }
  }

  // 4. Marcado para rehacerse y ahí sigue. Un rato es normal; un día no.
  if (!m.vigente && esViejo(m.generadoEn, 24)) {
    out.push({
      area,
      periodo: m.periodo,
      severidad: "falta",
      que: "El corte lleva más de un día marcado para recalcularse y no se ha rehecho.",
      detalle: m.motivo ?? "Sin motivo guardado.",
    });
  }

  return out;
}

/** Una fuente del mes que nunca se leyó: el corte sale incompleto y calla. */
export function hallazgosDeFuente(opts: {
  area: string;
  periodo: string;
  que: string;
  detalle: string;
  hay: boolean;
  /** Un mes del pasado sin su dato ya no se va a arreglar solo. */
  mesCerrado: boolean;
}): Hallazgo[] {
  if (opts.hay) return [];
  return [{
    area: opts.area,
    periodo: opts.periodo,
    severidad: opts.mesCerrado ? "grave" : "falta",
    que: opts.que,
    detalle: opts.detalle,
  }];
}

/** Un trabajo de fondo que dejó de correr. */
export function hallazgoDeSincronizacion(
  nombre: string,
  ultima: string | null,
  horasMaximas: number,
): Hallazgo[] {
  if (ultima && !esViejo(ultima, horasMaximas)) return [];
  return [{
    area: "Sincronización",
    periodo: null,
    severidad: "grave",
    que: `${nombre} lleva demasiado sin correr: lo que alimenta está quedándose viejo.`,
    detalle: ultima
      ? `Última corrida: ${ultima} (el tope son ${horasMaximas} h).`
      : "Nunca ha corrido, o no dejó bitácora.",
  }];
}

function esViejo(cuando: string | null, horas: number, ahora = Date.now()): boolean {
  if (!cuando) return true;
  const t = Date.parse(cuando);
  if (!Number.isFinite(t)) return true;
  return ahora - t > horas * 3_600_000;
}

const pesos = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });

export interface Salud {
  revisadoEn: string;
  graves: Hallazgo[];
  faltas: Hallazgo[];
  /** Meses revisados, para que la pantalla diga qué alcanzó a mirar. */
  meses: string[];
  /** Lo que la propia revisión no pudo leer: no se calla. */
  errores: string[];
}

/** El mes en curso en hora de México. */
const periodoActualMx = (): string =>
  new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 7);

/**
 * La revisión completa. Lecturas chicas y acotadas: el RPC de los meses más
 * unos conteos. No calcula ningún corte.
 */
export async function revisarSalud(
  db: DB,
  cuenta: { id: string },
  opts: { yzAccountId?: string | null; amazonAccountId?: string | null } = {},
): Promise<Salud> {
  const graves: Hallazgo[] = [];
  const faltas: Hallazgo[] = [];
  const errores: string[] = [];
  const meses: string[] = [];
  const hoy = periodoActualMx();
  const agregar = (hs: Hallazgo[]) => {
    for (const h of hs) (h.severidad === "grave" ? graves : faltas).push(h);
  };

  // --- Los meses del corte general ----------------------------------------
  const canalesEsperados = CANALES_ESPERADOS.filter(
    (c) => (c !== "meli_fundas" || opts.yzAccountId) && (c !== "amazon" || opts.amazonAccountId),
  );
  try {
    const { data, error } = await (db as any).rpc("salud_cortes", { p_account: cuenta.id });
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as any[]) {
      meses.push(f.periodo);
      agregar(hallazgosDelMes({
        periodo: f.periodo,
        generadoEn: f.generado_en ?? null,
        vigente: f.vigente !== false,
        motivo: f.motivo ?? null,
        canales: (f.canales ?? []) as string[],
        ventaTotal: f.venta_total == null ? null : Number(f.venta_total),
        ventaCanales: f.venta_canales == null ? null : Number(f.venta_canales),
        exacto: f.exacto === true,
        avisos: Number(f.avisos) || 0,
        avisosTimeout: Number(f.avisos_timeout) || 0,
      }, canalesEsperados));
    }
  } catch (err) {
    errores.push(`No se pudieron revisar los cortes: ${(err as Error).message}`);
  }

  // --- Las fuentes de dinero, mes por mes ---------------------------------
  // La facturación de MELI de mayo, junio y julio nunca se leyó y los gastos
  // de Full de esos meses salieron en cero sin que nadie lo gritara.
  const revisados = meses.length ? meses : [hoy];
  try {
    const { data } = await db
      .from("meli_cargos")
      .select("periodo")
      .eq("account_id", cuenta.id)
      .in("periodo", revisados);
    const conCargos = new Set((data ?? []).map((c: any) => String(c.periodo)));
    for (const periodo of revisados) {
      agregar(hallazgosDeFuente({
        area: "Facturación de MELI",
        periodo,
        que: "No se ha leído la facturación de MELI del mes: los gastos de Full salen en cero.",
        detalle: "En el corte, «Gastos descontados aparte» solo trae lo capturado a mano. Se lee en el latido.",
        hay: conCargos.has(periodo),
        mesCerrado: periodo < hoy,
      }));
    }
  } catch (err) {
    errores.push(`Facturación de MELI: ${(err as Error).message}`);
  }

  // --- TikTok: un saldo negativo es que se vendió algo que no existe -------
  try {
    const { data } = await db
      .from("tiktok_inventario")
      .select("sku, saldo")
      .eq("account_id", cuenta.id)
      .lt("saldo", 0)
      .limit(50);
    const rojos = (data ?? []) as { sku: string; saldo: number }[];
    if (rojos.length) {
      graves.push({
        area: "TikTok",
        periodo: null,
        severidad: "grave",
        que: `${rojos.length} SKU con saldo NEGATIVO: se vendió algo que nunca entró al kardex.`,
        detalle: rojos.slice(0, 5).map((r) => `${r.sku} (${r.saldo})`).join(", "),
      });
    }
  } catch (err) {
    errores.push(`Inventario de TikTok: ${(err as Error).message}`);
  }

  return {
    revisadoEn: new Date().toISOString(),
    graves,
    faltas,
    meses,
    errores,
  };
}

/** El correo de la revisión: solo se manda si hay algo GRAVE. */
export function correoDeSalud(s: Salud): { asunto: string; html: string; texto: string } | null {
  if (s.graves.length === 0) return null;
  const esc = (x: string) => x.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);
  const asunto = `ERP: ${s.graves.length} problema(s) en los números`;
  const filas = s.graves
    .map((h) => `<li><strong>${esc(h.area)}${h.periodo ? ` · ${esc(h.periodo)}` : ""}</strong><br>${esc(h.que)}<br><span style="color:#666;font-size:12px">${esc(h.detalle)}</span></li>`)
    .join("");
  const html = `
<p>La revisión general encontró <strong>${s.graves.length}</strong> cosa(s) que hacen que un número
de los cortes esté mal o incompleto sin que se note:</p>
<ul style="font-family:sans-serif;font-size:13px">${filas}</ul>
${s.faltas.length ? `<p style="color:#666;font-size:12px">Además hay ${s.faltas.length} dato(s) que todavía no llegan; esos se completan solos.</p>` : ""}
<p style="font-size:12px"><a href="https://meli-erp-full.vercel.app/salud">Abrir la revisión general</a></p>`;
  const texto = [
    `${asunto}.`,
    ...s.graves.map((h) => `- ${h.area}${h.periodo ? ` ${h.periodo}` : ""}: ${h.que} (${h.detalle})`),
  ].join("\n");
  return { asunto, html, texto };
}

/**
 * La revisión del cron diario: si hay algo grave, correo. Nunca lanza —
 * un correo que falla no debe tumbar el cron.
 */
export async function avisarSalud(
  db: DB,
  cuenta: { id: string },
  opts: { yzAccountId?: string | null; amazonAccountId?: string | null } = {},
): Promise<{ graves: number; faltas: number; enviado: boolean; motivo?: string }> {
  const { correoConfigurado, enviarCorreo } = await import("./correo");
  const salud = await revisarSalud(db, cuenta, opts);
  const correo = correoDeSalud(salud);
  if (!correo) return { graves: 0, faltas: salud.faltas.length, enviado: false };
  if (!correoConfigurado()) {
    return { graves: salud.graves.length, faltas: salud.faltas.length, enviado: false, motivo: "Correo sin configurar." };
  }
  const env = await enviarCorreo(correo).catch((err) => ({ enviado: false, motivo: (err as Error).message }));
  return { graves: salud.graves.length, faltas: salud.faltas.length, enviado: env.enviado, motivo: env.motivo };
}
