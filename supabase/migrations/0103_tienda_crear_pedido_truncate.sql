-- ============================================================================
--  tienda_crear_pedido: TRUNCATE en vez de DELETE sin WHERE.
--  Por la API (PostgREST) Supabase carga pg_safeupdate, que rechaza un
--  DELETE sin WHERE («DELETE requires a WHERE clause»): el primer pago real
--  de la tienda contestó 400 y la página dijo «No se pudo crear el pedido».
--  En el SQL directo no se nota porque ahí la extensión no está cargada.
-- ============================================================================
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
  -- TRUNCATE y no DELETE: Supabase (pg_safeupdate) rechaza por la API un
  -- DELETE sin WHERE, y así tronaba el pago con 400 (1-oct-2026).
  truncate _tienda_items;

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
