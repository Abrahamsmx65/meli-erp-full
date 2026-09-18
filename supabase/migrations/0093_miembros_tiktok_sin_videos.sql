-- El dueño le quitó al usuario de operación (rol tiktok) la sección de
-- videos de producto (18-sep-2026): se retiran las políticas que la
-- migración 0092 le dio. Las tablas quedan solo con la del dueño.
drop policy if exists videos_producto_miembros_tiktok on public.videos_producto;
drop policy if exists personajes_video_miembros_tiktok on public.personajes_video;
