-- ============================================================================
--  Amazon como segundo canal del ERP.
--
--  Todo esto es aditivo: no toca ni una tabla de Mercado Libre. Las tablas
--  quedan puestas para cuando se conecte Amazon, y mientras tanto simplemente
--  están vacías. Se dejan creadas desde ahora porque la vista
--  `ventas_diarias_canal` —que es la que unifica los dos canales— tiene que
--  existir antes de que nada la consulte.
-- ============================================================================

create table if not exists public.amazon_accounts (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id) on delete cascade,
  erp_account_id      uuid references public.meli_accounts(id) on delete set null,
  nombre              text,
  selling_partner_id  text,
  marketplace_id      text not null default 'A1AM78C64UM0Y8',
  pais                text not null default 'MX',
  region              text not null default 'na',
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);

create table if not exists public.amazon_tokens (
  account_id      uuid primary key references public.amazon_accounts(id) on delete cascade,
  refresh_token   text not null,
  access_token    text,
  expira_en       timestamptz,
  actualizado_en  timestamptz not null default now()
);

create table if not exists public.amazon_skus (
  account_id      uuid not null references public.amazon_accounts(id) on delete cascade,
  seller_sku      text not null,
  asin            text,
  fnsku           text,
  titulo          text,
  condicion       text,
  canal           text,
  estado          text,
  precio          numeric,
  activo          boolean not null default true,
  actualizado_en  timestamptz not null default now(),
  primary key (account_id, seller_sku)
);
create index if not exists amazon_skus_asin_idx on public.amazon_skus (account_id, asin);

create table if not exists public.amazon_sku_map (
  account_id   uuid not null references public.amazon_accounts(id) on delete cascade,
  seller_sku   text not null,
  sku_interno  text not null,
  nota         text,
  creado_en    timestamptz not null default now(),
  primary key (account_id, seller_sku)
);

create table if not exists public.amazon_ventas_diarias (
  account_id  uuid not null references public.amazon_accounts(id) on delete cascade,
  seller_sku  text not null,
  fecha       date not null,
  unidades    integer not null default 0,
  ordenes     integer not null default 0,
  importe     numeric not null default 0,
  moneda      text,
  primary key (account_id, seller_sku, fecha)
);
create index if not exists amazon_ventas_fecha_idx
  on public.amazon_ventas_diarias (account_id, fecha);

create table if not exists public.amazon_ordenes (
  account_id           uuid not null references public.amazon_accounts(id) on delete cascade,
  amazon_order_id      text not null,
  fecha_compra         timestamptz,
  fecha_actualizacion  timestamptz,
  estado               text,
  canal_logistico      text,
  canal_venta          text,
  marketplace_id       text,
  total                numeric,
  moneda               text,
  items_enviados       integer default 0,
  items_pendientes     integer default 0,
  es_negocio           boolean default false,
  detalle              jsonb not null default '{}'::jsonb,
  primary key (account_id, amazon_order_id)
);
create index if not exists amazon_ordenes_fecha_idx
  on public.amazon_ordenes (account_id, fecha_compra);

create table if not exists public.amazon_orden_items (
  account_id       uuid not null references public.amazon_accounts(id) on delete cascade,
  amazon_order_id  text not null,
  order_item_id    text not null,
  seller_sku       text,
  asin             text,
  titulo           text,
  cantidad         integer default 0,
  cantidad_enviada integer default 0,
  precio           numeric,
  impuesto         numeric,
  descuento        numeric,
  moneda           text,
  primary key (account_id, order_item_id)
);
create index if not exists amazon_orden_items_sku_idx
  on public.amazon_orden_items (account_id, seller_sku);
create index if not exists amazon_orden_items_orden_idx
  on public.amazon_orden_items (account_id, amazon_order_id);

