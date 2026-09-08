#!/usr/bin/env bash
# ============================================================================
#  Despliegue a Vercel en un comando.
#
#  Uso:  bash desplegar.sh
#
#  Te va a pedir tres datos de Mercado Libre y la service_role de Supabase.
#  Todo lo demás ya viene resuelto.
# ============================================================================
set -euo pipefail

azul()  { printf "\033[1;34m%s\033[0m\n" "$1"; }
verde() { printf "\033[1;32m%s\033[0m\n" "$1"; }
rojo()  { printf "\033[1;31m%s\033[0m\n" "$1"; }

command -v node >/dev/null || { rojo "Necesitas Node.js instalado: https://nodejs.org"; exit 1; }

azul "== 1/5 · Instalando dependencias =="
npm install --no-audit --no-fund

azul "== 2/5 · Verificando que todo compile =="
npm run build

azul "== 3/5 · Conectando con Vercel =="
echo "Si te pide iniciar sesión, ábrelo en el navegador y autoriza."
npx --yes vercel@latest link --yes

azul "== 4/5 · Capturando los secretos =="
echo
echo "Estos cuatro valores son los únicos que no pude conseguir yo."
echo

pedir() {                      # nombre, descripción, ¿silencioso?
  local var="$1" desc="$2" secreto="${3:-no}" valor=""
  echo "  $desc"
  if [ "$secreto" = "si" ]; then read -rsp "  $var: " valor; echo; else read -rp "  $var: " valor; fi
  echo
  [ -z "$valor" ] && { rojo "  Vacío. Lo puedes agregar después con: npx vercel env add $var production"; return; }
  printf '%s' "$valor" | npx --yes vercel@latest env add "$var" production --force >/dev/null 2>&1 || true
  printf '%s' "$valor" | npx --yes vercel@latest env add "$var" preview    --force >/dev/null 2>&1 || true
}

pedir SUPABASE_SERVICE_ROLE_KEY \
  "Supabase → Project Settings → API → service_role (la llave larga, NO la anon)" si

pedir MELI_CLIENT_ID \
  "Mercado Libre → developers.mercadolibre.com.mx/devcenter → tu app → Client ID"

pedir MELI_CLIENT_SECRET \
  "La misma pantalla → Client Secret" si

# Estos se generan o se derivan solos.
CRON=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
printf '%s' "$CRON" | npx --yes vercel@latest env add CRON_SECRET production --force >/dev/null 2>&1 || true
printf '%s' "MLM"   | npx --yes vercel@latest env add MELI_SITE_ID production --force >/dev/null 2>&1 || true

azul "== 5/5 · Publicando =="
URL=$(npx --yes vercel@latest --prod --yes | tail -1)

# La redirect URI y la URL pública solo se conocen hasta tener el dominio.
printf '%s' "$URL/api/meli/callback" | npx --yes vercel@latest env add MELI_REDIRECT_URI production --force >/dev/null 2>&1 || true
printf '%s' "$URL"                   | npx --yes vercel@latest env add NEXT_PUBLIC_APP_URL production --force >/dev/null 2>&1 || true

# Un redeploy final para que tome las variables que dependían del dominio.
npx --yes vercel@latest --prod --yes >/dev/null

echo
verde "================================================================"
verde " Listo: $URL"
verde "================================================================"
echo
echo "FALTA UN PASO, y es importante:"
echo
echo "  En developers.mercadolibre.com.mx/devcenter, en tu aplicación,"
echo "  pon esta Redirect URI EXACTA (si no coincide, MELI rechaza la conexión):"
echo
echo "      $URL/api/meli/callback"
echo
echo "Después entra a $URL, crea tu cuenta, y en Ajustes conecta Mercado Libre."
