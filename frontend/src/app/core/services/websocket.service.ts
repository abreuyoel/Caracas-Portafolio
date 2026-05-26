import { Injectable } from '@angular/core';
import { Observable, Subject, BehaviorSubject, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export interface LiveMarketTick {
  symbol: string;
  time: string;
  bid_vol: number;
  bid_price: number;
  ask_price: number;
  ask_vol: number;
  close: number;
  open: number;
  change_pct: number;
  change_abs: number;
  volume: number;
  amount: number;
  trades: number;
  high: number;
  low: number;
  is_live: boolean;
}

export type MarketBoard = Record<string, LiveMarketTick>;

@Injectable({
  providedIn: 'root'
})
export class WebSocketService {
  private socket: WebSocket | null = null;
  private messagesSubject: Subject<any> = new Subject<any>();
  public messages$: Observable<any> = this.messagesSubject.asObservable().pipe(shareReplay(1));
  
  // ✅ Nuevo: Estado global del mercado en tiempo real
  private marketBoardSubject = new BehaviorSubject<MarketBoard>({});
  public marketBoard$ = this.marketBoardSubject.asObservable();

  private reconnectInterval: number = 5000;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private isConnecting: boolean = false;

  constructor(private authService: AuthService) {}

  connect(): void {
    // ✅ Evitar múltiples conexiones simultáneas
    if (this.isConnecting || (this.socket && this.socket.readyState === WebSocket.OPEN)) {
      console.log('⚠️ WebSocket already connected or connecting');
      return;
    }

    const token = this.authService.getToken();
    if (!token) {
      console.warn('⚠️ No token available for WebSocket connection');
      return;
    }

    this.isConnecting = true;
    
    // ✅ Usar token actualizado
    const wsUrl = `${environment.wsUrl}?token=${encodeURIComponent(token)}`;
    console.log('🔌 Connecting to WebSocket:', wsUrl.replace(token, '***'));
    
    try {
      this.socket = new WebSocket(wsUrl);
      
      this.socket.onopen = () => {
        console.log('✅ WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // ✅ Distribuir eventos según su tipo de payload
          if (data.type === 'market_board_update') {
            this.marketBoardSubject.next(data.data as MarketBoard);
          } else {
            console.log('📨 WebSocket message:', data);
            this.messagesSubject.next(data);
          }
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error);
        }
      };

      this.socket.onclose = (event) => {
        console.log('🔌 WebSocket disconnected:', event.code, event.reason);
        this.isConnecting = false;
        this.attemptReconnect();
      };

      this.socket.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        this.isConnecting = false;
      };
    } catch (error) {
      console.error('❌ Error creating WebSocket:', error);
      this.isConnecting = false;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => this.connect(), this.reconnectInterval);
    } else {
      console.error('❌ Max WebSocket reconnect attempts reached');
    }
  }

  disconnect(): void {
    if (this.socket) {
      console.log('🔌 Manually disconnecting WebSocket');
      this.socket.close();
      this.socket = null;
    }
    this.isConnecting = false;
    this.reconnectAttempts = 0;
  }

  sendMessage(message: any): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      console.warn('⚠️ WebSocket not connected, cannot send message');
    }
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
}