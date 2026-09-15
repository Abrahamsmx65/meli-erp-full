-- Conciliación de MELI contra el reporte de Ventas de Mercado Libre
-- (Ventas → Descargar reporte, Excel): el reporte trae una fila por VENTA
-- —una orden suelta o un PAQUETE de varias órdenes, con el id del paquete—
-- con ingresos, cargo por venta e impuestos, envíos, anulaciones y total.
-- El ERP guarda una fila por ORDEN (`ordenes_neto`, con `pack_id`); esta
-- función la suma por venta para poder cotejar renglón por renglón.
create or replace function ordenes_neto_por_venta(
  p_account uuid,
  p_desde   date,
  p_hasta   date
)
returns table (
  venta          bigint,
  ordenes        bigint,
  fecha          date,
  estados        text,
  tipo_venta     text,
  total          numeric,
  comision       numeric,
  envio          numeric,
  isr            numeric,
  iva            numeric,
  otros          numeric,
  sin_desglosar  numeric,
  neto           numeric,
  sin_neto       bigint,
  reembolsado    numeric,
  con_pago_real  bigint,
  order_ids      bigint[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta(p_account) then
    raise exception 'Esa cuenta no es tuya' using errcode = '42501';
  end if;

  return query
    select
      coalesce(o.pack_id, o.order_id)                          as venta,
      count(*)                                                 as ordenes,
      min(o.fecha)                                             as fecha,
      string_agg(distinct coalesce(o.estado, '?'), ',')        as estados,
      max(o.tipo_venta)                                        as tipo_venta,
      sum(coalesce(o.total, 0))                                as total,
      sum(coalesce(o.comision_mp, 0))                          as comision,
      sum(coalesce(o.envio_mp, 0))                             as envio,
      sum(coalesce(o.isr_mp, 0))                               as isr,
      sum(coalesce(o.iva_mp, 0))                               as iva,
      sum(coalesce(o.otros_mp, 0))                             as otros,
      sum(coalesce(o.cargos_sin_desglosar, 0))                 as sin_desglosar,
      sum(coalesce(o.neto, 0))                                 as neto,
      count(*) filter (where o.neto_en is null)                as sin_neto,
      sum(coalesce(o.reembolsado, 0))                          as reembolsado,
      count(*) filter (where o.cargos_fuente is not null)      as con_pago_real,
      array_agg(o.order_id order by o.order_id)                as order_ids
    from ordenes_neto o
    where o.account_id = p_account
      and o.fecha >= p_desde
      and o.fecha <= p_hasta
    group by coalesce(o.pack_id, o.order_id)
    order by 1;
end;
$$;

revoke all on function ordenes_neto_por_venta(uuid, date, date) from public, anon;
grant execute on function ordenes_neto_por_venta(uuid, date, date) to authenticated, service_role;
