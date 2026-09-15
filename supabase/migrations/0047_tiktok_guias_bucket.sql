-- ============================================================================
--  Guías de TikTok guardadas: bucket PRIVADO `tiktok-guias`.
--
--  Con 170 paquetes por corte, bajar cada guía de TikTok al vuelo cada vez
--  que se imprime no cabe en los 300 s de Vercel (y las URLs de TikTok
--  caducan). Cada guía se guarda una vez por paquete
--  ({account}/{package_id}.pdf) y el PDF unido del corte también
--  ({account}/corte-{id}.pdf): reimprimir es leer un archivo. Privado: se
--  lee solo con service_role desde el API con sesión.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('tiktok-guias', 'tiktok-guias', false)
on conflict (id) do nothing;
