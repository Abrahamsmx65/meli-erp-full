# Boletos para eventos

Sistema independiente (no comparte tablas ni código con el ERP) para vender
boletos de un evento pagando por transferencia bancaria:

1. La persona entra, elige el evento, pone nombre, correo, teléfono y cuántos
   boletos quiere. El sistema le da una **referencia** (`EV-XXXXXX`) y los
   datos para transferir, por pantalla y por correo.
2. Cuando transfiere, entra a su pedido y avisa "ya pagué" (puede subir el
   comprobante).
3. El organizador ve en `/admin` quién pidió, quién avisó y quién ya pagó, con
   nombre, correo, teléfono, comprobante y notas. Con un clic **confirma el
   pago**: se emiten los boletos y se mandan por correo, cada uno con su QR.
4. El día del evento abre `/admin/escanear` en el celular: la cámara lee el QR,
   la pantalla se pone verde (pasa) o roja (no pasa) y el boleto queda marcado
   como usado. Nadie entra dos veces con el mismo QR.

## Stack

Next.js 15 (App Router) · React 19 · Tailwind v4 · Supabase (Postgres + Auth +
Storage) · Resend (correo) · `qrcode` / `html5-qrcode` · vitest.

```
npm install
npm run dev        # http://localhost:3000
npm test           # pruebas
npm run typecheck  # tipos
npm run build
```

## Puesta en marcha

### 1. Base de datos

Proyecto de Supabase **`boletos-eventos`** (`dggekhkkcbhpizrriwmi`, aparte del
ERP). Las migraciones de `supabase/migrations/` **ya están aplicadas**; si
agregas una, aplícala y guárdala numerada. Todas las tablas y funciones llevan
prefijo `ev_` y el bucket se llama `ev-comprobantes`.

### 2. Administrador

El registro está **cerrado** con un trigger sobre `auth.users`: solo puede
tener cuenta un correo que esté antes en `ev_administradores`, y solo esos
correos entran al panel. Para dar acceso a alguien más:

```sql
insert into ev_administradores (correo, nombre) values ('otro@correo.com', 'Su nombre');
```

y luego crea su usuario en Supabase → Authentication → Users → *Add user*.
Cada quien cambia su contraseña en `/admin/cuenta`.

### 3. Variables de entorno

Copia `.env.example` a `.env.local` (o a las variables del proyecto en Vercel):

| Variable | Qué es |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Del proyecto de Supabase (Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | Llave de servicio. **Nunca** al navegador |
| `NEXT_PUBLIC_URL_BASE` | URL pública del sitio; va dentro de cada QR y en los correos |
| `RESEND_API_KEY`, `CORREO_REMITENTE` | Cuenta de [Resend](https://resend.com) con dominio verificado |
| `CORREO_ORGANIZADOR` | Opcional: copia oculta de cada pedido nuevo |

Sin Resend el sistema funciona igual (los boletos se ven en su página y desde
el panel se puede copiar el enlace), solo no manda correos.

### 4. Despliegue en Vercel

Proyecto nuevo apuntando a este repositorio con **Root Directory = `boletos`**.
Framework Next.js, sin más ajustes. La cámara del escáner exige HTTPS, que
Vercel da por omisión.

### 5. Primer evento

Entra a `/admin/eventos` → *Nuevo evento*: nombre, fecha, precio, capacidad y
los **datos para transferir** (banco, CLABE, beneficiario) tal como quieres
que los vea el comprador. Comparte el enlace `/evento/{id}` o la página
principal `/`, que lista los eventos con venta abierta.

## Cómo está armado

```
src/app/                    página principal (eventos abiertos)
src/app/evento/[id]         formulario de compra
src/app/pedido/[id]         estado del pedido, datos de transferencia, "ya pagué"
src/app/boleto/[codigo]     el boleto con su QR (lo que abre el QR)
src/app/api/qr/[codigo]     PNG del QR (lo carga el correo)
src/app/login               entrada del organizador
src/app/admin               pedidos (filtros, cifras) · pedidos/[id] detalle y acciones
src/app/admin/asistentes    boletos emitidos, quién entró, últimos escaneos
src/app/admin/eventos       alta y edición de eventos
src/app/admin/escanear      escáner con la cámara del celular
src/lib/pedidos.ts          crear pedido, avisar pago, confirmar, emitir y enviar boletos
src/lib/boletos.ts          escaneo (ev_usar_boleto), consulta, deshacer entrada
src/lib/codigos.ts          referencia, código del boleto, lectura del QR (puro, con pruebas)
src/lib/correo.ts           Resend por fetch + plantilla
supabase/migrations/        esquema completo
```

### Decisiones

- **Seguridad por llave, no por sesión, en el lado público.** Todas las tablas
  `ev_` tienen RLS con cero políticas: solo el servidor las lee con
  `service_role`. El pedido se abre con su `id` (UUID aleatorio) y el boleto
  con su `codigo` (20 caracteres de un alfabeto sin 0/O/1/I/L, ~99 bits). Quien
  tiene el enlace tiene el boleto, igual que un boleto de papel.
- **La capacidad la cuida la base** (`ev_crear_pedido` bloquea el evento y
  suma lo pedido) y **el escaneo es atómico** (`ev_usar_boleto` con
  `for update`): dos celulares escaneando el mismo QR a la vez no dejan pasar
  a dos personas.
- **Todo pedido no cancelado ocupa lugar**, incluso sin pagar. Si alguien
  aparta y no paga, el organizador lo cancela desde el panel y el lugar se
  libera. Un pedido cancelado se puede reactivar.
- **El QR contiene la URL del boleto**, así cualquier cámara lo abre y el
  escáner del panel extrae el código de la URL o del código pelón.
- **Reenviar boletos** y **deshacer una entrada** (escaneo por error) están a
  un clic en el panel.
