#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Reintenta crear una instancia Always Free (VM.Standard.A1.Flex, 4
# OCPU / 24GB ARM) hasta que Oracle tenga hueco. Se ejecuta en Oracle
# Cloud Shell (ya tiene la OCI CLI autenticada con tu cuenta).
#
# Uso:
#   1. Rellena las tres variables de abajo (ver deploy/README.md para
#      cómo sacarlas).
#   2. En Cloud Shell:  tmux new -s freevm
#   3. chmod +x deploy/conseguir_always_free.sh
#      ./deploy/conseguir_always_free.sh
#   4. Sal del tmux sin matarlo con Ctrl+B y luego D. Puedes cerrar la
#      pestaña; para volver a mirar el progreso: tmux attach -t freevm
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

# ---- RELLENA ESTO (una sola vez) ----
COMPARTMENT_ID=""   # ocid1.tenancy.oc1.. (o el compartment donde está tu VM actual)
SUBNET_ID=""         # ocid1.subnet.oc1.eu-madrid-1.. (la misma subred que usa tu VM actual)
SSH_KEY_FILE="$HOME/.ssh/id_rsa.pub"   # tu clave pública; en Cloud Shell suele existir ya
# --------------------------------------

DISPLAY_NAME="canaston-free"
OCPUS=4
MEM_GB=24

if [ -z "$COMPARTMENT_ID" ] || [ -z "$SUBNET_ID" ]; then
  echo "Faltan COMPARTMENT_ID o SUBNET_ID: edita este script y rellénalos (ver deploy/README.md)."
  exit 1
fi

echo "Buscando una imagen de Ubuntu compatible con A1.Flex (ARM)..."
IMAGE_ID=$(oci compute image list \
  --compartment-id "$COMPARTMENT_ID" \
  --operating-system "Canonical Ubuntu" \
  --shape "VM.Standard.A1.Flex" \
  --sort-by TIMECREATED --sort-order DESC \
  --query "data[0].id" --raw-output 2>/dev/null)

if [ -z "$IMAGE_ID" ] || [ "$IMAGE_ID" == "null" ]; then
  echo "No se encontró imagen automáticamente. Búscala a mano:"
  echo "  oci compute image list --compartment-id \"$COMPARTMENT_ID\" --shape VM.Standard.A1.Flex --query \"data[].{nombre:\\\"display-name\\\",id:id}\""
  exit 1
fi
echo "Imagen encontrada: $IMAGE_ID"

ADS=$(oci iam availability-domain list --compartment-id "$COMPARTMENT_ID" \
  --query "data[].name" --raw-output 2>/dev/null | tr -d '[]"' | tr ',' ' ')
echo "Availability domains en tu región: $ADS"
echo

INTENTO=0
while true; do
  INTENTO=$((INTENTO+1))
  for AD in $ADS; do
    echo "[$(date '+%H:%M:%S')] intento $INTENTO en $AD..."
    if SALIDA=$(oci compute instance launch \
      --compartment-id "$COMPARTMENT_ID" \
      --availability-domain "$AD" \
      --shape "VM.Standard.A1.Flex" \
      --shape-config "{\"ocpus\": $OCPUS, \"memoryInGBs\": $MEM_GB}" \
      --subnet-id "$SUBNET_ID" \
      --image-id "$IMAGE_ID" \
      --display-name "$DISPLAY_NAME" \
      --ssh-authorized-keys-file "$SSH_KEY_FILE" \
      --assign-public-ip true 2>&1); then
      echo "$SALIDA"
      echo
      echo "✔ ¡Conseguida! Búscala en Consola → Compute → Instances → $DISPLAY_NAME"
      echo "  para ver su IP pública y seguir con deploy/README.md (instalar el juego)."
      exit 0
    fi
    if echo "$SALIDA" | grep -qi "capacity"; then
      echo "  sin hueco en $AD todavía..."
    else
      echo "ERROR distinto de 'sin capacidad', reviso y paro aquí:"
      echo "$SALIDA"
      exit 1
    fi
  done
  sleep 60
done
