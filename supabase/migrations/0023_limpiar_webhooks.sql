-- Limpieza de la bandeja de webhooks, ejecutada DENTRO de Postgres.
--
-- El latido intentaba dar por procesados ~190 mil avisos con un solo UPDATE
-- vía PostgREST: la sentencia moría por tiempo y el error se ignoraba — el
-- atasco creció por días y la tabla llegó a 382 MB en una semana. Esta
-- función hace lo mismo por tandas acotadas, en el servidor, y regresa los
-- conteos para poder vigilarla:
--
--   1. Marca como procesados los avisos anteriores a la última
--      sincronización completa (ya no dicen nada nuevo).
--   2. Borra los avisos procesados con más de 3 días (solo son bitácora).
create or replace function public.limpiar_webhooks(p_account uuid, p_corte timestamptz)
returns table (marcados integer, borrados integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marcados integer := 0;
  v_borrados integer := 0;
begin
  if p_corte is not null then
    with tanda as (
      select id from webhooks_meli
      where account_id = p_account
        and procesado_en is null
        and recibido_en < p_corte
      limit 20000
    )
    update webhooks_meli w
       set procesado_en = now()
      from tanda
     where w.id = tanda.id;
    get diagnostics v_marcados = row_count;
  end if;

  with tanda as (
    select id from webhooks_meli
    where account_id = p_account
      and procesado_en is not null
      and recibido_en < now() - interval '3 days'
    limit 20000
  )
  delete from webhooks_meli w
    using tanda
   where w.id = tanda.id;
  get diagnostics v_borrados = row_count;

  return query select v_marcados, v_borrados;
end;
$$;

-- Solo el service role (que se salta RLS y estos revokes) la ejecuta.
revoke execute on function public.limpiar_webhooks(uuid, timestamptz) from anon, authenticated, public;
