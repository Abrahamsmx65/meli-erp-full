-- Industher empezó a reportar la bodega "Naucalpan": 19 renglones de pares
-- sueltos (1 par por "caja", 660 pares) que NO son cajas de calzado para
-- Full. Como el RPC reemplazar_existencias da de alta cada almacén nuevo con
-- surte_full = true, entró a /inventario, al plan de Full y al pedido a
-- China ("Naucalpan 660 cajas · 660 pares"). Decisión del dueño: esa bodega
-- no se suma en bodega. Mismo candado que la de TikTok (migración 0045): el
-- trigger la deja en false pase lo que pase y se corrige lo ya guardado.

create or replace function public.tiktok_nunca_surte_full()
returns trigger
language plpgsql
as $$
declare
  v_nombre text := upper(regexp_replace(coalesce(new.almacen, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if v_nombre like 'TIKTOK%' or v_nombre like 'NAUCALPAN%' then
    new.surte_full := false;
  end if;
  return new;
end;
$$;

update public.almacenes_activos
set surte_full = false
where upper(regexp_replace(almacen, '[^A-Za-z0-9]', '', 'g')) like 'NAUCALPAN%'
  and surte_full;
