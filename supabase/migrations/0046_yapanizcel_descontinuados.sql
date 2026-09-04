-- Descontinuados: un SKU sin una sola venta en 180 días ya no se ofrece ni
-- se pide (decisión del dueño). Para no confundir "nuevo" con "muerto" se
-- guarda cuándo se publicó (date_created de MELI); si no se sabe, se asume
-- vieja. La última venta se calcula en la base.
alter table yz_skus add column if not exists publicado_en timestamptz;
alter table yz_skus_pendientes add column if not exists publicado_en timestamptz;

create or replace function yz_ultima_venta(p_account uuid)
returns table (sku text, ultima_venta date)
language sql stable security definer set search_path = public as $$
  select v.sku, max(v.fecha)
  from yz_ventas_diarias v
  where v.account_id = p_account and v.unidades > 0
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  group by v.sku;
$$;
revoke all on function yz_ultima_venta(uuid) from public, anon;
grant execute on function yz_ultima_venta(uuid) to authenticated, service_role;
