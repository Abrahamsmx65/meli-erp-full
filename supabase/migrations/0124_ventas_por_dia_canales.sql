-- Venta por día de TODOS los canales para Inicio (9-oct-2026).
--
-- Dueño: «en la página de inicio no te enfoques solo en MELI sino en todo
-- junto». Suma por día y canal lo que ya registran las tablas diarias:
--   calzado → ventas_diarias        (cuenta de MELI)
--   tiktok  → tiktok_ventas_diarias (misma cuenta de MELI)
--   fundas  → yz_ventas_diarias     (cuenta de YAPANIZCEL)
--   amazon  → amazon_ventas_diarias (cuenta de Amazon)
-- Es venta REGISTRADA (bruta), no dinero: el neto real vive en los cortes.
-- Cada lectura va por (account_id, fecha), que ya tiene índice.
--
-- security definer con su propio control de acceso (como los demás RPC del
-- fondo): cada cuenta que se pida tiene que ser del usuario, salvo service_role.

create or replace function public.ventas_por_dia_canales(
  p_meli uuid,
  p_amazon uuid,
  p_yz uuid,
  p_desde date,
  p_hasta date
)
returns table (fecha date, canal text, unidades bigint, importe numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  es_fondo boolean := coalesce(auth.role(), '') = 'service_role' or session_user = 'postgres';
begin
  if not es_fondo then
    if p_meli is not null and not es_mi_cuenta(p_meli) then
      raise exception 'ventas_por_dia_canales: la cuenta % no es tuya', p_meli using errcode = '42501';
    end if;
    if p_amazon is not null and not es_mi_cuenta_amazon(p_amazon) then
      raise exception 'ventas_por_dia_canales: la cuenta % no es tuya', p_amazon using errcode = '42501';
    end if;
    if p_yz is not null and not es_mi_cuenta_yz(p_yz) then
      raise exception 'ventas_por_dia_canales: la cuenta % no es tuya', p_yz using errcode = '42501';
    end if;
  end if;

  return query
  select v.fecha, 'calzado'::text, sum(v.unidades)::bigint, sum(v.importe)
  from ventas_diarias v
  where p_meli is not null and v.account_id = p_meli and v.fecha between p_desde and p_hasta
  group by v.fecha
  union all
  select t.fecha, 'tiktok'::text, sum(t.unidades)::bigint, sum(t.importe)
  from tiktok_ventas_diarias t
  where p_meli is not null and t.account_id = p_meli and t.fecha between p_desde and p_hasta
  group by t.fecha
  union all
  select y.fecha, 'fundas'::text, sum(y.unidades)::bigint, sum(y.importe)
  from yz_ventas_diarias y
  where p_yz is not null and y.account_id = p_yz and y.fecha between p_desde and p_hasta
  group by y.fecha
  union all
  select a.fecha, 'amazon'::text, sum(a.unidades)::bigint, sum(a.importe)
  from amazon_ventas_diarias a
  where p_amazon is not null and a.account_id = p_amazon and a.fecha between p_desde and p_hasta
  group by a.fecha
  order by 1, 2;
end;
$$;

revoke execute on function public.ventas_por_dia_canales(uuid, uuid, uuid, date, date) from anon, public;
grant execute on function public.ventas_por_dia_canales(uuid, uuid, uuid, date, date) to authenticated, service_role;
