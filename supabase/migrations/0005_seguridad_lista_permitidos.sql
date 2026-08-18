-- ============================================================================
--  Cierre del registro abierto.
--
--  Hasta ahora cualquiera que encontrara la URL podía crear una cuenta. No
--  vería datos ajenos —RLS lo impide— pero podía entrar, conectar su propio
--  Mercado Libre y consumir el proyecto. En una herramienta interna eso no
--  tiene por qué ser posible.
--
--  La lista se aplica con un trigger sobre auth.users, no solo escondiendo el
--  botón: así tampoco se puede saltar pegándole directo a la API de Supabase.
-- ============================================================================

create table if not exists usuarios_permitidos (
  email        text primary key,
  nota         text,
  invitado_por text,
  creado_en    timestamptz not null default now()
);

alter table usuarios_permitidos enable row level security;

-- Solo quien ya está adentro puede ver o ampliar la lista.
drop policy if exists permitidos_lectura on usuarios_permitidos;
create policy permitidos_lectura on usuarios_permitidos
  for select using (
    exists (select 1 from auth.users u where u.id = auth.uid())
  );

drop policy if exists permitidos_escritura on usuarios_permitidos;
create policy permitidos_escritura on usuarios_permitidos
  for all using (
    exists (select 1 from auth.users u where u.id = auth.uid())
  ) with check (
    exists (select 1 from auth.users u where u.id = auth.uid())
  );

-- Los que ya existen quedan autorizados: cerrar la puerta no debe dejar
-- fuera a quien ya estaba adentro.
insert into usuarios_permitidos (email, nota)
select email, 'Cuenta existente al cerrar el registro'
from auth.users
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
create or replace function verificar_correo_permitido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from usuarios_permitidos
    where lower(email) = lower(new.email)
  ) then
    raise exception 'Este correo no está autorizado para usar el sistema.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists solo_correos_permitidos on auth.users;
create trigger solo_correos_permitidos
  before insert on auth.users
  for each row execute function verificar_correo_permitido();
