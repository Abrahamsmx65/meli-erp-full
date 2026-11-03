-- La NUMERACIÓN del corte se congela al primer armado (dueño, 26-oct-2026:
-- en el corte #93 un pedido cancelado en TikTok después de imprimir corrió
-- un número a 180 paquetes y la estación ya no cuadraba con el papel; «ya
-- imprimí las etiquetas y todo, solo corrígelo en sistema»). pedido|paquete
-- → "#n", la que va en las guías y en las hojas. null = todavía no se arma
-- (o se unió una ronda y se renumera en el siguiente armado).
alter table tiktok_cortes
  add column if not exists numeracion jsonb;

comment on column tiktok_cortes.numeracion is
  'Numeración congelada del corte: {"orderId|packageId": n}. Nace en el primer cargarCorte y manda sobre el orden de hoy; se reinicia al unir una ronda (26-oct-2026).';
