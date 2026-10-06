-- La revisión general, segunda versión (decisión del dueño, 6-oct-2026):
-- la primera gritó nueve veces por una sola causa, marcó septiembre como
-- «sin facturación» teniendo 9,132 renglones (bajó 1,000 renglones crudos
-- en vez de contar), y no miró lo único que importaba: la COBERTURA de cada
-- canal en cada mes. Todo lo que aquí se cuenta se cuenta EN POSTGRES.

-- 1) salud_cortes_v2: devuelve los canales con su cobertura y si son
--    calculables. Va con nombre nuevo porque `drop function salud_cortes`
--    se quedó esperando un candado al aplicarse; la vieja queda sin uso.
create or replace function public.salud_cortes_v2(p_account uuid)
returns table(
  periodo text,
  generado_en timestamptz,
  vigente boolean,
  motivo text,
  canales jsonb,
  venta_total numeric,
  venta_canales numeric,
  utilidad_total numeric,
  exacto boolean,
  avisos int,
  avisos_timeout int
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    c.periodo,
    c.generado_en,
    coalesce(c.vigente, true),
    c.motivo,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
          'canal', k->>'canal',
          'venta', coalesce((k->>'ventaBruta')::numeric, 0),
          'cobertura', case when (k->>'coberturaNeto') is null then null else (k->>'coberturaNeto')::numeric end,
          'calculable', coalesce((k->>'calculable')::boolean, true)
        ) order by k->>'canal')
       from jsonb_array_elements(c.datos->'canales') k),
      '[]'::jsonb),
    (c.datos->'total'->>'ventaBruta')::numeric,
    -- Solo los canales calculables: los demás están fuera del total a propósito.
    coalesce(
      (select sum((k->>'ventaBruta')::numeric)
         from jsonb_array_elements(c.datos->'canales') k
        where coalesce((k->>'calculable')::boolean, true)), 0),
    (c.datos->'total'->>'utilidadNeta')::numeric,
    coalesce((c.datos->>'exacto')::boolean, false),
    coalesce((select count(*) from jsonb_array_elements_text(c.datos->'avisos')), 0)::int,
    coalesce((select count(*) from jsonb_array_elements_text(c.datos->'avisos') a
               where a ilike '%timeout%' or a ilike '%no se pudo cargar%' or a ilike '%no se pudo leer%'), 0)::int
  from consolidado_cache c
  where c.account_id = p_account
    and (auth.role() = 'service_role' or es_mi_cuenta(p_account))
  order by c.periodo desc;
$$;
grant execute on function public.salud_cortes_v2(uuid) to authenticated, service_role;

