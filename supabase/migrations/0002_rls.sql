-- ============================================================================
--  Row Level Security: cada quien ve solo sus propias cuentas.
-- ============================================================================

-- Helper: ¿esta cuenta de MELI es del usuario logueado?
create or replace function es_mi_cuenta(a uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from meli_accounts
    where id = a and owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
alter table meli_accounts enable row level security;

drop policy if exists meli_accounts_propias on meli_accounts;
create policy meli_accounts_propias on meli_accounts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- meli_tokens: RLS activo y SIN políticas => solo service_role puede tocarla.
alter table meli_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- Tablas con account_id: misma política para todas.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tablas text[] := array[
    'skus', 'stock_full', 'stock_snapshots', 'ventas_diarias',
    'stock_operaciones', 'inventario_propio', 'cajas', 'parametros',
    'sku_overrides', 'planes', 'sync_log'
  ];
begin
  foreach t in array tablas loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_mias', t);
    execute format(
      'create policy %I on %I for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id))',
      t || '_mias', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Tablas hijas (sin account_id propio): se resuelven por su padre.
-- ---------------------------------------------------------------------------
alter table caja_items enable row level security;
drop policy if exists caja_items_mias on caja_items;
create policy caja_items_mias on caja_items
  for all
  using (exists (select 1 from cajas c where c.id = caja_id and es_mi_cuenta(c.account_id)))
  with check (exists (select 1 from cajas c where c.id = caja_id and es_mi_cuenta(c.account_id)));

alter table plan_lineas enable row level security;
drop policy if exists plan_lineas_mias on plan_lineas;
create policy plan_lineas_mias on plan_lineas
  for all
  using (exists (select 1 from planes p where p.id = plan_id and es_mi_cuenta(p.account_id)))
  with check (exists (select 1 from planes p where p.id = plan_id and es_mi_cuenta(p.account_id)));

alter table plan_cajas enable row level security;
drop policy if exists plan_cajas_mias on plan_cajas;
create policy plan_cajas_mias on plan_cajas
  for all
  using (exists (select 1 from planes p where p.id = plan_id and es_mi_cuenta(p.account_id)))
  with check (exists (select 1 from planes p where p.id = plan_id and es_mi_cuenta(p.account_id)));
