# Misión a Puerto

Prototipo cooperativo web de toma de decisiones. La partida se juega con seis personas, una por rol, y cada evento tiene un límite individual de 60 segundos.

## Ejecutar

Requisitos: Node.js 18 o superior.

```bash
npm install
npm start
```

Abre `http://localhost:8080` en el navegador. Para probar varias personas, usa seis pestañas o dispositivos conectados al mismo servidor y comparte el código de sala.

## Login de demostración

Por ahora todas las personas pueden entrar con:

- Usuario: `game@mail.com`
- Contraseña: `123456`

Después del login cada participante escribe el nombre que quiere mostrar, elige un avatar y entra a una sala. El servidor asigna un rol libre de forma aleatoria y no permite duplicados dentro de la misma sala.

## Reglas de tiempo

El contador de 60 segundos pertenece únicamente a la decisión actual. No es el tiempo general de la misión. Si una persona responde antes, su respuesta queda registrada; si no responde antes de que termine su contador, el servidor registra la decisión como no contestada y la partida continúa sin bloquearse.

## Avatares

Los avatares usan assets Noto Emoji servidos desde la CDN de Google Fonts. La galería de referencia es [Noto Emoji Animation](https://googlefonts.github.io/noto-emoji-animation/).

## Alcance

El login es una autenticación de demostración y no debe usarse con datos reales. Las salas y resultados viven en memoria y se pierden al reiniciar el proceso. Antes de un despliegue público hay que añadir sesiones persistentes, HTTPS/WSS, control de acceso y almacenamiento seguro.
