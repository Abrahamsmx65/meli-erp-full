-- Precios para TikTok (1-oct-2026).
--
-- · tiktok_precios_objetivo: el precio que el dueño QUIERE poner por modelo
--   (relámpago normal) cuando no quiere el calculado («yo quiero el precio
--   que yo quiero poner»).
-- · meli_neto_relampago_por_modelo: el neto por par de MELI «de cuando se
--   vende el relámpago»: por modelo, las órdenes de un solo renglón se
--   agrupan por precio unitario y el ESCALÓN MÁS BAJO con volumen (≥ 10 %
--   de los pares del modelo, mínimo 3) es el relámpago; su neto ÷ pares es
--   el objetivo. El promedio de todas las ventas mezclaba precio lleno y
--   relámpago y daba un objetivo alto (GT148: $157 de precio en TikTok
--   cuando el relámpago de MELI deja $128.99).

create table if not exists public.tiktok_precios_objetivo (
  account_id uuid not null references public.meli_accounts(id) on delete cascade,
  modelo text not null,
  precio numeric not null check (precio > 0),
  actualizado_en timestamptz not null default now(),
  primary key (account_id, modelo)
);

alter table public.tiktok_precios_objetivo enable row level security;

drop policy if exists tiktok_precios_objetivo_mias on public.tiktok_precios_objetivo;
create policy tiktok_precios_objetivo_mias on public.tiktok_precios_objetivo
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

create or replace function public.meli_neto_relampago_por_modelo(
  p_account uuid,
  p_desde date
)
returns table (
  modelo text,
  precio_relampago numeric,   -- precio unitario del escalón más bajo con volumen
  pares_relampago bigint,     -- pares vendidos a ese precio
  neto_relampago numeric,     -- neto por par a ese precio
  pares_total bigint,         -- pares del modelo en el periodo (órdenes de un renglón con neto)
  neto_total numeric,         -- neto por par de todo el periodo
  escalones integer           -- cuántos precios distintos vendió
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
    raise exception 'meli_neto_relampago_por_modelo: la cuenta % no es tuya', p_account
      using errcode = '42501';
  end if;

  return query
  with x as (
    select upper(split_part(r->>'sku', '-', 1)) as modelo,
           greatest(1, coalesce((r->>'unidades')::int, 1)) as unidades,
           round(o.total / greatest(1, coalesce((r->>'unidades')::int, 1)), 2) as precio_u,
           o.neto
    from ordenes_neto o
    cross join lateral jsonb_array_elements(o.renglones) r
    where o.account_id = p_account
      and o.fecha >= p_desde
      and o.estado is distinct from 'cancelled'
      and o.neto is not null
      and o.total is not null and o.total > 0
      and o.renglones is not null
      and jsonb_array_length(o.renglones) = 1
      and coalesce(r->>'sku', '') <> ''
  ),
  g as (
    select x.modelo, x.precio_u, sum(x.unidades)::bigint as pares, sum(x.neto) as neto
    from x
    group by x.modelo, x.precio_u
  ),
  t as (
    select g.modelo, sum(g.pares)::bigint as pares_total, sum(g.neto) as neto_total, count(*)::int as escalones
    from g
    group by g.modelo
  ),
  r as (
    select g.modelo, g.precio_u, g.pares, g.neto,
           row_number() over (partition by g.modelo order by g.precio_u asc) as n
    from g
    join t on t.modelo = g.modelo
    where g.pares >= greatest(3, ceil(t.pares_total * 0.10))
  )
  select t.modelo,
         r.precio_u,
         r.pares,
         case when r.pares > 0 then round(r.neto / r.pares, 2) end,
         t.pares_total,
         case when t.pares_total > 0 then round(t.neto_total / t.pares_total, 2) end,
         t.escalones
  from t
  left join r on r.modelo = t.modelo and r.n = 1
  order by t.pares_total desc, t.modelo;
end;
$$;

grant execute on function public.meli_neto_relampago_por_modelo(uuid, date) to authenticated, service_role;
