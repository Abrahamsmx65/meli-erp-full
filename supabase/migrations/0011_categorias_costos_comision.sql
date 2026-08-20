-- Categoría y costo por producto (modelo + color), capturados a mano.
-- La categoría no existe en MELI (corcho, EVA, pantufla…) y el costo final
-- aterrizado solo lo sabe el negocio: ambos viven aquí. El costo es por
-- modelo+color porque todas las tallas cuestan lo mismo, en MXN.
create table if not exists productos_config (
  account_id     uuid not null references meli_accounts(id) on delete cascade,
  modelo         text not null,
  color          text not null default '',
  categoria      text,
  costo_mxn      numeric,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, modelo, color)
);

alter table productos_config enable row level security;
drop policy if exists productos_config_mias on productos_config;
create policy productos_config_mias on productos_config for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

-- Comisión real que MELI cobra por lo vendido (el sale_fee de cada orden):
-- lo que de verdad se recibe es importe - comision. La ganancia se calcula
-- sobre ese neto, no sobre el precio de lista.
alter table ventas_diarias add column if not exists comision numeric not null default 0;
