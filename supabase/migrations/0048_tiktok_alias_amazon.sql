-- ============================================================================
--  Colores equivalentes entre TikTok y Amazon, por MODELO.
--
--  El MY2304 se vende en TikTok como CAMEL y en Amazon como BROWN: es el
--  mismo par y la caja lleva el FNSKU de Amazon. Sin esta equivalencia el
--  corte no encuentra FNSKU y la hoja y la guía salen sin código de
--  producto. Decisión del dueño: el código de barras SIEMPRE es el FNSKU.
-- ============================================================================

create table if not exists public.tiktok_alias_amazon (
  account_id   uuid not null references public.meli_accounts (id) on delete cascade,
  modelo       text not null,
  color_tiktok text not null,
  color_amazon text not null,
  creado_en    timestamptz not null default now(),
  primary key (account_id, modelo, color_tiktok)
);
alter table public.tiktok_alias_amazon enable row level security;
drop policy if exists tiktok_alias_amazon_mias on public.tiktok_alias_amazon;
create policy tiktok_alias_amazon_mias on public.tiktok_alias_amazon
  for all to authenticated
  using (public.es_mi_cuenta(account_id))
  with check (public.es_mi_cuenta(account_id));

insert into public.tiktok_alias_amazon (account_id, modelo, color_tiktok, color_amazon)
select id, 'MY2304', 'CAMEL', 'BROWN' from public.meli_accounts where nickname = 'GETAC'
on conflict do nothing;
