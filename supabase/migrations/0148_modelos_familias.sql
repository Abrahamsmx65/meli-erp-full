-- ============================================================================
--  FAMILIAS de modelos: varios números de modelo que la fábrica hace como UN
--  solo zapato y se piden JUNTOS (dueño, 20-oct-2026: «tengo un modelo que
--  es el GT117 a GT122, quiero juntarlo todo para que se pida junto»).
--  GT117 BROWN, GT118 BLK, GT119 OLIVE, GT120 GREY, GT121 NAVY y GT122 BLK
--  son el mismo modelo en seis colores (una sola publicación en MELI y un
--  solo IN de Mingtai). Planeación de compras los enseña y exporta como un
--  renglón y Nuevo pedido arma UN borrador (un IN, un Excel) con todos.
-- ============================================================================

create table if not exists public.modelos_familias (
  account_id uuid not null references public.meli_accounts (id) on delete cascade,
  modelo     text not null,
  familia    text not null,
  creado_en  timestamptz not null default now(),
  primary key (account_id, modelo)
);

alter table public.modelos_familias enable row level security;
drop policy if exists modelos_familias_mios on public.modelos_familias;
create policy modelos_familias_mios on public.modelos_familias
  for all using (account_id in (select mis_cuentas_meli())) with check (account_id in (select mis_cuentas_meli()));

comment on table public.modelos_familias is 'Modelos que se piden juntos como una familia (GT117…GT122 = un zapato en seis colores).';
