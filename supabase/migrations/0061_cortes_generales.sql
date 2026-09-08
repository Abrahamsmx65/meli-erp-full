-- Corte general del mes: calzado en MELI + fundas en MELI + Amazon, todo
-- junto, congelado en jsonb. Vive con la cuenta de calzado (la principal).
create table if not exists public.cortes_generales (
  id          bigserial primary key,
  account_id  uuid not null references public.meli_accounts (id) on delete cascade,
  periodo     text not null,
  desde       date not null,
  hasta       date not null,
  resumen     jsonb not null,
  creado_en   timestamptz not null default now(),
  creado_por  uuid references auth.users (id) on delete set null,
  unique (account_id, periodo)
);
alter table public.cortes_generales enable row level security;
drop policy if exists cortes_generales_mias on public.cortes_generales;
create policy cortes_generales_mias on public.cortes_generales
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
