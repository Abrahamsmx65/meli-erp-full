-- Tallas cuyo SKU vive en el user product de MELI y aún no se ha consultado.
--
-- MELI limita /user-products a ~1 llamada por segundo, así que no caben en
-- la sincronización. Aquí se apuntan con todo su contexto y un proceso en
-- segundo plano las va resolviendo con el dato real hasta vaciar la tabla.
create table if not exists skus_pendientes (
  account_id      uuid not null references meli_accounts(id) on delete cascade,
  item_id         text not null,
  variation_id    text not null default '',
  user_product_id text not null,
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

alter table skus_pendientes enable row level security;

create policy skus_pendientes_mias on skus_pendientes for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
