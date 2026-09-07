-- Fecha de publicación para TODAS las variantes de una publicación, de un
-- jalón. Las variantes que se resolvieron por user product no pasan por el
-- catálogo y se quedaban sin fecha; sin fecha no se puede distinguir una
-- publicación nueva de una muerta.
create or replace function yz_fijar_publicado(p_account uuid, p_items jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account)) then
    raise exception 'no autorizado';
  end if;
  update yz_skus s
  set publicado_en = (e->>'publicado_en')::timestamptz
  from jsonb_array_elements(p_items) e
  where s.account_id = p_account and s.item_id = e->>'item_id'
    and (e->>'publicado_en') is not null
    and (s.publicado_en is null or s.publicado_en <> (e->>'publicado_en')::timestamptz);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function yz_fijar_publicado(uuid, jsonb) from public, anon;
grant execute on function yz_fijar_publicado(uuid, jsonb) to authenticated, service_role;
