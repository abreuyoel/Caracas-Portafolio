import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private api = environment.apiUrl;
  private headers() { return { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` }; }

  /** true = browser has permission + active subscription */
  granted$ = new BehaviorSubject<boolean>(false);
  loading  = false;

  constructor(private http: HttpClient) {
    this.refreshStatus();
  }

  async refreshStatus(): Promise<void> {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      this.granted$.next(false);
      return;
    }
    // Check both browser permission AND active push subscription
    if (Notification.permission !== 'granted') {
      this.granted$.next(false);
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      this.granted$.next(sub !== null);
    } catch {
      this.granted$.next(false);
    }
  }

  async subscribe(): Promise<{ ok: boolean; message: string }> {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      return { ok: false, message: 'Las notificaciones push no son compatibles con tu navegador.' };
    }
    this.loading = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this.loading = false;
        return { ok: false, message: 'Permiso denegado. Debes habilitarlo desde los ajustes del navegador.' };
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(environment.vapidPublicKey).buffer as ArrayBuffer,
      });

      const json: any = subscription.toJSON();
      await this.http.post(
        `${this.api}/alerts/push/subscribe`,
        { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth_key: json.keys.auth },
        { headers: this.headers() }
      ).toPromise();

      this.granted$.next(true);
      this.loading = false;
      return { ok: true, message: '✅ Notificaciones push activadas' };
    } catch (e: any) {
      this.loading = false;
      return { ok: false, message: `Error: ${e?.message || e}` };
    }
  }

  async unsubscribe(): Promise<{ ok: boolean; message: string }> {
    this.loading = true;
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      this.http.delete(`${this.api}/alerts/push/unsubscribe`, { headers: this.headers() }).subscribe();
      this.granted$.next(false);
      this.loading = false;
      // Note: browser permission stays "granted" — only the subscription is removed.
      return { ok: true, message: '🔕 Notificaciones push desactivadas. Si quieres bloquearlas completamente, ve a los ajustes del navegador.' };
    } catch (e: any) {
      this.loading = false;
      return { ok: false, message: `Error al desactivar: ${e?.message || e}` };
    }
  }

  async sendTest(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.http.post(`${this.api}/alerts/push/test`, {}, { headers: this.headers() }).toPromise();
      return { ok: true, message: '📨 Notificación de prueba enviada. Debería llegar en segundos.' };
    } catch (e: any) {
      return { ok: false, message: e?.error?.detail || 'Error enviando notificación de prueba.' };
    }
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }
}
