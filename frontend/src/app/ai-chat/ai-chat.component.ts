import { Component, OnInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatDialogModule } from '@angular/material/dialog';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

interface Message {
  id?: number;
  text: string;
  isUser: boolean;
  timestamp: Date;
  modelUsed?: string;
}

interface ChatSession {
  id: number;
  user_id: string;
  title: string;
  chat_type?: string;  // general | portfolio | technical | comparative
  is_active: boolean;
  created_at: string;
  updated_at: string;
  model_used: string;
  message_count: number;
  last_message?: string;
  last_message_at?: string;
}

@Component({
  selector: 'app-ai-chat',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatSidenavModule,
    MatListModule,
    MatDialogModule,
    MatToolbarModule,
    MatTooltipModule
  ],
  template: `
    <div class="chat-container">
      <!-- Sidebar con historial -->
      <div class="sidebar" [class.open]="sidebarOpen">
        <div class="sidebar-header">
          <h3>💬 Historial</h3>
          <button mat-icon-button (click)="toggleSidebar()" class="close-btn">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <!-- New chat type buttons -->
        <p class="nct-label">Nuevo chat</p>
        <div class="new-chat-types">
          <button class="nct-btn nct-general" (click)="createNewChat('general')" matTooltip="Chat general BVC">
            <mat-icon>chat</mat-icon><span>General</span>
          </button>
          <button class="nct-btn nct-portfolio" (click)="createNewChat('portfolio')" matTooltip="Analiza tu portafolio">
            <mat-icon>account_balance_wallet</mat-icon><span>Portafolio</span>
          </button>
          <button class="nct-btn nct-technical" (click)="createNewChat('technical')" matTooltip="Análisis técnico de una acción">
            <mat-icon>candlestick_chart</mat-icon><span>Técnico</span>
          </button>
          <button class="nct-btn nct-comparative" (click)="createNewChat('comparative')" matTooltip="Comparar dos o más acciones">
            <mat-icon>compare_arrows</mat-icon><span>Comparar</span>
          </button>
        </div>

        <div class="sessions-list">
          @for (session of chatSessions; track session.id) {
            <div class="session-item"
                 [class.active]="currentSessionId === session.id"
                 (click)="loadSession(session.id)">
              <div class="session-info">
                <mat-icon [style.color]="chatTypeConfig[session.chat_type || 'general']?.color">
                  {{ chatTypeConfig[session.chat_type || 'general']?.icon }}
                </mat-icon>
                <div class="session-details">
                  <span class="session-title">{{ session.title }}</span>
                  <div class="session-meta-row">
                    <span class="type-badge" [style.color]="chatTypeConfig[session.chat_type || 'general']?.color">
                      {{ chatTypeConfig[session.chat_type || 'general']?.label }}
                    </span>
                    <span class="session-meta">· {{ session.message_count }} msg</span>
                  </div>
                </div>
              </div>
              <button mat-icon-button class="delete-btn"
                      (click)="deleteSession(session.id, $event)"
                      matTooltip="Eliminar chat">
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          } @empty {
            <div class="empty-sessions">
              <mat-icon>history</mat-icon>
              <p>No hay chats anteriores</p>
            </div>
          }
        </div>
      </div>

      <!-- Overlay para móvil -->
      <div class="overlay" [class.visible]="sidebarOpen" (click)="toggleSidebar()"></div>

      <!-- Área principal del chat -->
      <div class="chat-main">
        <mat-toolbar color="primary" class="chat-toolbar">
          <button mat-icon-button (click)="toggleSidebar()" matTooltip="Historial">
            <mat-icon>menu</mat-icon>
          </button>
          <button mat-icon-button routerLink="/dashboard" matTooltip="Volver al inicio" class="back-btn">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <div class="chat-title-group">
            <span class="chat-title">{{ currentSessionId ? 'Chat en curso' : 'Asistente IA' }}</span>
            <div class="chat-subtitle-row">
              <span class="chat-subtitle">Bolsa de Caracas · Gemini</span>
              <span class="chat-type-pill" [style.color]="chatTypeConfig[currentChatType]?.color">
                <mat-icon style="font-size:12px;width:12px;height:12px;vertical-align:middle">{{ chatTypeConfig[currentChatType]?.icon }}</mat-icon>
                {{ chatTypeConfig[currentChatType]?.label }}
              </span>
            </div>
          </div>
          <span class="spacer"></span>
          <button mat-stroked-button class="new-chat-btn" (click)="createNewChat()" matTooltip="Nuevo chat general">
            <mat-icon>add</mat-icon>
            Nuevo
          </button>
        </mat-toolbar>

        <div class="chat-content" #chatContent>
          @if (loadingSessions) {
            <div class="loading-state">
              <mat-spinner diameter="40"></mat-spinner>
              <p>Cargando historial...</p>
            </div>
          } @else if (messages.length === 0) {
            <div class="welcome-state">
              @if (currentChatType === 'portfolio') {
                <div class="welcome-avatar" style="background:linear-gradient(135deg,rgba(45,217,148,0.2),rgba(0,229,195,0.1));border-color:rgba(45,217,148,0.35)">💼</div>
                <h2>Agente de Portafolio</h2>
                <p class="welcome-sub">Tengo acceso completo a tus posiciones, transacciones y perfil de inversión. Puedo analizar tu desempeño y decirte cuándo comprar, mantener o vender.</p>
                <div class="features-grid">
                  <div class="feature-card portfolio-card" (click)="quickSend('Analiza mi portafolio completo, dime qué está funcionando y qué no')">
                    <mat-icon>analytics</mat-icon>
                    <span>Análisis completo del portafolio</span>
                  </div>
                  <div class="feature-card portfolio-card" (click)="quickSend('¿Debo invertir más ahora o es mejor esperar? Analiza mi situación actual')">
                    <mat-icon>schedule</mat-icon>
                    <span>¿Invertir ahora o esperar?</span>
                  </div>
                  <div class="feature-card portfolio-card" (click)="quickSend('¿Cuáles de mis acciones están en pérdida y debería considerar vender?')">
                    <mat-icon>trending_down</mat-icon>
                    <span>Posiciones en pérdida</span>
                  </div>
                  <div class="feature-card portfolio-card" (click)="quickSend('¿Es mi portafolio coherente con mi perfil de riesgo e inversión?')">
                    <mat-icon>shield</mat-icon>
                    <span>¿Coherente con mi perfil?</span>
                  </div>
                  <div class="feature-card portfolio-card" (click)="quickSend('Analiza mis patrones de compra y venta, ¿tengo un buen comportamiento inversor?')">
                    <mat-icon>psychology</mat-icon>
                    <span>Mis patrones de comportamiento</span>
                  </div>
                  <div class="feature-card portfolio-card" (click)="quickSend('¿Qué acciones de la BVC complementarían mi portafolio actual?')">
                    <mat-icon>add_circle</mat-icon>
                    <span>Acciones para complementar</span>
                  </div>
                </div>
              } @else if (currentChatType === 'technical') {
                <div class="welcome-avatar" style="background:linear-gradient(135deg,rgba(251,191,36,0.18),rgba(245,158,11,0.08));border-color:rgba(251,191,36,0.3)">📊</div>
                <h2>Agente Técnico — Indicadores</h2>
                <p class="welcome-sub">Analizo indicadores técnicos de acciones BVC: RSI, MACD, Bollinger, EMA, volumen y más. Abre la acción en Gráficos para análisis completo con datos en tiempo real.</p>
                <div class="features-grid">
                  <div class="feature-card technical-card" (click)="quickSend('¿Qué indicadores técnicos debo usar para saber si una acción está sobrecomprada?')">
                    <mat-icon>show_chart</mat-icon>
                    <span>Indicadores de sobrecompra</span>
                  </div>
                  <div class="feature-card technical-card" (click)="quickSend('Explícame cómo interpretar el MACD en la BVC')">
                    <mat-icon>timeline</mat-icon>
                    <span>Cómo interpretar el MACD</span>
                  </div>
                  <div class="feature-card technical-card" (click)="quickSend('¿Qué significan las bandas de Bollinger y cómo las uso?')">
                    <mat-icon>ssid_chart</mat-icon>
                    <span>Bandas de Bollinger</span>
                  </div>
                  <div class="feature-card technical-card" (click)="quickSend('¿Qué es el RSI y cuándo indica señal de compra o venta?')">
                    <mat-icon>speed</mat-icon>
                    <span>RSI: señales de compra/venta</span>
                  </div>
                  <div class="feature-card technical-card" (click)="quickSend('¿Qué es el volumen y cómo confirma una tendencia?')">
                    <mat-icon>bar_chart</mat-icon>
                    <span>Volumen y tendencias</span>
                  </div>
                  <div class="feature-card technical-card" (click)="quickSend('Explícame el análisis de Ichimoku Cloud y cómo se usa en la BVC')">
                    <mat-icon>cloud</mat-icon>
                    <span>Ichimoku Cloud</span>
                  </div>
                </div>
                <p class="welcome-tip">💡 Para análisis técnico completo con datos reales, usa el botón IA en la sección <strong>Gráficos</strong></p>
              } @else if (currentChatType === 'comparative') {
                <div class="welcome-avatar" style="background:linear-gradient(135deg,rgba(167,139,250,0.18),rgba(139,92,246,0.08));border-color:rgba(167,139,250,0.3)">⚖️</div>
                <h2>Agente Comparativo — Empresas</h2>
                <p class="welcome-sub">Comparo dos o más acciones de la BVC: indicadores, sectores, riesgo y cuál se adapta mejor a tu perfil. Para comparación con datos en tiempo real usa la sección Gráficos.</p>
                <div class="features-grid">
                  <div class="feature-card comparative-card" (click)="quickSend('Compara BPV vs BBVA: ¿cuál tiene mejor perspectiva de inversión?')">
                    <mat-icon>compare_arrows</mat-icon>
                    <span>BPV vs BBVA</span>
                  </div>
                  <div class="feature-card comparative-card" (click)="quickSend('¿Cuáles son las mejores acciones del sector bancario en la BVC y cómo se comparan?')">
                    <mat-icon>account_balance</mat-icon>
                    <span>Sector bancario BVC</span>
                  </div>
                  <div class="feature-card comparative-card" (click)="quickSend('¿Qué acción de la BVC tiene mejor relación riesgo/retorno para un perfil moderado?')">
                    <mat-icon>balance</mat-icon>
                    <span>Mejor riesgo/retorno</span>
                  </div>
                  <div class="feature-card comparative-card" (click)="quickSend('Compara las acciones de manufactura vs banca en la BVC: ¿cuál sector conviene más ahora?')">
                    <mat-icon>factory</mat-icon>
                    <span>Manufactura vs Banca</span>
                  </div>
                  <div class="feature-card comparative-card" (click)="quickSend('¿Cuáles son las acciones más volátiles de la BVC y cuáles las más estables?')">
                    <mat-icon>leaderboard</mat-icon>
                    <span>Volátiles vs estables</span>
                  </div>
                  <div class="feature-card comparative-card" (click)="quickSend('Según mi perfil de inversión, ¿qué acciones BVC debería considerar y cuáles evitar?')">
                    <mat-icon>person_search</mat-icon>
                    <span>Según mi perfil</span>
                  </div>
                </div>
                <p class="welcome-tip">💡 Para comparar con indicadores en tiempo real, usa <strong>Gráficos → Comparar</strong></p>
              } @else {
                <div class="welcome-avatar">🤖</div>
                <h2>Asistente IA — Caracas Portafolio</h2>
                <p class="welcome-sub">Pregúntame sobre acciones de la Bolsa de Caracas, tu portafolio o análisis técnico.</p>
                <div class="features-grid">
                  <div class="feature-card" (click)="quickSend('¿Cuáles son las acciones más activas de la BVC hoy?')">
                    <mat-icon>bar_chart</mat-icon>
                    <span>Acciones más activas</span>
                  </div>
                  <div class="feature-card" (click)="quickSend('Analiza mi portafolio y dame recomendaciones según mi perfil de inversión')">
                    <mat-icon>analytics</mat-icon>
                    <span>Analiza mi portafolio</span>
                  </div>
                  <div class="feature-card" (click)="quickSend('Analiza BPV últimos 365 días')">
                    <mat-icon>candlestick_chart</mat-icon>
                    <span>Analiza BPV 365 días</span>
                  </div>
                  <div class="feature-card" (click)="quickSend('Dame recomendaciones de acciones según mi perfil de riesgo')">
                    <mat-icon>recommend</mat-icon>
                    <span>Recomendaciones personalizadas</span>
                  </div>
                  <div class="feature-card" (click)="quickSend('¿Qué es el RSI y cómo lo interpreto?')">
                    <mat-icon>school</mat-icon>
                    <span>¿Qué es el RSI?</span>
                  </div>
                  <div class="feature-card" (click)="quickSend('¿Dónde puedo ver los gráficos de la app?')">
                    <mat-icon>help_outline</mat-icon>
                    <span>Funcionalidades de la app</span>
                  </div>
                </div>
              }
            </div>
          } @else {
            <div class="messages-container">
              @for (message of messages; track message.timestamp) {
                <div class="message" [class.user-message]="message.isUser">
                  <div class="message-avatar">
                    {{ message.isUser ? '👤' : '🤖' }}
                  </div>
                  <div class="message-bubble">
                    <p>{{ message.text }}</p>
                    <span class="message-time">{{ message.timestamp | date:'HH:mm' }}</span>
                    @if (message.modelUsed) {
                      <span class="model-badge">{{ message.modelUsed }}</span>
                    }
                  </div>
                </div>
              }
              
              @if (loading) {
                <div class="message">
                  <div class="message-avatar">🤖</div>
                  <div class="message-bubble loading">
                    <mat-spinner diameter="20"></mat-spinner>
                    <span>Escribiendo...</span>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <div class="chat-input-container">
          <div class="input-wrapper">
            <input
              matInput
              [(ngModel)]="userMessage"
              (keyup.enter)="sendMessage()"
              placeholder="Escribe tu pregunta..."
              [disabled]="loading"
            >
            <button
              mat-icon-button
              color="primary"
              (click)="sendMessage()"
              [disabled]="!userMessage.trim() || loading"
              class="send-btn"
            >
              <mat-icon>send</mat-icon>
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .chat-container {
      display: flex;
      height: 100vh;
      background: #080d18;
      background-image:
        radial-gradient(ellipse 60% 40% at 15% 10%, rgba(99,102,241,0.10) 0%, transparent 60%),
        radial-gradient(ellipse 50% 35% at 85% 80%, rgba(139,92,246,0.08) 0%, transparent 60%);
      position: relative;
      overflow: hidden;
    }

    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      width: 320px;
      height: 100vh;
      background: rgba(15, 23, 42, 0.98);
      backdrop-filter: blur(20px);
      z-index: 1000;
      transform: translateX(-100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border-right: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      flex-direction: column;
    }

    .sidebar.open {
      transform: translateX(0);
    }

    @media (min-width: 768px) {
      .sidebar {
        position: relative;
        transform: translateX(0);
        width: 300px;
      }
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .sidebar-header h3 {
      flex: 1;
      margin: 0;
      color: #ffffff;
      font-size: 1.1rem;
    }

    .sidebar-header button {
      color: rgba(255, 255, 255, 0.8);
    }

    .sidebar-header .close-btn {
      display: block;
    }

    @media (min-width: 768px) {
      .sidebar-header .close-btn {
        display: none;
      }
    }

    .new-chat-types {
      display: flex;
      gap: 6px;
      padding: 10px 12px 4px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }

    .nct-btn {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      padding: 8px 4px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.68rem;
      color: rgba(255,255,255,0.6);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }

      &:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); color: #fff; }
    }

    .nct-label {
      font-size: 0.68rem;
      color: rgba(255,255,255,0.3);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 10px 14px 2px;
      margin: 0;
    }

    .nct-general     { &:hover { border-color: rgba(129,140,248,0.5); } mat-icon { color: #818cf8; } }
    .nct-portfolio   { &:hover { border-color: rgba(45,217,148,0.5);  } mat-icon { color: #2dd994; } }
    .nct-technical   { &:hover { border-color: rgba(251,191,36,0.5);  } mat-icon { color: #fbbf24; } }
    .nct-comparative { &:hover { border-color: rgba(167,139,250,0.5); } mat-icon { color: #a78bfa; } }

    .session-meta-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .type-badge {
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .sessions-list {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    .sessions-list .session-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      margin-bottom: 8px;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
      border: 1px solid transparent;
    }

    .sessions-list .session-item:hover {
      background: rgba(99, 102, 241, 0.1);
      border-color: rgba(99, 102, 241, 0.3);
    }

    .sessions-list .session-item.active {
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.2));
      border-color: rgba(99, 102, 241, 0.5);
    }

    .sessions-list .session-item .session-info {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .sessions-list .session-item .session-info mat-icon {
      color: rgba(99, 102, 241, 0.8);
    }

    .sessions-list .session-item .session-info .session-details {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .sessions-list .session-item .session-info .session-details .session-title {
      color: rgba(255, 255, 255, 0.9);
      font-size: 0.95rem;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sessions-list .session-item .session-info .session-details .session-meta {
      color: rgba(255, 255, 255, 0.5);
      font-size: 0.8rem;
    }

    .sessions-list .session-item .delete-btn {
      opacity: 0;
      transition: opacity 0.3s ease;
      color: rgba(239, 68, 68, 0.8);
    }

    .sessions-list .session-item .delete-btn:hover {
      color: #ef4444;
    }

    .sessions-list .session-item:hover .delete-btn {
      opacity: 1;
    }

    .sessions-list .empty-sessions {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      gap: 12px;
      color: rgba(255, 255, 255, 0.5);
    }

    .sessions-list .empty-sessions mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
    }

    .sessions-list .empty-sessions p {
      margin: 0;
      font-size: 0.9rem;
    }

    .overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 999;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }

    .overlay.visible {
      opacity: 1;
      pointer-events: auto;
    }

    @media (min-width: 768px) {
      .overlay {
        display: none;
      }
    }

    .chat-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    .chat-toolbar {
      background: rgba(8,13,24,0.92) !important;
      backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      height: 64px;
    }

    .back-btn { color: rgba(255,255,255,0.6) !important; margin-right: 4px; }

    .chat-title-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .chat-toolbar .chat-title {
      font-size: 1rem;
      font-weight: 700;
      color: #fff;
      line-height: 1.2;
    }

    .chat-subtitle-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .chat-subtitle {
      font-size: 0.7rem;
      color: rgba(255,255,255,0.4);
      letter-spacing: 0.04em;
    }

    .chat-type-pill {
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 1px 6px;
      border-radius: 6px;
      background: rgba(255,255,255,0.06);
      border: 1px solid currentColor;
      opacity: 0.85;
    }

    .new-chat-btn {
      border-color: rgba(99,102,241,0.4) !important;
      color: rgba(255,255,255,0.7) !important;
      border-radius: 8px !important;
      font-size: 0.82rem !important;
    }

    .chat-toolbar .spacer {
      flex: 1 1 auto;
    }

    .chat-content {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
    }

    .chat-content .loading-state,
    .chat-content .welcome-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 24px;
      text-align: center;
      color: rgba(255, 255, 255, 0.8);
    }

    .chat-content .loading-state mat-spinner,
    .chat-content .welcome-state mat-spinner {
      color: #6366f1;
    }

    .welcome-avatar {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.15));
      border: 1px solid rgba(99,102,241,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      animation: bounce 3s ease-in-out infinite;
    }

    .chat-content .welcome-state h2 {
      color: #ffffff;
      margin: 0;
      font-size: 1.3rem;
      font-weight: 700;
    }

    .welcome-sub {
      color: rgba(255,255,255,0.5);
      font-size: 0.9rem;
      max-width: 480px;
      text-align: center;
      margin: 0;
    }

    .chat-content .welcome-state .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      width: 100%;
      max-width: 700px;
      margin: 8px 0;
    }

    .chat-content .welcome-state .features-grid .feature-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 18px 14px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      cursor: pointer;
      transition: all 0.2s ease;
      &:hover {
        background: rgba(99,102,241,0.12);
        border-color: rgba(99,102,241,0.35);
        transform: translateY(-2px);
      }
    }

    .chat-content .welcome-state .features-grid .feature-card mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: #818cf8;
    }

    .chat-content .welcome-state .features-grid .feature-card span {
      font-size: 0.82rem;
      color: rgba(255,255,255,0.7);
      text-align: center;
      line-height: 1.3;
    }

    .chat-content .welcome-state .features-grid .portfolio-card {
      border-color: rgba(45,217,148,0.2);
      &:hover { background: rgba(45,217,148,0.1); border-color: rgba(45,217,148,0.4); }
      mat-icon { color: #2dd994; }
    }

    .chat-content .welcome-state .features-grid .technical-card {
      border-color: rgba(251,191,36,0.2);
      &:hover { background: rgba(251,191,36,0.08); border-color: rgba(251,191,36,0.4); }
      mat-icon { color: #fbbf24; }
    }

    .chat-content .welcome-state .features-grid .comparative-card {
      border-color: rgba(167,139,250,0.2);
      &:hover { background: rgba(167,139,250,0.1); border-color: rgba(167,139,250,0.4); }
      mat-icon { color: #a78bfa; }
    }

    .welcome-tip {
      font-size: 0.78rem;
      color: rgba(255,255,255,0.4);
      text-align: center;
      margin: 0;
      padding: 0 20px;

      strong { color: rgba(255,255,255,0.7); }
    }

    .messages-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 900px;
      margin: 0 auto;
    }

    .message {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      animation: slideIn 0.3s ease;
    }

    .message.user-message {
      flex-direction: row-reverse;
    }

    .message.user-message .message-bubble {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
    }

    .message.user-message .message-bubble .message-time {
      color: rgba(255, 255, 255, 0.7);
    }

    .message.user-message .message-bubble .model-badge {
      background: rgba(255, 255, 255, 0.2);
    }

    .message .message-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      flex-shrink: 0;
    }

    .message .message-bubble {
      max-width: 70%;
      padding: 16px 20px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      border-top-left-radius: 4px;
    }

    .message .message-bubble p {
      margin: 0;
      color: rgba(255, 255, 255, 0.95);
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .message .message-bubble .message-time {
      display: block;
      margin-top: 8px;
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.5);
    }

    .message .message-bubble .model-badge {
      display: inline-block;
      margin-top: 8px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.7rem;
      background: rgba(99, 102, 241, 0.3);
      color: rgba(99, 102, 241, 0.9);
    }

    .message .message-bubble.loading {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 120px;
    }

    .message .message-bubble.loading mat-spinner {
      color: #6366f1;
    }

    .message .message-bubble.loading span {
      color: rgba(255, 255, 255, 0.7);
    }

    .chat-input-container {
      padding: 20px 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(15, 23, 42, 0.5);
    }

    .chat-input-container .input-wrapper {
      display: flex;
      gap: 12px;
      align-items: center;
      max-width: 900px;
      margin: 0 auto;
    }

    .chat-input-container .input-wrapper input {
      flex: 1;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 14px 18px;
      color: #ffffff;
      font-size: 1rem;
    }

    .chat-input-container .input-wrapper input::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }

    .chat-input-container .input-wrapper input:focus {
      border-color: #6366f1;
      outline: none;
    }

    .chat-input-container .input-wrapper .send-btn {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border-radius: 12px;
    }

    .chat-input-container .input-wrapper .send-btn:disabled {
      opacity: 0.5;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes bounce {
      0%, 100% {
        transform: translateY(0);
      }
      50% {
        transform: translateY(-10px);
      }
    }

    ::-webkit-scrollbar {
      width: 6px;
    }

    ::-webkit-scrollbar-track {
      background: transparent;
    }

    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
    }
  `]
})
export class AiChatComponent implements OnInit, OnDestroy {
  @ViewChild('chatContent') chatContent!: ElementRef;

