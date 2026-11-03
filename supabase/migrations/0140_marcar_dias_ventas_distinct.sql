-- Arreglo de la 0138 (11-oct-2026). `marcar_dias_ventas` hacía
-- `select distinct …, clock_timestamp()`: la hora es distinta en cada renglón,
-- así que el DISTINCT no juntaba los días y el ON CONFLICT contestaba
-- «ON CONFLICT DO UPDATE command cannot affect row a second time» en cuanto
-- una sentencia tocaba DOS renglones del mismo día. El error tumbaba la
-- sentencia completa: de las 03:33Z a las 13:40Z no se guardó ninguna orden
-- de MELI (ordenes_neto, yz_ordenes_neto) ni venta diaria. La prueba de la
-- 0138 actualizó un solo renglón y no lo vio. Ahora se juntan los días y
-- después se les pone la hora.
create or replace function public.marcar_dias_ventas()
 returns trigger
 language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    insert into ventas_dias_sucios (canal, account_id, fecha, marcado_en)
    select tg_argv[0], d.account_id, d.fecha, clock_timestamp()
    from (select distinct n.account_id, n.fecha from nuevas n where n.fecha is not null) d
    on conflict (canal, account_id, fecha) do update set marcado_en = excluded.marcado_en;
  end if;
  if tg_op = 'UPDATE' then
    insert into ventas_dias_sucios (canal, account_id, fecha, marcado_en)
    select tg_argv[0], d.account_id, d.fecha, clock_timestamp()
    from (select distinct v.account_id, v.fecha from viejas v where v.fecha is not null) d
    on conflict (canal, account_id, fecha) do update set marcado_en = excluded.marcado_en;
  end if;
  return null;
end;
$function$;
