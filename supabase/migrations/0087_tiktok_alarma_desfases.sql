-- La bitácora de desfases PELIGROSOS entre el kardex y el estante del 3PL.
--
-- El dato ya existía en /tiktok/desfases, pero era una pantalla que nadie
-- abría: el GT102-GREY-25-MX estuvo cuatro días ofreciendo pares que la
-- bodega no tenía y nadie se enteró hasta que un pedido no se pudo surtir.
-- Aquí se guarda DESDE CUÁNDO lleva desfasado cada SKU, para poder avisar
-- una sola vez cuando el problema deja de ser un parpadeo y se vuelve real.
--
-- Solo entra la dirección peligrosa —el kardex ARRIBA del estante, o en
-- negativo—: cuando el kardex va por debajo lo único que pasa es que se
-- dejan de ofrecer pares que sí hay, y eso no cuesta un pedido.
create table if not exists public.tiktok_desfases (
  account_id uuid not null references public.meli_accounts (id) on delete cascade,
  sku        text not null,
  -- desde cuándo NO cuadra (no se pisa mientras siga sin cuadrar)
  desde      timestamptz not null default now(),
  -- última corrida que lo volvió a ver mal
  visto_en   timestamptz not null default now(),
  kardex     integer not null,
  estante    integer,
  motivo     text not null,
  -- cuándo se avisó por correo; null = todavía no
  avisado_en timestamptz,
  primary key (account_id, sku)
);

create index if not exists tiktok_desfases_desde_idx
  on public.tiktok_desfases (account_id, desde);

alter table public.tiktok_desfases enable row level security;

drop policy if exists tiktok_desfases_lectura on public.tiktok_desfases;
create policy tiktok_desfases_lectura on public.tiktok_desfases
  for select to authenticated using (es_mi_cuenta(account_id));
