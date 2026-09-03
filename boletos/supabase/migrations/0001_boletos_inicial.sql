-- Sistema de boletos para eventos: pago por transferencia, boleto con QR y
-- escáner. Todas las tablas llevan prefijo ev_ para poder convivir en una
-- base compartida sin chocar con nada.
--
-- Seguridad: TODAS las tablas tienen RLS con CERO políticas. Nadie las lee
-- desde el navegador; el servidor las alcanza con service_role después de
-- validar la sesión del administrador (ev_administradores) o el código del
-- boleto / id del pedido, que son las únicas "llaves" públicas.

create extension if not exists pgcrypto;

-- Quién puede entrar al panel. Inserta el correo del organizador aquí y
-- da de alta al mismo correo en Authentication → Users de Supabase.
create table if not exists ev_administradores (
  correo      text primary key,
  nombre      text,
  creado_en   timestamptz not null default now()
);

create table if not exists ev_eventos (
  id                    uuid primary key default gen_random_uuid(),
  nombre                text not null,
  descripcion           text,
  lugar                 text,
  fecha                 timestamptz not null,
  precio                numeric(10,2) not null check (precio >= 0),
  capacidad             integer not null check (capacidad > 0),
  maximo_por_pedido     integer not null default 10 check (maximo_por_pedido > 0),
  -- Instrucciones que ve el comprador para transferir: banco, CLABE,
  -- beneficiario. Texto libre, se muestra tal cual.
  datos_transferencia   text not null default '',
  activo                boolean not null default true,
  creado_en             timestamptz not null default now()
);

-- Un pedido = una persona pide N boletos y promete transferir.
--   pendiente      → se creó, esperamos la transferencia
--   por_confirmar  → el comprador avisó "ya pagué" (con o sin comprobante)
--   pagado         → el organizador confirmó; los boletos ya existen y se enviaron
--   cancelado      → no se pagó o se dio de baja
create table if not exists ev_pedidos (
  id               uuid primary key default gen_random_uuid(),
  evento_id        uuid not null references ev_eventos(id) on delete restrict,
  -- Clave corta que el comprador pone como concepto en la transferencia.
  referencia       text not null unique,
  nombre           text not null,
  correo           text not null,
  telefono         text,
  cantidad         integer not null check (cantidad > 0),
  total            numeric(10,2) not null check (total >= 0),
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','por_confirmar','pagado','cancelado')),
  comprobante_ruta text,
  aviso_pago_en    timestamptz,
  pagado_en        timestamptz,
  confirmado_por   text,
  cancelado_en     timestamptz,
  notas            text,
  correo_enviado_en timestamptz,
  creado_en        timestamptz not null default now()
);
create index if not exists ev_pedidos_evento_estado on ev_pedidos (evento_id, estado);
create index if not exists ev_pedidos_correo on ev_pedidos (lower(correo));

-- Un boleto por persona que entra. El código va dentro del QR.
create table if not exists ev_boletos (
  id          uuid primary key default gen_random_uuid(),
  folio       bigserial unique,
  pedido_id   uuid not null references ev_pedidos(id) on delete cascade,
  evento_id   uuid not null references ev_eventos(id) on delete restrict,
  codigo      text not null unique,
  estado      text not null default 'valido'
              check (estado in ('valido','usado','cancelado')),
  usado_en    timestamptz,
  usado_por   text,
  creado_en   timestamptz not null default now()
);
create index if not exists ev_boletos_pedido on ev_boletos (pedido_id);
create index if not exists ev_boletos_evento_estado on ev_boletos (evento_id, estado);

-- Bitácora de cada escaneo en la puerta, bueno o malo.
create table if not exists ev_escaneos (
  id          bigserial primary key,
  boleto_id   uuid references ev_boletos(id) on delete set null,
  codigo      text not null,
  resultado   text not null
              check (resultado in ('ok','ya_usado','no_existe','cancelado','no_pagado')),
  usuario     text,
  creado_en   timestamptz not null default now()
);
create index if not exists ev_escaneos_creado on ev_escaneos (creado_en desc);

alter table ev_administradores enable row level security;
alter table ev_eventos          enable row level security;
alter table ev_pedidos          enable row level security;
alter table ev_boletos          enable row level security;
alter table ev_escaneos         enable row level security;

-- Crear un pedido respetando la capacidad, sin carreras: bloquea el
-- renglón del evento, suma lo ya pedido (todo lo que no está cancelado
-- ocupa lugar) y solo entonces inserta.
create or replace function ev_crear_pedido(
  p_evento     uuid,
  p_referencia text,
  p_nombre     text,
  p_correo     text,
  p_telefono   text,
  p_cantidad   integer
) returns ev_pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evento    ev_eventos%rowtype;
  v_ocupados  integer;
  v_pedido    ev_pedidos%rowtype;
begin
  select * into v_evento from ev_eventos where id = p_evento for update;
  if not found then
    raise exception 'EVENTO_NO_EXISTE';
  end if;
  if not v_evento.activo then
    raise exception 'EVENTO_INACTIVO';
  end if;
  if p_cantidad < 1 or p_cantidad > v_evento.maximo_por_pedido then
    raise exception 'CANTIDAD_INVALIDA';
  end if;

  select coalesce(sum(cantidad), 0) into v_ocupados
    from ev_pedidos
   where evento_id = p_evento and estado <> 'cancelado';

  if v_ocupados + p_cantidad > v_evento.capacidad then
    raise exception 'SIN_LUGARES';
  end if;

  insert into ev_pedidos (evento_id, referencia, nombre, correo, telefono, cantidad, total)
  values (p_evento, p_referencia, p_nombre, p_correo, p_telefono, p_cantidad,
          round(v_evento.precio * p_cantidad, 2))
  returning * into v_pedido;

  return v_pedido;
end;
$$;

-- Solo el servidor (service_role) puede llamarla.
revoke all on function ev_crear_pedido(uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function ev_crear_pedido(uuid, text, text, text, text, integer) to service_role;

-- Marcar un boleto como usado en la puerta, de forma atómica: si dos
-- celulares escanean el mismo QR al mismo tiempo, solo uno gana.
create or replace function ev_usar_boleto(p_codigo text, p_usuario text)
returns table (
  resultado   text,
  boleto_id   uuid,
  folio       bigint,
  nombre      text,
  correo      text,
  cantidad    integer,
  evento      text,
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
  v_res     text;
begin
  select * into v_boleto from ev_boletos where codigo = p_codigo for update;
  if not found then
    insert into ev_escaneos (codigo, resultado, usuario) values (p_codigo, 'no_existe', p_usuario);
    return query select 'no_existe'::text, null::uuid, null::bigint, null::text, null::text,
                        null::integer, null::text, null::timestamptz, null::text;
    return;
  end if;

  select * into v_pedido from ev_pedidos where id = v_boleto.pedido_id;
  select * into v_evento from ev_eventos where id = v_boleto.evento_id;

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
                      v_pedido.cantidad, v_evento.nombre, v_boleto.usado_en, v_boleto.usado_por;
end;
$$;

revoke all on function ev_usar_boleto(text, text) from public, anon, authenticated;
grant execute on function ev_usar_boleto(text, text) to service_role;

-- Comprobantes de transferencia (imagen o PDF). Bucket privado: se ven
-- con URL firmada desde el panel.
insert into storage.buckets (id, name, public)
values ('ev-comprobantes', 'ev-comprobantes', false)
on conflict (id) do nothing;
