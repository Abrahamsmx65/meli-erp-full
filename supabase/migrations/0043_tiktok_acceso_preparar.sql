-- ============================================================================
--  Acceso sin contraseña a la estación de "Preparar pedidos" de TikTok.
--
--  Mismo patrón que `contenido_acceso`: un token de 64 hexadecimales por
--  cuenta, tabla con RLS y CERO políticas (solo service_role la lee), y el
--  único lugar que convierte token en permiso es `acceso-preparar.ts`, que
--  lo compara en tiempo constante. Quien entra con el link solo alcanza los
--  cortes de TikTok (leer) y las preparaciones (escribir). Nada más.
-- ============================================================================

create table if not exists public.tiktok_acceso (
  account_id uuid primary key references public.meli_accounts (id) on delete cascade,
  token      text not null unique,
  creado_en  timestamptz not null default now()
);

alter table public.tiktok_acceso enable row level security;

-- Un token por cuenta, sin pisar el que ya exista.
insert into public.tiktok_acceso (account_id, token)
select a.id,
       replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  from public.meli_accounts a
 where not exists (select 1 from public.tiktok_acceso c where c.account_id = a.id);
