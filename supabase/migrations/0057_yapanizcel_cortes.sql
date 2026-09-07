-- ============================================================================
--  Corte mensual de YAPANIZCEL, con las mismas piezas que el de calzado:
--  revisión de devoluciones y cancelaciones por orden, gastos a mano,
--  facturación de MELI (cargos de Full) y el corte congelado con su PDF.
--  Tablas propias (yz_) porque la cuenta de fundas es otra cuenta de MELI.
-- ============================================================================

alter table yz_ordenes_neto
  add column if not exists estado       text,
  add column if not exists estado_pago  text,
  add column if not exists reembolsado  numeric not null default 0,
  add column if not exists neto_actual  numeric,
  add column if not exists revisado_en  timestamptz,
  add column if not exists revisiones   smallint not null default 0;

create index if not exists yz_ordenes_neto_revision_idx
  on yz_ordenes_neto (account_id, fecha, revisiones);

create table if not exists yz_gastos (
  id          bigserial primary key,
  account_id  uuid not null references yz_cuentas (id) on delete cascade,
  fecha       date not null,
  concepto    text not null,
  categoria   text not null default 'otro',
  monto       numeric not null,
  creado_en   timestamptz not null default now(),
  creado_por  uuid references auth.users (id) on delete set null
);
create index if not exists yz_gastos_fecha_idx on yz_gastos (account_id, fecha);
alter table yz_gastos enable row level security;
drop policy if exists yz_gastos_mias on yz_gastos;
create policy yz_gastos_mias on yz_gastos
  for all using (es_mi_cuenta_yz(account_id)) with check (es_mi_cuenta_yz(account_id));

create table if not exists yz_cargos (
  account_id   uuid not null references yz_cuentas (id) on delete cascade,
  periodo      text not null,
  detalle_id   text not null,
  fecha        date,
  tipo         text,
  subtipo      text,
  descripcion  text,
  monto        numeric not null default 0,
  clase        text not null default 'otro',
  crudo        jsonb,
  leido_en     timestamptz not null default now(),
  primary key (account_id, detalle_id)
);
create index if not exists yz_cargos_periodo_idx on yz_cargos (account_id, periodo);
alter table yz_cargos enable row level security;
drop policy if exists yz_cargos_mias on yz_cargos;
create policy yz_cargos_mias on yz_cargos
  for all using (es_mi_cuenta_yz(account_id)) with check (es_mi_cuenta_yz(account_id));

create table if not exists yz_cortes (
  id          bigserial primary key,
  account_id  uuid not null references yz_cuentas (id) on delete cascade,
  periodo     text not null,
  desde       date not null,
  hasta       date not null,
  resumen     jsonb not null,
  creado_en   timestamptz not null default now(),
  creado_por  uuid references auth.users (id) on delete set null,
  unique (account_id, periodo)
);
alter table yz_cortes enable row level security;
drop policy if exists yz_cortes_mias on yz_cortes;
create policy yz_cortes_mias on yz_cortes
  for all using (es_mi_cuenta_yz(account_id)) with check (es_mi_cuenta_yz(account_id));
