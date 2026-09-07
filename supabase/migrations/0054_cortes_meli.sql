-- ============================================================================
--  Cortes mensuales de Mercado Libre: lo que se ganó DE VERDAD en el mes.
--
--  Cuatro piezas:
--   1. ordenes_neto crece con la REVISIÓN de cada orden: su estado en MELI
--      (pagada / cancelada), el estado del pago en Mercado Pago (aprobado /
--      reembolsado / contracargo), cuánto se le devolvió al comprador y el
--      neto tal como Mercado Pago lo reporta HOY. Sin esto, una orden
--      cancelada o devuelta semanas después seguía contando como venta.
--   2. gastos_meli: gastos del mes capturados a mano (almacenamiento de
--      Full, publicidad fuera del API, lo que sea) con fecha y concepto.
--   3. meli_cargos: lo que MELI facturó en el periodo según su API de
--      facturación, renglón por renglón, con el crudo por si hay que
--      reclasificar.
--   4. cortes_meli: el estado de resultados del mes CONGELADO al hacer el
--      corte (jsonb). Un corte se puede rehacer: el del mismo mes se
--      reemplaza.
-- ============================================================================

alter table public.ordenes_neto
  add column if not exists payment_ids  jsonb,
  -- estado de la orden en MELI: paid | cancelled | …
  add column if not exists estado       text,
  -- estado del pago en Mercado Pago: approved | refunded | charged_back | in_mediation | …
  add column if not exists estado_pago  text,
  -- lo devuelto al comprador (transaction_amount_refunded), sumado por pagos
  add column if not exists reembolsado  numeric not null default 0,
  -- net_received_amount releído en la revisión; null = aún no se revisó
  add column if not exists neto_actual  numeric,
  add column if not exists revisado_en  timestamptz,
  -- cuántas revisiones lleva (1 a los 10 días, 2 a los 40)
  add column if not exists revisiones   smallint not null default 0;

create index if not exists ordenes_neto_revision_idx
  on public.ordenes_neto (account_id, fecha, revisiones);

create table if not exists public.gastos_meli (
  id          bigserial primary key,
  account_id  uuid not null references public.meli_accounts (id) on delete cascade,
  fecha       date not null,
  concepto    text not null,
  -- full | publicidad | otro
  categoria   text not null default 'otro',
  monto       numeric not null,
  creado_en   timestamptz not null default now(),
  creado_por  uuid references auth.users (id) on delete set null
);
create index if not exists gastos_meli_fecha_idx on public.gastos_meli (account_id, fecha);

alter table public.gastos_meli enable row level security;
drop policy if exists gastos_meli_mias on public.gastos_meli;
create policy gastos_meli_mias on public.gastos_meli
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

create table if not exists public.meli_cargos (
  account_id   uuid not null references public.meli_accounts (id) on delete cascade,
  -- YYYY-MM del periodo de facturación
  periodo      text not null,
  detalle_id   text not null,
  fecha        date,
  tipo         text,
  subtipo      text,
  descripcion  text,
  monto        numeric not null default 0,
  -- full | publicidad | venta | otro (clasificación nuestra, por texto)
  clase        text not null default 'otro',
  crudo        jsonb,
  leido_en     timestamptz not null default now(),
  primary key (account_id, detalle_id)
);
create index if not exists meli_cargos_periodo_idx on public.meli_cargos (account_id, periodo);

alter table public.meli_cargos enable row level security;
drop policy if exists meli_cargos_mias on public.meli_cargos;
create policy meli_cargos_mias on public.meli_cargos
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

create table if not exists public.cortes_meli (
  id          bigserial primary key,
  account_id  uuid not null references public.meli_accounts (id) on delete cascade,
  -- YYYY-MM
  periodo     text not null,
  desde       date not null,
  hasta       date not null,
  resumen     jsonb not null,
  creado_en   timestamptz not null default now(),
  creado_por  uuid references auth.users (id) on delete set null,
  unique (account_id, periodo)
);

alter table public.cortes_meli enable row level security;
drop policy if exists cortes_meli_mias on public.cortes_meli;
create policy cortes_meli_mias on public.cortes_meli
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
