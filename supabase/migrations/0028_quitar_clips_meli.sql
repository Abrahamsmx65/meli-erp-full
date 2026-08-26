-- Fuera la tabla de clips: MELI NO expone los clips por API para vendedores
-- locales (verificado en agosto 2026 sondeando 10 rutas contra una
-- publicación que SÍ tiene clip — nada contesta, y la ruta de Global
-- Selling se la niega el PolicyAgent a la app). Sin API, la sección y su
-- espejo local no sirven de nada; el intento completo vive en el historial
-- de git por si MELI publica el recurso algún día.

drop table if exists clips_meli;
