-- ============================================================================
--  ERP de reposición a Mercado Envíos Full — esquema base
-- ============================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Cuenta de Mercado Libre conectada
-- ---------------------------------------------------------------------------
create table if not exists meli_accounts (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  meli_user_id  bigint not null,
  nickname      text,
  site_id       text not null default 'MLM',
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (owner_id, meli_user_id)
);

-- Los tokens viven aparte: esta tabla NO tiene políticas RLS, así que solo
-- la service_role (el backend) puede leerla. Ni el navegador ni el usuario.
create table if not exists meli_tokens (
  account_id     uuid primary key references meli_accounts (id) on delete cascade,
  access_token   text not null,
  refresh_token  text not null,
  expira_en      timestamptz not null,
  actualizado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catálogo: un renglón por SKU del vendedor
-- ---------------------------------------------------------------------------
create table if not exists skus (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references meli_accounts (id) on delete cascade,
  sku            text not null,
  item_id        text,
  variation_id   text,
  inventory_id   text,
  titulo         text,
  logistica      text,          -- fulfillment | drop_off | cross_docking | self_service
  estado         text,          -- active | paused | closed
  precio         numeric,
  -- Cuando un mismo SKU aparece en más de una publicación guardamos el resto aquí.
  publicaciones  jsonb not null default '[]'::jsonb,
  activo         boolean not null default true,
  actualizado_en timestamptz not null default now(),
  unique (account_id, sku)
);
create index if not exists skus_account_idx on skus (account_id);
create index if not exists skus_inventory_idx on skus (account_id, inventory_id);

-- ---------------------------------------------------------------------------
-- Stock actual en Full
-- ---------------------------------------------------------------------------
create table if not exists stock_full (
  account_id       uuid not null references meli_accounts (id) on delete cascade,
  sku              text not null,
  disponible       integer not null default 0,   -- listo para vender
  en_transferencia integer not null default 0,   -- viajando / recibiéndose en el centro
  no_disponible    integer not null default 0,   -- dañado, perdido, en revisión, etc.
  total            integer not null default 0,
  detalle          jsonb not null default '{}'::jsonb,  -- not_available_detail crudo
  actualizado_en   timestamptz not null default now(),
  primary key (account_id, sku)
);

-- ---------------------------------------------------------------------------
-- Foto diaria del stock. Es lo que permite saber qué días NO hubo stock.
-- origen: 'snapshot'      -> lo medimos ese día (fuente de verdad)
--         'reconstruido'  -> lo dedujimos hacia atrás con las operaciones
-- ---------------------------------------------------------------------------
create table if not exists stock_snapshots (
  account_id       uuid not null references meli_accounts (id) on delete cascade,
  sku              text not null,
  fecha            date not null,
  disponible       integer not null default 0,
  en_transferencia integer not null default 0,
  origen           text not null default 'snapshot',
  primary key (account_id, sku, fecha)
);
create index if not exists stock_snapshots_fecha_idx on stock_snapshots (account_id, fecha);

-- ---------------------------------------------------------------------------
-- Ventas agregadas por SKU y día
-- ---------------------------------------------------------------------------
create table if not exists ventas_diarias (
  account_id uuid not null references meli_accounts (id) on delete cascade,
  sku        text not null,
  fecha      date not null,
  unidades   integer not null default 0,
  ordenes    integer not null default 0,
  importe    numeric not null default 0,
  primary key (account_id, sku, fecha)
);
create index if not exists ventas_fecha_idx on ventas_diarias (account_id, fecha);

-- ---------------------------------------------------------------------------
-- Movimientos de inventario en Full (entradas, ventas, ajustes, devoluciones)
-- Con esto reconstruimos el nivel de stock día por día hacia atrás.
-- ---------------------------------------------------------------------------
create table if not exists stock_operaciones (
  account_id            uuid not null references meli_accounts (id) on delete cascade,
  operation_id          text not null,
  inventory_id          text,
  sku                   text,
  fecha                 timestamptz not null,
  tipo                  text,
  delta_disponible      integer,
  resultado_disponible  integer,
  resultado_total       integer,
  raw                   jsonb,
  primary key (account_id, operation_id)
);
create index if not exists stock_ops_sku_fecha_idx on stock_operaciones (account_id, sku, fecha);

-- ---------------------------------------------------------------------------
-- Mi inventario propio (bodega): piezas sueltas disponibles para enviar
-- ---------------------------------------------------------------------------
create table if not exists inventario_propio (
  account_id     uuid not null references meli_accounts (id) on delete cascade,
  sku            text not null,
  unidades       integer not null default 0,
  ubicacion      text,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, sku)
);

-- ---------------------------------------------------------------------------
-- Cajas / corridas. Una caja puede traer varios SKUs en cantidades fijas.
-- ---------------------------------------------------------------------------
create table if not exists cajas (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references meli_accounts (id) on delete cascade,
  codigo            text not null,
  nombre            text,
  cajas_disponibles integer not null default 0,   -- cuántas cajas armadas tengo
  activo            boolean not null default true,
  actualizado_en    timestamptz not null default now(),
  unique (account_id, codigo)
);

create table if not exists caja_items (
  caja_id uuid not null references cajas (id) on delete cascade,
  sku     text not null,
  piezas  integer not null check (piezas > 0),
  primary key (caja_id, sku)
);

-- ---------------------------------------------------------------------------
-- Parámetros de planeación (uno por cuenta)
-- ---------------------------------------------------------------------------
create table if not exists parametros (
  account_id     uuid primary key references meli_accounts (id) on delete cascade,
  datos          jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now()
);

-- Overrides puntuales por SKU (excluir, forzar demanda, multiplicador de temporada)
create table if not exists sku_overrides (
  account_id       uuid not null references meli_accounts (id) on delete cascade,
  sku              text not null,
  excluir          boolean not null default false,
  demanda_manual   numeric,          -- si se llena, ignora el cálculo histórico
  factor_temporada numeric not null default 1.0,
  minimo_envio     integer,
  nota             text,
  primary key (account_id, sku)
);

-- ---------------------------------------------------------------------------
-- Planes de envío generados
-- ---------------------------------------------------------------------------
create table if not exists planes (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references meli_accounts (id) on delete cascade,
  creado_en  timestamptz not null default now(),
  parametros jsonb not null default '{}'::jsonb,
  resumen    jsonb not null default '{}'::jsonb,
  estado     text not null default 'borrador'  -- borrador | confirmado | enviado
);
create index if not exists planes_cuenta_idx on planes (account_id, creado_en desc);

create table if not exists plan_lineas (
  plan_id uuid not null references planes (id) on delete cascade,
  sku     text not null,
  datos   jsonb not null,
  primary key (plan_id, sku)
);

create table if not exists plan_cajas (
  plan_id      uuid not null references planes (id) on delete cascade,
  caja_codigo  text not null,
  cantidad     integer not null,
  primary key (plan_id, caja_codigo)
);

-- ---------------------------------------------------------------------------
-- Bitácora de sincronizaciones
-- ---------------------------------------------------------------------------
create table if not exists sync_log (
  id         bigserial primary key,
  account_id uuid references meli_accounts (id) on delete cascade,
  tarea      text not null,
  inicio     timestamptz not null default now(),
  fin        timestamptz,
  estado     text not null default 'corriendo',   -- corriendo | ok | error
  detalle    jsonb not null default '{}'::jsonb
);
create index if not exists sync_log_cuenta_idx on sync_log (account_id, inicio desc);
