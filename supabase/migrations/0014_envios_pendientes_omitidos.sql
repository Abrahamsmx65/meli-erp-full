-- Envíos pendientes de Industher que el usuario TACHÓ para que no cuenten
-- como "en camino a Full" en el plan. El envío desaparece solo cuando la
-- bodega lo marca recibido (deja de venir en el API); la marca se queda por
-- si el mismo ID reaparece.
create table if not exists envios_pendientes_omitidos (
  account_id uuid not null references meli_accounts (id) on delete cascade,
  envio_id   text not null,
  creado_en  timestamptz not null default now(),
  primary key (account_id, envio_id)
);

alter table envios_pendientes_omitidos enable row level security;

drop policy if exists envios_pendientes_omitidos_rw on envios_pendientes_omitidos;
create policy envios_pendientes_omitidos_rw on envios_pendientes_omitidos
  for all
  using (es_mi_cuenta(account_id))
  with check (es_mi_cuenta(account_id));
