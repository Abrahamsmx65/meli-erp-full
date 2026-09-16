-- ============================================================================
--  Pedidos de almacén de TikTok: qué reponerle a la bodega de TikTok.
--
--  La bodega de TikTok (en Industher) se vacía con lo que se vende y hay
--  que rellenarla desde las bodegas de cajas (Industher, Caseshop,
--  EnvioPack). Un pedido junta lo vendido en un periodo por modelo, color y
--  talla, cuánto queda en el kardex, cuánto pedir y de qué bodega surtirlo,
--  y se queda guardado: el siguiente pedido arranca donde terminó este.
--  Pedido del dueño el 16-sep-2026.
-- ============================================================================

create table if not exists public.tiktok_pedidos_almacen (
  id            bigserial primary key,
  account_id    uuid not null references public.meli_accounts (id) on delete cascade,
  -- consecutivo por cuenta
  numero        integer not null,
  creado_en     timestamptz not null default now(),
  creado_por    uuid references auth.users (id) on delete set null,
  -- periodo de venta que cubre (días de México, inclusive)
  desde         date not null,
  hasta         date not null,
  -- vendido (reponer lo vendido) | cobertura (llegar a N días de venta)
  modo          text not null default 'vendido',
  dias_objetivo integer,
  -- el pedido armado: renglones por SKU, por modelo y totales (jsonb)
  datos         jsonb not null,
  skus          integer not null default 0,
  pares         integer not null default 0,
  unique (account_id, numero)
);

create index if not exists tiktok_pedidos_almacen_fecha_idx
  on public.tiktok_pedidos_almacen (account_id, hasta desc);

alter table public.tiktok_pedidos_almacen enable row level security;
drop policy if exists tiktok_pedidos_almacen_mios on public.tiktok_pedidos_almacen;
create policy tiktok_pedidos_almacen_mios on public.tiktok_pedidos_almacen
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
