-- Amazon: «otros por par» ya cuenta lo que el cliente pagó de envío
-- (`otrosCargos`, ShippingCharge + ShippingTax), que viene con su promoción
-- en contra (`promociones`). Antes solo se sumaba la promoción y el cargo
-- por par salía alto (GT114: $12.50 contra $9.46 reales). Con esto
-- precio − comisión − retención − FBA − otros = el neto que deposita Amazon
-- (8-nov-2026, revisión con el dueño de cómo cobra Amazon).
create or replace function public.amazon_tarifas_por_modelo(p_account uuid, p_desde date)
returns table (
  modelo text,
  unidades numeric,
  precio_par numeric,
  comision_pct numeric,
  retencion_pct numeric,
  fba_par numeric,
  otros_par numeric,
  neto_par numeric
)
language sql stable security definer set search_path = public
as $$
  with r as (
    select upper(split_part(x->>'sku', '-', 1)) as modelo,
           coalesce((x->>'unidades')::numeric, 0) as u,
           coalesce((x->>'principal')::numeric, 0) + coalesce((x->>'impuestoCobrado')::numeric, 0) as precio,
           coalesce((x->>'comision')::numeric, 0) as com,
           coalesce((x->>'fba')::numeric, 0) as fba,
           coalesce((x->>'retenido')::numeric, 0) as ret,
           coalesce((x->>'promociones')::numeric, 0) + coalesce((x->>'otrasTarifas')::numeric, 0)
             + coalesce((x->>'otrosCargos')::numeric, 0) as otros,
           coalesce((x->>'neto')::numeric, 0) as neto
    from amazon_finanzas_eventos e
    cross join lateral jsonb_array_elements(e.renglones) x
    where e.account_id = p_account
      and (select coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta_amazon(p_account))
      and e.lista = 'ShipmentEventList'
      and e.posted_en >= p_desde
      and coalesce(x->>'sku', '') <> ''
  )
  select r.modelo,
         sum(r.u),
         round(sum(r.precio) / nullif(sum(r.u), 0), 2),
         round(-sum(r.com) / nullif(sum(r.precio), 0), 6),
         round(-sum(r.ret) / nullif(sum(r.precio), 0), 6),
         round(-sum(r.fba) / nullif(sum(r.u), 0), 2),
         round(-sum(r.otros) / nullif(sum(r.u), 0), 2),
         round(sum(r.neto) / nullif(sum(r.u), 0), 2)
  from r
  where r.u > 0
  group by r.modelo
  order by r.modelo;
$$;
