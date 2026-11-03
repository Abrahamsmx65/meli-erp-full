-- Lo que MELI DEPOSITÓ por par a CADA PRECIO al cliente, por modelo (dueño,
-- 15-oct-2026: «si GT148 lo vendo en 199, ¿por qué recibo más?»). El
-- promedio de 30 días mezclaba el relámpago con el precio normal y las
-- promociones (GT148: $139.80 de promedio, $126.53 a $199.99), así que
-- Números toma el depósito real AL PRECIO RELÁMPAGO para calcular Amazon y
-- TikTok. Precio al cliente = el público (la reventa se reconstruye con
-- `total_comprador`), redondeado al peso; solo órdenes de UN renglón con
-- neto. El fondo lo llama con service_role.
create or replace function public.meli_neto_por_precio_modelo(p_account uuid, p_desde date)
returns table (modelo text, precio numeric, pares bigint, neto_par numeric)
language sql stable security definer set search_path = public
as $$
  with x as (
    select upper(split_part(r->>'sku', '-', 1)) as modelo,
           greatest(1, coalesce((r->>'unidades')::int, 1)) as u,
           coalesce(o.total_comprador, o.total) as publico,
           o.neto
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
  select x.modelo, round(x.publico / x.u) as precio, sum(x.u)::bigint, round(sum(x.neto) / sum(x.u), 2)
  from x
  group by x.modelo, round(x.publico / x.u)
  order by x.modelo, 2;
$$;

revoke all on function public.meli_neto_por_precio_modelo(uuid, date) from public, anon;
grant execute on function public.meli_neto_por_precio_modelo(uuid, date) to authenticated, service_role;
