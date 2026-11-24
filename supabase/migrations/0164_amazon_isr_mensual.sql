-- El ISR mensual de Amazon con su nombre (24-nov-2026). Hasta octubre de
-- 2026 Amazon cobraba el ISR retenido del mes anterior en UN cargo
-- `AdjustmentEventList` tipo `MiscAdjustment` cerca del día 11 (11-sep
-- −$106,854 ≈ 2.5 % de la base de agosto; 12-oct −$90,421 ≈ septiembre).
-- Ya se restaba como «ajustes de Amazon»; ahora sale en su propio renglón
-- para que el corte lo nombre. Desde noviembre el ISR viene por pedido
-- (IncomeTaxWithheldMexico) dentro de la retención de cada venta.


create or replace function amazon_finanzas_otros(
  p_account uuid,
  p_desde   date,
  p_hasta   date
)
returns table (
  lista          text,
  eventos        bigint,
  monto          numeric,
  base           numeric,
  impuesto       numeric,
  sin_clasificar bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- La sesión del dueño (RLS) o el fondo con service_role (precálculo).
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    select
      x.lista_salida                                    as lista,
      count(*)                                          as eventos,
      sum(x.monto)                                      as monto,
      sum(x.base)                                       as base,
      sum(x.impuesto)                                   as impuesto,
      count(*) filter (where not x.clasificado)         as sin_clasificar
    from (
      select
        case
          when e.lista = 'AdjustmentEventList' and e.descripcion in ('FailedDisbursement', 'SellerRewards', 'MiscAdjustment')
            then e.lista || ':' || e.descripcion
          else e.lista
        end as lista_salida,
        e.monto, e.base, e.impuesto, e.clasificado
      from amazon_finanzas_eventos e
      where e.account_id = p_account
        and e.renglones is null
        and (e.posted_en at time zone 'America/Mexico_City')::date >= p_desde
        and (e.posted_en at time zone 'America/Mexico_City')::date <= p_hasta
    ) x
    group by x.lista_salida
    order by x.lista_salida;
end;
$$;

revoke all on function amazon_finanzas_otros(uuid, date, date) from public, anon;
grant execute on function amazon_finanzas_otros(uuid, date, date) to authenticated, service_role;
