-- ============================================================================
--  Tienda en línea de GETAC (proyecto `tienda/`, pedido del dueño, 1-oct-2026:
--  «vamos a ocupar el mismo inventario que tenemos en TikTok y va a ser
--  sincronizado porque si algo se vende aquí ya no se puede vender en el
--  otro; de ahí tomamos listados, imágenes y precios»).
--
--  · El inventario es el KARDEX DE TIKTOK (`tiktok_inventario`). La tienda
--    no tiene stock propio: aparta pares en `apartado_web`, que el ERP resta
--    de lo que le publica a TikTok, y TikTok resta su `apartado` de lo que
--    ofrece la tienda. Un par, un dueño.
--  · El apartado de la tienda se decide DENTRO de Postgres con el renglón
--    bloqueado (`tienda_crear_pedido`): dos compradores al mismo segundo no
--    se pueden llevar el mismo último par.
--  · `tope_estante` y `contado` los escribe `publicarDisponibilidad` del
--    ERP: son las mismas dos reglas con las que se publica a TikTok (menor
--    entre kardex y estante del 3PL; solo SKUs que alguna vez se contaron).
--  · Catálogo (fotos, descripción, colores, tallas, precio) copiado de
--    TikTok por el ERP (`servicios/tienda-catalogo.ts`).
--  · Clientes con acceso por CÓDIGO al correo, en tablas propias: el
--    registro del ERP (`usuarios_permitidos`) sigue cerrado y un cliente no
--    es un usuario de Supabase Auth.
-- ============================================================================

alter table public.tiktok_inventario
  add column if not exists apartado_web integer not null default 0,
  add column if not exists tope_estante integer,
  add column if not exists contado boolean not null default false;

-- ---------------------------------------------------------------------------
-- Catálogo copiado de TikTok
-- ---------------------------------------------------------------------------
create table if not exists public.tienda_productos (
  account_id     uuid not null references public.meli_accounts (id) on delete cascade,
  product_id     text not null,
  modelo         text,
  titulo         text not null,
  descripcion    text,
  imagenes       jsonb not null default '[]'::jsonb,
  estado_tiktok  text,
  activo         boolean not null default true,
  leido_en       timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (account_id, product_id)
);
create index if not exists tienda_productos_modelo_idx on public.tienda_productos (account_id, modelo);

create table if not exists public.tienda_variantes (
  account_id   uuid not null references public.meli_accounts (id) on delete cascade,
  sku_id       text not null,
  product_id   text not null,
  sku_interno  text,
  seller_sku   text,
  color        text,
  talla        text,
  precio       numeric,
  precio_lista numeric,
  imagen       text,
  activo       boolean not null default true,
  primary key (account_id, sku_id)
);
create index if not exists tienda_variantes_producto_idx on public.tienda_variantes (account_id, product_id);
create index if not exists tienda_variantes_interno_idx on public.tienda_variantes (account_id, sku_interno);

-- ---------------------------------------------------------------------------
-- Clientes (acceso por código al correo)
-- ---------------------------------------------------------------------------
create table if not exists public.tienda_clientes (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.meli_accounts (id) on delete cascade,
  email          text not null,
  nombre         text,
  telefono       text,
  direccion      jsonb,
  creado_en      timestamptz not null default now(),
  ultimo_acceso  timestamptz,
  unique (account_id, email)
);

create table if not exists public.tienda_codigos (
  id          bigserial primary key,
  account_id  uuid not null references public.meli_accounts (id) on delete cascade,
  email       text not null,
  codigo_hash text not null,
  intentos    integer not null default 0,
  expira_en   timestamptz not null,
  usado_en    timestamptz,
  creado_en   timestamptz not null default now()
);
create index if not exists tienda_codigos_email_idx on public.tienda_codigos (account_id, email, creado_en desc);

