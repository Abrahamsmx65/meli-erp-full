/**
 * Pedidos pendientes desde el Google Sheets "PENDING ORDERS SHOES INTERNET".
 *
 * La operación lleva en un sheet la lista de pedidos vivos con la fábrica:
 * una sección por fábrica ("Chaozhou / Jieyang", "Jinjiang"…), y en cada
 * renglón el número de pedido en la columna A, los modelos en la B, los
 * pares en la C y la fecha planeada de embarque en la G. Aquí se lee esa
 * pestaña y se cruza contra los pedidos ya cargados en el ERP, para gritar
 * arriba cuáles faltan.
 *
 * Los que empiezan con "AR" NO son de este negocio: se ignoran por decisión
 * del dueño.
 *
 * Se descarga como CSV de la pestaña exacta (el `gid` de la URL), sin
 * llaves ni OAuth: basta que el sheet esté compartido como "cualquiera con
 * el enlace puede ver". La URL vive en PEDIDOS_SHEET_URL; si no está, se
 * usa la del sheet del negocio.
 */
import { canonizar } from "../importar/sku";
import type { Filas } from "../importar/leer-hoja";
import type { DB } from "../datos/repos";

export const URL_SHEET_PEDIDOS_OMISION =
  "https://docs.google.com/spreadsheets/d/18Pr9b6q2hDqZIWkX0uBX4g-ihfdi6tSpx6KKmYby7C8/edit?gid=0#gid=0";

/** Prefijos de pedido que no son de este negocio. */
const PREFIJOS_AJENOS = ["AR"];

export interface PedidoDelSheet {
  pedido: string;
  fabrica: string | null;
  modelos: string | null;
  pares: number | null;
  /** texto tal cual del sheet ("Sep 25", "Goods Ready") */
  embarque: string | null;
  fila: number;
}

export interface FaltantesSheet {
  /** pedidos del sheet que NO están cargados en el ERP */
  faltan: PedidoDelSheet[];
  /** pedidos del sheet que sí están cargados */
  cargados: PedidoDelSheet[];
  /** pedidos AR* y demás que se dejaron fuera */
  ignorados: string[];
  leidoEn: string;
}

export function configuracionSheetPedidos(): { url: string; csv: string } {
  const cruda =
    (process.env.PEDIDOS_SHEET_URL ?? "").trim().replace(/^["']+|["']+$/g, "") ||
    URL_SHEET_PEDIDOS_OMISION;
  return { url: cruda, csv: urlCsvSheets(cruda) };
}

/**
 * De la URL del navegador a la URL que baja UNA pestaña como CSV. El gid
 * viaja en la URL (`?gid=0` o `#gid=0`); si no viene, es la primera.
 */
export function urlCsvSheets(url: string): string {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) {
    throw new Error(
      "PEDIDOS_SHEET_URL no parece una URL de Google Sheets (docs.google.com/spreadsheets/d/…).",
    );
  }
  const gid = url.match(/[?#&]gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

/** CSV según RFC 4180: comillas, comas dentro de comillas y saltos de línea. */
export function leerCsv(texto: string): Filas {
  const filas: Filas = [];
  let fila: string[] = [];
  let celda = "";
  let entreComillas = false;
  const limpio = texto.replace(/^﻿/, "");

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        celda += c;
      }
      continue;
    }
    if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      fila.push(celda.trim());
      celda = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(celda.trim());
      filas.push(fila);
      fila = [];
      celda = "";
    } else {
      celda += c;
    }
  }
  if (celda.length || fila.length) {
    fila.push(celda.trim());
    filas.push(fila);
  }
  return filas;
}

/** "IN10127" sí; "GT268-GT271", "June 24" y "SENT" no. */
export function esNumeroDePedido(s: string): boolean {
  return /^[A-Z]{2,4}\d{4,}$/.test(s.trim().toUpperCase());
}

