// frontend/src/environments/environment.cloudflare.ts
export const environment = {
  production: false,

  // ✅ URL del backend vía Cloudflare Tunnel (SIN barra final + CON /api/v1)
  apiUrl: 'https://api.caracasportafolio.com/api/v1',

  // ⚠️ Quick Tunnels no soportan WebSocket nativamente
  wsUrl: null,

  // ✅ Mismo VAPID key
  vapidPublicKey: 'BPBpXPQWKpcW2ISLcelyg1cOi10sXvMbOks3f7ZtE3uor8BzEXNT4xPchT-EXygPUL6KdIV3jcc8o9cLvcPdUH0'
};