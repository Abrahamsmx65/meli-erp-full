-- Economía por producto desde el Data Kiosk de Amazon (SKU Economics):
-- ventas, tarifas, publicidad y neto por SKU y por día. Es la fuente exacta
-- de la ganancia del panel de Ventas Amazon.
create table if not exists public.amazon_economia (
  account_id  uuid not null references public.amazon_accounts (id) on delete cascade,
  seller_sku  text not null,
  fecha       date not null,
  unidades    numeric not null default 0,
  ventas      numeric not null default 0,
  tarifas     numeric not null default 0,
  publicidad  numeric not null default 0,
  neto        numeric not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, seller_sku, fecha)
);

alter table public.amazon_economia enable row level security;

drop policy if exists amazon_economia_mias on public.amazon_economia;
create policy amazon_economia_mias on public.amazon_economia
  for all
  using (es_mi_cuenta_amazon(account_id))
  with check (es_mi_cuenta_amazon(account_id));
