-- 1) Renglones de pedido POR TALLA: las cajas completas de una sola talla se
--    guardan una por talla (antes se fusionaban por color), porque cada
--    talla puede viajar en un contenedor distinto. Los renglones de corrida
--    siguen con talla = ''.
alter table public.pedido_lineas
  add column if not exists talla text not null default '';

alter table public.pedido_lineas
  drop constraint if exists pedido_lineas_pedido_id_modelo_color_key;

drop index if exists pedido_lineas_pedido_modelo_color_talla;
create unique index pedido_lineas_pedido_modelo_color_talla
  on public.pedido_lineas (pedido_id, modelo, color, talla);

-- 2) Contenedores: nuestro propio ID vive en `numero` (la llave del negocio);
--    el número que da la naviera va aparte, solo para rastreo.
alter table public.contenedores
  add column if not exists numero_naviera text;
