-- La miniatura de la sección de contenido.
--
-- El reporte de listados de Amazon MX llegó SIN la columna image-url (10 mil
-- filas y ni una imagen), así que la foto principal se trae del catálogo
-- (Catalog Items) en la misma pasada que resuelve el ASIN padre: es la imagen
-- de la publicación padre, que es justo lo que el renglón muestra.
alter table public.amazon_padres add column if not exists imagen_url text;
