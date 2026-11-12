-- Link de acceso general para publicar productos nuevos en MELI sin entrar
-- al ERP (dueño, 12-nov-2026: «un link por separado con acceso general para
-- que Michel pueda publicar sin tener que ingresar a la plataforma»).
-- Mismo patrón que `contenido_acceso` y `tiktok_acceso`: un token de 64
-- hexadecimales por cuenta, RLS con CERO políticas (solo service_role lo lee).
-- El token lo crea el dueño desde la pantalla; no nace con la tabla.

create table if not exists meli_publicar_acceso (
  account_id uuid primary key references meli_accounts(id) on delete cascade,
  token text not null,
  creado_en timestamptz not null default now()
);

alter table meli_publicar_acceso enable row level security;
