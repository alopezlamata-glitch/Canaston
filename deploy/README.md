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

## 4. Actualizar tras un cambio en el código

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
