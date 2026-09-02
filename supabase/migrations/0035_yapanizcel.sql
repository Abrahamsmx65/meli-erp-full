-- ============================================================================
--  ERP YAPANIZCEL — fundas para celular en Mercado Libre
--
--  Es OTRA cuenta de Mercado Libre, con su propia aplicación y sus propios
--  tokens, así que no comparte una sola tabla con el ERP de calzado: todo
--  vive con prefijo `yz_`. Mismo login, misma base, negocios separados.
--
--  Modelo del negocio, que es más simple que el del calzado:
--    · No hay corridas ni cajas que no se abren: la funda es unidad suelta.
--    · El SKU es DISEÑO-MODELO(-COLOR), donde "modelo" es el del CELULAR
--      (IP15PM, A54) y "diseño" el de la funda (499, 501...).
--    · El inventario de bodega vive en un Google Sheets, una pestaña por
--      diseño, y ahí los SKUs se escriben a mano: sobra una N, sobra una C,
--      se cuela un guion. Por eso el amarre contra MELI necesita su propia
--      sección y su propia tabla de mapeo manual.
--    · A Full se manda en DECENAS CERRADAS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Cuenta de Mercado Libre de YAPANIZCEL
-- ---------------------------------------------------------------------------
create table if not exists yz_cuentas (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users (id) on delete cascade,
  meli_user_id   bigint not null,
  nickname       text,
  site_id        text not null default 'MLM',
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (owner_id, meli_user_id)
);

-- Igual que `meli_tokens`: RLS activo y CERO políticas. Solo el backend con
-- service_role la lee. El navegador nunca ve un token.
create table if not exists yz_tokens (
  account_id     uuid primary key references yz_cuentas (id) on delete cascade,
  access_token   text not null,
  refresh_token  text not null,
  expira_en      timestamptz not null,
  actualizado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catálogo de publicaciones
-- ---------------------------------------------------------------------------
create table if not exists yz_skus (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references yz_cuentas (id) on delete cascade,
  sku            text not null,
  item_id        text,
  variation_id   text,
  inventory_id   text,
  user_product_id text,
  titulo         text,
  logistica      text,
  estado         text,
  precio         numeric,
  -- Desglose derivado del SKU, para agrupar por diseño en la pantalla de
  -- pedidos a China (ver todo el 499 junto).
  diseno         text,
  modelo         text,
  color          text,
  actualizado_en timestamptz not null default now(),
  unique (account_id, sku)
);
create index if not exists yz_skus_cuenta_idx on yz_skus (account_id);
create index if not exists yz_skus_diseno_idx on yz_skus (account_id, diseno);
create index if not exists yz_skus_inventario_idx on yz_skus (account_id, inventory_id);

-- Publicaciones cuyo SELLER_SKU todavía no se pudo leer de /user-products.
-- MELI limita esa consulta a ~1/s: lo pendiente se resuelve en segundo plano.
create table if not exists yz_skus_pendientes (
  account_id      uuid not null references yz_cuentas (id) on delete cascade,
  item_id         text not null,
  variation_id    text not null default '',
  user_product_id text,
  inventory_id    text,
  titulo          text,
  logistica       text,
  estado          text,
  precio          numeric,
  intentos        int not null default 0,
  ultimo_error    text,
  creado_en       timestamptz not null default now(),
  primary key (account_id, item_id, variation_id)
);

-- ---------------------------------------------------------------------------
-- Stock en Full
-- ---------------------------------------------------------------------------
create table if not exists yz_stock_full (
  account_id       uuid not null references yz_cuentas (id) on delete cascade,
  sku              text not null,
  disponible       int  not null default 0,
  en_transferencia int  not null default 0,
  no_disponible    int  not null default 0,
  total            int  not null default 0,
  actualizado_en   timestamptz not null default now(),
  primary key (account_id, sku)
);

-- Una foto diaria del stock. Es lo que con el tiempo permite saber CUÁNTOS
-- días de verdad hubo qué vender, en vez de suponerlo.
create table if not exists yz_stock_snapshots (
  account_id       uuid not null references yz_cuentas (id) on delete cascade,
  sku              text not null,
  fecha            date not null,
  disponible       int  not null default 0,
  en_transferencia int  not null default 0,
  primary key (account_id, sku, fecha)
);
create index if not exists yz_snapshots_fecha_idx on yz_stock_snapshots (account_id, fecha);

-- ---------------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------------
create table if not exists yz_ventas_diarias (
  account_id uuid not null references yz_cuentas (id) on delete cascade,
  sku        text not null,
  fecha      date not null,
  unidades   int  not null default 0,
  ordenes    int  not null default 0,
  importe    numeric not null default 0,   -- precio de lista × unidades
  comision   numeric not null default 0,   -- sale_fee de MELI
  neto       numeric,                      -- lo REALMENTE depositado, si ya se sabe
  primary key (account_id, sku, fecha)
);
create index if not exists yz_ventas_fecha_idx on yz_ventas_diarias (account_id, fecha);

-- Caché del neto real por orden (net_received_amount de Mercado Pago). Los
-- cargos de envío y las retenciones llegan DIFERIDOS, así que una orden se
-- vuelve a leer hasta que cumple un día.
create table if not exists yz_ordenes_neto (
  account_id     uuid not null references yz_cuentas (id) on delete cascade,
  order_id       bigint not null,
  payment_id     bigint,
  fecha          date not null,
  total          numeric not null default 0,
  neto           numeric not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, order_id)
);
create index if not exists yz_ordenes_neto_fecha_idx on yz_ordenes_neto (account_id, fecha);

