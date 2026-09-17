-- El usuario de operación (rol tiktok) también hace los videos de producto
-- (pedido del dueño, 17-sep-2026): las dos tablas de la sección de videos
-- aceptan su llave. `higgsfield_mcp` (la conexión con Higgsfield) se queda
-- sin políticas: solo la toca el servidor con service_role.
drop policy if exists videos_producto_miembros_tiktok on public.videos_producto;
create policy videos_producto_miembros_tiktok on public.videos_producto
  for all to authenticated using (es_miembro_tiktok(account_id)) with check (es_miembro_tiktok(account_id));
drop policy if exists personajes_video_miembros_tiktok on public.personajes_video;
create policy personajes_video_miembros_tiktok on public.personajes_video
  for all to authenticated using (es_miembro_tiktok(account_id)) with check (es_miembro_tiktok(account_id));
