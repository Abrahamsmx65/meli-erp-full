/**
 * Las fábricas y el FORMATO de proforma de cada una (dueño, 11-oct-2026:
 * «quiero que tú hagas la fábrica y lo hagas en su formato»).
 *
 * Cada fábrica manda su Proforma Invoice a su manera; el ERP arma el pedido
 * en ESE formato (columnas, encabezado, moneda y notas copiados de sus
 * proformas reales en `fixtures/`), así la fábrica lo reconoce como suyo y
 * el lector de proformas lo vuelve a leer igual cuando regrese firmado.
 *
 *   chaozhou  CHAOZHOU YINGYUAN (IN10148, IN10157): USD; un renglón por color
 *             con las CAJAS de cada talla cuando son cajas de una sola talla.
 *   jinjiang  JINJIANG HANDSOME (IN10159, IN10160): RMB; una fila por talla
 *             con las CAJAS bajo la talla; precio distinto por talla en fila
 *             de continuación.
 *   mingtai   FUJIAN MINGTAI (IN10151, IN10152): RMB.
 *   jiaxing   JIAXING INNOVATIVE (IN10172): USD; los pares por caja bajo la
 *             talla en las cajas de una sola talla.
 *   fuzhou    FUZHOU KC TRADING (IN10163): USD ("US$1.030").
 *   sencillo  HUAIAN TENGCHUANG (IN10173) y cualquier otra fábrica: una
 *             tabla limpia con el mismo orden de columnas.
 *
 * La moneda del perfil es la que la fábrica ha usado en sus proformas; para
 * una fábrica sin perfil se toma la de su último pedido y, si nunca se supo,
 * se pide en el borrador. Nunca se supone.
 */
import type { Moneda } from "../importar/proforma";

export type FormatoFabrica = "chaozhou" | "jinjiang" | "mingtai" | "jiaxing" | "fuzhou" | "sencillo";

export interface PerfilFabrica {
  /** clave estable (se guarda en el borrador) */
  clave: string;
  /** nombre como lo escribe la fábrica en su proforma */
  nombre: string;
  /** cómo se reconoce en `pedidos.proveedor` de pedidos viejos */
  reconoce: RegExp;
  formato: FormatoFabrica;
  moneda: Moneda | null;
  /** renglones de dirección y teléfono bajo el nombre */
  direccion: string[];
  pago: string;
  entrega: string;
  /** notas al pie, tal cual las pone la fábrica (sin datos bancarios) */
  notas: string[];
}

/** El comprador, como lo escriben las fábricas en sus proformas. */
export const COMPRADOR = {
  nombre: "CASESHOP SA DE CV",
  direccion: "AV PRESIDENTE MAZARIK 531, INT 101, POLANCO II, MIGUEL HIDALGO, CIUDAD DE MEXICO CP 11530 RFC CAS2011039W5",
};

