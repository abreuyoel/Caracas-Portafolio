import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/** Full tick object from serverDataExt (Bolsa de Caracas) */
export interface MarketTick {
  COD_SIMB:       string;
  DESC_SIMB:      string;
  PRECIO:         number;   // último precio negociado
  PRECIO_APERT:   number;   // precio de apertura del día
  PRECIO_MAX:     number;   // máximo del día
  PRECIO_MIN:     number;   // mínimo del día
  VAR_ABS:        number;   // variación absoluta vs cierre anterior
  VAR_REL:        number;   // variación % vs cierre anterior
  VOLUMEN:        number;   // acciones negociadas hoy
  MONTO_EFECTIVO: number;   // monto efectivo en Bs
  TOT_OP_NEGOC:   number;   // número de operaciones
  VOL_CMP:        number;   // volumen en oferta de compra (bid)
  PRE_CMP:        number;   // precio oferta de compra (bid)
  PRE_VTA:        number;   // precio oferta de venta (ask)
  VOL_VTA:        number;   // volumen en oferta de venta (ask)
  HORA:           string;   // hora última operación HH:MM:SS
}

/** Resumen global del mercado */
export interface MarketResumen {
  num_tot_ope_negoc:    number;
  num_tot_acc_negoc:    number;
  num_tot_mont_negoc:   number;
  num_tit_alza:         number;
  num_tit_baja:         number;
  num_tit_est:          number;
  fe_fecha_resumen?:    string;
  num_tot_capitalizacion?: number;
}

@Injectable({
  providedIn: 'root'
})
export class BvcSocketService {
  private ws: WebSocket | null = null;
  private reconnectInterval = 5000;
  private isConnecting = false;

  // Global Observables for anywhere in the app
  public isConnected$ = new BehaviorSubject<boolean>(false);
  public marketStatus$ = new BehaviorSubject<{ P_SIT_MERC: string; P_INFO_AL?: string }>({ P_SIT_MERC: 'CONECTANDO...' });
  public resumen$ = new BehaviorSubject<MarketResumen>({ num_tot_ope_negoc: 0, num_tot_acc_negoc: 0, num_tot_mont_negoc: 0, num_tit_alza: 0, num_tit_baja: 0, num_tit_est: 0 });
  public indices$ = new BehaviorSubject<any[]>([]);
  public ibc$ = new BehaviorSubject<number>(0);
  public stocksArray$ = new BehaviorSubject<MarketTick[]>([]);

  // Real-time lookup maps (O(1) dictionary)
  public stocksMap$ = new BehaviorSubject<Record<string, MarketTick>>({});
  // { 'BPV': 12.3 } – quick price-only access
  public prices$ = new BehaviorSubject<Record<string, number>>({});
  
  public cryptos$ = new BehaviorSubject<any[]>([]);
  
  // Log stream for Admin
  public logs$ = new BehaviorSubject<{time: string, event: string, data: any}[]>([]);

  constructor(private authService: AuthService) {
    this.connect();
    
    // Reconectar si auth status cambia drásticamente
    this.authService.currentUser$.subscribe(user => {
       // Opcionalmente podemos resetear conexión, pero si ya hay token, no es vital.
    });
  }

  public connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }
    
    const token = localStorage.getItem('access_token');
    if (!token) {
      // Intentar reconectar despues si aun no hay token
      setTimeout(() => this.connect(), 2000);
      return;
    }

    this.isConnecting = true;
    
    // Cambiar http/https a ws/wss
    const wsUrl = environment.apiUrl.replace(/^http/, 'ws') + `/ws?token=${token}`;
    
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.isConnected$.next(true);
        this.addLog('SYSTEM', 'Conectado al relé WS backend de Caracas Portafolio');
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          
          if (payload.type === 'bvc_event') {
            this.handleBvcEvent(payload.eventName, payload.data);
          } else if (payload.type === 'ack') {
              // backend pong
          } else if (payload.type === 'market_board_update') {
              // old daemon updates (opcional conservarlo o ignorarlo)
          }
        } catch (e) {
          console.error('Error parsing WS message', e);
        }
      };

      this.ws.onerror = (error) => {
        console.error('BvcSocket error', error);
      };

      this.ws.onclose = (event: CloseEvent) => {
        this.isConnecting = false;
        this.isConnected$.next(false);
        this.marketStatus$.next({ P_SIT_MERC: 'DESCONECTADO' });
        this.addLog('SYSTEM', 'Desconectado. Reconectando en 5s...');

        if (event.code === 4001) {
          // Token expired/invalid — refresh before reconnecting
          this.authService.refreshToken().subscribe({
            next: () => setTimeout(() => this.connect(), 1000),
            error: () => setTimeout(() => this.connect(), this.reconnectInterval),
          });
        } else {
          setTimeout(() => this.connect(), this.reconnectInterval);
        }
      };
      
    } catch (e) {
      this.isConnecting = false;
      setTimeout(() => this.connect(), this.reconnectInterval);
    }
  }

  private handleBvcEvent(eventName: string, data: any) {
    this.addLog(eventName, eventName === 'serverDataExt' ? `[${data.length} stocks]` : data);

    if (eventName === 'serverDataEstado') {
      this.marketStatus$.next(data);
    } 
    else if (eventName === 'serverDataResumen') {
      this.resumen$.next(data);
    }
    else if (eventName === 'serverDataTicker') {
      this.indices$.next(data);
      const ibc = data.find((x: any) => x.COD_SIMB.trim() === 'IBC');
      if (ibc) this.ibc$.next(ibc.PRECIO);
    }
    else if (eventName === 'serverDataExt' || eventName === 'serverData') {
      const isExt = eventName === 'serverDataExt';
      const currentMap = this.stocksMap$.getValue();
      const currentPrices = this.prices$.getValue();

      let updated = false;
      for (const item of data) {
        if (!item?.COD_SIMB) continue;
        const existing = currentMap[item.COD_SIMB];
        // serverDataExt always wins; serverData only writes when no ext data exists yet
        // (ext data is identified by having PRECIO_APERT, a field absent in serverData)
        if (isExt || !existing?.PRECIO_APERT) {
          currentMap[item.COD_SIMB] = item as MarketTick;
          if (item.PRECIO) currentPrices[item.COD_SIMB] = item.PRECIO;
          updated = true;
        }
      }

      // stocksArray$ always reflects the authoritative ext data when available
      if (isExt) this.stocksArray$.next(data as MarketTick[]);

      if (updated) {
        this.stocksMap$.next(currentMap);
        this.prices$.next(currentPrices);
      }
    }
    else if (eventName === 'cryptos') {
      if (Array.isArray(data)) {
        // Accept entries with either COD_SIMB or DESC_SIMB (BVC sends full names in COD_SIMB)
        const cleanCryptos = data.filter(c => c && c.simbolo && (c.simbolo.COD_SIMB || c.simbolo.DESC_SIMB));
        // Only overwrite when we actually received valid tickers — BVC occasionally emits empty
        // arrays as keep-alive pings which would wipe the cached crypto list.
        if (cleanCryptos.length > 0) {
          this.cryptos$.next(cleanCryptos);
        }
      }
    }
  }

  private addLog(event: string, data: any) {
    const logs = this.logs$.getValue();
    const time = new Date().toLocaleTimeString();
    
    // Only keep last 100
    if (logs.length >= 100) logs.pop();
    logs.unshift({ time, event, data });
    
    this.logs$.next(logs);
  }
}