-- 2) salud_fuentes: por mes, cuánto hay de cada fuente que alimenta los
--    cortes. Un renglón chico por mes; nunca se bajan tablas a Node.
create or replace function public.salud_fuentes(p_account uuid, p_yz uuid default null, p_amazon uuid default null)
returns table(
  mes text,
  venta_calzado numeric,
  ordenes_calzado bigint,
  ordenes_registradas bigint,
  ordenes_con_deposito bigint,
  cargos bigint,
  dias_publicidad bigint,
  venta_fundas numeric,
  ordenes_fundas bigint,
  fundas_con_deposito bigint,
  venta_amazon numeric,
  eventos_amazon bigint,
  grupos_amazon_descuadrados bigint,
  descuadre_amazon numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with meses as (
    select distinct to_char(fecha, 'YYYY-MM') as mes from ventas_diarias where account_id = p_account
    union
    select distinct to_char(fecha, 'YYYY-MM') from yz_ventas_diarias where p_yz is not null and account_id = p_yz
    union
    select distinct to_char(fecha, 'YYYY-MM') from amazon_ventas_diarias where p_amazon is not null and account_id = p_amazon
  ),
  cz as (
    select to_char(fecha, 'YYYY-MM') mes, sum(importe) venta, sum(ordenes) ordenes
    from ventas_diarias where account_id = p_account group by 1
  ),
  reg as (
    select to_char(fecha, 'YYYY-MM') mes,
           count(*) registradas,
           count(*) filter (where neto_en is not null or neto > 0) con_dep
    from ordenes_neto where account_id = p_account and (estado is null or estado <> 'cancelled') group by 1
  ),
  ca as (select periodo mes, count(*) n from meli_cargos where account_id = p_account group by 1),
  pu as (select to_char(fecha, 'YYYY-MM') mes, count(distinct fecha) dias from publicidad_diaria where account_id = p_account group by 1),
  yz as (
    select to_char(fecha, 'YYYY-MM') mes, sum(importe) venta, sum(ordenes) ordenes
    from yz_ventas_diarias where p_yz is not null and account_id = p_yz group by 1
  ),
  yo as (
    select to_char(fecha, 'YYYY-MM') mes, count(*) filter (where neto_en is not null or neto > 0) con_dep
    from yz_ordenes_neto where p_yz is not null and account_id = p_yz and (estado is null or estado <> 'cancelled') group by 1
  ),
  az as (select to_char(fecha, 'YYYY-MM') mes, sum(importe) venta from amazon_ventas_diarias where p_amazon is not null and account_id = p_amazon group by 1),
  ae as (
    select to_char(posted_en at time zone 'America/Mexico_City', 'YYYY-MM') mes, count(*) n
    from amazon_finanzas_eventos where p_amazon is not null and account_id = p_amazon group by 1
  ),
  ag as (
    select to_char(fin at time zone 'America/Mexico_City', 'YYYY-MM') mes,
           count(*) filter (where cuadra = false) n,
           coalesce(sum(suma_eventos - total_original) filter (where cuadra = false), 0) d
    from amazon_finanzas_grupos where p_amazon is not null and account_id = p_amazon group by 1
  )
  select m.mes,
    coalesce(cz.venta, 0), coalesce(cz.ordenes, 0)::bigint,
    coalesce(reg.registradas, 0), coalesce(reg.con_dep, 0),
    coalesce(ca.n, 0), coalesce(pu.dias, 0),
    coalesce(yz.venta, 0), coalesce(yz.ordenes, 0)::bigint, coalesce(yo.con_dep, 0),
    coalesce(az.venta, 0), coalesce(ae.n, 0), coalesce(ag.n, 0), coalesce(ag.d, 0)
  from meses m
  left join cz using (mes) left join reg using (mes) left join ca using (mes) left join pu using (mes)
  left join yz using (mes) left join yo using (mes) left join az using (mes) left join ae using (mes) left join ag using (mes)
  where (auth.role() = 'service_role' or es_mi_cuenta(p_account))
    and (p_yz is null or auth.role() = 'service_role' or es_mi_cuenta_yz(p_yz))
    and (p_amazon is null or auth.role() = 'service_role' or es_mi_cuenta_amazon(p_amazon))
  order by m.mes desc;
$$;
grant execute on function public.salud_fuentes(uuid, uuid, uuid) to authenticated, service_role;

-- 3) amazon_finanzas_recuadrar: el número de control de cada liquidación se
--    recalcula desde lo que HAY guardado. Al cerrar un grupo se congelaban
--    `suma_eventos`/`eventos`/`cuadra`; en 5 de 7 grupos «descuadrados» los
--    eventos guardados ya no coinciden con lo que se contó al cierre, así
--    que el control decía una cosa y la tabla otra. Devuelve lo que cambió.
create or replace function public.amazon_finanzas_recuadrar(p_account uuid)
returns table(grupo_id text, fin timestamptz, total_original numeric, suma_eventos numeric, eventos bigint, cuadra boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth.role() = 'service_role' or es_mi_cuenta_amazon(p_account)) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
  with s as (
    select e.grupo_id,
           sum(coalesce(e.monto, 0)) as suma,
           count(*) as n,
           count(*) filter (where not e.clasificado or e.monto is null) as sin
    from amazon_finanzas_eventos e
    where e.account_id = p_account
    group by e.grupo_id
  ),
  u as (
    update amazon_finanzas_grupos g
       set suma_eventos = s.suma,
           eventos = s.n::int,
           sin_clasificar = s.sin::int,
           cuadra = case when g.estado = 'Closed' and g.total_original is not null
                         then abs(s.suma - g.total_original) < 0.011 and s.sin = 0
                         else null end,
           actualizado_en = now()
      from s
     where g.account_id = p_account and g.grupo_id = s.grupo_id and g.completo
       and (g.suma_eventos is distinct from s.suma or g.eventos is distinct from s.n::int)
    returning g.grupo_id, g.fin, g.total_original, g.suma_eventos, g.eventos::bigint, g.cuadra
  )
  select * from u;
end;
$$;
grant execute on function public.amazon_finanzas_recuadrar(uuid) to authenticated, service_role;
