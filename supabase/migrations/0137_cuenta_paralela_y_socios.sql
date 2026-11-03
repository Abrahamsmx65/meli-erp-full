-- CUENTA CON RAFA, SOCIOS y lo demás del sheet «Cuentas YAPANIZCEL» dentro
-- del ERP (dueño, 11-oct-2026). Se importó una vez del sheet (que nunca se
-- escribe) y desde ahí se captura aquí.
--
-- · Las transferencias a Rafa (Industher / Vantorix) NO son pagos de
--   contenedores: son el dinero que sale de la cuenta del negocio a una
--   cuenta paralela; Rafa paga a China o le entrega efectivo al dueño, y
--   cobra 2/116 (~1.72 %) de cada transferencia.
-- · De ahí salen también los gastos en EFECTIVO (la pestaña GASTOS MEX) y
--   la renta de oficina; los que se pagan desde el BANCO con factura se
--   capturan en Gastos como siempre (`gastos_empresariales.medio`).
-- · Socios: Abraham 25 %, Daniel 25 %, su papá 50 %. Sus retiros solo se
--   APUNTAN: no son gasto del negocio.
-- · Contenedores de FUNDAS (P605…) en el mismo costeo, y la comisión del
--   agente (Joanne, 1.5 %) por contenedor como gasto operativo, nunca como
--   costo del par.

alter table public.costeo_contenedores drop constraint if exists costeo_contenedores_contenedor_check;
alter table public.costeo_contenedores add constraint costeo_contenedores_contenedor_check check (contenedor ~ '^[SP][0-9]{3}$');
alter table public.costeo_pagos drop constraint if exists costeo_pagos_contenedor_check;
alter table public.costeo_pagos add constraint costeo_pagos_contenedor_check check (contenedor ~ '^[SP][0-9]{3}$');
alter table public.costeo_contenedores
  add column if not exists negocio text not null default 'calzado' check (negocio in ('calzado', 'fundas')),
  add column if not exists comision_agente numeric(14,2) check (comision_agente is null or comision_agente >= 0);

alter table public.gastos_empresariales
  add column if not exists medio text not null default 'banco' check (medio in ('banco', 'efectivo'));

create table if not exists public.cuenta_paralela (
  id                bigserial primary key,
  account_id        uuid not null references public.meli_accounts (id) on delete cascade,
  fecha             date,
  -- transferencia: dinero que entra a la cuenta con Rafa (cobra comisión)
  -- ingreso: dinero que entra sin comisión (una deuda que le pagaron al dueño)
  -- gasto: lo que se paga desde ahí y no está en Gastos (renta de oficina)
  tipo              text not null check (tipo in ('transferencia', 'ingreso', 'gasto')),
  monto             numeric(14,2) not null,
  beneficiario      text,
  referencia        text,
  comision          numeric(14,2) not null default 0,
  notas             text,
  clave_importacion text,
  creado_en         timestamptz not null default now(),
  unique (account_id, clave_importacion)
);
create index if not exists cuenta_paralela_fecha on public.cuenta_paralela (account_id, fecha);
alter table public.cuenta_paralela enable row level security;
create policy cuenta_paralela_mia on public.cuenta_paralela
  for all using (account_id in (select mis_cuentas_meli()))
  with check (account_id in (select mis_cuentas_meli()));

create table if not exists public.socios (
  id          bigserial primary key,
  account_id  uuid not null references public.meli_accounts (id) on delete cascade,
  nombre      text not null check (char_length(btrim(nombre)) between 1 and 80),
  porcentaje  numeric(5,2) not null check (porcentaje >= 0 and porcentaje <= 100),
  orden       int not null default 0,
  unique (account_id, nombre)
);
alter table public.socios enable row level security;
create policy socios_mios on public.socios
  for all using (account_id in (select mis_cuentas_meli()))
  with check (account_id in (select mis_cuentas_meli()));

create table if not exists public.socios_retiros (
  id                bigserial primary key,
  account_id        uuid not null references public.meli_accounts (id) on delete cascade,
  socio_id          bigint not null references public.socios (id) on delete cascade,
  fecha             date,
  concepto          text not null check (char_length(btrim(concepto)) between 1 and 200),
  -- negativo = el socio pagó algo del negocio y se le descuenta de su retiro
  monto             numeric(14,2) not null,
  clave_importacion text,
  creado_en         timestamptz not null default now(),
  unique (account_id, clave_importacion)
);
create index if not exists socios_retiros_socio on public.socios_retiros (account_id, socio_id);
alter table public.socios_retiros enable row level security;
create policy socios_retiros_mios on public.socios_retiros
  for all using (account_id in (select mis_cuentas_meli()))
  with check (account_id in (select mis_cuentas_meli()));
