-- ============================================================================
--  Ofertas relámpago de TikTok creadas desde el ERP (pedido del dueño,
--  15-oct-2026: «crear relámpagos en TikTok más rápido […] los relámpagos
--  generales de los que duran cada 3 días, todo desde mi panel»).
--
--  La verdad de la oferta vive en TikTok (API de promociones); aquí queda la
--  constancia de lo que el ERP creó: con qué modelos, a qué precio y qué
--  contestó TikTok, para «repetir la última» y para la bitácora.
-- ============================================================================

create table if not exists public.tiktok_promociones (
  id                 bigserial primary key,
  account_id         uuid not null references public.meli_accounts (id) on delete cascade,
  activity_id        text,
  titulo             text not null,
  tipo               text not null default 'FLASHSALE',
  nivel              text,
  inicio             timestamptz not null,
  fin                timestamptz not null,
  tope_por_talla     integer not null default -1,
  tope_por_comprador integer not null default -1,
  modelos            jsonb not null default '[]'::jsonb,
  estado             text not null default 'creada',
  respuesta          jsonb,
  error              text,
  creado_en          timestamptz not null default now(),
  creado_por         uuid references auth.users (id) on delete set null
);
create index if not exists tiktok_promociones_cuenta_idx on public.tiktok_promociones (account_id, inicio desc);

alter table public.tiktok_promociones enable row level security;
drop policy if exists tiktok_promociones_mios on public.tiktok_promociones;
create policy tiktok_promociones_mios on public.tiktok_promociones
  for all using (account_id in (select mis_cuentas_meli())) with check (account_id in (select mis_cuentas_meli()));
drop policy if exists tiktok_promociones_miembros_tiktok on public.tiktok_promociones;
create policy tiktok_promociones_miembros_tiktok on public.tiktok_promociones
  for all to authenticated using (account_id in (select mis_cuentas_tiktok())) with check (account_id in (select mis_cuentas_tiktok()));
