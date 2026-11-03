-- Ventas ya sumadas POR DÍA (11-oct-2026; dueño: «se tarda mucho todavía,
-- más que todo cuando te vas a más días atrás, y no sé si se actualiza al
-- momento sin actualizarlo yo»).
--
-- `ventas_vivas` / `yz_ventas_vivas` (0133/0136) sumaban en cada consulta
-- TODAS las órdenes del rango: 2.3–3.6 s con 90–180 días, y Ventas,
-- Publicidad, Inicio y las gráficas hacen varias. Un rango que no estaba
-- guardado tardaba 5–10 s o se pasaba de los 8 s. Ahora:
--
--  1. `ventas_dia_sku` y `ventas_dia_hora` guardan el resultado por día (y por
--     hora) de cada canal (`meli_calzado`, `meli_fundas`), calculado con la
--     MISMA regla (`ventas_vivas_calculo` = el cuerpo de la 0136).
--  2. Un disparador por sentencia en `ordenes_neto`, `ventas_diarias` y sus
--     gemelas de fundas marca el DÍA tocado en `ventas_dias_sucios`.
--  3. `limpiar_ventas_sucias()` recalcula esos días; pg_cron la corre cada
--     minuto dentro de la base (sin depender de Vercel).
--  4. `ventas_vivas` / `yz_ventas_vivas` (las que leen todas las pantallas)
--     y `ventas_por_hora` leen las tablas: cualquier rango es sumar unos
--     cientos de renglones. Un día recién tocado se ve a más tardar en ~1 min.

create table if not exists public.ventas_dia_sku (
  canal text not null,
  account_id uuid not null,
  fecha date not null,
  sku text not null,
  unidades bigint not null default 0,
  ordenes bigint not null default 0,
  importe numeric,
  comision numeric,
  neto numeric,
  neto_confirmado boolean,
  unidades_con_neto bigint,
  importe_con_neto numeric,
  comision_con_neto numeric,
  primary key (account_id, canal, fecha, sku)
);
create table if not exists public.ventas_dia_hora (
  canal text not null,
  account_id uuid not null,
  fecha date not null,
  -- -1 = sin hora (orden sin `date_created` o día de renglones diarios)
  hora smallint not null,
  u numeric not null default 0,
  o bigint not null default 0,
  i numeric not null default 0,
  primary key (account_id, canal, fecha, hora)
);
create table if not exists public.ventas_dias_sucios (
  canal text not null,
  account_id uuid not null,
  fecha date not null,
  marcado_en timestamptz not null default clock_timestamp(),
  primary key (canal, account_id, fecha)
);
-- Hasta cuándo quedó recalculado cada día: un día está sucio si su marca
-- es más nueva que esto. Nada se BORRA (ni marcas ni renglones): un renglón
-- que ya no aplica se pone en cero y las lecturas lo saltan.
create table if not exists public.ventas_dias_hechos (
  canal text not null,
  account_id uuid not null,
  fecha date not null,
  hecho_en timestamptz not null,
  primary key (canal, account_id, fecha)
);
alter table public.ventas_dias_hechos enable row level security;
-- Solo las funciones (security definer) las leen y escriben.
alter table public.ventas_dia_sku enable row level security;
alter table public.ventas_dia_hora enable row level security;
alter table public.ventas_dias_sucios enable row level security;