  messages: Message[] = [];
  userMessage = '';
  loading = false;
  sidebarOpen = false;
  loadingSessions = true;
  currentSessionId: number | null = null;
  currentChatType: string = 'general';
  chatSessions: ChatSession[] = [];

  readonly chatTypeConfig: Record<string, { label: string; icon: string; color: string }> = {
    general: { label: 'General', icon: 'chat', color: '#818cf8' },
    portfolio: { label: 'Portafolio', icon: 'account_balance_wallet', color: '#2dd994' },
    technical: { label: 'Técnico', icon: 'candlestick_chart', color: '#fbbf24' },
    comparative: { label: 'Comparativo', icon: 'compare_arrows', color: '#a78bfa' },
  };

  private apiUrl = environment.apiUrl;
  private refreshInterval: any;

  constructor(
    private http: HttpClient,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit(): void {
    this.loadChatSessions();
    this.refreshInterval = setInterval(() => {
      this.loadChatSessions();
    }, 30000);
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  async loadChatSessions(): Promise<void> {
    try {
      const token = localStorage.getItem('access_token');

      const response = await this.http.get<ChatSession[]>(
        `${this.apiUrl}/chat/sessions`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      ).toPromise();

      this.chatSessions = response || [];
    } catch (error) {
      console.error('❌ Error loading chat sessions:', error);
    } finally {
      this.loadingSessions = false;
    }
  }

  async loadSession(sessionId: number): Promise<void> {
    try {
      const token = localStorage.getItem('access_token');

      const response = await this.http.get<any[]>(
        `${this.apiUrl}/chat/sessions/${sessionId}/messages`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      ).toPromise();

      this.currentSessionId = sessionId;
      const sess = this.chatSessions.find(s => s.id === sessionId);
      this.currentChatType = sess?.chat_type || 'general';

      this.messages = (response || []).map((msg: any) => ({
        id: msg.id,
        text: msg.content,
        isUser: msg.role === 'user',
        timestamp: new Date(msg.created_at),
        modelUsed: msg.model_used || undefined
      }));

      this.scrollToBottom();
      this.sidebarOpen = false;
    } catch (error) {
      console.error('❌ Error loading session:', error);
      this.snackBar.open('Error al cargar el chat', 'Cerrar', { duration: 3000 });
    }
  }

  async createNewChat(chatType: string = 'general'): Promise<void> {
    this.currentSessionId = null;
    this.currentChatType = chatType;
    this.messages = [];
    this.sidebarOpen = false;
    await this.loadChatSessions();
  }

  async deleteSession(sessionId: number, event: Event): Promise<void> {
    event.stopPropagation();

    const confirmed = confirm('¿Estás seguro de eliminar este chat? Esta acción no se puede deshacer.');
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('access_token');

      await this.http.delete(
        `${this.apiUrl}/chat/sessions/${sessionId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      ).toPromise();

      this.snackBar.open('✅ Chat eliminado', 'Cerrar', { duration: 2000 });

      if (this.currentSessionId === sessionId) {
        this.currentSessionId = null;
        this.messages = [];
      }

      await this.loadChatSessions();
    } catch (error) {
      console.error('❌ Error deleting session:', error);
      this.snackBar.open('Error al eliminar el chat', 'Cerrar', { duration: 3000 });
    }
  }

  /**
   * Detecta si el mensaje pide análisis histórico de una acción.
   * Ejemplos: "analiza BPV últimos 180 días", "análisis de FNV 1 año",
   * "qué ha hecho PTN en los últimos 365 días"
   */
  private detectHistoricalRequest(message: string): { symbol: string; days: number } | null {
    const text = message.toUpperCase();

    // Patrón: símbolo + días numéricos
    const patternDays = /\b([A-Z]{2,6}(?:\.[AB])?)\b.*?(\d+)\s*D[IÍ]AS?/i;
    const matchDays = message.match(patternDays);
    if (matchDays) return { symbol: matchDays[1].toUpperCase(), days: parseInt(matchDays[2]) };

    // Patrón: símbolo + palabras de período
    const patternPeriod = /\b([A-Z]{2,6}(?:\.[AB])?)\b.*?\b(1\s*A[ÑN]O|AÑO|YEAR|6\s*MESES?|SEMESTRE|3\s*MESES?|TRIMESTRE|MES)\b/i;
    const matchPeriod = message.match(patternPeriod);
    if (matchPeriod) {
      const period = matchPeriod[2].toUpperCase();
      let days = 365;
      if (/6\s*MES|SEMESTRE/.test(period)) days = 180;
      if (/3\s*MES|TRIMESTRE/.test(period)) days = 90;
      if (/^MES$/.test(period.trim())) days = 30;
      return { symbol: matchPeriod[1].toUpperCase(), days };
    }

    return null;
  }

  async sendMessage(): Promise<void> {
    if (!this.userMessage.trim() || this.loading) return;

    const message = this.userMessage.trim();
    this.userMessage = '';

    this.messages.push({
      text: message,
      isUser: true,
      timestamp: new Date()
    });

    this.loading = true;
    this.scrollToBottom();

    try {
      const token = localStorage.getItem('access_token');

      // Detectar solicitud de análisis histórico
      const historical = this.detectHistoricalRequest(message);

      // If this is the first message and chat type is not general, create session first
      if (!this.currentSessionId && this.currentChatType !== 'general') {
        try {
          const sessResp = await this.http.post<any>(
            `${this.apiUrl}/chat/sessions`,
            { title: message.slice(0, 60), chat_type: this.currentChatType },
            { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
          ).toPromise();
          if (sessResp?.id) this.currentSessionId = sessResp.id;
        } catch { /* session will be created by backend */ }
      }

      const body: any = {
        message,
        session_id: this.currentSessionId,
        chat_type: this.currentChatType
      };
      if (historical) {
        body.stock_symbol = historical.symbol;
        body.days = historical.days;
      }

      const response = await this.http.post<any>(
        `${this.apiUrl}/chat/chat`,
        body,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      ).toPromise();

      if (response.session_id && !this.currentSessionId) {
        this.currentSessionId = response.session_id;
        await this.loadChatSessions();
      }

      this.messages.push({
        text: response.response,
        isUser: false,
        timestamp: new Date(),
        modelUsed: response.model_used
      });

      this.scrollToBottom();
    } catch (error: any) {
      console.error('❌ Error sending message:', error);
      this.messages.push({
        text: 'Lo siento, tuve un error procesando tu mensaje. Por favor intenta de nuevo.',
        isUser: false,
        timestamp: new Date()
      });
    } finally {
      this.loading = false;
    }
  }

  quickSend(msg: string): void {
    this.userMessage = msg;
    this.sendMessage();
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      if (this.chatContent) {
        this.chatContent.nativeElement.scrollTop = this.chatContent.nativeElement.scrollHeight;
      }
    }, 100);
  }
}