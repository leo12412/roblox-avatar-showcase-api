# Avatar Showcase - API intermediaria

Necesitas Node.js 20 o superior. No requiere instalar paquetes ni configurar una base de datos.

1. Abre la carpeta en Visual Studio Code.
2. Abre **Terminal > New Terminal**.
3. Ejecuta `node server.js` (o `npm start`).
4. Visita `http://127.0.0.1:3000/health`.
5. Prueba `http://127.0.0.1:3000/api/outfits/156` (156 es un UserId de ejemplo, no un username). Puedes sustituirlo por cualquier UserId existente.

La API devuelve `{ userId, count, outfits: [{id,name}], complete }`.

**Importante:** el servidor corre en tu computadora. Roblox no podrá acceder a `127.0.0.1` dentro de un juego publicado. Para conectarlo, se necesita una URL HTTPS pública en un servicio de alojamiento (p. ej., Render o Railway) y activar HTTP Requests en Roblox Studio. **No abras puertos de tu router ni coloques cookies `.ROBLOSECURITY` en el proyecto.**

Si Roblox cambia el formato de paginación del endpoint, puede requerirse una actualización. El campo `complete` ayuda a detectarlo; un `count: 0` no demuestra que el usuario no tenga atuendos privados.

## Despliegue en Render
1. Sube `server.js` y `package.json` a un repositorio GitHub (sin secretos).
2. En Render crea **New > Web Service**, conecta el repositorio.
3. Runtime: **Node**; Build Command: `npm install`; Start Command: `npm start`.
4. La aplicacion escucha en `process.env.PORT` y en `0.0.0.0`.
5. Comprueba `https://TU-DOMINIO.onrender.com/health` y `/api/outfits/USERID`.
6. Copia la URL base HTTPS (sin `/health`) al atributo `AvatarShowcaseApiUrl` en Workspace > AvatarShowcase en Roblox Studio.

Nota: la disponibilidad de planes y sus limites dependen de Render. En alojamiento gratuito el servicio puede dormir y tardar en despertar.
