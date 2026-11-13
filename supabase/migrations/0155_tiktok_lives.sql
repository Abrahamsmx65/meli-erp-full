-- ============================================================================
--  MIS LIVE: análisis de los LIVE PROPIOS de la tienda en TikTok Shop
--  (dueño, 13-nov-2026: «una sección de análisis de los live en vivo para
--  saber qué se vendió, los pedidos que contienen, cuánto gané…; me refiero
--  a mis live propios»).
--
--  Un renglón por sesión de LIVE de las cuentas PROPIAS (oficial y de
--  marketing; las de afiliados no van aquí), leído de la analítica de TikTok
--  (`GET /analytics/202609/shop_lives/performance`):
--   · `datos`     ventas, tráfico e interacción de la sesión, como las da TikTok;
--   · `productos` lo vendido producto por producto en ESE live
--                 (`GET /analytics/202512/shop/{live_id}/products_performance`);
--   · `pedidos`   los pedidos de la TIENDA (sin creador) que entraron mientras
--                 duró el live, con lo que TikTok paga por ellos, su costo y la
--                 ganancia: TikTok no dice qué pedido salió de qué live, así
--                 que esto es lo que entró en su ventana y así se declara.
-- ============================================================================

create table if not exists public.tiktok_lives (
  account_id          uuid not null references public.meli_accounts (id) on delete cascade,
  live_id             text not null,
  cuenta_tipo         text not null,
  titulo              text,
  creador             jsonb,
  inicio              timestamptz,
  fin                 timestamptz,
  datos               jsonb not null,
  productos           jsonb,
  productos_leido_en  timestamptz,
  pedidos             jsonb,
  pedidos_leido_en    timestamptz,
  leido_en            timestamptz not null default now(),
  primary key (account_id, live_id)
);
create index if not exists tiktok_lives_inicio_idx on public.tiktok_lives (account_id, inicio desc);
comment on table public.tiktok_lives is
  'Sesiones de LIVE propias de la tienda de TikTok Shop con sus métricas, lo vendido por producto y los pedidos de la tienda en su ventana.';

alter table public.tiktok_lives enable row level security;
create policy tiktok_lives_mios on public.tiktok_lives
  for all using (account_id in (select mis_cuentas_meli())) with check (account_id in (select mis_cuentas_meli()));
create policy tiktok_lives_miembros_tiktok on public.tiktok_lives
  for all to authenticated using (account_id in (select mis_cuentas_tiktok())) with check (account_id in (select mis_cuentas_tiktok()));
