-- ============================================================================
--  Costos unificados: Productos y costos (productos_config) es LA fuente de
--  costo de todo lo que se vende —calzado y fundas, en MELI y en Amazon—.
--
--  Decisión del dueño: un solo lugar para capturar precios. Los costos de
--  fundas que ya estaban en yz_costos (Excel de YAPANIZCEL) se copian a
--  productos_config de la cuenta de calzado, con categoría "Fundas", sin
--  pisar lo que ya exista ahí. yz_costos se queda como respaldo de lectura
--  y la subida del Excel de fundas escribe en los dos lados.
-- ============================================================================

insert into public.productos_config (account_id, modelo, color, categoria, costo_mxn, actualizado_en)
select
  (select id from public.meli_accounts order by creado_en asc limit 1),
  upper(c.modelo),
  '',
  'Fundas',
  c.costo,
  now()
from public.yz_costos c
where c.costo > 0
  and exists (select 1 from public.meli_accounts)
on conflict (account_id, modelo, color) do nothing;