-- ---------------------------------------------------------------------------
-- Inventario de bodega (viene del Google Sheets)
-- ---------------------------------------------------------------------------
-- Se REEMPLAZA completo en cada sincronización: el sheet es la foto del
-- momento y conservar renglones viejos haría planear con lo que ya no está.
create table if not exists yz_inventario (
  account_id     uuid not null references yz_cuentas (id) on delete cascade,
  sku_bodega     text not null,
  hoja           text,
  diseno         text,
  modelo         text,
  color          text,
  cantidad       int  not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, sku_bodega)
);
create index if not exists yz_inventario_diseno_idx on yz_inventario (account_id, diseno);

-- Bitácora de la última lectura del sheet, para poder decir en pantalla qué
-- se leyó y qué se quedó fuera sin tener que volver a bajarlo.
create table if not exists yz_inventario_sync (
  account_id  uuid primary key references yz_cuentas (id) on delete cascade,
  corrido_en  timestamptz not null default now(),
  hojas       int not null default 0,
  renglones   int not null default 0,
  unidades    int not null default 0,
  avisos      jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- Amarre de SKUs: bodega <-> Mercado Libre
-- ---------------------------------------------------------------------------
-- Lo que la normalización automática no alcanza a empatar se resuelve aquí,
-- a mano y una sola vez.
create table if not exists yz_mapeo_skus (
  account_id uuid not null references yz_cuentas (id) on delete cascade,
  sku_bodega text not null,
  sku_meli   text not null,
  nota       text,
  creado_en  timestamptz not null default now(),
  primary key (account_id, sku_bodega)
);

-- SKUs de bodega que a propósito NO se amarran (descontinuados, muestras).
-- Sin esto la pantalla de pendientes nunca se vacía y deja de servir.
create table if not exists yz_skus_ignorados (
  account_id uuid not null references yz_cuentas (id) on delete cascade,
  sku_bodega text not null,
  motivo     text,
  creado_en  timestamptz not null default now(),
  primary key (account_id, sku_bodega)
);

-- ---------------------------------------------------------------------------
-- Costos (llegan de un Excel con número de modelo y costo)
-- ---------------------------------------------------------------------------
create table if not exists yz_costos (
  account_id     uuid not null references yz_cuentas (id) on delete cascade,
  modelo         text not null,   -- forma canónica de la clave del Excel
  etiqueta       text,            -- cómo venía escrita en el Excel
  costo          numeric not null default 0,
  moneda         text not null default 'MXN',
  actualizado_en timestamptz not null default now(),
  primary key (account_id, modelo)
);

-- ---------------------------------------------------------------------------
-- Pedidos a China
-- ---------------------------------------------------------------------------
create table if not exists yz_pedidos (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references yz_cuentas (id) on delete cascade,
  folio          text not null,
  proveedor      text,
  -- creado | en_camino | recibido | cancelado
  estado         text not null default 'creado',
  fecha_pedido   date,
  fecha_estimada date,
  nota           text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (account_id, folio)
);

create table if not exists yz_pedido_lineas (
  id             uuid primary key default gen_random_uuid(),
  pedido_id      uuid not null references yz_pedidos (id) on delete cascade,
  sku_bodega     text not null,
  diseno         text,
  modelo         text,
  color          text,
  cantidad       int  not null default 0,
  recibido       int  not null default 0,
  costo_unitario numeric,
  unique (pedido_id, sku_bodega)
);
create index if not exists yz_pedido_lineas_pedido_idx on yz_pedido_lineas (pedido_id);

-- ---------------------------------------------------------------------------
-- Envíos a Full
-- ---------------------------------------------------------------------------
-- Solo alimentan el cálculo: cuentan como "en camino" y NUNCA descuentan
-- inventario de bodega por sí mismos. Caducan solos y se quedan visibles.
create table if not exists yz_envios (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references yz_cuentas (id) on delete cascade,
  folio          text,
  -- preparado | enviado | recibido | cancelado
  estado         text not null default 'preparado',
  nota           text,
  creado_en      timestamptz not null default now(),
  enviado_en     timestamptz
);
create index if not exists yz_envios_cuenta_idx on yz_envios (account_id, creado_en desc);

create table if not exists yz_envio_lineas (
  id         uuid primary key default gen_random_uuid(),
  envio_id   uuid not null references yz_envios (id) on delete cascade,
  sku_meli   text not null,
  sku_bodega text,
  unidades   int not null default 0,
  unique (envio_id, sku_meli)
);

-- ---------------------------------------------------------------------------
-- Parámetros del planeador
-- ---------------------------------------------------------------------------
create table if not exists yz_parametros (
  account_id            uuid primary key references yz_cuentas (id) on delete cascade,
  dias_venta            int not null default 30,  -- ventana que mide la venta
  dias_objetivo         int not null default 30,  -- cobertura que se quiere dejar en Full
  multiplo_envio        int not null default 10,  -- decenas cerradas
  minimo_envio          int not null default 10,  -- nada de mandar de a 1
  dias_caducidad_envio  int not null default 10,  -- cuándo deja de contar un envío
  actualizado_en        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Bitácora de sincronización
-- ---------------------------------------------------------------------------
create table if not exists yz_sync_log (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references yz_cuentas (id) on delete cascade,
  corrido_en timestamptz not null default now(),
  ok         boolean not null default true,
  detalle    jsonb
);
create index if not exists yz_sync_log_idx on yz_sync_log (account_id, corrido_en desc);