export const FABRICAS: PerfilFabrica[] = [
  {
    clave: "chaozhou",
    nombre: "CHAOZHOU YINGYUAN SHOES CO., LTD.",
    reconoce: /CHAOZHOU\s+YINGYUAN/i,
    formato: "chaozhou",
    moneda: "USD",
    direccion: ["YINGTANG, FENGXI, CHAOZHOU, GUANGDONG, CHINA", "TEL.: 0086-768-2979568   FAX: 0086-768-2978209"],
    pago: "BY TT",
    entrega: "FOB YANTIAN",
    notas: ["1) Term of Payment: T/T, 30% deposit, balance before shipment"],
  },
  {
    clave: "jinjiang",
    nombre: "JINJIANG HANDSOME SHOE CO.,LTD",
    reconoce: /JINJIANG\s+HANDSOME/i,
    formato: "jinjiang",
    moneda: "RMB",
    direccion: [
      "NO.66 JIANXI ROAD ,LISHAN VILLAGE ,NEIKENG TOWN ,JINJIANG CITY",
      "TEL:86-0595-88386788  FAX:86-0595-88385666",
    ],
    pago: "30% deposit . Balance before shipment .",
    entrega: "FOB XIAMEN",
    notas: [],
  },
  {
    clave: "mingtai",
    nombre: "Fujian  Mingtai Shoes Co.,Ltd.",
    reconoce: /MINGTAI/i,
    formato: "mingtai",
    moneda: "RMB",
    direccion: ["Neihu Light Industry Area,Neikeng,Jinjiang City,Fujian,China   TEL:86-595-88385292 FAX:86-595-88392292"],
    pago: "100% PAYMENT SHOULD BE EFFECTED WHEN SEEING THE COPY OF B/L BY EMAIL OR FAX.",
    entrega: "FOB Xiamen",
    notas: [
      "1 . PAYMENT :100% PAYMENT SHOULD BE EFFECTED WHEN SEEING THE COPY OF B/L BY EMAIL OR FAX.",
      "2.PACKING: OPP BAG PER PAIR WITH ONE HANGTAG, IMPORTER STICKER, SIZE STICKER.",
      "3. DELIVERY(交货期) :",
      "中底不用印刷商标GETAC，袋外需贴一个条码标（后面提供）",
    ],
  },
  {
    clave: "jiaxing",
    nombre: "Jiaxing Innovative Manufactory  Ltd.",
    reconoce: /JIAXING\s+INNOVATIVE/i,
    formato: "jiaxing",
    moneda: "USD",
    direccion: ["38 Xincun Road, Shimen Town, Tongxiang, Zhejiang, China     Tel: 0086 573-88615885"],
    pago: "100% PAYMENT SHOULD BE EFFECTED WHEN SEEING THE COPY OF B/L BY EMAIL OR FAX.",
    entrega: "FOB Shanghai",
    notas: [
      "1 . PAYMENT :100% PAYMENT SHOULD BE EFFECTED WHEN SEEING THE COPY OF B/L BY EMAIL OR FAX.",
      "2.PACKING: OPP BAG PER PAIR WITH ONE HANGTAG, IMPORTER STICKER, SIZE STICKER.",
      "3. DELIVERY(交货期) :",
      "中底不用印刷商标GETAC，袋外需贴一个条码标（后面提供）",
      "带面印刷GETAC",
    ],
  },
  {
    clave: "fuzhou",
    nombre: "Fuzhou KC Trading Co., Ltd.",
    reconoce: /FUZHOU\s+KC/i,
    formato: "fuzhou",
    moneda: "USD",
    direccion: [
      "Add.: 422, BUILDING 1, VANKE FINANCIAL PORT , NO. 16 AOGANG ROAD, AOFENG STREET, TAIJIANG DISTRICT , FUZHOU , FUJIAN",
      "Tel: 0086-591-83783266  Phone:0086-18150815662  E-mail: sales1@minyishoes.com",
    ],
    pago: "T/T",
    entrega: "FOB XIAMEN",
    notas: [],
  },
  {
    clave: "tengchuang",
    nombre: "Huaian Tengchuang Footwear Co., Ltd.",
    reconoce: /TENGCHUANG/i,
    formato: "sencillo",
    moneda: "USD",
    direccion: [],
    pago: "30% anticipo · 70% saldo antes de embarque",
    entrega: "FOB",
    notas: [],
  },
];

/** Limpia el nombre que el lector sacó de la proforma ("SELLERS:WENZHOU …  S/C NO.: …"). */
export function nombreLimpio(proveedor: string): string {
  return proveedor
    .replace(/^\s*(SELLERS?|SHIPPER|供货方)\s*[:：]\s*/i, "")
    .replace(/\s{2,}.*$/, "")
    .replace(/\s*(S\/C|PI|INVOICE|订单编号).*$/i, "")
    .trim()
    .slice(0, 120);
}

export function perfilPorClave(clave: string | null | undefined): PerfilFabrica | null {
  if (!clave) return null;
  return FABRICAS.find((f) => f.clave === clave) ?? null;
}

/**
 * El perfil de la fábrica de un pedido viejo. Una fábrica sin formato
 * conocido sale con el formato sencillo y SIN moneda (la da su historia).
 */
export function perfilDeProveedor(proveedor: string | null | undefined): PerfilFabrica | null {
  if (!proveedor?.trim()) return null;
  const conocido = FABRICAS.find((f) => f.reconoce.test(proveedor));
  if (conocido) return conocido;
  const nombre = nombreLimpio(proveedor);
  if (!nombre) return null;
  return {
    clave: `otra:${nombre.toUpperCase()}`,
    nombre,
    reconoce: new RegExp(nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    formato: "sencillo",
    moneda: null,
    direccion: [],
    pago: "",
    entrega: "FOB",
    notas: [],
  };
}

/** Perfil por la clave guardada en el borrador ("chaozhou", "otra:NOMBRE"). */
export function perfilDeClave(clave: string | null | undefined): PerfilFabrica | null {
  if (!clave) return null;
  if (clave.startsWith("otra:")) return perfilDeProveedor(clave.slice(5));
  return perfilPorClave(clave);
}
