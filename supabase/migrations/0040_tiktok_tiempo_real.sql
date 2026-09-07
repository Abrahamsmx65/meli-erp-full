-- ============================================================================
--  TikTok en tiempo real: avisos de TikTok, envío desde el ERP y
--  reconciliación contra el número REAL de TikTok.
--
--  · `tiktok_webhooks`: bandeja de entrada de los avisos de TikTok (cambio
--    de estado de pedido). Se guarda y se contesta; se procesa después.
--  · `tiktok_skus.cantidad_tiktok`: lo que TikTok dice tener publicado, leído
--    del catálogo en cada corrida. Es contra ESTO que se compara el
--    disponible, no contra lo último que el ERP escribió: si alguien edita
--    el stock en el Seller Center, la siguiente corrida lo corrige.
--  · `tiktok_ordenes.shipping_type` y `paquetes`: lo que hace falta para
--    confirmar el envío desde el ERP (TikTok envía por paquete, no por
--    pedido).
-- ============================================================================

alter table public.tiktok_skus
  add column if not exists cantidad_tiktok integer;

alter table public.tiktok_ordenes
  add column if not exists shipping_type text,
  add column if not exists paquetes jsonb not null default '[]'::jsonb;

create table if not exists public.tiktok_webhooks (
  id           bigserial primary key,
  account_id   uuid references public.meli_accounts (id) on delete cascade,
  shop_id      text,
  tipo         integer,
  order_id     text,
  payload      jsonb not null default '{}'::jsonb,
  recibido_en  timestamptz not null default now(),
  procesado_en timestamptz,
  error        text
);
create index if not exists tiktok_webhooks_pendientes_idx
  on public.tiktok_webhooks (account_id, recibido_en)
  where procesado_en is null;

alter table public.tiktok_webhooks enable row level security;
drop policy if exists tiktok_webhooks_mias on public.tiktok_webhooks;
create policy tiktok_webhooks_mias on public.tiktok_webhooks
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
