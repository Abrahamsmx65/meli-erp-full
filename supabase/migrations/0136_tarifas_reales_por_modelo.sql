-- TARIFAS REALES por modelo para Números (dueño, 11-oct-2026: «los números,
-- en vez de calcular con mis estimaciones de comisión y costo de envío, ¿lo
-- puedes calcular con lo real?»). Tres RPC, uno por canal, que suman en
-- Postgres lo que de verdad cobró cada plataforma en el rango; el fondo los
-- llama con service_role y guarda el resultado masticado.
--
-- MELI: solo órdenes de UN renglón con neto. En REVENTA (desde ago-2026 la
-- mayoría) MELI paga precio − comisión − envío SIN retenciones; en venta
-- DIRECTA se retiene IVA + ISR. Por eso se separan: la comisión y el envío
-- salen de la directa (es donde se ven), y la retención efectiva = la de la
-- directa × su parte de los pares (sale sola de sumar la retención sobre
-- todo el total).
create or replace function public.meli_tarifas_por_modelo(p_account uuid, p_desde date)
returns table (
  modelo text,
  pares bigint,
  pares_directa bigint,
  comision_pct numeric,
  envio_par numeric,
  retencion_pct numeric,
  neto_par numeric
)
language sql stable security definer set search_path = public
as $$
  with x as (
    select upper(split_part(r->>'sku', '-', 1)) as modelo,
           greatest(1, coalesce((r->>'unidades')::int, 1)) as u,
           o.tipo_venta, o.total, o.neto, o.comision_mp, o.envio_vendedor,
           coalesce(o.isr_mp, 0) + coalesce(o.iva_mp, 0) as ret
    from ordenes_neto o
    cross join lateral jsonb_array_elements(o.renglones) r
    where o.account_id = p_account
      and (select coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account))
      and o.fecha >= p_desde
      and o.estado is distinct from 'cancelled'
      and o.neto is not null and o.total > 0
      and o.renglones is not null and jsonb_array_length(o.renglones) = 1
      and coalesce(r->>'sku', '') <> ''
  )
  select x.modelo,
         sum(x.u)::bigint,
         sum(x.u) filter (where x.tipo_venta is distinct from 'reventa')::bigint,
         round(sum(x.comision_mp) filter (where x.tipo_venta is distinct from 'reventa')
               / nullif(sum(x.total) filter (where x.tipo_venta is distinct from 'reventa'), 0), 6),
         -- MEDIANA de los envíos de un solo par: un carrito le carga el
         -- paquete completo a cada orden y el promedio salía inflado.
         round((percentile_cont(0.5) within group (order by x.envio_vendedor)
               filter (where x.tipo_venta is distinct from 'reventa' and x.envio_vendedor is not null and x.u = 1))::numeric, 2),
         round(sum(x.ret) / nullif(sum(x.total), 0), 6),
         round(sum(x.neto) / nullif(sum(x.u), 0), 2)
  from x
  group by x.modelo
  order by x.modelo;
$$;

revoke all on function public.meli_tarifas_por_modelo(uuid, date) from public, anon;
grant execute on function public.meli_tarifas_por_modelo(uuid, date) to authenticated, service_role;

-- AMAZON: renglones de las liquidaciones (ShipmentEventList) por fecha de
-- asiento. Comisión y retención como % del precio con IVA; FBA y lo demás
-- (promociones + otras tarifas) por unidad.
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
           coalesce((x->>'promociones')::numeric, 0) + coalesce((x->>'otrasTarifas')::numeric, 0) as otros,
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

revoke all on function public.amazon_tarifas_por_modelo(uuid, date) from public, anon;
grant execute on function public.amazon_tarifas_por_modelo(uuid, date) to authenticated, service_role;

-- TIKTOK (su account_id es el de la cuenta de MELI): pedidos de UN solo modelo, pagados, sin muestras, con lo que
-- TikTok paga (liquidado o por liquidar). Lo que se queda = 1 − pago ÷ precio.
create or replace function public.tiktok_tarifas_por_modelo(p_account uuid, p_desde date)
returns table (
  modelo text,
  pares numeric,
  precio_par numeric,
  pago_par numeric,
  afiliado_pct numeric
)
language sql stable security definer set search_path = public
as $$
  with i as (
    select it.order_id,
           min(upper(split_part(coalesce(it.sku_interno, it.seller_sku), '-', 1))) as modelo,
           count(distinct upper(split_part(coalesce(it.sku_interno, it.seller_sku), '-', 1))) as modelos,
           sum(it.cantidad) as pares,
           sum(it.precio * it.cantidad) as bruto
    from tiktok_orden_items it
    join tiktok_ordenes o on o.account_id = it.account_id and o.order_id = it.order_id
    where o.account_id = p_account
      and (select coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account))
      and o.fecha_creacion >= p_desde
      and o.pago_estado in ('liquidado', 'por_liquidar')
      and not coalesce(o.es_muestra, false)
      and it.bloqueo_resultado is distinct from 'cancelado'
    group by it.order_id
  )
  select i.modelo,
         sum(i.pares),
         round(sum(i.bruto) / nullif(sum(i.pares), 0), 2),
         round(sum(o.pago_esperado) / nullif(sum(i.pares), 0), 2),
         round(sum(coalesce(o.pago_afiliado, 0)) / nullif(sum(i.bruto), 0), 6)
  from i
  join tiktok_ordenes o on o.account_id = p_account and o.order_id = i.order_id
  where i.modelos = 1 and i.pares > 0
  group by i.modelo
  order by i.modelo;
$$;

revoke all on function public.tiktok_tarifas_por_modelo(uuid, date) from public, anon;
grant execute on function public.tiktok_tarifas_por_modelo(uuid, date) to authenticated, service_role;
