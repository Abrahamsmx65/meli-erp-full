-- Pausas de Product Ads hechas desde el ERP.
--
-- Cuando un anuncio se pausa desde la página de Publicidad (normalmente
-- porque el stock se acabó o está por acabarse), se apunta aquí. Al volver a
-- haber stock del modelo, la página lo detecta y recuerda encenderlo; al
-- reactivarlo se marca reactivado_en y el recordatorio se apaga. NO es el
-- estado del anuncio en MELI (ese vive en MELI): es la memoria de POR QUÉ se
-- pausó y de que hay que acordarse de encenderlo.
create table if not exists publicidad_pausas (
  account_id    uuid not null references meli_accounts(id) on delete cascade,
  item_id       text not null,
  modelo        text not null default '',
  motivo        text not null default '',
  pausado_en    timestamptz not null default now(),
  reactivado_en timestamptz,
  primary key (account_id, item_id)
);

create index if not exists publicidad_pausas_activas_idx
  on publicidad_pausas (account_id) where reactivado_en is null;

alter table publicidad_pausas enable row level security;

create policy publicidad_pausas_mias on publicidad_pausas for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
