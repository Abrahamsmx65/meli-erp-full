-- Tipos de boleto con precio propio (Kit de Jalá $350, Acompañante $150),
-- donativo opcional (Misheberaj) y datos extra del evento para la portada.
-- Lugares NO asignados: el límite es de cuántos boletos hay en total (y,
-- opcionalmente, por tipo).

alter table ev_eventos
  add column if not exists imagen_url           text,
  add column if not exists informes             text,
  add column if not exists donativo_nombre      text,
  add column if not exists donativo_monto       numeric(10,2) check (donativo_monto is null or donativo_monto > 0),
  add column if not exists donativo_descripcion text;

create table if not exists ev_tipos_boleto (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references ev_eventos(id) on delete cascade,
  nombre      text not null,
  descripcion text,
  precio      numeric(10,2) not null check (precio >= 0),
  -- null = solo lo limita la capacidad total del evento
  limite      integer check (limite is null or limite > 0),
  orden       integer not null default 0,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);
create index if not exists ev_tipos_boleto_evento on ev_tipos_boleto (evento_id, orden);
alter table ev_tipos_boleto enable row level security;

-- Qué pidió cada quien, por tipo.
create table if not exists ev_pedido_renglones (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references ev_pedidos(id) on delete cascade,
  tipo_id         uuid not null references ev_tipos_boleto(id) on delete restrict,
  cantidad        integer not null check (cantidad > 0),
  precio_unitario numeric(10,2) not null check (precio_unitario >= 0)
);
create index if not exists ev_pedido_renglones_pedido on ev_pedido_renglones (pedido_id);
create index if not exists ev_pedido_renglones_tipo on ev_pedido_renglones (tipo_id);
alter table ev_pedido_renglones enable row level security;

-- Un pedido puede ser solo donativo (sin boletos): cantidad >= 0.
alter table ev_pedidos drop constraint if exists ev_pedidos_cantidad_check;
alter table ev_pedidos add constraint ev_pedidos_cantidad_check check (cantidad >= 0);
alter table ev_pedidos add column if not exists donativos integer not null default 0 check (donativos >= 0);

alter table ev_boletos add column if not exists tipo_id uuid references ev_tipos_boleto(id) on delete restrict;

-- Crear pedido: renglones [{tipo_id, cantidad}] + donativos. La base calcula
-- el total con los precios vigentes y cuida la capacidad total y por tipo,
-- bloqueando el evento para que no haya carreras.
drop function if exists ev_crear_pedido(uuid, text, text, text, text, integer);
create or replace function ev_crear_pedido(
  p_evento     uuid,
  p_referencia text,
  p_nombre     text,
  p_correo     text,
  p_telefono   text,
  p_renglones  jsonb,
  p_donativos  integer
) returns ev_pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evento    ev_eventos%rowtype;
  v_tipo      ev_tipos_boleto%rowtype;
  v_renglon   record;
  v_ocupados  integer;
  v_del_tipo  integer;
  v_cantidad  integer := 0;
  v_total     numeric(10,2) := 0;
  v_pedido    ev_pedidos%rowtype;
