-- Videos de 30 segundos en DOS partes hiladas (Seedance genera 15 s máximo):
-- la parte 2 arranca del último cuadro de la parte 1 y al final se unen.
alter table videos_producto add column if not exists request_id_parte2 text;
alter table videos_producto add column if not exists video_parte1 text;
alter table videos_producto add column if not exists resolucion text;
