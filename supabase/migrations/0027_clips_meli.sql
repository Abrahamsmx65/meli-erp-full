-- Clips de Mercado Libre por publicación.
--
-- Con el agrupador de variantes cada color es su PROPIO MLM: el clip que se
-- sube a una variante se ve en la página agrupada, pero MELI se lo cuenta
-- solo a ese MLM y las hermanas quedan sin video (menos exposición). Esta
-- tabla es el espejo local de qué publicación tiene clip y la cola para
-- aplicar el video de una hermana a las que no lo tienen.
--
-- estado: sin_leer | ok (tiene clip) | sin_clip | pendiente (encolada para
-- subir) | error. Las columnas origen_* son la cola: de qué publicación
-- hermana sale el video y de qué URL se descarga para re-subirlo.
create table if not exists clips_meli (
  account_id       uuid not null references meli_accounts(id) on delete cascade,
  item_id          text not null,
  modelo           text,
  titulo           text,
  color            text,
  estado_pub       text,
  -- Lo que MELI contestó al consultar los clips de la publicación.
  clips            jsonb,
  tiene_clip       boolean not null default false,
  clip_url         text,
  leido_en         timestamptz,
  estado           text not null default 'sin_leer',
  origen_item_id   text,
  origen_video_url text,
  ultimo_error     text,
  aplicado_en      timestamptz,
  actualizado_en   timestamptz not null default now(),
  primary key (account_id, item_id)
);

create index if not exists clips_meli_estado_idx
  on clips_meli (account_id, estado);

alter table clips_meli enable row level security;

create policy clips_meli_mios on clips_meli for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
