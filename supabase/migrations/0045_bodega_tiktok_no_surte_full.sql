-- La bodega "TikTok" de Industher es el inventario de la tienda de TikTok,
-- no cajas de calzado: nunca surte a Full. El RPC reemplazar_existencias da
-- de alta los almacenes nuevos con surte_full = true y la sincronización de
-- TikTok solo lo bajaba "si no existía", así que en producción quedó en true
-- y sus cajas entraron a bodega, al plan de Full y al pedido a China.
-- Un trigger lo deja en false pase lo que pase, y se corrige lo ya guardado.

create or replace function public.tiktok_nunca_surte_full()
returns trigger
language plpgsql
as $$
begin
  if upper(regexp_replace(coalesce(new.almacen, ''), '[^A-Za-z0-9]', '', 'g')) like 'TIKTOK%' then
    new.surte_full := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tiktok_nunca_surte_full on public.almacenes_activos;
create trigger trg_tiktok_nunca_surte_full
  before insert or update on public.almacenes_activos
  for each row execute function public.tiktok_nunca_surte_full();

update public.almacenes_activos
set surte_full = false
where upper(regexp_replace(almacen, '[^A-Za-z0-9]', '', 'g')) like 'TIKTOK%'
  and surte_full;
