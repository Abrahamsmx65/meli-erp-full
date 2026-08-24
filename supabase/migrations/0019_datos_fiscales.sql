-- Datos fiscales de las publicaciones de MELI (solo México).
--
-- Espejo local de fiscal_information/graphql para encontrar los SKUs que NO
-- tienen la información cargada (la UI de MELI se atora con muchos productos)
-- y rellenarlos en masa por modelo. Las columnas *_nuevo son la cola de envío:
-- lo capturado que todavía no llega a MELI. Solo cuando MELI confirma la
-- mutación, los valores pasan a las columnas reales.
create table if not exists datos_fiscales (
  account_id     uuid not null references meli_accounts(id) on delete cascade,
  sku            text not null,
  item_id        text,
  variation_id   text,
  -- Lo que MELI tiene hoy (getFiscalInformationsByItem / BySku).
  sat            text,
  iva            text,
  ieps           numeric,
  upc            text,
  descripcion    text,
  unidad         text,
  unidad_desc    text,
  leido_en       timestamptz,
  -- ok | sin_datos | pendiente | error
  estado         text not null default 'sin_datos',
  sat_nuevo      text,
  iva_nuevo      text,
  ieps_nuevo     numeric,
  unidad_nueva   text,
  ultimo_error   text,
  enviado_en     timestamptz,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, sku)
);

create index if not exists datos_fiscales_estado_idx
  on datos_fiscales (account_id, estado);

alter table datos_fiscales enable row level security;

create policy datos_fiscales_mias on datos_fiscales for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
