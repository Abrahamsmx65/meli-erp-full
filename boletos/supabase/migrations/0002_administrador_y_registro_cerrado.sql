-- El organizador. Solo los correos de esta tabla pueden entrar al panel.
insert into ev_administradores (correo, nombre)
values ('abrahamdarwish@hotmail.com', 'Abraham')
on conflict (correo) do nothing;

-- Registro cerrado: nadie puede crear cuenta (ni desde el formulario ni por
-- API) si su correo no está antes en ev_administradores. Mismo patrón que
-- usuarios_permitidos en el ERP.
create or replace function ev_solo_administradores()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from ev_administradores where lower(correo) = lower(new.email)) then
    raise exception 'Registro cerrado: el correo % no está autorizado.', new.email;
  end if;
  return new;
end;
$$;

drop trigger if exists ev_solo_administradores on auth.users;
create trigger ev_solo_administradores
  before insert on auth.users
  for each row execute function ev_solo_administradores();
