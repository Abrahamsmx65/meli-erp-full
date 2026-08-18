-- ============================================================================
--  Cerrar las funciones que Supabase expone de más.
--
--  Supabase publica automáticamente como endpoint REST (/rest/v1/rpc/...) toda
--  función que viva en el esquema `public`. Eso incluye las tres funciones
--  internas de este sistema, que nadie debería poder llamar a mano.
--
--  Los permisos NO son todos iguales, y por eso no se revocan en bloque:
--
--  · verificar_correo_permitido() es la que cierra el registro. Es una función
--    de trigger; llamarla suelta ni siquiera funcionaría, pero no tiene por
--    qué estar publicada. Se le quita el permiso a todo el mundo.
--
--  · es_mi_cuenta() y es_mi_cuenta_amazon() SÍ las necesita el rol
--    `authenticated`: las políticas de RLS se evalúan con los privilegios de
--    quien hace la consulta, así que si se le quita el permiso, deja de poder
--    leer sus propios datos y el sistema entero se cae. A `anon` se le quitan,
--    porque un visitante sin sesión no tiene nada que preguntar.
-- ============================================================================

revoke execute on function public.verificar_correo_permitido() from anon, authenticated, public;

revoke execute on function public.es_mi_cuenta(uuid) from anon, public;
revoke execute on function public.es_mi_cuenta_amazon(uuid) from anon, public;

grant execute on function public.es_mi_cuenta(uuid) to authenticated;
grant execute on function public.es_mi_cuenta_amazon(uuid) to authenticated;
