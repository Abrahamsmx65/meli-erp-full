-- El reemplazo transaccional no necesita elevar privilegios: `existencias` y
-- `almacenes_activos` ya tienen RLS por cuenta. Ejecutarlo como el invocador
-- reduce el alcance del RPC y conserva el acceso del backend con service_role.
alter function public.reemplazar_existencias(uuid, text[], jsonb, boolean)
  security invoker;