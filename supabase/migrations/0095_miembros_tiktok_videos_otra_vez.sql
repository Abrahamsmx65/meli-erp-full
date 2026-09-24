-- El dueño le vuelve a dar al usuario de operación (rol tiktok) la sección
-- de videos de producto (24-sep-2026): las mismas políticas de la migración
-- 0092 que la 0093 había retirado. `higgsfield_mcp` sigue sin políticas:
-- solo la toca el servidor con service_role.
drop policy if exists videos_producto_miembros_tiktok on public.videos_producto;
create policy videos_producto_miembros_tiktok on public.videos_producto
  for all to authenticated using (es_miembro_tiktok(account_id)) with check (es_miembro_tiktok(account_id));
drop policy if exists personajes_video_miembros_tiktok on public.personajes_video;
create policy personajes_video_miembros_tiktok on public.personajes_video
  for all to authenticated using (es_miembro_tiktok(account_id)) with check (es_miembro_tiktok(account_id));