create table if not exists public.tienda_sesiones (
  token_hash text primary key,
  cliente_id uuid not null references public.tienda_clientes (id) on delete cascade,
  expira_en  timestamptz not null,
  creado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------
create table if not exists public.tienda_pedidos (
  id             bigserial primary key,
  -- GW000123: también es la referencia en el kardex y en las salidas al 3PL
  folio          text generated always as ('GW' || lpad(id::text, 6, '0')) stored,
  account_id     uuid not null references public.meli_accounts (id) on delete cascade,
  cliente_id     uuid references public.tienda_clientes (id) on delete set null,
  email          text not null,
  nombre         text not null,
  telefono       text,
  direccion      jsonb not null default '{}'::jsonb,
  -- pendiente_pago | pagado | enviado | entregado | cancelado | expirado | sin_stock
  estado         text not null default 'pendiente_pago',
  subtotal       numeric not null default 0,
  envio          numeric not null default 0,
  total          numeric not null default 0,
  -- para ver el pedido sin sesión (liga del correo y regreso de Mercado Pago)
  token_publico  text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  mp_preferencia text,
  mp_pago        text,
  pago_estado    text,
  pago_detalle   jsonb,
  expira_en      timestamptz,
  pagado_en      timestamptz,
  guia           text,
  paqueteria     text,
  enviado_en     timestamptz,
  cancelado_en   timestamptz,
  nota           text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (folio)
);
create index if not exists tienda_pedidos_estado_idx on public.tienda_pedidos (account_id, estado, creado_en);
create index if not exists tienda_pedidos_cliente_idx on public.tienda_pedidos (cliente_id, creado_en desc);

create table if not exists public.tienda_pedido_items (
  id          bigserial primary key,
  pedido_id   bigint not null references public.tienda_pedidos (id) on delete cascade,
  sku_id      text not null,
  product_id  text,
  sku_interno text not null,
  titulo      text,
  color       text,
  talla       text,
  cantidad    integer not null check (cantidad > 0),
  precio      numeric not null,
  imagen      text
);
create index if not exists tienda_pedido_items_pedido_idx on public.tienda_pedido_items (pedido_id);
create index if not exists tienda_pedido_items_sku_idx on public.tienda_pedido_items (sku_interno);

-- ---------------------------------------------------------------------------
-- RLS: el ERP (dueño y miembros de TikTok) ve catálogo y pedidos; clientes,
-- códigos y sesiones solo con service_role (cero políticas, como meli_tokens).
-- ---------------------------------------------------------------------------
alter table public.tienda_productos enable row level security;
alter table public.tienda_variantes enable row level security;
alter table public.tienda_clientes enable row level security;
alter table public.tienda_codigos enable row level security;
alter table public.tienda_sesiones enable row level security;
alter table public.tienda_pedidos enable row level security;
alter table public.tienda_pedido_items enable row level security;

drop policy if exists tienda_productos_mios on public.tienda_productos;
create policy tienda_productos_mios on public.tienda_productos
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
drop policy if exists tienda_productos_miembros_tiktok on public.tienda_productos;
create policy tienda_productos_miembros_tiktok on public.tienda_productos
  for select to authenticated using (es_miembro_tiktok(account_id));

drop policy if exists tienda_variantes_mios on public.tienda_variantes;
create policy tienda_variantes_mios on public.tienda_variantes
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
drop policy if exists tienda_variantes_miembros_tiktok on public.tienda_variantes;
create policy tienda_variantes_miembros_tiktok on public.tienda_variantes
  for select to authenticated using (es_miembro_tiktok(account_id));

drop policy if exists tienda_pedidos_mios on public.tienda_pedidos;
create policy tienda_pedidos_mios on public.tienda_pedidos
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
drop policy if exists tienda_pedidos_miembros_tiktok on public.tienda_pedidos;
create policy tienda_pedidos_miembros_tiktok on public.tienda_pedidos
  for all to authenticated using (es_miembro_tiktok(account_id)) with check (es_miembro_tiktok(account_id));

drop policy if exists tienda_pedido_items_mios on public.tienda_pedido_items;
create policy tienda_pedido_items_mios on public.tienda_pedido_items
  for select using (exists (
    select 1 from public.tienda_pedidos p
     where p.id = pedido_id and (es_mi_cuenta(p.account_id) or es_miembro_tiktok(p.account_id))
  ));

-- ---------------------------------------------------------------------------
-- Disponible para la tienda: la misma regla que se le publica a TikTok
-- (`disponibleConEstante`) menos lo que ya apartó la propia tienda.
-- ---------------------------------------------------------------------------
create or replace function public.tienda_disponible_de(
  saldo integer, apartado integer, apartado_web integer, tope_estante integer, contado boolean
) returns integer
language sql immutable as $$
  select case
    when not coalesce(contado, false) then 0
    else greatest(0, least(coalesce(saldo, 0), coalesce(tope_estante, coalesce(saldo, 0)))
                     - coalesce(apartado, 0) - coalesce(apartado_web, 0))
  end
$$;

create or replace function public.tienda_disponibles(p_account uuid, p_skus text[] default null)
returns table (sku text, disponible integer)
language sql stable as $$
  select i.sku, public.tienda_disponible_de(i.saldo, i.apartado, i.apartado_web, i.tope_estante, i.contado)
    from public.tiktok_inventario i
   where i.account_id = p_account
     and (p_skus is null or i.sku = any (p_skus))
   order by i.sku
$$;

-- Estados que tienen un par apartado en la tienda.
create or replace function public.tienda_recalcular_apartado(p_account uuid, p_skus text[] default null)
returns void
language sql as $$
  update public.tiktok_inventario i
     set apartado_web = coalesce((
           select sum(it.cantidad)::int
             from public.tienda_pedido_items it
             join public.tienda_pedidos p on p.id = it.pedido_id
            where p.account_id = i.account_id
              and it.sku_interno = i.sku
              and p.estado in ('pendiente_pago', 'pagado')
         ), 0)
   where i.account_id = p_account
     and (p_skus is null or i.sku = any (p_skus))
$$;

-- ---------------------------------------------------------------------------
-- Crear un pedido: valida precio y existencia con los renglones BLOQUEADOS y
-- aparta en el mismo acto. El precio sale del catálogo, nunca del navegador.
--   p_items: [{ "sku_id": "...", "cantidad": 2 }]
-- Devuelve { ok, id, folio, token, total } o { ok:false, faltantes:[{sku_id, disponible}] }.
-- ---------------------------------------------------------------------------
create or replace function public.tienda_crear_pedido(
  p_account uuid,
  p_cliente uuid,
  p_email text,
  p_nombre text,
  p_telefono text,
  p_direccion jsonb,
  p_envio numeric,
  p_items jsonb,
  p_minutos integer default 45
) returns jsonb
language plpgsql as $$
declare
  v_skus text[];
  v_faltantes jsonb := '[]'::jsonb;
  v_pedido public.tienda_pedidos;
  v_subtotal numeric := 0;
  r record;
begin
  -- Renglones pedidos, contra el catálogo vivo
  create temp table if not exists _tienda_items (
    sku_id text, product_id text, sku_interno text, titulo text, color text, talla text,
    cantidad int, precio numeric, imagen text
  ) on commit drop;
  delete from _tienda_items;

  insert into _tienda_items
  select v.sku_id, v.product_id, v.sku_interno, p.titulo, v.color, v.talla,
         sum(greatest(0, coalesce((x->>'cantidad')::int, 0)))::int, v.precio, coalesce(v.imagen, p.imagenes->>0)
    from jsonb_array_elements(p_items) x
    join public.tienda_variantes v on v.account_id = p_account and v.sku_id = x->>'sku_id' and v.activo
    join public.tienda_productos p on p.account_id = p_account and p.product_id = v.product_id and p.activo
   where v.sku_interno is not null and v.precio is not null and v.precio > 0
   group by v.sku_id, v.product_id, v.sku_interno, p.titulo, v.color, v.talla, v.precio, v.imagen, p.imagenes;

  delete from _tienda_items where cantidad <= 0;

  -- Lo que se pidió y no está a la venta cuenta como faltante con 0.
  select coalesce(jsonb_agg(jsonb_build_object('sku_id', x->>'sku_id', 'disponible', 0)), '[]'::jsonb)
    into v_faltantes
    from jsonb_array_elements(p_items) x
   where not exists (select 1 from _tienda_items t where t.sku_id = x->>'sku_id');

  if not exists (select 1 from _tienda_items) then
    return jsonb_build_object('ok', false, 'faltantes', v_faltantes);
  end if;

  select array_agg(distinct sku_interno order by sku_interno) into v_skus from _tienda_items;

  -- El candado: los renglones del kardex de estos SKUs, en orden fijo.
  perform 1 from public.tiktok_inventario
   where account_id = p_account and sku = any (v_skus)
   order by sku
   for update;

  for r in
    select t.sku_interno, sum(t.cantidad)::int as pide,
           coalesce(max(public.tienda_disponible_de(i.saldo, i.apartado, i.apartado_web, i.tope_estante, i.contado)), 0) as hay
      from _tienda_items t
      left join public.tiktok_inventario i on i.account_id = p_account and i.sku = t.sku_interno
     group by t.sku_interno
  loop
    if r.pide > r.hay then
      v_faltantes := v_faltantes || (
        select coalesce(jsonb_agg(jsonb_build_object('sku_id', t.sku_id, 'disponible', r.hay)), '[]'::jsonb)
          from _tienda_items t where t.sku_interno = r.sku_interno
      );
    end if;
  end loop;

  if jsonb_array_length(v_faltantes) > 0 then
    return jsonb_build_object('ok', false, 'faltantes', v_faltantes);
  end if;

  select sum(cantidad * precio) into v_subtotal from _tienda_items;

  insert into public.tienda_pedidos (
    account_id, cliente_id, email, nombre, telefono, direccion, estado,
    subtotal, envio, total, expira_en
  ) values (
    p_account, p_cliente, lower(trim(p_email)), p_nombre, p_telefono, coalesce(p_direccion, '{}'::jsonb),
    'pendiente_pago', v_subtotal, coalesce(p_envio, 0), v_subtotal + coalesce(p_envio, 0),
    now() + make_interval(mins => greatest(5, coalesce(p_minutos, 45)))
  ) returning * into v_pedido;

  insert into public.tienda_pedido_items (pedido_id, sku_id, product_id, sku_interno, titulo, color, talla, cantidad, precio, imagen)
  select v_pedido.id, sku_id, product_id, sku_interno, titulo, color, talla, cantidad, precio, imagen
    from _tienda_items;

  perform public.tienda_recalcular_apartado(p_account, v_skus);

  return jsonb_build_object(
    'ok', true, 'id', v_pedido.id, 'folio', v_pedido.folio, 'token', v_pedido.token_publico,
    'subtotal', v_pedido.subtotal, 'envio', v_pedido.envio, 'total', v_pedido.total
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Lo que Mercado Pago dice del pago. Un pago APROBADO de un pedido que ya
-- había caducado vuelve a apartar si todavía hay pares; si no, el pedido
-- queda `sin_stock` (hay que devolver el dinero) y nunca se aparta de más.
-- ---------------------------------------------------------------------------
create or replace function public.tienda_marcar_pago(
  p_pedido bigint, p_estado_mp text, p_pago text, p_detalle jsonb
) returns jsonb
language plpgsql as $$
declare
  v public.tienda_pedidos;
  v_skus text[];
  v_falta boolean := false;
  v_estado text;
begin
  select * into v from public.tienda_pedidos where id = p_pedido for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'pedido no existe'); end if;

  select array_agg(distinct sku_interno order by sku_interno) into v_skus
    from public.tienda_pedido_items where pedido_id = v.id;
  v_estado := v.estado;

  if p_estado_mp = 'approved' then
    if v.estado = 'pendiente_pago' then
      v_estado := 'pagado';
    elsif v.estado in ('expirado', 'cancelado') and v.pagado_en is null then
      perform 1 from public.tiktok_inventario
       where account_id = v.account_id and sku = any (v_skus) order by sku for update;
      select exists (
        select 1 from (
          select it.sku_interno, sum(it.cantidad) as pide
            from public.tienda_pedido_items it where it.pedido_id = v.id group by it.sku_interno
        ) q
        left join public.tiktok_inventario i on i.account_id = v.account_id and i.sku = q.sku_interno
        where q.pide > coalesce(public.tienda_disponible_de(i.saldo, i.apartado, i.apartado_web, i.tope_estante, i.contado), 0)
      ) into v_falta;
      v_estado := case when v_falta then 'sin_stock' else 'pagado' end;
    end if;
  elsif p_estado_mp in ('pending', 'in_process', 'authorized') then
    -- OXXO / SPEI: el par se queda apartado mientras se paga (hasta 72 h).
    if v.estado = 'pendiente_pago' then
      update public.tienda_pedidos
         set expira_en = greatest(coalesce(expira_en, now()), now() + interval '72 hours')
       where id = v.id;
    end if;
  elsif p_estado_mp in ('cancelled') then
    if v.estado = 'pendiente_pago' then v_estado := 'cancelado'; end if;
  end if;

  update public.tienda_pedidos
     set estado = v_estado,
         mp_pago = coalesce(p_pago, mp_pago),
         pago_estado = p_estado_mp,
         pago_detalle = coalesce(p_detalle, pago_detalle),
         pagado_en = case when p_estado_mp = 'approved' then coalesce(pagado_en, now()) else pagado_en end,
         cancelado_en = case when v_estado = 'cancelado' and v.estado <> 'cancelado' then now() else cancelado_en end,
         actualizado_en = now()
   where id = v.id;

  perform public.tienda_recalcular_apartado(v.account_id, v_skus);
  return jsonb_build_object('ok', true, 'antes', v.estado, 'estado', v_estado, 'skus', to_jsonb(v_skus));
end
$$;

-- Caducar lo que se quedó sin pagar. Devuelve los SKUs que se soltaron.
create or replace function public.tienda_expirar(p_account uuid)
returns text[]
language plpgsql as $$
declare
  v_skus text[];
begin
  with caducados as (
    update public.tienda_pedidos
       set estado = 'expirado', actualizado_en = now()
     where account_id = p_account and estado = 'pendiente_pago' and expira_en < now()
    returning id
  )
  select array_agg(distinct it.sku_interno) into v_skus
    from public.tienda_pedido_items it join caducados c on c.id = it.pedido_id;
  if v_skus is not null then
    perform public.tienda_recalcular_apartado(p_account, v_skus);
  end if;
  return coalesce(v_skus, '{}');
end
$$;

-- Solo el servidor (service_role) mueve pedidos y apartados.
revoke execute on function public.tienda_disponibles(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.tienda_recalcular_apartado(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.tienda_crear_pedido(uuid, uuid, text, text, text, jsonb, numeric, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.tienda_marcar_pago(bigint, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.tienda_expirar(uuid) from public, anon, authenticated;
grant execute on function public.tienda_disponibles(uuid, text[]) to service_role;
grant execute on function public.tienda_recalcular_apartado(uuid, text[]) to service_role;
grant execute on function public.tienda_crear_pedido(uuid, uuid, text, text, text, jsonb, numeric, jsonb, integer) to service_role;
grant execute on function public.tienda_marcar_pago(bigint, text, text, jsonb) to service_role;
grant execute on function public.tienda_expirar(uuid) to service_role;
