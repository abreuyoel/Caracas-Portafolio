import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="landing">

      <!-- ── NAV ─────────────────────────────────────────────── -->
      <nav class="nav" aria-label="Navegación principal">
        <div class="nav-inner">
          <a class="brand" routerLink="/">
            <span class="brand-icon">📊</span>
            Caracas <span class="brand-accent">Portafolio</span>
          </a>
          <div class="nav-actions">
            <a class="btn-ghost" routerLink="/auth/login">Iniciar sesión</a>
            <a class="btn-primary" routerLink="/auth/register">Registrarse</a>
          </div>
        </div>
      </nav>

      <!-- ── HERO ────────────────────────────────────────────── -->
      <header class="hero">
        <div class="blobs">
          <div class="blob b1"></div>
          <div class="blob b2"></div>
          <div class="blob b3"></div>
        </div>
        <div class="hero-content">
          <a class="hero-new-badge" routerLink="/release-notes">
            <span class="new-tag">NUEVO</span>
            Ver qué hay de nuevo en la v2.0
            <span class="arrow">→</span>
          </a>
          <h1 class="hero-title">
            Invierte con inteligencia en la<br>
            <span class="gradient-text">Bolsa de Valores de Caracas</span>
          </h1>
          <p class="hero-sub">
            Caracas Portfolio es la plataforma profesional para gestionar tu portafolio de acciones venezolanas.
            Análisis técnico con IA, gráficos en tiempo real, perfil de riesgo personalizado y mucho más.
          </p>
          <div class="hero-cta">
            <a class="btn-hero-primary" routerLink="/auth/register">
              Empezar gratis
              <span class="arrow">→</span>
            </a>
            <a class="btn-hero-ghost" routerLink="/auth/login">Ya tengo cuenta</a>
          </div>
          <p class="hero-note">Datos reales de la BVC · 100% gratuito</p>
        </div>
      </header>

      <!-- ── STATS ────────────────────────────────────────────── -->
      <section class="stats" aria-label="Estadísticas de la plataforma">
        <div class="stats-inner">
          <div class="stat">
            <span class="stat-num">45+</span>
            <span class="stat-lbl">Acciones BVC activas</span>
          </div>
          <div class="stat-div"></div>
          <div class="stat">
            <span class="stat-num">15+</span>
            <span class="stat-lbl">Indicadores técnicos IA</span>
          </div>
          <div class="stat-div"></div>
          <div class="stat">
            <span class="stat-num">6</span>
            <span class="stat-lbl">Gráficos de portafolio</span>
          </div>
          <div class="stat-div"></div>
          <div class="stat">
            <span class="stat-num">BCV</span>
            <span class="stat-lbl">Tasas auto-actualizadas</span>
          </div>
          <div class="stat-div"></div>
          <div class="stat">
            <span class="stat-num">Red</span>
            <span class="stat-lbl">Social de inversores</span>
          </div>
        </div>
      </section>

      <!-- ── FEATURES ─────────────────────────────────────────── -->
      <section class="features" id="features" aria-labelledby="feat-heading">
        <div class="section-inner">
          <h2 id="feat-heading" class="section-title">Todo lo que necesitas para invertir en la BVC</h2>
          <p class="section-sub">
            Herramientas profesionales de análisis bursátil, diseñadas específicamente para el mercado venezolano.
          </p>

          <div class="feat-grid">

            <article class="feat-card feat-card--highlight" aria-label="Movimientos del mercado">
              <div class="feat-icon">🏆</div>
              <h3>Movimientos del Mercado BVC</h3>
              <p>Dashboard con top ganadoras, perdedoras, estables y ciclos de subida para períodos semanal, mensual y trimestral. Sincronización automática al arrancar.</p>
              <ul class="feat-list">
                <li>Top ganadoras / perdedoras / estables</li>
                <li>Ciclo de subida (sesiones consecutivas al alza)</li>
                <li>Toggle Bs / USD con ajuste por devaluación BCV</li>
                <li>Cartera institucional por liquidez</li>
              </ul>
            </article>

            <article class="feat-card feat-card--highlight" aria-label="Análisis profundo de portafolio">
              <div class="feat-icon">📊</div>
              <h3>Análisis Profundo de Portafolio</h3>
              <p>Dashboard analítico con 6 gráficos interactivos, P&L real por posición y detección automática de tu mejor y peor operación.</p>
              <ul class="feat-list">
                <li>P&L total por acción (realizado + latente)</li>
                <li>Mejor compra actual · Peor pérdida latente</li>
                <li>Mejor y peor venta realizada</li>
                <li>Mejor y peor día de ganancias</li>
                <li>Top 5 tenencias sin vender en USD</li>
              </ul>
            </article>

            <article class="feat-card" aria-label="Tasas BCV automáticas">
              <div class="feat-icon">🏦</div>
              <h3>Tasas BCV Auto-Actualizadas</h3>
              <p>El sistema obtiene la tasa oficial USD/Bs del BCV automáticamente de lunes a viernes y la guarda en la base de datos. Sin intervención manual.</p>
              <ul class="feat-list">
                <li>Scraping diario de bcv.org.ve</li>
                <li>Scheduler lunes–viernes 00:00 (hora Caracas)</li>
                <li>Historial de tasas desde 2020 importado</li>
                <li>Auto-relleno en formulario de transacciones</li>
              </ul>
            </article>

            <article class="feat-card feat-card--social" aria-label="Red de inversores">
              <div class="feat-icon">👥</div>
              <h3>Red Social de Inversores <span class="new-badge">NUEVO</span></h3>
              <p>Crea un perfil anónimo con alias y conecta con otros inversores de la BVC. Tú controlas qué datos de tu portafolio son visibles.</p>
              <ul class="feat-list">
                <li>Alias obligatorio — nombre real nunca visible</li>
                <li>Perfiles públicos o privados</li>
                <li>Seguidores y notificaciones por nueva transacción</li>
                <li>Privacidad garantizada </li>
              </ul>
            </article>

            <article class="feat-card" aria-label="Gráficos en tiempo real">
              <div class="feat-icon">📈</div>
              <h3>Gráficos con Toggle USD / Bs</h3>
              <p>Candlesticks con datos de la BVC en Bolívares o dólares según la tasa BCV histórica. El libro de órdenes y todos los indicadores se convierten automáticamente.</p>
              <ul class="feat-list">
                <li>OHLCV en Bs o USD por fecha</li>
                <li>Libro de órdenes en tiempo real convertido</li>
                <li>Herramientas de dibujo (Fibonacci, líneas)</li>
              </ul>
            </article>

            <article class="feat-card" aria-label="Análisis técnico con IA">
              <div class="feat-icon">🤖</div>
              <h3>Análisis Técnico con IA</h3>
              <p>Gemini AI analiza el gráfico activo y responde en la moneda que tienes seleccionada (Bs o USD). Contexto venezolano incluido.</p>
              <ul class="feat-list">
                <li>RSI, MACD, Bollinger, EMA, VWAP, Ichimoku</li>
                <li>IA responde en Bs o USD según el toggle activo</li>
                <li>Recomendación según tu perfil de riesgo</li>
              </ul>
            </article>

            <article class="feat-card" aria-label="Indicadores técnicos avanzados">
              <div class="feat-icon">🔬</div>
              <h3>15+ Indicadores Avanzados</h3>
              <p>Panel Analytics con ADX, Chaikin, ATR%, DMI, MFI, Stochastic, Aroon, OBV, A/D y más. Detección automática de Golden Cross y Death Cross.</p>
              <ul class="feat-list">
                <li>Panel Analytics flotante en el gráfico</li>
                <li>Golden Cross / Death Cross automático</li>
                <li>Soporte y resistencia calculados</li>
              </ul>
            </article>

            <article class="feat-card" aria-label="Registro de transacciones BVC">
              <div class="feat-icon">📋</div>
              <h3>Transacciones Completas BVC</h3>
              <p>Registra compras y ventas con todos los detalles: casa de bolsa, comisiones, IVA, derecho de registro. La tasa BCV se rellena sola al seleccionar la fecha.</p>
              <ul class="feat-list">
                <li>35+ casas de bolsa venezolanas</li>
                <li>Auto-fill de tasa BCV por fecha</li>
                <li>Slippage, órdenes mercado y límite</li>
              </ul>
            </article>

            <article class="feat-card" aria-label="Chat especializado BVC">
              <div class="feat-icon">💬</div>
              <h3>Chat Especializado en BVC</h3>
              <p>Asistente de inversiones con contexto venezolano completo: inflación, reconversión monetaria, tasa BCV y particularidades del mercado local.</p>
              <ul class="feat-list">
                <li>Historial de conversaciones guardado</li>
                <li>Análisis comparativo de acciones</li>
                <li>Contexto económico venezolano</li>
              </ul>
            </article>

          </div>
        </div>
      </section>

      <!-- ── HOW IT WORKS ─────────────────────────────────────── -->
      <section class="how" aria-labelledby="how-heading">
        <div class="section-inner">
          <h2 id="how-heading" class="section-title">Cómo funciona</h2>
          <div class="steps">
            <div class="step">
              <div class="step-num">1</div>
              <h3>Crea tu cuenta gratis</h3>
              <p>Regístrate en segundos. Acceso inmediato a datos del mercado.</p>
            </div>
            <div class="step-arrow">→</div>
            <div class="step">
              <div class="step-num">2</div>
              <h3>Define tu perfil de inversión</h3>
              <p>Cuestionario de 9 preguntas. La IA adapta recomendaciones a tu tolerancia al riesgo.</p>
            </div>
            <div class="step-arrow">→</div>
            <div class="step">
              <div class="step-num">3</div>
              <h3>Registra tus operaciones</h3>
              <p>Agrega compras y ventas. La tasa BCV se rellena automáticamente por fecha.</p>
            </div>
            <div class="step-arrow">→</div>
            <div class="step">
              <div class="step-num">4</div>
              <h3>Analiza y conecta</h3>
              <p>Gráficos Bs/USD, análisis IA, movimientos del mercado y red social de inversores.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- ── CTA FINAL ────────────────────────────────────────── -->
      <section class="cta-section" aria-label="Llamado a la acción">
        <div class="cta-inner">
          <h2>La plataforma de inversión más completa para la BVC</h2>
          <p>Gráficos, IA, portafolio en USD/Bs, tasas BCV automáticas y red social de inversores. Todo gratis.</p>
          <a class="btn-hero-primary" routerLink="/auth/register">
            Comenzar ahora — es gratis
            <span class="arrow">→</span>
          </a>
        </div>
      </section>

      <!-- ── FOOTER ───────────────────────────────────────────── -->
      <footer class="footer" aria-label="Pie de página">
        <div class="footer-inner">
          <div class="footer-brand">
            <span class="brand-icon">📊</span>
            Caracas <span class="brand-accent">Portafolio</span>
          </div>
          <p class="footer-desc">
            Plataforma profesional para gestión de portafolios e inversiones en la
            Bolsa de Valores de Caracas (BVC), Venezuela.
          </p>
          <p class="footer-copy">© 2026 Caracas Portafolio · Desarrollado con ❤️ en Venezuela por Yoel Abreu</p>
        </div>
      </footer>

    </div>
  `,
  styles: [`
    :host {
      --bg: #080d18;
      --surface: rgba(255,255,255,0.04);
      --border: rgba(255,255,255,0.08);
      --primary: #4c62ff;
      --primary-l: #6b80ff;
      --accent: #00e5c3;
      --text: #e8eaf6;
      --text-muted: rgba(232,234,246,0.60);
      --radius: 16px;
    }

    * { box-sizing: border-box; }

    .landing {
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: 'Space Grotesk', 'Roboto', sans-serif;
      overflow-x: hidden;
    }

    /* ── NAV ──────────────────────────────────────────────── */
    .nav {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(8,13,24,0.85);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
    }

    .nav-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text);
      text-decoration: none;
    }

    .brand-icon { font-size: 1.5rem; }
    .brand-accent { color: var(--accent); }

    .nav-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .btn-ghost {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      padding: 8px 14px;
      border-radius: 10px;
      transition: color 0.2s, background 0.2s;
      white-space: nowrap;
    }
    .btn-ghost:hover { color: var(--text); background: var(--surface); }

    .btn-primary {
      background: linear-gradient(135deg, var(--primary), #7c3aed);
      color: #fff;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 600;
      padding: 9px 16px;
      border-radius: 10px;
      transition: opacity 0.2s, transform 0.2s;
      white-space: nowrap;
    }
    .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }

    @media (max-width: 480px) {
      .nav-inner { padding: 0 12px; gap: 8px; }
      .brand { font-size: 1rem; gap: 6px; }
      .brand-icon { font-size: 1.2rem; }
      .nav-actions { gap: 6px; }
      .btn-ghost { font-size: 0.75rem; padding: 6px 8px; }
      .btn-primary { font-size: 0.75rem; padding: 6px 10px; }
    }

    @media (max-width: 360px) {
      .brand { font-size: 0.9rem; }
      .btn-ghost { font-size: 0.7rem; padding: 5px 6px; }
      .btn-primary { font-size: 0.7rem; padding: 5px 8px; }
    }

    /* ── HERO ────────────────────────────────────────────── */
    .hero {
      position: relative;
      min-height: 88vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 80px 24px 60px;
      overflow: hidden;
    }

    .blobs { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
    .blob {
      position: absolute;
      border-radius: 50%;
      filter: blur(90px);
      opacity: 0.3;
      animation: drift 20s ease-in-out infinite alternate;
    }
    .b1 { width: 600px; height: 600px; background: radial-gradient(var(--primary), transparent 70%); top: -200px; left: -150px; }
    .b2 { width: 450px; height: 450px; background: radial-gradient(#8b5cf6, transparent 70%); top: 30%; right: -120px; animation-delay: 7s; }
    .b3 { width: 350px; height: 350px; background: radial-gradient(var(--accent), transparent 70%); bottom: -80px; left: 35%; opacity: 0.15; animation-delay: 14s; }

    @keyframes drift {
      from { transform: translate(0,0) scale(1); }
      to   { transform: translate(25px,15px) scale(1.05); }
    }

    .hero-content {
      position: relative;
      z-index: 1;
      max-width: 820px;
    }

    .hero-badge {
      display: inline-block;
      background: rgba(76,98,255,0.18);
      border: 1px solid rgba(76,98,255,0.4);
      color: #a5b4fc;
      padding: 6px 18px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 28px;
      letter-spacing: 0.04em;
    }

    .hero-new-badge {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: rgba(76,98,255,0.1);
      border: 1px solid rgba(76,98,255,0.25);
      padding: 8px 16px;
      border-radius: 100px;
      text-decoration: none;
      color: #a5b4fc;
      font-size: 0.88rem;
      font-weight: 600;
      margin-bottom: 24px;
      transition: all 0.3s ease;
    }
    .hero-new-badge:hover {
      background: rgba(76,98,255,0.2);
      border-color: rgba(76,98,255,0.5);
      transform: translateY(-2px);
    }
    .new-tag {
      background: linear-gradient(135deg, var(--primary), var(--accent));
      color: #fff;
      font-size: 0.65rem;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 20px;
      letter-spacing: 0.05em;
    }

    .hero-title {
      font-size: clamp(2rem, 5vw, 3.4rem);
      font-weight: 800;
      line-height: 1.15;
      margin: 0 0 24px;
      color: var(--text);
    }

    .gradient-text {
      background: linear-gradient(135deg, var(--primary-l), var(--accent));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero-sub {
      font-size: 1.1rem;
      color: var(--text-muted);
      line-height: 1.7;
      margin: 0 0 36px;
      max-width: 640px;
      margin-left: auto;
      margin-right: auto;
    }

    .hero-cta { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 16px; }

    .btn-hero-primary {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, var(--primary), #7c3aed);
      color: #fff;
      text-decoration: none;
      font-size: 1.05rem;
      font-weight: 700;
      padding: 14px 32px;
      border-radius: 12px;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 4px 20px rgba(76,98,255,0.35);
    }
    .btn-hero-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(76,98,255,0.45); }

    .btn-hero-ghost {
      display: inline-flex;
      align-items: center;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 1.05rem;
      font-weight: 600;
      padding: 14px 28px;
      border-radius: 12px;
      border: 1px solid var(--border);
      transition: color 0.2s, border-color 0.2s;
    }
    .btn-hero-ghost:hover { color: var(--text); border-color: rgba(255,255,255,0.2); }

    .arrow { font-size: 1.1rem; }

    .hero-note { color: var(--text-muted); font-size: 0.82rem; margin: 0; }

    /* ── STATS ───────────────────────────────────────────── */
    .stats {
      padding: 40px 24px;
      background: rgba(255,255,255,0.025);
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }

    .stats-inner {
      max-width: 900px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 24px;
    }

    .stat { text-align: center; padding: 0 24px; }
    .stat-num { display: block; font-size: 2.2rem; font-weight: 800; color: var(--primary-l); }
    .stat-lbl { display: block; font-size: 0.88rem; color: var(--text-muted); margin-top: 4px; }
    .stat-div { width: 1px; height: 48px; background: var(--border); }

    /* ── FEATURES ────────────────────────────────────────── */
    .features { padding: 96px 24px; }

    .section-inner { max-width: 1200px; margin: 0 auto; }

    .section-title {
      font-size: clamp(1.6rem, 3.5vw, 2.4rem);
      font-weight: 800;
      text-align: center;
      margin: 0 0 16px;
      color: var(--text);
    }

    .section-sub {
      text-align: center;
      color: var(--text-muted);
      font-size: 1.05rem;
      max-width: 600px;
      margin: 0 auto 60px;
      line-height: 1.65;
    }

    .feat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 24px;
    }

    .feat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 28px;
      transition: border-color 0.25s, transform 0.25s, box-shadow 0.25s;
    }

    .feat-card:hover {
      border-color: rgba(76,98,255,0.4);
      transform: translateY(-4px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }

    .feat-icon { font-size: 2.2rem; margin-bottom: 16px; display: block; }

    .feat-card h3 {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text);
      margin: 0 0 10px;
    }

    .feat-card p {
      font-size: 0.9rem;
      color: var(--text-muted);
      line-height: 1.65;
      margin: 0 0 14px;
    }

    .feat-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .feat-list li {
      font-size: 0.85rem;
      color: var(--text-muted);
      padding: 4px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .feat-list li::before {
      content: '✓';
      color: var(--accent);
      font-weight: 700;
      flex-shrink: 0;
    }

    .feat-card--highlight {
      border-color: rgba(76,98,255,0.35);
      background: linear-gradient(135deg, rgba(76,98,255,0.08), var(--surface));
    }
    .feat-card--social {
      border-color: rgba(168,85,247,0.35);
      background: linear-gradient(135deg, rgba(168,85,247,0.08), var(--surface));
    }
    .new-badge {
      display: inline-block;
      background: linear-gradient(135deg, #a855f7, #4c62ff);
      color: #fff;
      font-size: 0.6rem;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 6px;
      vertical-align: middle;
      margin-left: 8px;
      letter-spacing: 0.05em;
    }

    /* ── HOW IT WORKS ────────────────────────────────────── */
    .how {
      padding: 80px 24px;
      background: rgba(255,255,255,0.02);
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }

    .steps {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin-top: 48px;
      flex-wrap: wrap;
    }

    .step {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 32px 28px;
      max-width: 260px;
      text-align: center;
      flex: 1;
      min-width: 200px;
    }

    .step-num {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--primary), #7c3aed);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.3rem;
      font-weight: 800;
      color: #fff;
      margin: 0 auto 20px;
      box-shadow: 0 4px 16px rgba(76,98,255,0.35);
    }

    .step h3 { font-size: 1rem; font-weight: 700; color: var(--text); margin: 0 0 10px; }
    .step p  { font-size: 0.88rem; color: var(--text-muted); margin: 0; line-height: 1.6; }

    .step-arrow { font-size: 1.8rem; color: var(--border); flex-shrink: 0; }

    @media (max-width: 640px) { .step-arrow { display: none; } }

    /* ── CTA SECTION ────────────────────────────────────── */
    .cta-section {
      padding: 100px 24px;
      text-align: center;
    }

    .cta-inner { max-width: 640px; margin: 0 auto; }

    .cta-inner h2 {
      font-size: clamp(1.5rem, 3vw, 2.2rem);
      font-weight: 800;
      color: var(--text);
      margin: 0 0 16px;
    }

    .cta-inner p {
      font-size: 1.05rem;
      color: var(--text-muted);
      margin: 0 0 36px;
      line-height: 1.6;
    }

    /* ── FOOTER ─────────────────────────────────────────── */
    .footer {
      padding: 40px 24px;
      border-top: 1px solid var(--border);
      background: rgba(255,255,255,0.02);
    }

    .footer-inner { max-width: 640px; margin: 0 auto; text-align: center; }

    .footer-brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 1.1rem;
      font-weight: 700;
      margin-bottom: 12px;
    }

    .footer-desc {
      color: var(--text-muted);
      font-size: 0.88rem;
      line-height: 1.65;
      margin: 0 0 12px;
    }

    .footer-copy {
      color: rgba(232,234,246,0.35);
      font-size: 0.8rem;
      margin: 0;
    }
  `]
})
export class LandingComponent { }
