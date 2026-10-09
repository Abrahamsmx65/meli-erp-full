-- Gastos FIJOS del negocio (nómina, fletes, renta, logística 3PL…): la
-- mayoría se repite igual cada mes (dueño, 9-oct-2026). Se dan de alta UNA
-- vez como plantilla y cada mes se materializa su renglón en
-- `gastos_empresariales` (fecha = día 1 del mes, `gasto_fijo_id`), que el
-- dueño puede corregir (`editado`) u omitir para ese mes (`omitido`).
-- En el mes en curso el corte los cuenta en proporción a los días
-- transcurridos (decisión del dueño): eso se calcula al leer.
create table if not exists public.gastos_fijos (
  id             bigserial primary key,
  account_id     uuid not null references public.meli_accounts (id) on delete cascade,
  concepto       text not null check (char_length(btrim(concepto)) between 1 and 200),
  categoria      text not null check (char_length(btrim(categoria)) between 1 and 80),
  monto          numeric(14,2) not null check (monto > 0),
  -- primer y último mes en que aplica (día 1 del mes); sin `hasta` = sigue
  desde          date not null check (extract(day from desde) = 1),
  hasta          date check (hasta is null or (extract(day from hasta) = 1 and hasta >= desde)),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists gastos_fijos_cuenta on public.gastos_fijos (account_id);

alter table public.gastos_fijos enable row level security;
create policy gastos_fijos_mios on public.gastos_fijos
  for all using (account_id in (select mis_cuentas_meli()))
  with check (account_id in (select mis_cuentas_meli()));

alter table public.gastos_empresariales
  add column if not exists gasto_fijo_id bigint references public.gastos_fijos (id) on delete set null,
  add column if not exists editado boolean not null default false,
  add column if not exists omitido boolean not null default false;

-- Un renglón por gasto fijo y mes (los gastos sueltos llevan NULL y no chocan).
alter table public.gastos_empresariales
  add constraint gastos_empresariales_fijo_mes unique (account_id, gasto_fijo_id, fecha);
