-- ============================================================================
--  `envio_real_por_sku` corría bajo RLS y se cancelaba por tiempo.
--
--  El 28-sep-2026 la pantalla de Costos de envío enseñaba TODAS las tallas
--  «sin ventas» (y al GT229 «4 cobran de más (simulador)») aunque el RPC,
--  corrido a mano, contestaba 1,429 SKUs en 1.5 s. Desde la app el mismo RPC
--  contestaba 500: el rol `authenticated` tiene `statement_timeout = 8s` y
--  bajo RLS la política `es_mi_cuenta(account_id)` se evalúa renglón por
--  renglón en `ordenes_neto` (146 mil renglones, seq scan de 2 s) y deja al
--  planificador sin estimaciones (rows=1): el amarre contra `skus` se iba a
--  un bucle anidado de 48 millones de comparaciones y el total a 17.6 s. La
--  app se tragaba el error y caía al simulador.
--
--  Ahora la función es SECURITY DEFINER (sin RLS, el plan bueno: ~1.5 s) y
--  hace el control de acceso ella misma: solo el dueño de la cuenta
--  (`es_mi_cuenta`), el service_role o una sesión abierta como postgres
--  (`session_user`, no `current_user`: dentro de una función security
--  definer `current_user` es el dueño de la función y dejaría pasar a
--  cualquiera). El cuerpo es el mismo de la migración 0097.
-- ============================================================================
drop function if exists envio_real_por_sku(uuid, timestamptz);

create or replace function envio_real_por_sku(p_account uuid, p_desde timestamptz)
returns table (
  sku text,
  ordenes bigint,
  unidades bigint,
  mediana numeric,          -- de todo lo cobrado por unidad, sin distinguir precio
  comparables bigint,       -- pedidos con alguna hermana al mismo precio
  ordenes_de_mas bigint,    -- pedidos que pagaron más de $5 sobre lo normal
  pagado_de_mas numeric,    -- Σ (cobrado − normal de las hermanas) × unidades, solo lo positivo
  de_mas_por_venta numeric, -- mediana de (cobrado − normal) en los comparables; negativo = paga MENOS
  ultimos jsonb             -- los 2 últimos pedidos COMPARABLES: fecha, total, envio, normal, hermanas
)
language plpgsql stable
security definer
set search_path = public
as $$
begin
  if not (
    es_mi_cuenta(p_account)
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  ) then
    raise exception 'envio_real_por_sku: la cuenta % no es tuya', p_account
      using errcode = '42501';
  end if;

  return query
  with packs as (
    -- cuántas órdenes comparten el envío de cada carrito
    select o.pack_id, count(*) as ordenes
    from ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.pack_id is not null
    group by o.pack_id
  ),
  x as (
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
    left join packs pk on pk.pack_id = o.pack_id
    where o.account_id = p_account
      and coalesce(pk.ordenes, 1) = 1
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
    select x.modelo, x.total_u, x.sku,
           percentile_cont(0.5) within group (order by x.envio_u) as mediana
    from x
    where x.modelo is not null
    group by x.modelo, x.total_u, x.sku
  ),
  -- Lo "normal" para un SKU a un precio: la mediana de lo que pagan sus
  -- HERMANAS (otros SKUs del modelo) a ese mismo precio, sin self-join (ver
  -- la migración 0097).
  gw as (
    select g.*,
           array_agg(g.sku) over w as skus,
           array_agg(g.mediana) over w as medianas
    from g
    window w as (partition by g.modelo, g.total_u)
  ),
  n as (
    select gw.modelo, gw.total_u, gw.sku,
           (select percentile_cont(0.5) within group (order by t.m)
              from unnest(gw.medianas) with ordinality t(m, i)
             where t.i <> array_position(gw.skus, gw.sku)) as normal,
           cardinality(gw.skus) - 1 as hermanas
    from gw
    where cardinality(gw.skus) > 1
  ),
  comparado as (
    select x.*, n.normal, n.hermanas,
           row_number() over (partition by x.sku, (n.normal is not null) order by x.fecha desc, x.order_id desc) as rn
    from x
    left join n on n.modelo = x.modelo and n.total_u = x.total_u and n.sku = x.sku
  )
  select c.sku,
         count(*) as ordenes,
         sum(c.unidades) as unidades,
         -- percentile_cont contesta double precision (y `normal` sale de ahí), y
         -- RETURN QUERY de plpgsql exige el tipo exacto de la tabla de salida:
         -- se castea a numeric.
         (percentile_cont(0.5) within group (order by c.envio_u))::numeric as mediana,
         count(*) filter (where c.normal is not null) as comparables,
         count(*) filter (where c.normal is not null and c.envio_u - c.normal > 5) as ordenes_de_mas,
         coalesce(sum(case when c.envio_u - c.normal > 5 then (c.envio_u - c.normal) * c.unidades else 0 end)
                  filter (where c.normal is not null), 0)::numeric as pagado_de_mas,
         (percentile_cont(0.5) within group (order by c.envio_u - c.normal) filter (where c.normal is not null))::numeric as de_mas_por_venta,
         jsonb_agg(jsonb_build_object(
             'fecha', to_char(c.fecha, 'YYYY-MM-DD'),
             'total', c.total_u,
             'envio', c.envio_u,
             'normal', c.normal,
             'hermanas', c.hermanas)
           order by c.fecha desc) filter (where c.rn <= 2 and c.normal is not null) as ultimos
  from comparado c
  group by c.sku
  order by c.sku;
end;
$$;

revoke all on function envio_real_por_sku(uuid, timestamptz) from public;
grant execute on function envio_real_por_sku(uuid, timestamptz) to authenticated, service_role;
