-- ============================================================================
--  Estabilización operativa:
--    1) candados atómicos para que dos sincronizaciones no corran a la vez;
--    2) reemplazo transaccional de existencias para conservar la foto anterior
--       si cualquier renglón de la foto nueva falla.
-- ============================================================================

create table if not exists public.candados_trabajo (
  account_id  uuid not null references public.meli_accounts (id) on delete cascade,
  recurso     text not null,
  token       uuid not null,
  adquirido_en timestamptz not null,
  expira_en   timestamptz not null,
  primary key (account_id, recurso)
);

-- Tabla interna: solo se toca mediante las funciones de abajo.
alter table public.candados_trabajo enable row level security;
revoke all on table public.candados_trabajo from anon, authenticated;

create or replace function public.adquirir_candado_trabajo(
  p_account_id uuid,
  p_recurso text,
  p_ttl_segundos integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
  v_adquirido uuid;
begin
  if nullif(btrim(p_recurso), '') is null then
    raise exception 'El recurso del candado es obligatorio.';
  end if;
  if p_ttl_segundos < 30 or p_ttl_segundos > 3600 then
    raise exception 'El TTL del candado debe estar entre 30 y 3600 segundos.';
  end if;

  insert into public.candados_trabajo as actual (
    account_id,
    recurso,
    token,
    adquirido_en,
    expira_en
  )
  values (
    p_account_id,
    p_recurso,
    v_token,
    clock_timestamp(),
    clock_timestamp() + make_interval(secs => p_ttl_segundos)
  )
  on conflict (account_id, recurso) do update
  set token = excluded.token,
      adquirido_en = excluded.adquirido_en,
      expira_en = excluded.expira_en
  where actual.expira_en <= clock_timestamp()
  returning token into v_adquirido;

  return v_adquirido;
end;
$$;

create or replace function public.liberar_candado_trabajo(
  p_account_id uuid,
  p_recurso text,
  p_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liberado boolean;
begin
  delete from public.candados_trabajo
  where account_id = p_account_id
    and recurso = p_recurso
    and token = p_token
  returning true into v_liberado;

  return coalesce(v_liberado, false);
end;
$$;

revoke execute on function public.adquirir_candado_trabajo(uuid, text, integer)
  from anon, authenticated, public;
revoke execute on function public.liberar_candado_trabajo(uuid, text, uuid)
  from anon, authenticated, public;
grant execute on function public.adquirir_candado_trabajo(uuid, text, integer)
  to service_role;
grant execute on function public.liberar_candado_trabajo(uuid, text, uuid)
  to service_role;

create or replace function public.reemplazar_existencias(
  p_account_id uuid,
  p_almacenes text[],
  p_filas jsonb,
  p_reemplazar_todo boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insertadas integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.es_mi_cuenta(p_account_id) then
    raise exception 'No puedes modificar las existencias de esta cuenta.'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'La foto nueva de existencias está vacía; no se tocó nada.';
  end if;
  if coalesce(array_length(p_almacenes, 1), 0) = 0 then
    raise exception 'La foto nueva no indica almacenes; no se tocó nada.';
  end if;

  -- Serializa también dos reemplazos concurrentes de Industher/Excel para la
  -- misma cuenta. El candado dura exactamente la transacción.
  perform pg_advisory_xact_lock(
    hashtextextended(p_account_id::text || ':existencias', 0)
  );

  if exists (
    select 1
    from jsonb_to_recordset(p_filas) as fila(
      almacen text,
      sku_caja text,
      modelo text,
      talla text
    )
    where nullif(btrim(fila.almacen), '') is null
       or nullif(btrim(fila.sku_caja), '') is null
       or nullif(btrim(fila.modelo), '') is null
       or nullif(btrim(fila.talla), '') is null
  ) then
    raise exception 'Hay existencias sin almacén, SKU, modelo o talla; no se tocó nada.';
  end if;

  if not p_reemplazar_todo and exists (
    select 1
    from jsonb_to_recordset(p_filas) as fila(almacen text)
    where not (fila.almacen = any(p_almacenes))
  ) then
    raise exception 'La foto contiene un almacén fuera del alcance del reemplazo.';
  end if;

  if p_reemplazar_todo then
    delete from public.existencias
    where account_id = p_account_id;
  else
    delete from public.existencias
    where account_id = p_account_id
      and almacen = any(p_almacenes);
  end if;

  insert into public.existencias (
    account_id,
    almacen,
    codigo_almacen,
    sku_caja,
    pedido,
    modelo,
    color,
    talla,
    contenedor,
    cajas_fisicas,
    cajas_apartadas,
    en_camino,
    cajas_disponibles,
    pares_por_caja,
    importado_en
  )
  select
    p_account_id,
    fila.almacen,
    fila.codigo_almacen,
    fila.sku_caja,
    fila.pedido,
    fila.modelo,
    fila.color,
    fila.talla,
    coalesce(fila.contenedor, ''),
    coalesce(fila.cajas_fisicas, 0),
    coalesce(fila.cajas_apartadas, 0),
    coalesce(fila.en_camino, 0),
    coalesce(fila.cajas_disponibles, 0),
    coalesce(fila.pares_por_caja, 0),
    clock_timestamp()
  from jsonb_to_recordset(p_filas) as fila(
    almacen text,
    codigo_almacen text,
    sku_caja text,
    pedido text,
    modelo text,
    color text,
    talla text,
    contenedor text,
    cajas_fisicas integer,
    cajas_apartadas integer,
    en_camino integer,
    cajas_disponibles integer,
    pares_por_caja integer
  )
  on conflict (account_id, almacen, sku_caja, talla, contenedor) do update
  set codigo_almacen = excluded.codigo_almacen,
      pedido = excluded.pedido,
      modelo = excluded.modelo,
      color = excluded.color,
      cajas_fisicas = excluded.cajas_fisicas,
      cajas_apartadas = excluded.cajas_apartadas,
      en_camino = excluded.en_camino,
      cajas_disponibles = excluded.cajas_disponibles,
      pares_por_caja = excluded.pares_por_caja,
      importado_en = excluded.importado_en;

  get diagnostics v_insertadas = row_count;

  -- Un almacén recién descubierto surte a Full por omisión. Un ajuste previo
  -- del usuario se conserva gracias a `do nothing`.
  insert into public.almacenes_activos (account_id, almacen, surte_full)
  select p_account_id, almacen, true
  from unnest(p_almacenes) as almacen
  on conflict (account_id, almacen) do nothing;

  return v_insertadas;
end;
$$;

revoke execute on function public.reemplazar_existencias(uuid, text[], jsonb, boolean)
  from anon, public;
grant execute on function public.reemplazar_existencias(uuid, text[], jsonb, boolean)
  to authenticated, service_role;