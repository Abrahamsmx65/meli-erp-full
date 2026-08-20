-- Lo que MELI de verdad deposita por cada orden (net_received_amount de
-- Mercado Pago): ya trae descontados comisión, envío de Full y retenciones
-- de ISR/IVA. Se guarda por orden porque los cargos llegan diferidos y el
-- neto de una orden reciente se vuelve a leer hasta que se asienta.
create table if not exists ordenes_neto (
  account_id     uuid not null references meli_accounts(id) on delete cascade,
  order_id       bigint not null,
  payment_id     bigint,
  fecha          date not null,
  total          numeric not null default 0,
  neto           numeric not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, order_id)
);
create index if not exists ordenes_neto_fecha_idx on ordenes_neto (account_id, fecha);

alter table ordenes_neto enable row level security;
drop policy if exists ordenes_neto_mias on ordenes_neto;
create policy ordenes_neto_mias on ordenes_neto for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

-- El neto del día por SKU, repartido desde las órdenes en proporción al
-- importe de cada renglón.
alter table ventas_diarias add column if not exists neto numeric not null default 0;
