-- El BL del contenedor como número de control (dueño, 11-oct-2026: «sería
-- inteligente siempre confirmar contra el BL; ahí dice cantidad de cajas y
-- está en el mismo Drive que el PL»). Lo escribe la sincronización de Drive
-- (`drive-packing.ts`, `importar/bl.ts`); la pantalla compara las cajas
-- cargadas contra `cajas_bl` y grita la diferencia.
alter table public.contenedores add column if not exists cajas_bl integer;
alter table public.contenedores add column if not exists bl_archivo text;
alter table public.contenedores add column if not exists bl_leido_en timestamptz;
