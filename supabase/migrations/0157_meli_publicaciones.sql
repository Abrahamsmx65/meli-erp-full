-- Publicar productos nuevos de calzado en Mercado Libre (12-nov-2026).
-- Un renglón por pedido de publicación (un modelo con sus colores y
-- tallas); `variantes` lleva el avance de cada color + talla (una
-- publicación de MELI por variante) para poder reintentar solo lo que falló.

create table if not exists meli_publicaciones (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references meli_accounts(id) on delete cascade,
  modelo text not null,
  titulo text not null,
  categoria_id text not null,
  precio numeric not null,
  estado text not null default 'pendiente',
  pedido jsonb not null,
  variantes jsonb not null default '[]'::jsonb,
  error text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists meli_publicaciones_cuenta_idx
  on meli_publicaciones (account_id, creado_en desc);

alter table meli_publicaciones enable row level security;

create policy meli_publicaciones_propias on meli_publicaciones
  for all
  using (account_id in (select mis_cuentas_meli()))
  with check (account_id in (select mis_cuentas_meli()));
