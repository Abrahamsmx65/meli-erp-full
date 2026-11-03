-- COSTEO POR CONTENEDOR y NÚMEROS dentro del ERP (dueño, 11-oct-2026: «ya no
-- quiero actualizar la sección de Números, quiero que tú hagas todos los
-- cálculos según el tipo de cambio que pagué […] y dejar de usar el sheet
-- COSTING GETAC para tener todo en el sistema»).
--
-- costeo_contenedores: lo que se pagó por contenedor que no es por pago
--   (factura en USD, flete en USD, aduana en pesos, si ya se entregó).
-- costeo_pagos: cada pago en USD con SU tipo de cambio (fábrica o flete);
--   los pesos salen de ahí, no de un tipo de cambio único.
-- numeros_modelos: los datos que el dueño fija por modelo para calcular
--   precios (relámpago de MELI, envíos, variantes de la fórmula). El costo
--   NO se guarda: sale del último contenedor costeado.
create table if not exists public.costeo_contenedores (
  account_id     uuid not null references public.meli_accounts (id) on delete cascade,
  contenedor     text not null check (contenedor ~ '^S[0-9]{3}$'),
  anio           int,
  iso            text,
  productos      text,
  costo_usd      numeric(14,2) check (costo_usd is null or costo_usd >= 0),
  flete_usd      numeric(14,2) check (flete_usd is null or flete_usd >= 0),
  aduana_mxn     numeric(14,2) check (aduana_mxn is null or aduana_mxn >= 0),
  entregado      boolean not null default false,
  fecha_entrega  date,
  notas          text,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, contenedor)
);

alter table public.costeo_contenedores enable row level security;
create policy costeo_contenedores_mios on public.costeo_contenedores
  for all using (account_id in (select mis_cuentas_meli()))
  with check (account_id in (select mis_cuentas_meli()));

create table if not exists public.costeo_pagos (
  id           bigserial primary key,
  account_id   uuid not null references public.meli_accounts (id) on delete cascade,
  contenedor   text not null check (contenedor ~ '^S[0-9]{3}$'),
  concepto     text not null check (concepto in ('fabrica', 'flete')),
  fecha        date,
  usd          numeric(14,2) not null check (usd > 0),
  tipo_cambio  numeric(12,6) not null check (tipo_cambio > 0),
  notas        text,
  creado_en    timestamptz not null default now()
);

create index if not exists costeo_pagos_contenedor on public.costeo_pagos (account_id, contenedor);

alter table public.costeo_pagos enable row level security;
create policy costeo_pagos_mios on public.costeo_pagos
  for all using (account_id in (select mis_cuentas_meli()))
  with check (account_id in (select mis_cuentas_meli()));

create table if not exists public.numeros_modelos (
  account_id       uuid not null references public.meli_accounts (id) on delete cascade,
  modelo           text not null,
  envio_meli       numeric(10,2),
  precio_relampago numeric(10,2),
  -- vacío = relámpago × 1.065
  pv_normal        numeric(10,2),
  -- restar también la retención del 10.5 % (IVA + ISR sobre la base sin IVA)
  retencion        boolean not null default false,
  envio_amazon     numeric(10,2),
  -- vacío = PVP Amazon sin ads × 1.12
  pvp_deal         numeric(10,2),
  tiktok_extra     numeric(10,2) not null default 8,
  tiktok_comision  numeric(8,6) not null default 0.24,
  tiktok_oferta    numeric(8,4) not null default 1.11,
  actualizado_en   timestamptz not null default now(),
  primary key (account_id, modelo)
);

alter table public.numeros_modelos enable row level security;
create policy numeros_modelos_mios on public.numeros_modelos
  for all using (account_id in (select mis_cuentas_meli()))
  with check (account_id in (select mis_cuentas_meli()));
