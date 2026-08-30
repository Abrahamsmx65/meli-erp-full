-- ============================================================================
--  TikTok Shop: tercer canal, con ENVÍO PROPIO desde bodega.
--
--  Es distinto de los otros dos y por eso no reutiliza nada de ellos:
--
--    · Mercado Envíos Full y FBA son almacenes AJENOS. Ahí mandas cajas
--      cerradas, el marketplace guarda el stock y él mismo lo descuenta al
--      vender: el ERP solo lee la foto que le dan.
--    · Las existencias de Industher son CAJAS CERRADAS en bodega, y su
--      número lo manda el API del almacén: escribir ahí duplicaría.
--
--  TikTok es envío propio: los pares salen de un almacén NUESTRO, par por
--  par, y nadie más lleva esa cuenta. Así que aquí el inventario sí es
--  nuestro y se lleva con un KARDEX: `tiktok_movimientos` es la fuente de
--  verdad (cada entrada y cada salida, con su motivo y su referencia) y
--  `tiktok_inventario` es solo el saldo ya sumado, para leer rápido.
--
--  El ciclo completo:
--    entrada al almacén TikTok  -> sube el saldo
--    venta pagada sin enviar    -> aparta (no baja el saldo todavía)
--    ENVÍO CONFIRMADO           -> salida: baja el saldo
--    cancelación o devolución    -> reversa: regresa el saldo
--    disponible = saldo - apartado  -> es lo que se publica a TikTok
--
--  Todo cuelga de `meli_accounts` (la cuenta del ERP), no de una cuenta
--  aparte: TikTok es un canal más de la misma operación, y así la RLS es la
--  misma `es_mi_cuenta()` de siempre.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- La tienda conectada
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_tienda (
  account_id     uuid primary key references public.meli_accounts (id) on delete cascade,
  shop_id        text,
  -- TikTok exige mandar este "cipher" en cada llamada de tienda; sale del
  -- authorized_shops después de autorizar y no es secreto.
  shop_cipher    text,
  nombre         text,
  region         text not null default 'MX',
  moneda         text not null default 'MXN',
  -- Bodega de TikTok contra la que se publica el stock (la que devuelve
  -- /logistics/202309/warehouses). Sin esto no se puede escribir inventario.
  warehouse_id   text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Los tokens viven aparte y con RLS SIN POLÍTICAS, igual que `meli_tokens`:
-- solo la service_role los alcanza, nunca el navegador.
create table if not exists public.tiktok_tokens (
  account_id        uuid primary key references public.meli_accounts (id) on delete cascade,
  access_token      text not null,
  refresh_token     text not null,
  expira_en         timestamptz not null,
  refresh_expira_en timestamptz,
  actualizado_en    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catálogo de TikTok, ya amarrado al SKU interno del ERP
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_skus (
  account_id     uuid not null references public.meli_accounts (id) on delete cascade,
  sku_id         text not null,
  product_id     text,
  seller_sku     text,
  titulo         text,
  talla          text,
  precio         numeric,
  estado         text,
  -- SKU del ERP (MODELO-COLOR-TALLA). Nulo mientras no se logre amarrar:
  -- esos renglones salen en Pendientes en vez de inventarse un amarre.
  sku_interno    text,
  origen_amarre  text,
  activo         boolean not null default true,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, sku_id)
);
create index if not exists tiktok_skus_interno_idx on public.tiktok_skus (account_id, sku_interno);
create index if not exists tiktok_skus_seller_idx on public.tiktok_skus (account_id, seller_sku);

-- Amarre a mano para lo que la normalización no alcanza, igual que `mapeo_sku`.
create table if not exists public.tiktok_mapeo_sku (
  account_id  uuid not null references public.meli_accounts (id) on delete cascade,
  sku_tiktok  text not null,
  sku_interno text not null,
  nota        text,
  creado_en   timestamptz not null default now(),
  primary key (account_id, sku_tiktok)
);

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_ordenes (
  account_id          uuid not null references public.meli_accounts (id) on delete cascade,
  order_id            text not null,
  estado              text not null,
  fecha_creacion      timestamptz,
  fecha_actualizacion timestamptz,
  fecha_envio         timestamptz,
  total               numeric,
  moneda              text,
  paqueteria          text,
  guia                text,
  -- Marca de que la orden YA movió el kardex, para no descontar dos veces
  -- cuando la sincronización la vuelve a ver.
  descontado          boolean not null default false,
  revertido           boolean not null default false,
  detalle             jsonb not null default '{}'::jsonb,
  sincronizado_en     timestamptz not null default now(),
  primary key (account_id, order_id)
);
create index if not exists tiktok_ordenes_fecha_idx
  on public.tiktok_ordenes (account_id, fecha_creacion);
create index if not exists tiktok_ordenes_estado_idx
  on public.tiktok_ordenes (account_id, estado);

create table if not exists public.tiktok_orden_items (
  account_id   uuid not null references public.meli_accounts (id) on delete cascade,
  line_item_id text not null,
  order_id     text not null,
  sku_id       text,
  seller_sku   text,
  sku_interno  text,
  titulo       text,
  cantidad     integer not null default 1,
  precio       numeric,
  estado       text,
  primary key (account_id, line_item_id)
);
create index if not exists tiktok_orden_items_orden_idx
  on public.tiktok_orden_items (account_id, order_id);
create index if not exists tiktok_orden_items_sku_idx
  on public.tiktok_orden_items (account_id, sku_interno);

-- Ventas por SKU y día, en el mismo formato que los otros canales.
create table if not exists public.tiktok_ventas_diarias (
  account_id uuid not null references public.meli_accounts (id) on delete cascade,
  sku        text not null,
  fecha      date not null,
  unidades   integer not null default 0,
  ordenes    integer not null default 0,
  importe    numeric not null default 0,
  primary key (account_id, sku, fecha)
);
create index if not exists tiktok_ventas_fecha_idx
  on public.tiktok_ventas_diarias (account_id, fecha);

-- ---------------------------------------------------------------------------
-- EL KARDEX. Fuente de verdad del inventario de TikTok.
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_movimientos (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.meli_accounts (id) on delete cascade,
  sku         text not null,
  -- entrada | salida | devolucion | ajuste | merma
  tipo        text not null,
  -- SIEMPRE positiva: el signo lo pone el tipo, no la captura. Un 'ajuste'
  -- guarda el saldo objetivo y se traduce a la diferencia al aplicarlo.
  cantidad    integer not null check (cantidad >= 0),
  -- Cuánto quedó el saldo del SKU después de este movimiento. Es el que
  -- deja auditar el kardex sin volver a sumar toda la historia.
  saldo_final integer,
  motivo      text,
  -- order_id de TikTok, folio de la entrada, contenedor... Lo que permite
  -- rastrear el movimiento hasta su origen y no repetirlo.
  referencia  text,
  fecha       timestamptz not null default now(),
  nota        text,
  creado_por  uuid references auth.users (id) on delete set null,
  creado_en   timestamptz not null default now()
);
create index if not exists tiktok_movimientos_sku_idx
  on public.tiktok_movimientos (account_id, sku, fecha);
create index if not exists tiktok_movimientos_fecha_idx
  on public.tiktok_movimientos (account_id, fecha desc);

-- El seguro contra el doble descuento: una orden solo puede generar UNA
-- salida por SKU, y una sola devolución. Si la sincronización vuelve a ver
-- la misma orden enviada, el insert choca y no pasa nada.
--
-- OJO: nació parcial (`where referencia is not null`) y la 0031 lo rehace
-- completo, porque `ON CONFLICT` no puede inferir un índice parcial.
create unique index if not exists tiktok_movimientos_referencia_unica
  on public.tiktok_movimientos (account_id, tipo, referencia, sku)
  where referencia is not null;

-- ---------------------------------------------------------------------------
-- Saldo por SKU: la suma del kardex, ya hecha.
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_inventario (
  account_id     uuid not null references public.meli_accounts (id) on delete cascade,
  sku            text not null,
  -- pares físicos en el almacén de TikTok
  saldo          integer not null default 0,
  -- pares de pedidos pagados que todavía no salen: siguen en el almacén
  -- pero ya tienen dueño, así que no se le pueden ofrecer a nadie más
  apartado       integer not null default 0,
  -- último número que TikTok confirmó tener publicado, para saber qué falta
  -- por empujar sin volver a preguntárselo
  publicado      integer,
  publicado_en   timestamptz,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, sku)
);

