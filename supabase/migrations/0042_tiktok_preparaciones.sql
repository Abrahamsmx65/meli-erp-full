-- ============================================================================
--  Control de calidad del despacho de TikTok: cada paquete se da por
--  PREPARADO solo cuando se escanearon, en ese orden, el renglón de la lista
--  de empaque, la etiqueta y el producto (FNSKU de Amazon), y los tres
--  cuadraron. Aquí queda la constancia, con lo que se escaneó.
-- ============================================================================

create table if not exists public.tiktok_preparaciones (
  id            bigserial primary key,
  account_id    uuid not null references public.meli_accounts (id) on delete cascade,
  corte_id      bigint not null references public.tiktok_cortes (id) on delete cascade,
  order_id      text not null,
  package_id    text not null default '',
  numero        integer not null,
  escaneos      jsonb not null default '[]'::jsonb,
  preparado_en  timestamptz not null default now(),
  preparado_por uuid references auth.users (id) on delete set null,
  unique (account_id, order_id, package_id)
);
create index if not exists tiktok_preparaciones_corte_idx
  on public.tiktok_preparaciones (account_id, corte_id);

alter table public.tiktok_preparaciones enable row level security;
drop policy if exists tiktok_preparaciones_mias on public.tiktok_preparaciones;
create policy tiktok_preparaciones_mias on public.tiktok_preparaciones
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
