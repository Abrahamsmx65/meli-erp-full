-- ============================================================================
--  Con qué ORDEN se armó el corte.
--
--  Desde el 14-sep-2026 el corte va PRIMERO con los paquetes de un solo
--  modelo y al final con los revueltos (decisión del dueño: así se prepara
--  más rápido). Pero el orden manda los NÚMEROS que se imprimen en la
--  etiqueta y en la lista, y un corte ya impreso —a medio preparar, con las
--  hojas en la mesa— no se puede renumerar sin que el papel deje de cuadrar.
--
--  Por eso cada corte guarda con qué orden nació y se vuelve a armar SIEMPRE
--  con ese: los de antes conservan el suyo ('bodega': modelo, color, talla)
--  y los nuevos usan el nuevo ('un-modelo'). Una fecha de corte no serviría:
--  dependería de la hora exacta del despliegue.
-- ============================================================================

alter table public.tiktok_cortes
  add column if not exists orden_paquetes text not null default 'bodega';

comment on column public.tiktok_cortes.orden_paquetes is
  'Con qué orden se numeraron los paquetes: bodega (modelo→color→talla) o un-modelo (primero lo de un solo modelo, al final lo revuelto).';
