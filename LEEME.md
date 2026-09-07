# Canastón

## Un solo móvil

Abre `canaston.html`. No necesita nada más.

## Online

    npm install
    node servidor.js

Abre `http://localhost:8080`, crea una sala y comparte el enlace que aparece.
Quien lo abra entra directamente en tu partida.

## Subirlo a Railway

Ya está todo configurado: `package.json` con el arranque, `railway.json` con el
comando, y el puerto se lee de `PORT`.

1. Sube esta carpeta a un repositorio de GitHub.
2. En railway.app: **New Project → Deploy from GitHub repo** y elige el repo.
3. Cuando termine, en **Settings → Networking** pulsa **Generate Domain**.

Eso da una dirección tipo `canaston-production.up.railway.app`. Esa es la que
compartes. Los enlaces de invitación se construyen solos a partir de ella.

No hay variables de entorno que configurar ni base de datos que enchufar. Las
partidas viven en memoria, así que si Railway reinicia el servicio se pierden
las que estén en curso.

Render y Fly funcionan igual con estos mismos archivos.

## Archivos

- `motor.js` — las reglas. No sabe nada de pantallas. Lo usan el servidor y el cliente.
- `servidor.js` — salas, turnos y reparto.
- `sala.html` — el cliente online.
- `canaston.html` — la versión de un dispositivo, con su copia de las reglas.

## Por qué manda el servidor

Si cada móvil tuviera la partida entera, cualquiera podría abrir las
herramientas del navegador y leer la mano del rival y el orden del taco.
El servidor manda a cada uno una vista recortada: tu mano completa y, de los
demás, solo cuántas cartas tienen. Del taco, solo cuántas quedan. Del pozo, la
carta de arriba y los monos cruzados, que es lo que se ve en una mesa real.

Las acciones se validan ahí: el asiento sale de la conexión, nunca de lo que
diga el cliente, así que no se puede jugar en el turno de otro.

## Si se cae la conexión

Cada jugador guarda una ficha de su asiento en el navegador. Al volver a entrar
recupera su sitio con sus cartas. La partida espera.
