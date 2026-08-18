-- ============================================================================
--  Row Level Security: cada quien ve solo sus propias cuentas.
-- ============================================================================

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

alter table meli_accounts enable row level security;
drop policy if exists meli_accounts_propias on meli_accounts;
create policy meli_accounts_propias on meli_accounts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- meli_tokens: RLS activo y SIN políticas => solo service_role puede tocarla.
alter table meli_tokens enable row level security;

-- Tablas con account_id: misma política para todas.
do $$
declare
  t text;
  tablas text[] := array[
    'skus', 'stock_full', 'stock_snapshots', 'ventas_diarias',
    'stock_operaciones', 'corridas', 'existencias', 'almacenes_activos',
    'mapeo_sku', 'parametros', 'sku_overrides', 'planes', 'sync_log'
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

-- Tablas hijas: se resuelven por su plan padre.
do $$
declare
  t text;
  tablas text[] := array['plan_lineas', 'plan_cajas'];
begin
  foreach t in array tablas loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_mias', t);
    execute format(
      'create policy %I on %I for all
         using (exists (select 1 from planes p where p.id = plan_id and es_mi_cuenta(p.account_id)))
         with check (exists (select 1 from planes p where p.id = plan_id and es_mi_cuenta(p.account_id)))',
      t || '_mias', t
    );
  end loop;
end $$;
