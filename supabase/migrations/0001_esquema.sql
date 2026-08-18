-- ============================================================================
--  ERP de reposición a Mercado Envíos Full — calzado por corridas
--
--  Modelo del negocio:
--    · El SKU de Mercado Libre es MODELO-COLOR-TALLA (ej. GT107-CAMEL-25).
--    · En bodega el inventario está en CAJAS que no se abren.
--    · Una caja de "corrida" trae varias tallas del mismo modelo y color,
--      según una receta (la corrida). Toca varios SKUs de MELI a la vez.
--    · Una caja de talla única trae todos sus pares de una sola talla.
--  Por eso la decisión de reposición nunca es "cuántos pares", sino
--  "cuáles cajas completas mando".
-- ============================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Cuenta de Mercado Libre conectada
-- ---------------------------------------------------------------------------
create table if not exists meli_accounts (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users (id) on delete cascade,
  meli_user_id   bigint not null,
  nickname       text,
  site_id        text not null default 'MLM',
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (owner_id, meli_user_id)
);

-- Los tokens viven aparte: esta tabla tiene RLS activo y CERO políticas, así
-- que solo la service_role (el backend) puede leerla. Nunca el navegador.
create table if not exists meli_tokens (
  account_id     uuid primary key references meli_accounts (id) on delete cascade,
  access_token   text not null,
  refresh_token  text not null,
  expira_en      timestamptz not null,
  actualizado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catálogo de SKUs de Mercado Libre
-- ---------------------------------------------------------------------------
create table if not exists skus (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references meli_accounts (id) on delete cascade,
  sku            text not null,
  item_id        text,
  variation_id   text,
  inventory_id   text,
  titulo         text,
  logistica      text,        -- fulfillment | drop_off | cross_docking | self_service
  estado         text,        -- active | paused | closed
  precio         numeric,
  -- Desglose derivado del SKU, para agrupar y reportar por modelo o talla.
  modelo         text,
  color          text,
  talla          text,
  activo         boolean not null default true,
  actualizado_en timestamptz not null default now(),
  unique (account_id, sku)
);
create index if not exists skus_account_idx on skus (account_id);
create index if not exists skus_inventory_idx on skus (account_id, inventory_id);
create index if not exists skus_modelo_idx on skus (account_id, modelo);

-- ---------------------------------------------------------------------------
-- Stock actual en Full
-- ---------------------------------------------------------------------------
create table if not exists stock_full (
  account_id       uuid not null references meli_accounts (id) on delete cascade,
  sku              text not null,
  disponible       integer not null default 0,   -- listo para vender
  en_transferencia integer not null default 0,   -- viajando / recibiéndose
  no_disponible    integer not null default 0,   -- dañado, perdido, en revisión
  total            integer not null default 0,
  detalle          jsonb not null default '{}'::jsonb,
  actualizado_en   timestamptz not null default now(),
  primary key (account_id, sku)
);

-- ---------------------------------------------------------------------------
-- Foto diaria del stock. Es lo que permite saber qué días NO hubo stock,
-- que es de donde sale la corrección de demanda.
-- ---------------------------------------------------------------------------
create table if not exists stock_snapshots (
  account_id       uuid not null references meli_accounts (id) on delete cascade,
  sku              text not null,
  fecha            date not null,
  disponible       integer not null default 0,
  en_transferencia integer not null default 0,
  origen           text not null default 'snapshot',  -- snapshot | reconstruido
  primary key (account_id, sku, fecha)
);
create index if not exists stock_snapshots_fecha_idx on stock_snapshots (account_id, fecha);

-- ---------------------------------------------------------------------------
-- Ventas por SKU y día
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
-- Movimientos de inventario en Full
-- ---------------------------------------------------------------------------
create table if not exists stock_operaciones (
  account_id           uuid not null references meli_accounts (id) on delete cascade,
  operation_id         text not null,
  inventory_id         text,
  sku                  text,
  fecha                timestamptz not null,
  tipo                 text,
  delta_disponible     integer,
  resultado_disponible integer,
  primary key (account_id, operation_id)
);
create index if not exists stock_ops_sku_fecha_idx on stock_operaciones (account_id, sku, fecha);

-- ---------------------------------------------------------------------------
-- CORRIDAS: la receta de tallas de cada caja.
-- Clave del negocio: PEDIDO + MODELO + COLOR.
-- ---------------------------------------------------------------------------
create table if not exists corridas (
  account_id     uuid not null references meli_accounts (id) on delete cascade,
  pedido         text not null,
  modelo         text not null,
  color          text not null,
  -- { "23": 5, "24": 10, "25": 13, ... }
  tallas         jsonb not null,
  total          integer not null,
  -- 'excel' si vino del archivo, 'manual' si se capturó en la app
  origen         text not null default 'excel',
  actualizado_en timestamptz not null default now(),
  primary key (account_id, pedido, modelo, color)
);
create index if not exists corridas_modelo_idx on corridas (account_id, modelo, color);

-- ---------------------------------------------------------------------------
-- EXISTENCIAS: cuántas cajas hay, de qué y dónde.
-- ---------------------------------------------------------------------------
create table if not exists existencias (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references meli_accounts (id) on delete cascade,
  almacen           text not null,
  codigo_almacen    text,
  sku_caja          text not null,
  pedido            text,
  modelo            text not null,
  color             text,
  -- 'CORRIDA' o una talla concreta ('25')
  talla             text not null,
  contenedor        text,
  cajas_fisicas     integer not null default 0,
  cajas_apartadas   integer not null default 0,
  en_camino         integer not null default 0,
  cajas_disponibles integer not null default 0,
  pares_por_caja    integer not null default 0,
  importado_en      timestamptz not null default now(),
  unique (account_id, almacen, sku_caja, talla, contenedor)
);
create index if not exists existencias_cuenta_idx on existencias (account_id);
create index if not exists existencias_modelo_idx on existencias (account_id, modelo, color);

-- Qué almacenes surten a Full (si está vacío, se usan todos)
create table if not exists almacenes_activos (
  account_id uuid not null references meli_accounts (id) on delete cascade,
  almacen    text not null,
  surte_full boolean not null default true,
  primary key (account_id, almacen)
);

-- ---------------------------------------------------------------------------
-- MAPEO MANUAL DE SKU
-- El SKU que se arma desde bodega (MODELO-COLOR-TALLA) no siempre coincide
-- con el que está capturado en la publicación de MELI. Aquí se amarran a mano
-- los que la normalización automática no alcanza.
-- ---------------------------------------------------------------------------
create table if not exists mapeo_sku (
  account_id      uuid not null references meli_accounts (id) on delete cascade,
  sku_construido  text not null,
  sku_meli        text not null,
  nota            text,
  creado_en       timestamptz not null default now(),
  primary key (account_id, sku_construido)
);

-- ---------------------------------------------------------------------------
-- Parámetros y ajustes por SKU
-- ---------------------------------------------------------------------------
create table if not exists parametros (
  account_id     uuid primary key references meli_accounts (id) on delete cascade,
  datos          jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now()
);

create table if not exists sku_overrides (
  account_id       uuid not null references meli_accounts (id) on delete cascade,
  sku              text not null,
  excluir          boolean not null default false,
  demanda_manual   numeric,
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
  estado     text not null default 'borrador'   -- borrador | confirmado | enviado
);
create index if not exists planes_cuenta_idx on planes (account_id, creado_en desc);

create table if not exists plan_lineas (
  plan_id uuid not null references planes (id) on delete cascade,
  sku     text not null,
  datos   jsonb not null,
  primary key (plan_id, sku)
);

create table if not exists plan_cajas (
  plan_id     uuid not null references planes (id) on delete cascade,
  caja_codigo text not null,
  almacen     text,
  sku_caja    text,
  talla       text,
  cantidad    integer not null,
  pares       integer not null default 0,
  detalle     jsonb not null default '[]'::jsonb,
  primary key (plan_id, caja_codigo)
);

-- ---------------------------------------------------------------------------
-- Bitácora de sincronizaciones e importaciones
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
