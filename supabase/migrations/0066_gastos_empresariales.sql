-- Gastos que pertenecen al negocio completo y se descuentan una sola vez en
-- el corte general. No forman parte de ningún canal ni se reparten por modelo.
create table if not exists public.gastos_empresariales (
  id          bigserial primary key,
  account_id  uuid not null references public.meli_accounts (id) on delete cascade,
  fecha       date not null,
  concepto    text not null check (char_length(btrim(concepto)) between 1 and 200),
  categoria   text not null check (char_length(btrim(categoria)) between 1 and 80),
  monto       numeric(14,2) not null check (monto > 0),
  creado_en   timestamptz not null default now(),
  creado_por  uuid references auth.users (id) on delete set null
);

create index if not exists gastos_empresariales_cuenta_fecha
  on public.gastos_empresariales (account_id, fecha);

alter table public.gastos_empresariales enable row level security;
drop policy if exists gastos_empresariales_mios on public.gastos_empresariales;
create policy gastos_empresariales_mios on public.gastos_empresariales
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));