begin
  select * into v_evento from ev_eventos where id = p_evento for update;
  if not found then
    raise exception 'EVENTO_NO_EXISTE';
  end if;
  if not v_evento.activo then
    raise exception 'EVENTO_INACTIVO';
  end if;
  if p_donativos < 0 or (p_donativos > 0 and v_evento.donativo_monto is null) then
    raise exception 'CANTIDAD_INVALIDA';
  end if;

  -- Primero se valida y se suma todo; se inserta hasta el final.
  for v_renglon in
    select (r->>'tipo_id')::uuid as tipo_id, (r->>'cantidad')::integer as cantidad
      from jsonb_array_elements(coalesce(p_renglones, '[]'::jsonb)) r
  loop
    if v_renglon.cantidad is null or v_renglon.cantidad < 0 then
      raise exception 'CANTIDAD_INVALIDA';
    end if;
    continue when v_renglon.cantidad = 0;

    select * into v_tipo from ev_tipos_boleto
     where id = v_renglon.tipo_id and evento_id = p_evento and activo;
    if not found then
      raise exception 'TIPO_NO_EXISTE';
    end if;

    if v_tipo.limite is not null then
      select coalesce(sum(r.cantidad), 0) into v_del_tipo
        from ev_pedido_renglones r
        join ev_pedidos p on p.id = r.pedido_id
       where r.tipo_id = v_tipo.id and p.estado <> 'cancelado';
      if v_del_tipo + v_renglon.cantidad > v_tipo.limite then
        raise exception 'SIN_LUGARES_TIPO:%', v_tipo.nombre;
      end if;
    end if;

    v_cantidad := v_cantidad + v_renglon.cantidad;
    v_total := v_total + v_tipo.precio * v_renglon.cantidad;
  end loop;

  if v_cantidad = 0 and p_donativos = 0 then
    raise exception 'CANTIDAD_INVALIDA';
  end if;
  if v_cantidad > v_evento.maximo_por_pedido then
    raise exception 'CANTIDAD_INVALIDA';
  end if;

  select coalesce(sum(cantidad), 0) into v_ocupados
    from ev_pedidos
   where evento_id = p_evento and estado <> 'cancelado';
  if v_ocupados + v_cantidad > v_evento.capacidad then
    raise exception 'SIN_LUGARES';
  end if;

  v_total := v_total + coalesce(v_evento.donativo_monto, 0) * p_donativos;

  insert into ev_pedidos (evento_id, referencia, nombre, correo, telefono, cantidad, total, donativos)
  values (p_evento, p_referencia, p_nombre, p_correo, p_telefono, v_cantidad, round(v_total, 2), p_donativos)
  returning * into v_pedido;

  insert into ev_pedido_renglones (pedido_id, tipo_id, cantidad, precio_unitario)
  select v_pedido.id, t.id, (r->>'cantidad')::integer, t.precio
    from jsonb_array_elements(coalesce(p_renglones, '[]'::jsonb)) r
    join ev_tipos_boleto t on t.id = (r->>'tipo_id')::uuid
   where (r->>'cantidad')::integer > 0;

  return v_pedido;
end;
$$;

revoke all on function ev_crear_pedido(uuid, text, text, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function ev_crear_pedido(uuid, text, text, text, text, jsonb, integer) to service_role;

-- El escaneo ahora dice también el TIPO de boleto (en la puerta importa
-- quién lleva kit y quién es acompañante).
drop function if exists ev_usar_boleto(text, text);
create or replace function ev_usar_boleto(p_codigo text, p_usuario text)
returns table (
  resultado   text,
  boleto_id   uuid,
  folio       bigint,
  nombre      text,
  correo      text,
  cantidad    integer,
  evento      text,
  tipo        text,
  usado_en    timestamptz,
  usado_por   text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_boleto  ev_boletos%rowtype;
  v_pedido  ev_pedidos%rowtype;
  v_evento  ev_eventos%rowtype;
  v_tipo    text;
  v_res     text;
begin
  select * into v_boleto from ev_boletos where codigo = p_codigo for update;
  if not found then
    insert into ev_escaneos (codigo, resultado, usuario) values (p_codigo, 'no_existe', p_usuario);
    return query select 'no_existe'::text, null::uuid, null::bigint, null::text, null::text,
                        null::integer, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;

  select * into v_pedido from ev_pedidos where id = v_boleto.pedido_id;
  select * into v_evento from ev_eventos where id = v_boleto.evento_id;
  select t.nombre into v_tipo from ev_tipos_boleto t where t.id = v_boleto.tipo_id;

  if v_boleto.estado = 'cancelado' or v_pedido.estado = 'cancelado' then
    v_res := 'cancelado';
  elsif v_pedido.estado <> 'pagado' then
    v_res := 'no_pagado';
  elsif v_boleto.estado = 'usado' then
    v_res := 'ya_usado';
  else
    update ev_boletos
       set estado = 'usado', usado_en = now(), usado_por = p_usuario
     where id = v_boleto.id
     returning * into v_boleto;
    v_res := 'ok';
  end if;

  insert into ev_escaneos (boleto_id, codigo, resultado, usuario)
  values (v_boleto.id, p_codigo, v_res, p_usuario);

  return query select v_res, v_boleto.id, v_boleto.folio, v_pedido.nombre, v_pedido.correo,
                      v_pedido.cantidad, v_evento.nombre, v_tipo, v_boleto.usado_en, v_boleto.usado_por;
end;
$$;

revoke all on function ev_usar_boleto(text, text) from public, anon, authenticated;
grant execute on function ev_usar_boleto(text, text) to service_role;
