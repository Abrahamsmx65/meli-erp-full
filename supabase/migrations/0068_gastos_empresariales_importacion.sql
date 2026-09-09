alter table public.gastos_empresariales
  add column if not exists clave_importacion text;

alter table public.gastos_empresariales
  drop constraint if exists gastos_empresariales_clave_importacion_valida;

alter table public.gastos_empresariales
  add constraint gastos_empresariales_clave_importacion_valida check (
    clave_importacion is null
    or char_length(btrim(clave_importacion)) between 1 and 200
  );

create unique index if not exists gastos_empresariales_cuenta_clave_importacion
  on public.gastos_empresariales (account_id, clave_importacion)
  where clave_importacion is not null;