create table if not exists public.amazon_inventario (
  account_id           uuid not null references public.amazon_accounts(id) on delete cascade,
  seller_sku           text not null,
  asin                 text,
  fnsku                text,
  condicion            text,
  disponible           integer not null default 0,
  reservado            integer not null default 0,
  entrante_trabajando  integer not null default 0,
  entrante_enviado     integer not null default 0,
  entrante_recibiendo  integer not null default 0,
  en_transferencia     integer not null default 0,
  no_disponible        integer not null default 0,
  investigando         integer not null default 0,
  total                integer not null default 0,
  detalle              jsonb not null default '{}'::jsonb,
  actualizado_en       timestamptz not null default now(),
  primary key (account_id, seller_sku)
);

create table if not exists public.amazon_inventario_snapshots (
  account_id        uuid not null references public.amazon_accounts(id) on delete cascade,
  seller_sku        text not null,
  fecha             date not null,
  disponible        integer not null default 0,
  en_transferencia  integer not null default 0,
  reservado         integer not null default 0,
  total             integer not null default 0,
  origen            text not null default 'snapshot',
  primary key (account_id, seller_sku, fecha)
);

create table if not exists public.amazon_sync_estado (
  account_id      uuid not null references public.amazon_accounts(id) on delete cascade,
  tarea           text not null,
  cursor_ts       timestamptz,
  datos           jsonb not null default '{}'::jsonb,
  actualizado_en  timestamptz not null default now(),
  primary key (account_id, tarea)
);

create table if not exists public.amazon_sync_log (
  id          bigserial primary key,
  account_id  uuid references public.amazon_accounts(id) on delete cascade,
  tarea       text not null,
  inicio      timestamptz not null default now(),
  fin         timestamptz,
  estado      text not null default 'corriendo',
  detalle     jsonb not null default '{}'::jsonb
);
create index if not exists amazon_sync_log_cuenta_idx
  on public.amazon_sync_log (account_id, inicio desc);

create or replace function public.es_mi_cuenta_amazon(a uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from amazon_accounts
    where id = a and owner_id = auth.uid()
  );
$$;

alter table public.amazon_accounts             enable row level security;
alter table public.amazon_tokens               enable row level security;
alter table public.amazon_skus                 enable row level security;
alter table public.amazon_sku_map              enable row level security;
alter table public.amazon_ventas_diarias       enable row level security;
alter table public.amazon_ordenes              enable row level security;
alter table public.amazon_orden_items          enable row level security;
alter table public.amazon_inventario           enable row level security;
alter table public.amazon_inventario_snapshots enable row level security;
alter table public.amazon_sync_estado          enable row level security;
alter table public.amazon_sync_log             enable row level security;

drop policy if exists amazon_accounts_propias on public.amazon_accounts;
create policy amazon_accounts_propias on public.amazon_accounts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_tokens', 'amazon_skus', 'amazon_sku_map', 'amazon_ventas_diarias',
    'amazon_ordenes', 'amazon_orden_items', 'amazon_inventario',
    'amazon_inventario_snapshots', 'amazon_sync_estado', 'amazon_sync_log'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_mias', t);
    execute format(
      'create policy %I on public.%I for all
         using (es_mi_cuenta_amazon(account_id))
         with check (es_mi_cuenta_amazon(account_id))', t || '_mias', t);
  end loop;
end $$;

-- Las ventas de los dos canales bajo un solo nombre de SKU.
create or replace view public.ventas_diarias_canal
with (security_invoker = true) as
  select account_id, 'meli'::text as canal, sku, fecha, unidades, ordenes, importe
    from public.ventas_diarias
  union all
  select a.erp_account_id as account_id,
         'amazon'::text   as canal,
         coalesce(m.sku_interno, v.seller_sku) as sku,
         v.fecha, v.unidades, v.ordenes, v.importe
    from public.amazon_ventas_diarias v
    join public.amazon_accounts a on a.id = v.account_id
    left join public.amazon_sku_map m
           on m.account_id = v.account_id and m.seller_sku = v.seller_sku
   where a.erp_account_id is not null;
