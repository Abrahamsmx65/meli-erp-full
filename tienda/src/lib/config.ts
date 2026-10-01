import "server-only";

/** Variables de entorno de la tienda. Todas se leen solo en el servidor. */
function obligatoria(nombre: string): string {
  const v = (process.env[nombre] ?? "").trim();
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}.`);
  return v;
}

export const config = {
  supabaseUrl: () => obligatoria("SUPABASE_URL"),
  supabaseServiceKey: () => obligatoria("SUPABASE_SERVICE_ROLE_KEY"),
  /** La cuenta del ERP (meli_accounts.id) cuyo almacén TikTok se vende aquí. */
  cuenta: () => obligatoria("TIENDA_ACCOUNT_ID"),
  /** https://getac.mx (sin diagonal final) */
  urlTienda: () => obligatoria("TIENDA_URL").replace(/\/+$/, ""),
  mpToken: () => obligatoria("MP_ACCESS_TOKEN"),
  /** https://meli-erp-full.vercel.app — para avisarle que el inventario cambió. */
  urlErp: () => (process.env.ERP_URL ?? "https://meli-erp-full.vercel.app").trim().replace(/\/+$/, ""),
  secretoErp: () => (process.env.TIENDA_SECRET ?? "").trim(),
  /** Firma de cookies y de códigos de acceso. */
  secretoSesion: () => obligatoria("TIENDA_SESION_SECRET"),
  envio: () => ({
    costo: Number(process.env.ENVIO_COSTO ?? 149) || 0,
    gratisDesde: process.env.ENVIO_GRATIS_DESDE ? Number(process.env.ENVIO_GRATIS_DESDE) : 999,
  }),
  resendKey: () => (process.env.RESEND_API_KEY ?? "").trim(),
  remitente: () => (process.env.CORREO_REMITENTE ?? "GETAC <onboarding@resend.dev>").trim(),
};