-- ---------------------------------------------------------------------------
-- Bitácora de sincronización
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_sync_estado (
  account_id     uuid not null references public.meli_accounts (id) on delete cascade,
  tarea          text not null,
  cursor_ts      timestamptz,
  datos          jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, tarea)
);

create table if not exists public.tiktok_sync_log (
  id         bigserial primary key,
  account_id uuid references public.meli_accounts (id) on delete cascade,
  tarea      text not null,
  inicio     timestamptz not null default now(),
  fin        timestamptz,
  estado     text not null default 'corriendo',
  detalle    jsonb not null default '{}'::jsonb
);
create index if not exists tiktok_sync_log_cuenta_idx
  on public.tiktok_sync_log (account_id, inicio desc);

-- ---------------------------------------------------------------------------
-- RLS: la misma de siempre, salvo los tokens.
-- ---------------------------------------------------------------------------
alter table public.tiktok_tokens enable row level security;  -- sin políticas

do $$
declare t text;
begin
  foreach t in array array[
    'tiktok_tienda', 'tiktok_skus', 'tiktok_mapeo_sku', 'tiktok_ordenes',
    'tiktok_orden_items', 'tiktok_ventas_diarias', 'tiktok_movimientos',
    'tiktok_inventario', 'tiktok_sync_estado', 'tiktok_sync_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_mias', t);
    execute format(
      'create policy %I on public.%I for all
         using (es_mi_cuenta(account_id))
         with check (es_mi_cuenta(account_id))', t || '_mias', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Los tres canales bajo un solo nombre de SKU.
-- ---------------------------------------------------------------------------
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
   where a.erp_account_id is not null
  union all
  select account_id, 'tiktok'::text as canal, sku, fecha, unidades, ordenes, importe
    from public.tiktok_ventas_diarias;
