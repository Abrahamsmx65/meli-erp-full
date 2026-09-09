alter table public.gastos_empresariales
  add column if not exists clave_idempotencia uuid;

create unique index if not exists gastos_empresariales_cuenta_idempotencia
  on public.gastos_empresariales (account_id, clave_idempotencia)
  where clave_idempotencia is not null;