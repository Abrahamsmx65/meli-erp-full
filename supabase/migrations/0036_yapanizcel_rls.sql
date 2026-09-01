-- ============================================================================
--  RLS de ERP YAPANIZCEL.
--
--  Mismo criterio que el ERP de calzado: cada quien alcanza solo lo suyo, y
--  la tabla de tokens no la alcanza NADIE desde el navegador.
-- ============================================================================

-- Igual que `es_mi_cuenta`, pero mirando `yz_cuentas`. Va aparte a propósito:
-- si compartieran función, una cuenta de un ERP abriría los datos del otro.
create or replace function es_mi_cuenta_yz(a uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from yz_cuentas
    where id = a and owner_id = auth.uid()
  );
$$;

-- RLS evalúa con los permisos de quien consulta: sin esto, el usuario con
-- sesión deja de leer sus propios datos. A `anon` no se le da nada.
revoke all on function es_mi_cuenta_yz(uuid) from public;
revoke all on function es_mi_cuenta_yz(uuid) from anon;
grant execute on function es_mi_cuenta_yz(uuid) to authenticated;

alter table yz_cuentas enable row level security;
drop policy if exists yz_cuentas_propias on yz_cuentas;
create policy yz_cuentas_propias on yz_cuentas
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- yz_tokens: RLS activo y SIN políticas => solo service_role. No agregar
-- políticas aquí; es la misma decisión que en `meli_tokens`.
alter table yz_tokens enable row level security;

-- Tablas con account_id.
do $$
declare
  t text;
  tablas text[] := array[
    'yz_skus', 'yz_skus_pendientes', 'yz_stock_full', 'yz_stock_snapshots',
    'yz_ventas_diarias', 'yz_ordenes_neto', 'yz_inventario',
    'yz_inventario_sync', 'yz_mapeo_skus', 'yz_skus_ignorados', 'yz_costos',
    'yz_pedidos', 'yz_envios', 'yz_parametros', 'yz_sync_log'
  ];
begin
  foreach t in array tablas loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_mias', t);
    execute format(
      'create policy %I on %I for all using (es_mi_cuenta_yz(account_id)) with check (es_mi_cuenta_yz(account_id))',
      t || '_mias', t
    );
  end loop;
end $$;

-- Tablas hijas: se resuelven por su padre.
alter table yz_pedido_lineas enable row level security;
drop policy if exists yz_pedido_lineas_mias on yz_pedido_lineas;
create policy yz_pedido_lineas_mias on yz_pedido_lineas for all
  using (exists (select 1 from yz_pedidos p where p.id = pedido_id and es_mi_cuenta_yz(p.account_id)))
  with check (exists (select 1 from yz_pedidos p where p.id = pedido_id and es_mi_cuenta_yz(p.account_id)));

alter table yz_envio_lineas enable row level security;
drop policy if exists yz_envio_lineas_mias on yz_envio_lineas;
create policy yz_envio_lineas_mias on yz_envio_lineas for all
  using (exists (select 1 from yz_envios e where e.id = envio_id and es_mi_cuenta_yz(e.account_id)))
  with check (exists (select 1 from yz_envios e where e.id = envio_id and es_mi_cuenta_yz(e.account_id)));
