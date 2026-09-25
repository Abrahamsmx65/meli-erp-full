-- ============================================================================
--  Lo que MELI COBRÓ de envío en cada venta, por SKU, comparado contra las
--  hermanas AL MISMO PRECIO.
--
--  La revisión de costos de envío comparaba con el SIMULADOR de MELI (qué
--  costaría con las medidas que tiene la publicación). Pero el dato exacto ya
--  está en `ordenes_neto.envio_vendedor` (`/shipments/{id}/costs`): lo que
--  MELI cobró en cada venta real. Y no coincide con el simulador: en el
--  GT229-TABACO BROWN-24 (medida "mal", 28 × 25 × 25) el simulador dice $152
--  contra $76 de sus hermanas, y en las ventas reales MELI le cobró $59.60 y
--  $67.60, igual que a las hermanas (25-sep-2026; el dueño: «¿por qué
--  simulas y no revisas exactamente?»).
--
--  El envío cambia con el PRECIO de cada pedido (reventa a $222.25 → $67.60,
--  a $230.25 → $59.60, a $235.64 → $76: la MISMA talla, el mismo día), así
--  que dos pedidos no se comparan si no son al mismo precio. Aquí cada pedido
--  de un SKU se compara contra los pedidos de sus HERMANAS (mismo modelo,
--  otro SKU) con el MISMO total por unidad (±1 centavo): la mediana de esas
--  hermanas es lo "normal" para ese precio, y lo que se pagó de más es la
--  diferencia, pedido por pedido. Sin hermana al mismo precio, el pedido no
--  se compara (no se inventa). Solo cuentan las órdenes de UN renglón: en
--  una de varios SKUs el envío es del paquete y no se puede repartir.
-- ============================================================================
drop function if exists envio_real_por_sku(uuid, timestamptz);

create or replace function envio_real_por_sku(p_account uuid, p_desde timestamptz)
returns table (
  sku text,
  ordenes bigint,
  unidades bigint,
  mediana numeric,          -- de todo lo cobrado por unidad, sin distinguir precio
  comparables bigint,       -- pedidos con alguna hermana al mismo precio
  pagado_de_mas numeric,    -- Σ (cobrado − normal de las hermanas) × unidades, solo lo positivo
  de_mas_por_venta numeric, -- mediana de (cobrado − normal) en los comparables; negativo = paga MENOS
  ultimos jsonb             -- los 2 últimos pedidos: fecha, total, envio, normal, hermanas
)
language sql stable
as $$
  with x as (
    select o.order_id,
           r->>'sku' as sku,
           s.modelo,
           greatest(1, coalesce((r->>'unidades')::int, 1)) as unidades,
           round(o.total / greatest(1, coalesce((r->>'unidades')::int, 1)), 2) as total_u,
           o.envio_vendedor / greatest(1, coalesce((r->>'unidades')::int, 1)) as envio_u,
           o.fecha
    from ordenes_neto o
    cross join lateral jsonb_array_elements(o.renglones) r
    left join skus s on s.account_id = o.account_id and s.sku = r->>'sku' and s.activo
    where o.account_id = p_account
      and o.fecha >= p_desde
      and o.estado is distinct from 'cancelled'
      and o.renglones is not null
      and jsonb_array_length(o.renglones) = 1
      and o.envio_vendedor is not null
      and o.envio_vendedor > 0
      and o.total is not null
      and r->>'sku' is not null
  ),
  -- Por modelo, precio y SKU: qué cobró MELI (mediana) a esa talla a ese precio.
  g as (
    select modelo, total_u, sku,
           percentile_cont(0.5) within group (order by envio_u) as mediana
    from x
    where modelo is not null
    group by modelo, total_u, sku
  ),
  -- Lo "normal" para un SKU a un precio: la mediana de lo que pagan sus
  -- HERMANAS (otros SKUs del modelo) a ese mismo precio.
  n as (
    select a.modelo, a.total_u, a.sku,
           percentile_cont(0.5) within group (order by b.mediana) as normal,
           count(*) as hermanas
    from g a
    join g b on b.modelo = a.modelo and b.total_u = a.total_u and b.sku <> a.sku
    group by a.modelo, a.total_u, a.sku
  ),
  comparado as (
    select x.*, n.normal, n.hermanas,
           row_number() over (partition by x.sku order by x.fecha desc, x.order_id desc) as rn
    from x
    left join n on n.modelo = x.modelo and n.total_u = x.total_u and n.sku = x.sku
  )
  select sku,
         count(*) as ordenes,
         sum(unidades) as unidades,
         percentile_cont(0.5) within group (order by envio_u) as mediana,
         count(*) filter (where normal is not null) as comparables,
         -- Menos de $5 de diferencia no es un cobro de más: es ruido de redondeo
         -- entre hermanas; un escalón de medida se ve en decenas de pesos.
         coalesce(sum(case when envio_u - normal > 5 then (envio_u - normal) * unidades else 0 end)
                  filter (where normal is not null), 0) as pagado_de_mas,
         percentile_cont(0.5) within group (order by envio_u - normal) filter (where normal is not null) as de_mas_por_venta,
         jsonb_agg(jsonb_build_object(
             'fecha', to_char(fecha, 'YYYY-MM-DD'),
             'total', total_u,
             'envio', envio_u,
             'normal', normal,
             'hermanas', hermanas)
           order by fecha desc) filter (where rn <= 2) as ultimos
  from comparado
  group by sku
  order by sku;
$$;

revoke all on function envio_real_por_sku(uuid, timestamptz) from public;
grant execute on function envio_real_por_sku(uuid, timestamptz) to authenticated, service_role;
