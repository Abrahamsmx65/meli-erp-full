import "server-only";
import { config } from "./config";

const API = "https://api.mercadopago.com";

async function mp<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${ruta}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.mpToken()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${texto.slice(0, 300)}`);
  return JSON.parse(texto) as T;
}

export interface ItemPreferencia {
  id: string;
  title: string;
  quantity: number;
  unit_price: number;
  picture_url?: string | null;
}

/**
 * Checkout Pro: tarjeta, OXXO, SPEI y meses. El pedido viaja como
 * `external_reference` (su id) y el aviso llega a /api/mp/aviso. La
 * preferencia caduca junto con el apartado: pagar después de eso cae en
 * `tienda_marcar_pago`, que vuelve a apartar solo si aún hay pares.
 */
export async function crearPreferencia(p: {
  pedidoId: number;
  folio: string;
  token: string;
  email: string;
  nombre: string;
  items: ItemPreferencia[];
  envio: number;
  expiraEn: Date;
}): Promise<{ id: string; init_point: string }> {
  const base = config.urlTienda();
  const vuelta = `${base}/pedido/${p.folio}?t=${p.token}`;
  return mp("/checkout/preferences", {
    method: "POST",
    headers: { "X-Idempotency-Key": `pref-${p.folio}` },
    body: JSON.stringify({
      // El envío va como un renglón más: así el total que cobra Mercado Pago
      // es exactamente el `total` del pedido (y `pagoCuadra` lo compara).
      items: [
        ...p.items.map((i) => ({ ...i, currency_id: "MXN", picture_url: i.picture_url ?? undefined })),
        ...(p.envio > 0 ? [{ id: "envio", title: "Envío", quantity: 1, unit_price: p.envio, currency_id: "MXN" }] : []),
      ],
      payer: { email: p.email, name: p.nombre },
      external_reference: String(p.pedidoId),
      statement_descriptor: "GETAC",
      notification_url: `${base}/api/mp/aviso`,
      back_urls: { success: vuelta, pending: vuelta, failure: vuelta },
      auto_return: "approved",
      expires: true,
      expiration_date_to: p.expiraEn.toISOString(),
      // OXXO y transferencia: hasta 3 días, igual que el apartado de pendientes.
      date_of_expiration: new Date(Date.now() + 72 * 3_600_000).toISOString(),
      metadata: { folio: p.folio },
    }),
  });
}

export interface PagoMP {
  id: number;
  status: string;
  status_detail?: string;
  transaction_amount?: number;
  external_reference?: string;
  payment_method_id?: string;
  payment_type_id?: string;
  date_approved?: string | null;
}

/** El pago se lee SIEMPRE de Mercado Pago: el aviso solo dice qué leer. */
export async function leerPago(id: string): Promise<PagoMP> {
  return mp(`/v1/payments/${encodeURIComponent(id)}`);
}
