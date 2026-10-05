-- Corte por MODELO (pedido del dueño, 5-oct-2026: «quiero poder despachar
-- modelos que tienen muchas ventas por separado; el GT148 va a tener como
-- 2,000 ventas»). Un corte puede nacer con un filtro de modelos: toma solo
-- los paquetes que son ÚNICAMENTE de esos modelos; los revueltos se van con
-- el corte general (decisión del dueño). `modelos` null = corte general.
-- La continuación por tiempo solo se une a un corte con el MISMO filtro.
alter table public.tiktok_cortes
  add column if not exists modelos text[];
comment on column public.tiktok_cortes.modelos is
  'Filtro con el que nació el corte: solo paquetes de un solo modelo de esta lista. null = corte general (todo lo pendiente, revueltos incluidos).';
