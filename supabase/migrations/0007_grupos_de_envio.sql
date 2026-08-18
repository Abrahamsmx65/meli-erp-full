-- Grupos de envío por almacén.
--
-- Caseshop e Industher están en la misma dirección, así que sus cajas pueden
-- salir en un solo envío a Mercado Envíos Full. EnvioPack es otra bodega y
-- tiene que ir por separado. Esto no se puede adivinar del inventario: es un
-- dato del negocio y por eso se guarda.
--
-- Nulo significa "este almacén sale solo", que es el comportamiento seguro:
-- agrupar de más junta bodegas que no se pueden juntar, agrupar de menos solo
-- genera un envío extra.
alter table public.almacenes_activos
  add column if not exists grupo_envio text;

comment on column public.almacenes_activos.grupo_envio is
  'Almacenes con el mismo grupo salen en un mismo envío a Full. Nulo = sale solo.';

-- Los grupos que hoy aplican para esta operación.
update public.almacenes_activos
   set grupo_envio = 'Caseshop + Industher'
 where almacen in ('Caseshop', 'Industher')
   and grupo_envio is null;

update public.almacenes_activos
   set grupo_envio = 'EnvioPack'
 where almacen = 'EnvioPack'
   and grupo_envio is null;
