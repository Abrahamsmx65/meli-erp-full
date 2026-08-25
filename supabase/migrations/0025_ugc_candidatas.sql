-- UGC con control de calidad manual: Soul genera 4 imágenes candidatas de la
-- persona con el producto y el video NO se anima hasta que el usuario elige
-- en cuál salió fiel el producto (estado nuevo 'eligiendo'). Así el crédito
-- caro —la animación— solo se gasta sobre una imagen aprobada.

alter table videos_producto
  add column if not exists imagenes_candidatas jsonb;
