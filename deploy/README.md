# Desplegar Canastón en Oracle Cloud (Always Free)

Servidor real, gratis para siempre, que no se duerme. A cambio hay que
montarlo a mano una vez: crear la cuenta, la máquina, y correr un script.
Después de eso, actualizar es un solo comando.

## 1. Cuenta y máquina en Oracle Cloud

1. Entra en **oracle.com/cloud/free** y crea una cuenta. Pide tarjeta para
   verificar tu identidad — no cobra nada mientras te quedes dentro del
   tier "Always Free".
2. En la consola, ve a **Compute → Instances → Create instance**.
3. En "Image and shape":
   - Imagen: **Ubuntu** (la versión LTS más reciente que ofrezca).
   - Shape: pulsa "Change shape" y elige uno que diga **"Always Free
     eligible"**. El más sencillo es `VM.Standard.E2.1.Micro` (AMD, 1
     OCPU, 1 GB RAM) — de sobra para este juego. Si quieres más potencia
     y tu región tiene hueco, `VM.Standard.A1.Flex` (ARM) da hasta 4
     OCPU y 24 GB gratis, pero a veces Oracle no tiene capacidad libre
     y falla la creación; si eso pasa, usa el Micro.
4. En "Add SSH keys": deja que Oracle genere el par de claves y
   **descarga la clave privada** (el archivo `.key`), o pega tu propia
   clave pública si ya tienes una (`~/.ssh/id_ed25519.pub`).
5. Crea la instancia y anota la **IP pública** que le asigna.
6. Abre los puertos: en la consola, entra en la VCN de la instancia
   (**Networking → Virtual Cloud Networks**, la que se creó junto con
   la VM) → **Security Lists** → la lista por defecto → **Add Ingress
   Rules**. Añade dos reglas, origen `0.0.0.0/0`:
   - TCP, puerto destino **80**
   - TCP, puerto destino **443**
   (el 22 para SSH ya viene abierto por defecto).

## 2. Dominio gratis con DuckDNS

1. Entra en **duckdns.org** y accede con Google/GitHub.
2. Crea un subdominio, por ejemplo `canaston` → te da
   `canaston.duckdns.org`.
3. En el campo IP, pon la IP pública de tu VM (la del paso anterior) y
   pulsa "update ip".

## 3. Instalar el juego en la VM

Conéctate por SSH (cambia la ruta de la clave y la IP por las tuyas):

```bash
chmod 600 la-clave-que-descargaste.key
ssh -i la-clave-que-descargaste.key ubuntu@TU_IP_PUBLICA
```

Ya dentro de la VM:

```bash
curl -fsSL https://raw.githubusercontent.com/alopezlamata-glitch/Canaston/claude/zip-github-canaston-j73r4t/deploy/instalar.sh -o instalar.sh
chmod +x instalar.sh
./instalar.sh canaston.duckdns.org tu-email@ejemplo.com
```

(Cambia `canaston.duckdns.org` por el subdominio que hayas elegido, y
pon un email de verdad — certbot lo usa solo para avisarte si el
certificado fuera a caducar sin renovarse.)

El script instala Node, nginx y certbot, clona el proyecto en
`/opt/canaston`, pide el certificado HTTPS, y deja el juego corriendo
como servicio del sistema — arranca solo si la VM se reinicia, y se
recupera solo si el proceso se cae.

Al terminar, `https://canaston.duckdns.org` debería estar sirviendo el
juego. Pruébalo desde el móvil y añádelo a la pantalla de inicio.

## 4. Conseguir el shape gratis A1.Flex (ARM, 4 OCPU / 24GB) si te da "Out of capacity"

Si al crear la instancia Oracle dice que no hay capacidad para
`VM.Standard.A1.Flex`, no es un error tuyo: esa región se ha quedado sin
hueco de ese hardware y se libera de forma intermitente (a veces tarda
horas, a veces días). La forma de conseguirlo sin estar reintentando a
mano es dejar un script pidiéndolo cada minuto hasta que entre.

1. Abre **Cloud Shell** en la consola de Oracle (el icono `>_` arriba a
   la derecha) — ya viene con la OCI CLI autenticada, sin configurar nada.
2. Consigue los dos datos que pide el script:
   - **Compartment**: en la consola, icono de perfil (arriba a la
     derecha) → "Tenancy: ..." → copia el OCID (empieza por
     `ocid1.tenancy...`).
   - **Subnet**: la misma que usa tu VM actual. En Cloud Shell:
     ```bash
     # lista tus instancias y sus OCID
     oci compute instance list --compartment-id "TU_TENANCY_OCID" \
       --query "data[].{nombre:\"display-name\",id:id}"
     # con el id de tu VM de pago, saca su subred
     oci compute instance list-vnics --compartment-id "TU_TENANCY_OCID" \
       --instance-id "OCID_DE_TU_VM" --query "data[0].\"subnet-id\""
     ```
3. Sube o clona este repo en Cloud Shell y edita
   `deploy/conseguir_always_free.sh` rellenando `COMPARTMENT_ID` y
   `SUBNET_ID` con lo que has sacado arriba.
4. Ejecútalo dentro de una sesión `tmux` para que sobreviva si Cloud
   Shell te desconecta por inactividad:
   ```bash
   tmux new -s freevm
   chmod +x deploy/conseguir_always_free.sh
   ./deploy/conseguir_always_free.sh
   ```
   Sal sin matarlo con `Ctrl+B` y luego `D`. Para volver a mirarlo:
   `tmux attach -t freevm`.
5. En cuanto Oracle acepte la petición, el script para solo y te dice
   dónde ver la instancia nueva. A partir de ahí, sigue igual que en el
   paso 3 de este README (SSH + `instalar.sh`) para instalar el juego
   en la máquina gratis, actualiza la IP en DuckDNS, comprueba que
   funciona, y ya puedes terminar la VM de pago.

## 5. Actualizar tras un cambio en el código

Cada vez que haya cambios nuevos en la rama:

```bash
ssh -i la-clave.key ubuntu@TU_IP_PUBLICA
cd /opt/canaston
./deploy/actualizar.sh
```

## Comandos útiles

```bash
sudo systemctl status canaston     # ¿está corriendo?
sudo journalctl -u canaston -f     # logs en vivo
sudo systemctl restart canaston    # reiniciar a mano
```

## Por qué hace falta HTTPS de verdad (no solo abrir el puerto 8080)

La app es una PWA: el "Añadir a pantalla de inicio" y el service worker
que la hace instalable solo funcionan sobre HTTPS. Por eso el script
usa nginx + certbot en vez de exponer `servidor.js` directamente.
