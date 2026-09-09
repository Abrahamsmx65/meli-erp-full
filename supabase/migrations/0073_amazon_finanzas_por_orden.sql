-- Conciliación del dinero de Amazon contra el reporte de transacciones de
-- Seller Central (Pagos → Reportes → Transacciones, CSV por mes): el ERP
-- suma sus eventos por PEDIDO en el mismo rango de fechas de asiento y los
-- coteja con el reporte, orden por orden. Estas dos funciones dan el lado
-- del ERP; el cruce vive en `amazon/conciliar.ts`.

-- Por pedido: lo que el ERP tiene de cada orden entre dos instantes.
create or replace function amazon_finanzas_por_orden(
  p_account uuid,
  p_desde   timestamptz,
  p_hasta   timestamptz
)
returns table (
  amazon_order_id text,
  eventos         bigint,
  monto           numeric,
  unidades        bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    select e.amazon_order_id,
           count(*)                         as eventos,
           sum(e.monto)                     as monto,
           sum(coalesce(e.unidades, 0))     as unidades
    from amazon_finanzas_eventos e
    where e.account_id = p_account
      and e.amazon_order_id is not null
      and e.renglones is not null
      and e.posted_en >= p_desde
      and e.posted_en <= p_hasta
    group by e.amazon_order_id
    order by e.amazon_order_id;
end;
$$;

revoke all on function amazon_finanzas_por_orden(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function amazon_finanzas_por_orden(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- Los eventos que no son de un pedido (publicidad, cargos de servicio,
-- ajustes…), uno por uno, para ponerlos al lado de los renglones del
-- reporte que no traen orden.
create or replace function amazon_finanzas_sueltos(
  p_account uuid,
  p_desde   timestamptz,
  p_hasta   timestamptz
)
returns table (
  lista       text,
  descripcion text,
  posted_en   timestamptz,
  monto       numeric,
  clasificado boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    select e.lista, e.descripcion, e.posted_en, e.monto, e.clasificado
    from amazon_finanzas_eventos e
    where e.account_id = p_account
      and e.renglones is null
      and e.posted_en >= p_desde
      and e.posted_en <= p_hasta
    order by e.lista, e.posted_en, e.clave;
end;
$$;

revoke all on function amazon_finanzas_sueltos(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function amazon_finanzas_sueltos(uuid, timestamptz, timestamptz) to authenticated, service_role;
