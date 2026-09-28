-- Dos arreglos al dinero de Amazon (28-sep-2026, revisando enero 2026):
--
-- 1. `amazon_finanzas_otros` junta los eventos sin renglón por LISTA, y en
--    AdjustmentEventList venían revueltos un depósito REBOTADO
--    (FailedDisbursement, $326,732.82 el 2-ene: exactamente el depósito de
--    la liquidación del 30-dic al 2-ene que el banco devolvió) con las
--    recompensas de Amazon (SellerRewards, $538,896 en enero). El rebote NO
--    es ingreso: es el mismo dinero regresando al saldo, y contado como
--    «ajuste» inflaba la ganancia de enero. Ahora esos dos tipos salen en su
--    propio renglón (`AdjustmentEventList:FailedDisbursement`,
--    `AdjustmentEventList:SellerRewards`) y Node decide qué hace con cada uno.
--
-- 2. `amazon_pagos_por_sku` (respaldo de liquidaciones) solo aceptaba la
--    sesión del dueño: desde el cron del corte general contestaba «Esa cuenta
--    de Amazon no es tuya» y el corte lo declaraba en cada mes. Acepta
--    service_role como las demás sumas de Amazon.

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
          when e.lista = 'AdjustmentEventList' and e.descripcion in ('FailedDisbursement', 'SellerRewards')
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

create or replace function public.amazon_pagos_por_sku(
  p_account uuid,
  p_desde date,
  p_hasta date
)
returns table(seller_sku text, neto numeric, unidades numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    select
      p.seller_sku,
      sum(p.neto)::numeric               as neto,
      coalesce(sum(p.unidades), 0)::numeric as unidades
    from amazon_pagos p
    where p.account_id = p_account
      and p.fecha >= p_desde
      and p.fecha <= p_hasta
    group by p.seller_sku
    order by p.seller_sku;
end;
$$;

grant execute on function public.amazon_pagos_por_sku(uuid, date, date) to authenticated, service_role;