-- El cálculo de siempre (0136), sin el permiso: solo lo llaman el
-- recálculo y pg_cron, nunca la API.
create or replace function public.ventas_vivas_calculo(p_account uuid, p_desde date, p_hasta date)
 returns table(sku text, fecha date, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto numeric, neto_confirmado boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  with o as materialized (
    select o.fecha, o.total, coalesce(o.neto_actual, o.neto) as neto_hoy,
      (o.neto_en is not null or o.neto > 0) as neto_conocido,
      case when o.tipo_venta = 'reventa' and o.total_comprador is not null then o.total_comprador - o.total else 0 end as alza,
      o.renglones
    from ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null
  ),
  r as (
    select o.fecha, o.total, o.neto_hoy, o.neto_conocido, o.alza, t.importe_orden,
      e->>'sku' as sku, coalesce((e->>'unidades')::numeric, 0) as unidades,
      coalesce((e->>'importe')::numeric, 0) as importe, coalesce((e->>'comision')::numeric, 0) as comision
    from o
    cross join lateral (select sum(coalesce((x->>'importe')::numeric, 0)) as importe_orden from jsonb_array_elements(o.renglones) x) t
    cross join lateral jsonb_array_elements(o.renglones) e
  ),
  g as (
    select r.sku, r.fecha, sum(r.unidades)::bigint as unidades, count(*)::bigint as ordenes,
      round(sum(r.importe + case when r.importe_orden > 0 then r.alza * r.importe / r.importe_orden else 0 end), 2) as importe,
      round(sum(r.comision + case when r.importe_orden > 0 then r.alza * r.importe / r.importe_orden else 0 end), 2) as comision,
      case when bool_or(r.total > 0 and not r.neto_conocido) then 0
           else round(sum(case when r.neto_conocido and r.importe_orden > 0 then r.neto_hoy * r.importe / r.importe_orden else 0 end), 2) end as neto,
      not bool_or(r.total > 0 and not r.neto_conocido) as neto_confirmado
    from r where r.sku is not null and r.sku <> '' group by r.sku, r.fecha
  ),
  dias as (select distinct o.fecha from o)
  select g.sku, g.fecha, g.unidades, g.ordenes, g.importe, g.comision, g.neto, g.neto_confirmado from g
  union all
  select v.sku, v.fecha, v.unidades::bigint, v.ordenes::bigint, v.importe, v.comision, v.neto, coalesce(v.neto_confirmado, false)
  from ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and not exists (select 1 from dias d where d.fecha = v.fecha);
$function$;

create or replace function public.yz_ventas_vivas_calculo(p_account uuid, p_desde date, p_hasta date)
 returns table(sku text, fecha date, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto numeric, unidades_con_neto bigint, importe_con_neto numeric, comision_con_neto numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  with o as materialized (
    select o.fecha, coalesce(o.neto_actual, o.neto) as neto_hoy,
      (o.neto_en is not null or o.neto > 0 or not (o.total > 0)) as neto_conocido,
      case when o.tipo_venta = 'reventa' and o.total_comprador is not null then o.total_comprador - o.total else 0 end as alza,
      o.renglones
    from yz_ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null
  ),
  r as (
    select o.fecha, o.neto_conocido, e->>'sku' as sku,
      coalesce((e->>'unidades')::numeric, 0) as unidades,
      coalesce((e->>'importe')::numeric, 0) + case when t.importe_orden > 0 then o.alza * coalesce((e->>'importe')::numeric, 0) / t.importe_orden else 0 end as importe,
      coalesce((e->>'comision')::numeric, 0) + case when t.importe_orden > 0 then o.alza * coalesce((e->>'importe')::numeric, 0) / t.importe_orden else 0 end as comision,
      case when o.neto_conocido and t.importe_orden > 0 then o.neto_hoy * coalesce((e->>'importe')::numeric, 0) / t.importe_orden else 0 end as neto
    from o
    cross join lateral (select sum(coalesce((x->>'importe')::numeric, 0)) as importe_orden from jsonb_array_elements(o.renglones) x) t
    cross join lateral jsonb_array_elements(o.renglones) e
  ),
  g as (
    select r.sku, r.fecha, sum(r.unidades)::bigint as unidades, count(*)::bigint as ordenes,
      round(sum(r.importe), 2) as importe, round(sum(r.comision), 2) as comision, round(sum(r.neto), 2) as neto,
      coalesce(sum(r.unidades) filter (where r.neto_conocido), 0)::bigint as unidades_con_neto,
      round(coalesce(sum(r.importe) filter (where r.neto_conocido), 0), 2) as importe_con_neto,
      round(coalesce(sum(r.comision) filter (where r.neto_conocido), 0), 2) as comision_con_neto
    from r where r.sku is not null and r.sku <> '' group by r.sku, r.fecha
  ),
  dias as (select distinct o.fecha from o)
  select g.sku, g.fecha, g.unidades, g.ordenes, g.importe, g.comision, g.neto, g.unidades_con_neto, g.importe_con_neto, g.comision_con_neto from g
  union all
  select v.sku, v.fecha, v.unidades::bigint, v.ordenes::bigint, v.importe, v.comision, coalesce(v.neto, 0),
    coalesce(v.unidades_con_neto, 0)::bigint, coalesce(v.importe_con_neto, 0), coalesce(v.comision_con_neto, 0)
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and not exists (select 1 from dias d where d.fecha = v.fecha);
$function$;

-- Recalcula un rango de días de un canal y lo deja guardado (sin borrar:
-- lo que ya no aplica queda en cero).
create or replace function public.rehacer_ventas_dias(p_canal text, p_account uuid, p_desde date, p_hasta date)
 returns integer
 language plpgsql security definer set search_path to 'public' set statement_timeout to '120s'
as $function$
declare
  t0 timestamptz := clock_timestamp();
  n integer;
begin
  if p_canal not in ('meli_calzado', 'meli_fundas') then
    raise exception 'Canal desconocido: %', p_canal;
  end if;
  -- Dos recálculos del mismo canal y cuenta no se enciman.
  perform pg_advisory_xact_lock(hashtext('ventas_dias:' || p_canal || ':' || p_account::text));

  update ventas_dia_sku
     set unidades = 0, ordenes = 0, importe = 0, comision = 0, neto = 0, neto_confirmado = true,
         unidades_con_neto = 0, importe_con_neto = 0, comision_con_neto = 0
   where account_id = p_account and canal = p_canal and fecha between p_desde and p_hasta
     and (unidades <> 0 or ordenes <> 0 or importe <> 0);
  update ventas_dia_hora set u = 0, o = 0, i = 0
   where account_id = p_account and canal = p_canal and fecha between p_desde and p_hasta
     and (u <> 0 or o <> 0 or i <> 0);

  if p_canal = 'meli_calzado' then
    insert into ventas_dia_sku (canal, account_id, fecha, sku, unidades, ordenes, importe, comision, neto, neto_confirmado)
    select p_canal, p_account, v.fecha, v.sku, v.unidades, v.ordenes, v.importe, v.comision, v.neto, v.neto_confirmado
    from ventas_vivas_calculo(p_account, p_desde, p_hasta) v
    on conflict (account_id, canal, fecha, sku) do update set
      unidades = excluded.unidades, ordenes = excluded.ordenes, importe = excluded.importe,
      comision = excluded.comision, neto = excluded.neto, neto_confirmado = excluded.neto_confirmado;
  else
    insert into ventas_dia_sku (canal, account_id, fecha, sku, unidades, ordenes, importe, comision, neto,
      unidades_con_neto, importe_con_neto, comision_con_neto)
    select p_canal, p_account, v.fecha, v.sku, v.unidades, v.ordenes, v.importe, v.comision, v.neto,
      v.unidades_con_neto, v.importe_con_neto, v.comision_con_neto
    from yz_ventas_vivas_calculo(p_account, p_desde, p_hasta) v
    on conflict (account_id, canal, fecha, sku) do update set
      unidades = excluded.unidades, ordenes = excluded.ordenes, importe = excluded.importe,
      comision = excluded.comision, neto = excluded.neto, unidades_con_neto = excluded.unidades_con_neto,
      importe_con_neto = excluded.importe_con_neto, comision_con_neto = excluded.comision_con_neto;
  end if;
  get diagnostics n = row_count;

  -- Por hora (la regla de `ventas_por_hora`, 0134): una orden en la hora de
  -- su `date_created` en México; la reventa sube la venta solo si la orden
  -- trae importe; un día sin órdenes sale de los renglones diarios con hora -1.
  insert into ventas_dia_hora (canal, account_id, fecha, hora, u, o, i)
  with x as (
    select o.order_id, o.fecha,
      extract(hour from ((o.orden_cruda->>'date_created')::timestamptz at time zone 'UTC' - interval '6 hours'))::int as hora,
      case when o.tipo_venta = 'reventa' and o.total_comprador is not null then o.total_comprador - o.total else 0 end as alza,
      coalesce((e->>'unidades')::numeric, 0) as u,
      coalesce((e->>'importe')::numeric, 0) as i
    from ordenes_neto o, jsonb_array_elements(o.renglones) e
    where p_canal = 'meli_calzado' and o.account_id = p_account and o.fecha between p_desde and p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null and coalesce(e->>'sku', '') <> ''
    union all
    select o.order_id, o.fecha,
      extract(hour from ((o.orden_cruda->>'date_created')::timestamptz at time zone 'UTC' - interval '6 hours'))::int,
      case when o.tipo_venta = 'reventa' and o.total_comprador is not null then o.total_comprador - o.total else 0 end,
      coalesce((e->>'unidades')::numeric, 0),
      coalesce((e->>'importe')::numeric, 0)
    from yz_ordenes_neto o, jsonb_array_elements(o.renglones) e
    where p_canal = 'meli_fundas' and o.account_id = p_account and o.fecha between p_desde and p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null and coalesce(e->>'sku', '') <> ''
  ),
  ord as (
    select order_id, fecha, coalesce(hora, -1) as hora, sum(u) as u,
      sum(i) + case when sum(i) > 0 then max(alza) else 0 end as i
    from x group by order_id, fecha, coalesce(hora, -1)
  ),
  dias_ord as (select distinct fecha from ord)
  select p_canal, p_account, fecha, hora, sum(u), count(*), sum(i) from ord group by fecha, hora
  union all
  select p_canal, p_account, v.fecha, -1, sum(v.unidades), sum(v.ordenes), sum(v.importe)
  from ventas_diarias v
  where p_canal = 'meli_calzado' and v.account_id = p_account and v.fecha between p_desde and p_hasta
    and not exists (select 1 from dias_ord d where d.fecha = v.fecha)
  group by v.fecha
  union all
  select p_canal, p_account, v.fecha, -1, sum(v.unidades), sum(v.ordenes), sum(v.importe)
  from yz_ventas_diarias v
  where p_canal = 'meli_fundas' and v.account_id = p_account and v.fecha between p_desde and p_hasta
    and not exists (select 1 from dias_ord d where d.fecha = v.fecha)
  group by v.fecha
  on conflict (account_id, canal, fecha, hora) do update set u = excluded.u, o = excluded.o, i = excluded.i;

  -- Lo que se marcó DESPUÉS de empezar sigue sucio: su marca es más nueva.
  insert into ventas_dias_hechos (canal, account_id, fecha, hecho_en)
  select p_canal, p_account, d::date, t0 from generate_series(p_desde, p_hasta, interval '1 day') d
  on conflict (canal, account_id, fecha) do update set hecho_en = excluded.hecho_en;
  return n;
end;
$function$;

-- Marca los días tocados (disparador por sentencia: una orden o mil, un renglón por día).
create or replace function public.marcar_dias_ventas()
 returns trigger
 language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    insert into ventas_dias_sucios (canal, account_id, fecha, marcado_en)
    select distinct tg_argv[0], n.account_id, n.fecha, clock_timestamp() from nuevas n where n.fecha is not null
    on conflict (canal, account_id, fecha) do update set marcado_en = excluded.marcado_en;
  end if;
  if tg_op = 'UPDATE' then
    insert into ventas_dias_sucios (canal, account_id, fecha, marcado_en)
    select distinct tg_argv[0], v.account_id, v.fecha, clock_timestamp() from viejas v where v.fecha is not null
    on conflict (canal, account_id, fecha) do update set marcado_en = excluded.marcado_en;
  end if;
  return null;
end;
$function$;

create trigger ordenes_neto_dias_ins after insert on public.ordenes_neto
  referencing new table as nuevas for each statement execute function public.marcar_dias_ventas('meli_calzado');
create trigger ordenes_neto_dias_upd after update on public.ordenes_neto
  referencing new table as nuevas old table as viejas for each statement execute function public.marcar_dias_ventas('meli_calzado');
create trigger ventas_diarias_dias_ins after insert on public.ventas_diarias
  referencing new table as nuevas for each statement execute function public.marcar_dias_ventas('meli_calzado');
create trigger ventas_diarias_dias_upd after update on public.ventas_diarias
  referencing new table as nuevas old table as viejas for each statement execute function public.marcar_dias_ventas('meli_calzado');
create trigger yz_ordenes_neto_dias_ins after insert on public.yz_ordenes_neto
  referencing new table as nuevas for each statement execute function public.marcar_dias_ventas('meli_fundas');
create trigger yz_ordenes_neto_dias_upd after update on public.yz_ordenes_neto
  referencing new table as nuevas old table as viejas for each statement execute function public.marcar_dias_ventas('meli_fundas');
create trigger yz_ventas_diarias_dias_ins after insert on public.yz_ventas_diarias
  referencing new table as nuevas for each statement execute function public.marcar_dias_ventas('meli_fundas');
create trigger yz_ventas_diarias_dias_upd after update on public.yz_ventas_diarias
  referencing new table as nuevas old table as viejas for each statement execute function public.marcar_dias_ventas('meli_fundas');

-- Recalcula los días marcados, día por día, con presupuesto de 45 s.
create or replace function public.limpiar_ventas_sucias()
 returns integer
 language plpgsql security definer set search_path to 'public' set statement_timeout to '55s'
as $function$
declare
  r record;
  hechos integer := 0;
  t0 timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_lock(hashtext('limpiar_ventas_sucias')) then
    return 0;
  end if;
  for r in
    select s.canal, s.account_id, s.fecha
    from ventas_dias_sucios s
    left join ventas_dias_hechos h on h.canal = s.canal and h.account_id = s.account_id and h.fecha = s.fecha
    where h.hecho_en is null or s.marcado_en > h.hecho_en
    union
    -- Red de seguridad: lo que se borra (el barrido quita renglones de
    -- ventas_diarias sin volver a escribir el día) no deja marca, así que lo
    -- reciente se rehace por EDAD: los últimos 3 días cada 15 min y los
    -- últimos 120 cada 6 h.
    select h.canal, h.account_id, h.fecha
    from ventas_dias_hechos h
    where (h.fecha >= current_date - 3 and h.hecho_en < clock_timestamp() - interval '15 minutes')
       or (h.fecha >= current_date - 120 and h.hecho_en < clock_timestamp() - interval '6 hours')
    order by 3 desc
  loop
    exit when clock_timestamp() - t0 > interval '45 seconds';
    perform rehacer_ventas_dias(r.canal, r.account_id, r.fecha, r.fecha);
    hechos := hechos + 1;
  end loop;
  perform pg_advisory_unlock(hashtext('limpiar_ventas_sucias'));
  return hechos;
end;
$function$;

revoke all on function public.ventas_vivas_calculo(uuid, date, date) from public, anon, authenticated;
revoke all on function public.yz_ventas_vivas_calculo(uuid, date, date) from public, anon, authenticated;
revoke all on function public.rehacer_ventas_dias(text, uuid, date, date) from public, anon, authenticated;
revoke all on function public.limpiar_ventas_sucias() from public, anon, authenticated;
revoke all on function public.marcar_dias_ventas() from public, anon, authenticated;
grant execute on function public.rehacer_ventas_dias(text, uuid, date, date) to service_role;
grant execute on function public.limpiar_ventas_sucias() to service_role;

select cron.schedule('limpiar-ventas-sucias', '* * * * *', $$select public.limpiar_ventas_sucias()$$);

-- Las lecturas de TODAS las pantallas: de las tablas.
create or replace function public.ventas_vivas(p_account uuid, p_desde date, p_hasta date)
 returns table(sku text, fecha date, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto numeric, neto_confirmado boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  select d.sku, d.fecha, d.unidades, d.ordenes, d.importe, d.comision, d.neto, coalesce(d.neto_confirmado, false)
  from ventas_dia_sku d
  where d.account_id = p_account and d.canal = 'meli_calzado' and d.fecha >= p_desde and d.fecha <= p_hasta
    and (d.unidades <> 0 or d.ordenes <> 0 or d.importe <> 0)
    and (select coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account));
$function$;

create or replace function public.yz_ventas_vivas(p_account uuid, p_desde date, p_hasta date)
 returns table(sku text, fecha date, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto numeric, unidades_con_neto bigint, importe_con_neto numeric, comision_con_neto numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  select d.sku, d.fecha, d.unidades, d.ordenes, d.importe, d.comision, coalesce(d.neto, 0),
    coalesce(d.unidades_con_neto, 0), coalesce(d.importe_con_neto, 0), coalesce(d.comision_con_neto, 0)
  from ventas_dia_sku d
  where d.account_id = p_account and d.canal = 'meli_fundas' and d.fecha >= p_desde and d.fecha <= p_hasta
    and (d.unidades <> 0 or d.ordenes <> 0 or d.importe <> 0)
    and (select coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta_yz(p_account));
$function$;

-- La gráfica por día y por hora (0134) también lee las tablas para MELI y
-- fundas; TikTok y Amazon siguen como estaban.
create or replace function public.ventas_por_hora(p_canal text, p_account uuid, p_desde date, p_hasta date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  r jsonb;
begin
  if p_canal = 'meli_calzado' or p_canal = 'tiktok' then
    if not (coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account)) then
      raise exception 'Esa cuenta no es tuya';
    end if;
  elsif p_canal = 'meli_fundas' then
    if not (coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta_yz(p_account)) then
      raise exception 'Esa cuenta no es tuya';
    end if;
  elsif p_canal = 'amazon' then
    if not (coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta_amazon(p_account)) then
      raise exception 'Esa cuenta no es tuya';
    end if;
  else
    raise exception 'Canal desconocido: %', p_canal;
  end if;

  if p_canal in ('meli_calzado', 'meli_fundas') then
    with h as (
      select fecha, hora, u, o, i from ventas_dia_hora
      where account_id = p_account and canal = p_canal and fecha >= p_desde and fecha <= p_hasta
        and (u <> 0 or o <> 0 or i <> 0)
    ),
    dias as (select fecha, sum(u) u, sum(o) o, sum(i) i from h group by fecha)
    select jsonb_build_object(
      'dias', coalesce((select jsonb_agg(jsonb_build_object('f', fecha, 'u', u, 'o', o, 'i', round(i, 2)) order by fecha) from dias), '[]'::jsonb),
      'horas', coalesce((select jsonb_agg(jsonb_build_object('f', fecha, 'h', hora, 'u', u, 'o', o, 'i', round(i, 2)) order by fecha, hora) from h where hora >= 0), '[]'::jsonb)
    ) into r;

  elsif p_canal = 'tiktok' then
    with o as (
      select t.order_id,
        coalesce(t.fecha_creacion, t.fecha_actualizacion) - interval '6 hours' as local,
        case when (t.neto_recibido is not null or t.pago_esperado is not null)
             then nullif(t.pago_desglose->>'ingreso', '')::numeric end as ingreso
      from tiktok_ordenes t
      where t.account_id = p_account
        and coalesce(t.fecha_creacion, t.fecha_actualizacion) >= (p_desde::timestamp + interval '6 hours') at time zone 'UTC'
        and coalesce(t.fecha_creacion, t.fecha_actualizacion) < ((p_hasta + 1)::timestamp + interval '6 hours') at time zone 'UTC'
        and not coalesce(t.es_muestra, false)
        and upper(coalesce(t.estado, '')) not in ('UNPAID', 'CANCELLED', 'CANCEL')
    ),
    ord as (
      select o.order_id,
        (o.local at time zone 'UTC')::date as fecha,
        extract(hour from (o.local at time zone 'UTC'))::int as hora,
        sum(it.cantidad) as u,
        coalesce(max(o.ingreso), sum(coalesce(it.precio, 0) * it.cantidad)) as i
      from o join tiktok_orden_items it on it.account_id = p_account and it.order_id = o.order_id
      where it.sku_interno is not null
        and upper(coalesce(it.estado, '')) not in ('UNPAID', 'CANCELLED', 'CANCEL')
      group by 1, 2, 3
    ),
    dias as (select fecha, sum(u) u, count(*) o, sum(i) i from ord group by fecha),
    horas as (select fecha, hora, sum(u) u, count(*) o, sum(i) i from ord group by fecha, hora)
    select jsonb_build_object(
      'dias', coalesce((select jsonb_agg(jsonb_build_object('f', fecha, 'u', u, 'o', o, 'i', round(i, 2)) order by fecha) from dias), '[]'::jsonb),
      'horas', coalesce((select jsonb_agg(jsonb_build_object('f', fecha, 'h', hora, 'u', u, 'o', o, 'i', round(i, 2)) order by fecha, hora) from horas), '[]'::jsonb)
    ) into r;

  else
    select jsonb_build_object(
      'dias', coalesce((
        select jsonb_agg(jsonb_build_object('f', d.fecha, 'u', d.u, 'o', d.o, 'i', round(d.i, 2)) order by d.fecha)
        from (select fecha, sum(unidades) u, sum(ordenes) o, sum(importe) i
              from amazon_ventas_diarias
              where account_id = p_account and fecha >= p_desde and fecha <= p_hasta
              group by fecha) d), '[]'::jsonb),
      'horas', coalesce((
        select jsonb_agg(jsonb_build_object('f', fecha, 'h', hora, 'u', unidades, 'o', ordenes, 'i', importe) order by fecha, hora)
        from amazon_ventas_horas
        where account_id = p_account and fecha >= p_desde and fecha <= p_hasta), '[]'::jsonb)
    ) into r;
  end if;

  return r;
end;
$function$;
