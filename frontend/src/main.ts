// frontend/src/main.ts
import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
// ✅ Importa SIEMPRE desde 'environment' (sin sufijo)
import { environment } from './environments/environment';

console.log('🌍 Environment:', environment.apiUrl); // Para debug

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));