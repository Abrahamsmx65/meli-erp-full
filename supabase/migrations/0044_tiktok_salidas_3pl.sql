-- ============================================================================
--  Salidas del almacén TikTok que hay que reflejar en el 3PL (Industher).
--
--  Después de cada corte, los pares que salieron se le mandan a Industher
--  para que su número baje también. Cada renglón es (corte, pedido, SKU,
--  pares); `confirmada_en` es cuando Industher aceptó la salida (o cuando
--  su número bajó y se le atribuyó). Mientras no esté confirmada, una baja
--  en el número de Industher se atribuye primero a estas salidas y solo el
--  resto se toma como merma: así no se descuenta dos veces.
-- ============================================================================

create table if not exists public.tiktok_salidas_3pl (
  id            bigserial primary key,
  account_id    uuid not null references public.meli_accounts (id) on delete cascade,
  corte_id      bigint references public.tiktok_cortes (id) on delete set null,
  order_id      text not null,
  sku           text not null,
  pares         integer not null check (pares > 0),
  creada_en     timestamptz not null default now(),
  -- último intento de mandarla al 3PL
  enviada_en    timestamptz,
  error         text,
  -- el 3PL ya la tiene descontada (ack del endpoint, o baja atribuida)
  confirmada_en timestamptz,
  unique (account_id, order_id, sku)
);
create index if not exists tiktok_salidas_3pl_pendientes_idx
  on public.tiktok_salidas_3pl (account_id, sku)
  where confirmada_en is null;

alter table public.tiktok_salidas_3pl enable row level security;
drop policy if exists tiktok_salidas_3pl_mias on public.tiktok_salidas_3pl;
create policy tiktok_salidas_3pl_mias on public.tiktok_salidas_3pl
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
