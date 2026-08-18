-- ============================================================================
--  Sincronización en vivo, pedidos a China, contenedores y envíos a Full.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Avisos de Mercado Libre (webhooks).
--
-- MELI exige que le contestes 200 en menos de medio segundo o reintenta y
-- acaba desactivando la suscripción. Por eso el aviso se guarda y se procesa
-- después: la fila es una bandeja de entrada, no un registro histórico.
-- ---------------------------------------------------------------------------
create table if not exists webhooks_meli (
  id            bigserial primary key,
  account_id    uuid references meli_accounts (id) on delete cascade,
  meli_user_id  bigint,
  topic         text not null,
  resource      text not null,
  recibido_en   timestamptz not null default now(),
  procesado_en  timestamptz,
  intentos      integer not null default 0,
  error         text,
  raw           jsonb
);
create index if not exists webhooks_pendientes_idx
  on webhooks_meli (account_id, recibido_en) where procesado_en is null;
create index if not exists webhooks_recientes_idx
  on webhooks_meli (account_id, recibido_en desc);

-- ---------------------------------------------------------------------------
-- Pedidos a China.
--
-- Ciclo de vida: creado -> con contenedor -> en tránsito -> recibido.
-- Un pedido puede repartirse en varios contenedores, y un contenedor puede
-- traer varios pedidos: por eso el reparto vive en su propia tabla.
-- ---------------------------------------------------------------------------
create table if not exists pedidos (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references meli_accounts (id) on delete cascade,
  pedido         text not null,
  proveedor      text,
  fecha_pi       date,
  moneda         text default 'RMB',
  importe        numeric,
  estado         text not null default 'creado',
  notas          text,
  archivo        text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (account_id, pedido)
);

create table if not exists pedido_lineas (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references pedidos (id) on delete cascade,
  modelo          text not null,
  color           text not null,
  descripcion     text,
  tallas          jsonb not null default '{}'::jsonb,
  pares_por_caja  integer not null default 0,
  cajas           integer not null default 0,
  pares           integer not null default 0,
  precio_unitario numeric,
  unique (pedido_id, modelo, color)
);

create table if not exists contenedores (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references meli_accounts (id) on delete cascade,
  numero             text not null,
  naviera            text,
  fecha_salida       date,
  fecha_llegada_est  date,
  fecha_llegada_real date,
  almacen_destino    text,
  estado             text not null default 'en_transito',
  notas              text,
  creado_en          timestamptz not null default now(),
  unique (account_id, numero)
);

-- Qué cajas de qué pedido van en qué contenedor.
create table if not exists contenedor_lineas (
  id              uuid primary key default gen_random_uuid(),
  contenedor_id   uuid not null references contenedores (id) on delete cascade,
  pedido_linea_id uuid not null references pedido_lineas (id) on delete cascade,
  cajas           integer not null default 0,
  unique (contenedor_id, pedido_linea_id)
);

-- ---------------------------------------------------------------------------
-- Envíos a Full.
--
-- Caseshop e Industher pueden viajar juntos; EnvioPack sale de otra bodega y
-- necesita su propio envío. Por eso el envío guarda de qué bodegas es.
-- ---------------------------------------------------------------------------
create table if not exists envios_full (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references meli_accounts (id) on delete cascade,
  folio       text,
  bodegas     text[] not null default '{}',
  estado      text not null default 'borrador',
  plan_id     uuid references planes (id) on delete set null,
  cajas       integer not null default 0,
  pares       integer not null default 0,
  notas       text,
  creado_en   timestamptz not null default now(),
  enviado_en  timestamptz
);

create table if not exists envio_cajas (
  id          uuid primary key default gen_random_uuid(),
  envio_id    uuid not null references envios_full (id) on delete cascade,
  caja_codigo text not null,
  almacen     text,
  sku_caja    text,
  pedido      text,
  modelo      text,
  color       text,
  talla       text,
  cantidad    integer not null,
  pares       integer not null default 0,
  detalle     jsonb not null default '[]'::jsonb
);
create index if not exists envio_cajas_envio_idx on envio_cajas (envio_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tablas text[] := array['webhooks_meli','pedidos','contenedores','envios_full'];
begin
  foreach t in array tablas loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_mias', t);
    execute format(
      'create policy %I on %I for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id))',
      t || '_mias', t
    );
  end loop;
end $$;

alter table pedido_lineas enable row level security;
drop policy if exists pedido_lineas_mias on pedido_lineas;
create policy pedido_lineas_mias on pedido_lineas for all
  using (exists (select 1 from pedidos p where p.id = pedido_id and es_mi_cuenta(p.account_id)))
  with check (exists (select 1 from pedidos p where p.id = pedido_id and es_mi_cuenta(p.account_id)));

alter table contenedor_lineas enable row level security;
drop policy if exists contenedor_lineas_mias on contenedor_lineas;
create policy contenedor_lineas_mias on contenedor_lineas for all
  using (exists (select 1 from contenedores c where c.id = contenedor_id and es_mi_cuenta(c.account_id)))
  with check (exists (select 1 from contenedores c where c.id = contenedor_id and es_mi_cuenta(c.account_id)));

alter table envio_cajas enable row level security;
drop policy if exists envio_cajas_mias on envio_cajas;
create policy envio_cajas_mias on envio_cajas for all
  using (exists (select 1 from envios_full e where e.id = envio_id and es_mi_cuenta(e.account_id)))
  with check (exists (select 1 from envios_full e where e.id = envio_id and es_mi_cuenta(e.account_id)));