export function esPedidoAjeno(pedido: string): boolean {
  const p = pedido.toUpperCase();
  return PREFIJOS_AJENOS.some((pre) => p.startsWith(pre));
}

/**
 * Saca los pedidos de las filas ya leídas (del CSV o de un xlsx).
 *
 * Un renglón cuya primera celda es un número de pedido es un pedido; un
 * renglón cuya primera celda es texto sin número (y sin nada más de valor)
 * es el encabezado de una fábrica, que se le pega a los pedidos de abajo.
 */
export function pedidosDeFilas(filas: Filas): { pedidos: PedidoDelSheet[]; ignorados: string[] } {
  const pedidos: PedidoDelSheet[] = [];
  const ignorados: string[] = [];
  const vistos = new Set<string>();
  let fabrica: string | null = null;

  filas.forEach((f, i) => {
    const primera = (f[0] ?? "").trim();
    if (!primera) return;

    if (esNumeroDePedido(primera)) {
      const pedido = primera.toUpperCase();
      if (esPedidoAjeno(pedido)) {
        ignorados.push(pedido);
        return;
      }
      if (vistos.has(pedido)) return;
      vistos.add(pedido);
      const pares = Number(String(f[2] ?? "").replace(/[, ]/g, ""));
      pedidos.push({
        pedido,
        fabrica,
        modelos: (f[1] ?? "").trim() || null,
        pares: Number.isFinite(pares) && pares > 0 ? pares : null,
        embarque: (f[6] ?? "").trim() || null,
        fila: i + 1,
      });
      return;
    }

    // Encabezado de fábrica: texto en la A sin número de pedido ("Chaozhou /
    // Jieyang", "Jinjiang"…). En la primera fila la fábrica comparte renglón
    // con los títulos de columna ("Qtys", "Confirm"…) y sigue siendo la
    // fábrica. Un "Total" o un título de columna suelto no lo es.
    if (!/\d{3,}/.test(primera) && !/^(total|pedido|order|po|no\.?)$/i.test(primera)) {
      fabrica = primera;
    }
  });

  return { pedidos, ignorados };
}

/** Descarga la pestaña como CSV. Nunca requiere credenciales. */
export async function descargarSheetPedidos(): Promise<string> {
  const { csv } = configuracionSheetPedidos();

  let respuesta: Response;
  try {
    respuesta = await fetch(csv, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      throw new Error("Google Sheets no contestó en 20 segundos.");
    }
    throw new Error(`No se pudo alcanzar Google Sheets: ${e.message}`);
  }

  if (!respuesta.ok) {
    throw new Error(
      `Google Sheets contestó ${respuesta.status}. Revisa que el sheet de pedidos esté compartido como "cualquiera con el enlace puede ver".`,
    );
  }

  const texto = await respuesta.text();
  // Si llega HTML es la pantalla de inicio de sesión de Google.
  if (/^\s*<(!doctype|html)/i.test(texto)) {
    throw new Error(
      'Google regresó una página de inicio de sesión en vez del archivo: el sheet de pedidos no es público. Compártelo como "cualquiera con el enlace puede ver" (solo lectura).',
    );
  }
  return texto;
}

/** Los pedidos que hay que cargar según el sheet, contra los del ERP. */
export async function faltantesDelSheet(db: DB, accountId: string): Promise<FaltantesSheet> {
  const texto = await descargarSheetPedidos();
  const { pedidos, ignorados } = pedidosDeFilas(leerCsv(texto));

  const { data } = await db.from("pedidos").select("pedido").eq("account_id", accountId);
  const cargados = new Set((data ?? []).map((p: { pedido: string }) => canonizar(p.pedido)));

  return {
    faltan: pedidos.filter((p) => !cargados.has(canonizar(p.pedido))),
    cargados: pedidos.filter((p) => cargados.has(canonizar(p.pedido))),
    ignorados,
    leidoEn: new Date().toISOString(),
  };
}
