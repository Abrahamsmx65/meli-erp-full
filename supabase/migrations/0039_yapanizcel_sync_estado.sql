-- Hasta dónde están completas las ventas diarias de YAPANIZCEL. La
-- sincronización va por tramos de 7 días (el catálogo es grande y una sola
-- corrida no cabe en el tiempo de la función); aquí se apunta el rango ya
-- cubierto para retomar donde se quedó.
create table if not exists yz_sync_estado (
  account_id     uuid primary key references yz_cuentas (id) on delete cascade,
  ventas_desde   date,
  ventas_hasta   date,
  actualizado_en timestamptz not null default now()
);
alter table yz_sync_estado enable row level security;
drop policy if exists yz_sync_estado_mias on yz_sync_estado;
create policy yz_sync_estado_mias on yz_sync_estado
  for all using (es_mi_cuenta_yz(account_id)) with check (es_mi_cuenta_yz(account_id));
