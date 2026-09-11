-- El neto liquidado por Amazon, SUMADO EN POSTGRES por SKU.
--
-- Por qué: el monitor de Amazon bajaba `amazon_pagos` renglón por renglón
-- (~15 mil en julio, en 16 viajes paginados). Cada viaje evalúa la RLS
-- `es_mi_cuenta_amazon(account_id)` una vez POR RENGLÓN —no es leakproof, así
-- que no se resuelve con el índice— y el rol `authenticated` corta a los 8 s.
-- Julio se pasaba, el error tumbaba TODO el bloque de Amazon del corte
-- general y el consolidado se volvía a guardar con dos canales en vez de
-- tres: la información de Amazon "desaparecía" de un mes que ya estaba bien.
--
-- Sumado por SKU son ~1,600 renglones en un viaje. La clasificación de los
-- pseudo-SKUs "(PUBLICIDAD)", "(RESERVA)" y "(OTROS CARGOS)" y el amarre al
-- modelo siguen en Node, que es donde vive `modeloUnificado`.
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
  if not es_mi_cuenta_amazon(p_account) then
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
