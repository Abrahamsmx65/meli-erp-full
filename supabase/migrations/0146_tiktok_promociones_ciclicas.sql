-- ============================================================================
--  Relámpagos CÍCLICOS de TikTok (pedido del dueño, 15-oct-2026: «en cíclicos
--  yo pongo un producto, cuál es el precio y el sistema se encarga de que
--  siempre va a estar con relámpagos programadas; se pueden adelantar muchas
--  y cada una dura máximo 72 horas»).
--
--  Un renglón por modelo con su precio de oferta, sus topes y las horas de
--  cada ventana (≤ 72). El fondo (cron de cada hora) mantiene siempre
--  `VENTANAS_ADELANTE` actividades encadenadas por modelo; cada actividad
--  creada queda en `tiktok_promociones` con su `ciclico_id`.
-- ============================================================================

create table if not exists public.tiktok_promociones_ciclicas (
  id                 bigserial primary key,
  account_id         uuid not null references public.meli_accounts (id) on delete cascade,
  modelo             text not null,
  precio             numeric(12,2) not null,
  horas              integer not null default 72,
  tope_por_talla     integer not null default -1,
  tope_por_comprador integer not null default -1,
  activo             boolean not null default true,
  ultimo_error       text,
  programado_en      timestamptz,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  creado_por         uuid references auth.users (id) on delete set null,
  unique (account_id, modelo)
);

alter table public.tiktok_promociones_ciclicas enable row level security;
drop policy if exists tiktok_promociones_ciclicas_mios on public.tiktok_promociones_ciclicas;
create policy tiktok_promociones_ciclicas_mios on public.tiktok_promociones_ciclicas
  for all using (account_id in (select mis_cuentas_meli())) with check (account_id in (select mis_cuentas_meli()));
drop policy if exists tiktok_promociones_ciclicas_miembros_tiktok on public.tiktok_promociones_ciclicas;
create policy tiktok_promociones_ciclicas_miembros_tiktok on public.tiktok_promociones_ciclicas
  for all to authenticated using (account_id in (select mis_cuentas_tiktok())) with check (account_id in (select mis_cuentas_tiktok()));

alter table public.tiktok_promociones
  add column if not exists ciclico_id bigint references public.tiktok_promociones_ciclicas (id) on delete set null;
create index if not exists tiktok_promociones_ciclico_idx on public.tiktok_promociones (ciclico_id, fin desc) where ciclico_id is not null;
