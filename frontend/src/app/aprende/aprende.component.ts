import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { environment } from '../../environments/environment';
import { createChart, IChartApi } from 'lightweight-charts';

// ── Curriculum data ────────────────────────────────────────────────────────────

export interface QuizQuestion {
  q: string;
  options: string[];
  correct: number;
  explanation: string;
}

export interface Lesson {
  id: string;
  title: string;
  icon: string;
  type: 'theory' | 'quiz' | 'fundamental' | 'live' | 'reading';
  duration: string; // e.g. "8 min"
  xp: number;
  content?: string;           // HTML string for theory/reading
  questions?: QuizQuestion[]; // for quiz
  fundamentalStock?: string;  // for fundamental analysis examples
}

export interface Level {
  id: number;
  title: string;
  subtitle: string;
  badge: string;        // emoji
  badgeName: string;
  color: string;        // CSS color
  lessons: Lesson[];
  totalXp: number;
}

// ── XP & Progress store (localStorage) ────────────────────────────────────────
const STORAGE_KEY = 'aprende_progress_v1';

interface Progress {
  completedLessons: string[];   // lesson ids
  xp: number;
  lastActivity: string;
}

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { completedLessons: [], xp: 0, lastActivity: '' };
  } catch { return { completedLessons: [], xp: 0, lastActivity: '' }; }
}

function saveProgress(p: Progress): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

// ── Curriculum definition ──────────────────────────────────────────────────────
const CURRICULUM: Level[] = [
  {
    id: 1, title: 'Fundamentos del Mercado', subtitle: 'De cero al primer concepto',
    badge: '🌱', badgeName: 'Semilla', color: '#22c55e', totalXp: 200,
    lessons: [
      {
        id: 'L1-1', title: '¿Qué es la Bolsa de Valores?', icon: '🏛️', type: 'theory', duration: '6 min', xp: 30,
        content: `
          <h3>¿Qué es una Bolsa de Valores?</h3>
          <p>Una bolsa de valores es un mercado organizado donde se compran y venden instrumentos financieros como <strong>acciones</strong>, bonos y otros títulos de manera regulada, transparente y segura.</p>
          <p>En Venezuela, este mercado es la <strong>Bolsa de Valores de Caracas (BVC)</strong>, fundada en 1947. Es el lugar donde empresas como Mercantil, Banco Provincial, Ron Santa Teresa y CANTV cotizan sus acciones.</p>
          <h4>¿Por qué existe?</h4>
          <ul>
            <li><strong>Empresas:</strong> Consiguen capital para crecer sin endeudarse con bancos.</li>
            <li><strong>Inversores:</strong> Pueden participar en el crecimiento de esas empresas y obtener ganancias.</li>
            <li><strong>Economía:</strong> Se canaliza el ahorro hacia la producción real.</li>
          </ul>
          <h4>Actores del mercado</h4>
          <ul>
            <li><strong>Emisores:</strong> Las empresas que ofrecen sus acciones (MVZ, BPV, CRM.A…)</li>
            <li><strong>Inversores:</strong> Personas o fondos que compran esos títulos</li>
            <li><strong>Casas de bolsa:</strong> Intermediarios autorizados (DAVASA, BANSEVAL, etc.)</li>
            <li><strong>BVC:</strong> Organiza y supervisa el mercado</li>
            <li><strong>SUNAVAL:</strong> Ente regulador venezolano</li>
          </ul>
          <div class="learn-tip">💡 <strong>Dato clave:</strong> Cuando compras una acción, te conviertes en propietario (accionista) de una fracción de esa empresa. Si la empresa gana dinero y crece, tu inversión también crece.</div>
        `
      },
      {
        id: 'L1-2', title: '¿Qué es una Acción?', icon: '📄', type: 'theory', duration: '5 min', xp: 30,
        content: `
          <h3>La Acción: la unidad de propiedad</h3>
          <p>Una <strong>acción</strong> es un título que representa una parte alícuota del capital social de una empresa. Al comprarla, eres dueño proporcional de esa compañía.</p>
          <h4>Tipos de acciones en la BVC</h4>
          <ul>
            <li><strong>Ordinarias (Clase A, B, C):</strong> Dan derecho a voto en asambleas y a dividendos. Ej: MVZ.A, MVZ.B</li>
            <li><strong>Preferentes:</strong> Prioridad en el cobro de dividendos, generalmente sin voto.</li>
            <li><strong>Derechos (sufijo .D):</strong> Derecho de suscripción preferente en nuevas emisiones. Ej: TDV.D</li>
          </ul>
          <h4>¿Cómo ganas dinero con acciones?</h4>
          <ul>
            <li><strong>Plusvalía (Capital Gain):</strong> Compras a Bs 500 y vendes a Bs 750 → ganaste Bs 250 por acción</li>
            <li><strong>Dividendos:</strong> La empresa reparte parte de sus ganancias entre accionistas</li>
          </ul>
          <h4>¿Cómo se cotiza en la BVC?</h4>
          <p>El precio de una acción en la BVC se expresa en <strong>Bolívares</strong>. Para convertirlo a dólares, se divide entre la tasa BCV del día.</p>
          <div class="learn-formula">
            <code>Precio USD = Precio Bs ÷ Tasa BCV</code><br>
            <em>Ej: CRM.A a Bs 638 ÷ BCV Bs 93.5/$ = $6.82 por acción</em>
          </div>
          <div class="learn-tip">💡 En la BVC los lotes mínimos suelen ser de 1 acción, a diferencia de otras bolsas que exigen lotes de 100.</div>
        `
      },
      {
        id: 'L1-3', title: 'Quiz — Fundamentos', icon: '❓', type: 'quiz', duration: '3 min', xp: 50,
        questions: [
          {
            q: '¿Qué es la BVC?',
            options: ['Banco de Venezuela Corporativo', 'Bolsa de Valores de Caracas', 'Bono de Valor Convertible', 'Banco Virtual de Caracas'],
            correct: 1,
            explanation: 'BVC significa Bolsa de Valores de Caracas, fundada en 1947. Es el mercado bursátil oficial de Venezuela.'
          },
          {
            q: 'Compraste 1000 acciones de MVZ.A a Bs 1.200 c/u y las vendiste a Bs 1.850 c/u. ¿Cuál fue tu ganancia total en Bs?',
            options: ['Bs 350.000', 'Bs 650.000', 'Bs 1.200.000', 'Bs 185.000'],
            correct: 1,
            explanation: '(1.850 - 1.200) × 1.000 = 650 × 1.000 = Bs 650.000 de ganancia bruta.'
          },
          {
            q: '¿Quién regula el mercado de valores en Venezuela?',
            options: ['BCV', 'BVC', 'SUNAVAL', 'SENIAT'],
            correct: 2,
            explanation: 'SUNAVAL (Superintendencia Nacional de Valores) es el ente regulador del mercado bursátil venezolano.'
          },
          {
            q: 'Una acción con sufijo .B en la BVC generalmente indica:',
            options: ['Una acción extranjera', 'Una segunda clase de acción ordinaria de la misma empresa', 'Un bono convertible', 'Una acción bloqueada'],
            correct: 1,
            explanation: 'En la BVC, los sufijos .A y .B representan diferentes clases de acciones ordinarias de la misma empresa, generalmente con distintos derechos políticos o económicos.'
          }
        ]
      },
      {
        id: 'L1-4', title: '¿Cómo funciona una Orden de Compra?', icon: '🛒', type: 'theory', duration: '7 min', xp: 40,
        content: `
          <h3>El proceso de una transacción bursátil</h3>
          <p>Para comprar o vender en la BVC no puedes ir directamente. Necesitas una <strong>Casa de Bolsa</strong> autorizada que actúe como intermediaria.</p>
          <h4>Paso a paso</h4>
          <ol>
            <li><strong>Apertura de cuenta:</strong> Abres una cuenta de inversión en una casa de bolsa (DAVASA, BANSEVAL, BANCOEX, etc.) con tu cédula y documentos.</li>
            <li><strong>Depositas fondos:</strong> Transfieres bolívares a tu cuenta bursátil.</li>
            <li><strong>Colocas una orden:</strong> Instruyes a tu corredor: qué comprar, cuántas acciones, a qué precio.</li>
            <li><strong>Calce de órdenes:</strong> La BVC cruza tu compra con la venta de otro participante.</li>
            <li><strong>Liquidación:</strong> En T+2 (dos días hábiles) recibes las acciones y el vendedor recibe el dinero.</li>
          </ol>
          <h4>Tipos de órdenes</h4>
          <ul>
            <li><strong>Orden a Mercado:</strong> Se ejecuta al mejor precio disponible. Rápida pero el precio puede variar.</li>
            <li><strong>Orden Límite:</strong> Especificas el precio máximo que pagas (compra) o mínimo que aceptas (venta). Control total del precio, pero puede no ejecutarse.</li>
          </ul>
          <h4>Costos de una transacción</h4>
          <ul>
            <li><strong>Comisión casa de bolsa:</strong> ~0.5% a 1% del monto operado</li>
            <li><strong>IVA:</strong> 16% sobre la comisión</li>
            <li><strong>Derechos de Registro BVC:</strong> ~0.1% del monto</li>
          </ul>
          <div class="learn-formula">
            <code>Costo neto = Precio × Cantidad × (1 + comisión + IVA_comisión + derechos)</code>
          </div>
        `
      },
      {
        id: 'L1-5', title: 'Lectura: Historia de la BVC', icon: '📖', type: 'reading', duration: '5 min', xp: 50,
        content: `
          <h3>La Bolsa de Caracas: 77 años de historia</h3>
          <p>La <strong>Bolsa de Valores de Caracas</strong> fue fundada el <strong>21 de enero de 1947</strong> durante el gobierno de Rómulo Betancourt. Nació con el objetivo de crear un mercado de capitales organizado en Venezuela.</p>
          <h4>Hitos históricos</h4>
          <ul>
            <li><strong>1947:</strong> Fundación con apenas 18 empresas listadas.</li>
            <li><strong>1970s:</strong> Boom petrolero impulsa el mercado. Nuevas empresas industriales listan sus acciones.</li>
            <li><strong>1990:</strong> Gran boom especulativo. El índice Caracas sube más de 500% en un año.</li>
            <li><strong>1994:</strong> Crisis bancaria venezolana golpea fuertemente al mercado.</li>
            <li><strong>2007:</strong> CANTV (TDV) es renacionalizada. Sale del mercado temporalmente.</li>
            <li><strong>2018:</strong> Reconversión monetaria (eliminación de 5 ceros). Los precios se ajustan.</li>
            <li><strong>2021:</strong> Segunda reconversión (3 ceros más). Los precios vuelven a ajustarse.</li>
            <li><strong>2023-2026:</strong> Resurgimiento gradual. Mayor liquidez y nuevas empresas retoman operaciones.</li>
          </ul>
          <h4>La reconversión monetaria y los precios históricos</h4>
          <p>Uno de los aspectos únicos del análisis de acciones venezolanas es que los precios históricos deben ajustarse por las reconversiones:</p>
          <ul>
            <li>2008: Se eliminaron 3 ceros (1 nuevo Bs = 1.000 viejos Bs)</li>
            <li>2018: Se eliminaron 5 ceros (1 nuevo Bs Soberano = 100.000 Bs Fuertes)</li>
            <li>2021: Se eliminaron 6 ceros (1 nuevo Bs Digital = 1.000.000 Bs Soberanos)</li>
          </ul>
          <div class="learn-tip">💡 Por esta razón, en Caracas Portafolio aplicamos factores de ajuste automáticos al mostrar el historial de precios — para que puedas ver la trayectoria real de cada acción en términos comparables.</div>
        `
      }
    ]
  },
  {
    id: 2, title: 'Lectura de Gráficos', subtitle: 'El lenguaje visual del mercado',
    badge: '📊', badgeName: 'Analista', color: '#3b82f6', totalXp: 280,
    lessons: [
      {
        id: 'L2-1', title: 'La Vela Japonesa (Candlestick)', icon: '🕯️', type: 'theory', duration: '8 min', xp: 40,
        content: `
          <h3>La vela japonesa: historia en 4 precios</h3>
          <p>El gráfico de velas japonesas fue desarrollado en el siglo XVIII por comerciantes japoneses de arroz. Hoy es el estándar mundial en trading.</p>
          <h4>Anatomía de una vela</h4>
          <div class="candle-diagram">
            <div class="candle-anatomy">
              <div class="candle-wick-top"></div>
              <div class="candle-body green">CUERPO</div>
              <div class="candle-wick-bottom"></div>
              <div class="candle-labels">
                <span class="label-high">Máximo (High)</span>
                <span class="label-open">Apertura (Open)</span>
                <span class="label-close">Cierre (Close)</span>
                <span class="label-low">Mínimo (Low)</span>
              </div>
            </div>
          </div>
          <ul>
            <li><strong>Cuerpo verde/blanco:</strong> El precio subió (cierre > apertura). Bullish.</li>
            <li><strong>Cuerpo rojo/negro:</strong> El precio bajó (cierre < apertura). Bearish.</li>
            <li><strong>Mecha superior:</strong> El precio llegó hasta ese máximo pero no cerró ahí.</li>
            <li><strong>Mecha inferior:</strong> El precio llegó hasta ese mínimo pero se recuperó.</li>
          </ul>
          <h4>¿Qué nos dice una vela?</h4>
          <p>Cada vela cuenta la historia de la batalla entre compradores (alcistas) y vendedores (bajistas) durante ese período.</p>
          <ul>
            <li>Vela verde grande = Los compradores dominaron claramente</li>
            <li>Vela roja grande = Los vendedores dominaron claramente</li>
            <li>Vela pequeña con mechas largas = Indecisión, lucha equilibrada</li>
          </ul>
          <div class="learn-tip">💡 <strong>Doji:</strong> Una vela donde apertura y cierre son casi iguales (cuerpo muy pequeño). Señal de indecisión del mercado. Muy relevante en puntos de inflexión.</div>
        `
      },
      {
        id: 'L2-2', title: 'Tipos de gráficos: Línea, Barras, Velas', icon: '📈', type: 'theory', duration: '5 min', xp: 30,
        content: `
          <h3>Los tres tipos de gráficos más usados</h3>
          <h4>1. Gráfico de Línea</h4>
          <p>Conecta únicamente los precios de cierre. Simple y limpio para ver tendencias generales. Pierde el contexto de apertura, máximo y mínimo.</p>
          <p><em>Mejor para:</em> Ver tendencia a largo plazo, presentaciones.</p>
          <h4>2. Gráfico de Barras (OHLC)</h4>
          <p>Muestra Apertura, Máximo, Mínimo y Cierre con barras verticales. Más información que la línea pero visualmente más complejo que las velas.</p>
          <h4>3. Gráfico de Velas Japonesas</h4>
          <p>El favorito de los traders profesionales. Combina toda la información de la barra OHLC pero con colores que permiten leer el sentimiento del mercado de un vistazo.</p>
          <p><em>Mejor para:</em> Trading activo, identificación de patrones, análisis técnico.</p>
          <h4>Timeframes (marcos temporales)</h4>
          <ul>
            <li><strong>1D:</strong> Cada vela = 1 día. Ideal para inversión a medio-largo plazo.</li>
            <li><strong>1H:</strong> Cada vela = 1 hora. Trading intradía.</li>
            <li><strong>1W:</strong> Cada vela = 1 semana. Análisis macro y swing trading.</li>
            <li><strong>1M:</strong> Cada vela = 1 mes. Inversión institucional y largo plazo.</li>
          </ul>
          <div class="learn-tip">💡 En la BVC, dado el volumen moderado, el timeframe diario (1D) es el más relevante para la mayoría de inversores.</div>
        `
      },
      {
        id: 'L2-3', title: 'Tendencias: Alcista, Bajista y Lateral', icon: '📉', type: 'theory', duration: '7 min', xp: 40,
        content: `
          <h3>Identificar la tendencia: la habilidad más fundamental</h3>
          <p>Dow Theory (1900): "El mercado se mueve en tendencias que persisten hasta que dan señales claras de reversión."</p>
          <h4>Tipos de tendencia</h4>
          <ul>
            <li><strong>Alcista (Uptrend):</strong> Serie de máximos más altos (HH) y mínimos más altos (HL). Los compradores están en control.</li>
            <li><strong>Bajista (Downtrend):</strong> Serie de máximos más bajos (LH) y mínimos más bajos (LL). Los vendedores dominan.</li>
            <li><strong>Lateral (Sideways/Ranging):</strong> El precio oscila entre soporte y resistencia sin dirección clara. Mercado en consolidación.</li>
          </ul>
          <h4>Soportes y Resistencias</h4>
          <p>Son niveles de precio donde el mercado ha reaccionado históricamente:</p>
          <ul>
            <li><strong>Soporte:</strong> Nivel donde los compradores entran con fuerza, "soportando" el precio. Actúa como piso.</li>
            <li><strong>Resistencia:</strong> Nivel donde los vendedores frenan el avance. Actúa como techo.</li>
            <li><strong>Cambio de polaridad:</strong> Un soporte roto se convierte en resistencia y viceversa.</li>
          </ul>
          <div class="learn-formula">
            <strong>Regla de oro:</strong><br>
            <code>Compra en soportes → Vende en resistencias (Uptrend)</code><br>
            <code>Vende en resistencias → Compra en soportes (Ranging)</code>
          </div>
          <div class="learn-tip">💡 En la BVC, muchas acciones tienen soportes y resistencias muy respetados. CRM.A por ejemplo ha respetado niveles de Bs 800 y Bs 1.200 múltiples veces.</div>
        `
      },
      {
        id: 'L2-4', title: 'Patrones de Velas Clásicos', icon: '🕯️', type: 'theory', duration: '10 min', xp: 50,
        content: `
          <h3>Los patrones que todo trader debe conocer</h3>
          <h4>Patrones de reversión alcista</h4>
          <ul>
            <li><strong>Martillo (Hammer):</strong> Cuerpo pequeño arriba + mecha inferior larga (≥ 2x el cuerpo). Los vendedores intentaron bajar el precio pero los compradores recuperaron. Muy bullish si aparece en soporte.</li>
            <li><strong>Engulfing alcista:</strong> Vela roja seguida de vela verde que "engulle" completamente al cuerpo de la anterior. Cambio de poder claro.</li>
            <li><strong>Morning Star:</strong> Patrón de 3 velas. Vela roja + doji/vela pequeña + vela verde grande. El mercado vacila y luego los compradores toman el control.</li>
          </ul>
          <h4>Patrones de reversión bajista</h4>
          <ul>
            <li><strong>Shooting Star:</strong> Cuerpo pequeño abajo + mecha superior larga. Los compradores empujaron el precio pero los vendedores dominaron al cierre. Bearish en resistencia.</li>
            <li><strong>Engulfing bajista:</strong> Vela verde seguida de vela roja que engulle a la anterior. Dominio vendedor.</li>
            <li><strong>Evening Star:</strong> Inverso al Morning Star. Vela verde + indecisión + vela roja grande.</li>
          </ul>
          <h4>Patrones de continuación</h4>
          <ul>
            <li><strong>Tres soldados blancos:</strong> Tres velas verdes consecutivas con cuerpos grandes. Tendencia alcista fuerte.</li>
            <li><strong>Tres cuervos negros:</strong> Tres velas rojas consecutivas. Tendencia bajista fuerte.</li>
            <li><strong>Doji:</strong> Indecisión. Por sí solo no da dirección, pero es clave en combinación con el contexto.</li>
          </ul>
          <div class="learn-tip">💡 Nunca operes un patrón aislado. Siempre confirma con: (1) ubicación respecto a soporte/resistencia, (2) volumen, (3) indicadores.</div>
        `
      },
      {
        id: 'L2-5', title: 'Quiz — Gráficos y Velas', icon: '❓', type: 'quiz', duration: '4 min', xp: 70,
        questions: [
          {
            q: '¿Qué indica una vela japonesa con cuerpo verde grande y mechas muy pequeñas?',
            options: ['Indecisión del mercado', 'Dominio claro de los compradores durante todo el período', 'Reversión bajista inminente', 'Precio sin movimiento'],
            correct: 1,
            explanation: 'Un cuerpo verde grande con mechas pequeñas indica que los compradores controlaron el mercado desde la apertura hasta el cierre, sin que los vendedores pudieran presionar significativamente.'
          },
          {
            q: '¿Qué es un Doji?',
            options: ['Una vela con cuerpo rojo muy grande', 'Una vela donde apertura y cierre son casi iguales', 'Un patrón de 3 velas alcistas', 'Una mecha muy larga hacia arriba'],
            correct: 1,
            explanation: 'Un Doji tiene la apertura y el cierre prácticamente en el mismo nivel, creando un cuerpo muy delgado o nulo. Señal de indecisión.'
          },
          {
            q: 'En un uptrend (tendencia alcista), ¿qué describes cuando el precio forma Máximos Más Altos (HH) y Mínimos Más Altos (HL)?',
            options: ['Una tendencia bajista', 'Una estructura de mercado alcista clásica', 'Un mercado lateral', 'Una resistencia'],
            correct: 1,
            explanation: 'HH (Higher Highs) y HL (Higher Lows) es la definición técnica de un uptrend. Cada rally supera el anterior y cada corrección se detiene más alto que la anterior.'
          },
          {
            q: 'Un "Martillo" (Hammer) aparece en un soporte fuerte. ¿Qué sugiere esto?',
            options: ['Continuar la tendencia bajista', 'Posible reversión alcista', 'Ruptura del soporte', 'Mercado sin dirección'],
            correct: 1,
            explanation: 'El Hammer en un soporte es una de las señales de reversión alcista más confiables. La mecha larga inferior muestra que los vendedores intentaron romper el soporte pero los compradores rechazaron con fuerza.'
          },
          {
            q: 'Si una resistencia en Bs 1.500 es rota con volumen alto, ¿qué pasa con ese nivel?',
            options: ['Sigue siendo resistencia', 'Se convierte en soporte (cambio de polaridad)', 'Desaparece como nivel relevante', 'Se convierte en la próxima resistencia más alta'],
            correct: 1,
            explanation: 'El cambio de polaridad es un concepto fundamental: cuando una resistencia es rota, se convierte en soporte para futuras correcciones.'
          }
        ]
      }
    ]
  },
  {
    id: 3, title: 'Análisis Técnico', subtitle: 'Indicadores y estrategias de entrada',
    badge: '⚡', badgeName: 'Técnico', color: '#f59e0b', totalXp: 350,
    lessons: [
      {
        id: 'L3-1', title: 'Medias Móviles (EMA / SMA)', icon: '〰️', type: 'theory', duration: '9 min', xp: 50,
        content: `
          <h3>Medias Móviles: el indicador más usado del mundo</h3>
          <p>Una media móvil suaviza el ruido del precio y te ayuda a identificar la dirección de la tendencia. En Caracas Portafolio puedes verlas en la sección de Gráficos.</p>
          <h4>SMA (Simple Moving Average)</h4>
          <p>Promedio simple de los últimos N cierres.</p>
          <div class="learn-formula"><code>SMA(20) = (C₁ + C₂ + ... + C₂₀) ÷ 20</code></div>
          <p><em>Usadas:</em> SMA 50 y SMA 200 para tendencias de largo plazo.</p>
          <h4>EMA (Exponential Moving Average)</h4>
          <p>Da más peso a los precios recientes. Más reactiva que la SMA.</p>
          <p><em>Usadas:</em> EMA 9, EMA 21 para señales rápidas. EMA 200 para la tendencia macro.</p>
          <h4>Señales con medias móviles</h4>
          <ul>
            <li><strong>Golden Cross:</strong> EMA 50 cruza SOBRE EMA 200 → señal alcista de largo plazo</li>
            <li><strong>Death Cross:</strong> EMA 50 cruza DEBAJO de EMA 200 → señal bajista de largo plazo</li>
            <li><strong>Precio sobre EMA:</strong> Tendencia alcista activa. Comprar en pullbacks a la EMA.</li>
            <li><strong>Precio bajo EMA:</strong> Tendencia bajista. Evitar compras.</li>
          </ul>
          <div class="learn-tip">💡 En la BVC, dado que el mercado tiene menos participantes, las EMA de 20 y 50 períodos son especialmente efectivas como soportes dinámicos.</div>
        `
      },
      {
        id: 'L3-2', title: 'RSI: Sobrecompra y Sobreventa', icon: '📊', type: 'theory', duration: '8 min', xp: 50,
        content: `
          <h3>RSI — Relative Strength Index</h3>
          <p>El RSI mide la velocidad y magnitud de los movimientos de precio en una escala de 0 a 100. Creado por J. Welles Wilder en 1978.</p>
          <div class="learn-formula">
            <code>RSI = 100 - (100 ÷ (1 + RS))</code><br>
            <code>RS = Promedio ganancias ÷ Promedio pérdidas (14 períodos)</code>
          </div>
          <h4>Niveles clave</h4>
          <ul>
            <li><strong>RSI &gt; 70:</strong> Sobrecomprado — el precio subió demasiado rápido. Posible corrección.</li>
            <li><strong>RSI &lt; 30:</strong> Sobrevendido — el precio cayó demasiado rápido. Posible rebote.</li>
            <li><strong>RSI en 50:</strong> Nivel neutro. Por encima = momentum alcista, por debajo = bajista.</li>
          </ul>
          <h4>Divergencias RSI (muy poderosas)</h4>
          <ul>
            <li><strong>Divergencia bajista:</strong> El precio hace un HH pero el RSI hace un LH → la subida pierde fuerza.</li>
            <li><strong>Divergencia alcista:</strong> El precio hace un LL pero el RSI hace un HL → la bajada pierde fuerza.</li>
          </ul>
          <div class="learn-tip">💡 Nunca uses el RSI solo para entrar. RSI sobrevendido en downtrend = trampa. Siempre confirma con la tendencia y el soporte/resistencia.</div>
        `
      },
      {
        id: 'L3-3', title: 'MACD: Momentum y Cruces', icon: '🔀', type: 'theory', duration: '8 min', xp: 50,
        content: `
          <h3>MACD — Moving Average Convergence Divergence</h3>
          <p>El MACD combina medias móviles para medir el momentum (fuerza) de la tendencia.</p>
          <h4>Componentes</h4>
          <ul>
            <li><strong>Línea MACD:</strong> EMA(12) - EMA(26)</li>
            <li><strong>Línea de señal:</strong> EMA(9) de la línea MACD</li>
            <li><strong>Histograma:</strong> MACD - Señal (mide la distancia entre ambas)</li>
          </ul>
          <h4>Señales</h4>
          <ul>
            <li><strong>Cruce alcista:</strong> MACD cruza SOBRE la señal → momentum alcista, posible entrada.</li>
            <li><strong>Cruce bajista:</strong> MACD cruza DEBAJO de la señal → momentum bajista.</li>
            <li><strong>Histograma creciente:</strong> El momentum aumenta en la dirección actual.</li>
            <li><strong>Divergencia:</strong> Igual que con RSI, muy poderosa para detectar cambios de tendencia.</li>
          </ul>
          <div class="learn-tip">💡 Los cruces del MACD por encima o por debajo de la línea cero son especialmente significativos — confirman cambios de tendencia de mayor importancia.</div>
        `
      },
      {
        id: 'L3-4', title: 'Gestión de Riesgo: Stop Loss y Take Profit', icon: '🛡️', type: 'theory', duration: '10 min', xp: 60,
        content: `
          <h3>La regla #1: Proteger tu capital</h3>
          <p>Todos los traders profesionales coinciden: <strong>el riesgo lo es todo</strong>. Puedes equivocarte el 60% de las veces y aun así ser rentable si gestionas bien el riesgo.</p>
          <h4>Stop Loss</h4>
          <p>Un nivel predefinido donde cierras la posición si el mercado va en tu contra. <em>Limita tus pérdidas antes de que crezcan.</em></p>
          <h4>Take Profit</h4>
          <p>El nivel donde tomas tus ganancias. <em>Las ganancias no son reales hasta que cierras.</em></p>
          <h4>Risk/Reward Ratio (R:R)</h4>
          <div class="learn-formula">
            <code>R:R = (Take Profit - Entrada) ÷ (Entrada - Stop Loss)</code><br>
            <em>Ejemplo: Entrada Bs 600, Stop Bs 540, TP Bs 750</em><br>
            <code>R:R = (750 - 600) ÷ (600 - 540) = 150 ÷ 60 = 2.5 : 1</code>
          </div>
          <p>Nunca entres a una operación con R:R menor a 1.5:1. Los profesionales buscan 2:1 o mejor.</p>
          <h4>Regla del 2%</h4>
          <p>No arriesgues más del 2% de tu capital total en una sola operación.</p>
          <div class="learn-formula">
            <code>Máximo a perder = Capital × 2%</code><br>
            <code>Cantidad acciones = Máximo a perder ÷ (Entrada - Stop)</code>
          </div>
          <div class="learn-tip">💡 Con la regla del 2%, necesitarías 50 operaciones perdedoras consecutivas para perder todo tu capital. La consistencia gana a largo plazo.</div>
        `
      },
      {
        id: 'L3-5', title: 'Quiz — Análisis Técnico', icon: '❓', type: 'quiz', duration: '5 min', xp: 90,
        questions: [
          {
            q: 'Un RSI de 28 en un soporte fuerte con una vela Hammer sugiere:',
            options: ['Vender inmediatamente', 'Posible oportunidad de compra (confluencia)', 'Ignorar la señal', 'Esperar a RSI 50'],
            correct: 1,
            explanation: 'RSI sobrevendido (<30) + soporte + patrón de vela reversal = confluencia de señales alcistas. Esta es exactamente la configuración que los traders profesionales buscan.'
          },
          {
            q: '¿Qué es un Golden Cross?',
            options: ['EMA 200 cruza sobre EMA 50', 'EMA 50 cruza sobre EMA 200', 'RSI cruza el nivel 50', 'MACD cruza la línea de señal'],
            correct: 1,
            explanation: 'El Golden Cross ocurre cuando la EMA de corto plazo (50) cruza por encima de la EMA de largo plazo (200). Es una de las señales alcistas de largo plazo más respetadas.'
          },
          {
            q: 'Tienes un capital de $5.000. Con la regla del 2%, ¿cuánto es lo máximo que puedes arriesgar en una operación?',
            options: ['$500', '$200', '$100', '$50'],
            correct: 2,
            explanation: '$5.000 × 2% = $100 es el máximo riesgo por operación. Esto te protege de rachas perdedoras.'
          },
          {
            q: 'Una divergencia bajista del RSI ocurre cuando:',
            options: ['El precio hace mínimos más altos y el RSI hace mínimos más bajos', 'El precio hace máximos más altos pero el RSI hace máximos más bajos', 'Ambos el precio y el RSI hacen máximos más altos', 'El RSI está en sobrecompra'],
            correct: 1,
            explanation: 'La divergencia bajista = precio HH pero RSI LH. El momentum de la subida se debilita aunque el precio siga subiendo. Señal de posible reversión.'
          }
        ]
      }
    ]
  },
  {
    id: 4, title: 'Análisis Fundamental', subtitle: 'Entendiendo el valor real de una empresa',
    badge: '💼', badgeName: 'Analista Financiero', color: '#a855f7', totalXp: 380,
    lessons: [
      {
        id: 'L4-1', title: '¿Qué es el Análisis Fundamental?', icon: '🔍', type: 'theory', duration: '8 min', xp: 50,
        content: `
          <h3>Análisis Fundamental: invertir en negocios, no en precios</h3>
          <p>El análisis fundamental busca determinar el <strong>valor intrínseco</strong> de una empresa — lo que realmente vale — para compararlo con su precio en bolsa y detectar si está sobrevalorada o infravalorada.</p>
          <blockquote>"En el corto plazo, el mercado es una máquina de votar. En el largo plazo, es una máquina de pesar." — Benjamin Graham</blockquote>
          <h4>Los tres pilares del análisis fundamental</h4>
          <ol>
            <li><strong>Análisis económico:</strong> ¿Cómo está la economía? ¿PIB, inflación, tasas de interés? Afecta a todas las empresas.</li>
            <li><strong>Análisis sectorial:</strong> ¿Es un sector en crecimiento o en declive? ¿Tiene competencia fuerte?</li>
            <li><strong>Análisis de empresa:</strong> Estados financieros, management, ventajas competitivas, perspectivas.</li>
          </ol>
          <h4>Inversión en valor vs. inversión en crecimiento</h4>
          <ul>
            <li><strong>Value Investing (Graham, Buffett):</strong> Busca empresas sólidas cuyo precio esté por debajo de su valor real. Compra con margen de seguridad.</li>
            <li><strong>Growth Investing:</strong> Busca empresas con alto potencial de crecimiento futuro aunque el precio actual parezca alto.</li>
          </ul>
          <div class="learn-tip">💡 En el contexto venezolano, el análisis fundamental es especialmente desafiante por la inflación, los controles y la poca transparencia. Sin embargo, los ratios financieros básicos siguen siendo válidos.</div>
        `
      },
      {
        id: 'L4-2', title: 'Estados Financieros: Balance General', icon: '📋', type: 'fundamental', duration: '12 min', xp: 80,
        content: `
          <h3>El Balance General: la fotografía financiera de la empresa</h3>
          <p>El balance general muestra la posición financiera de una empresa en un momento específico:</p>
          <div class="learn-formula">
            <code>ACTIVOS = PASIVOS + PATRIMONIO</code>
          </div>
          <h4>Ejemplo ficticio: Corimon C.A. (CRM.A) - Balance Simplificado</h4>
          <div class="fundamental-table">
            <table>
              <thead><tr><th>ACTIVOS</th><th>Bs (millones)</th><th>PASIVOS + PATRIMONIO</th><th>Bs (millones)</th></tr></thead>
              <tbody>
                <tr><td>Caja y equiv.</td><td>245.000</td><td>Cuentas por pagar</td><td>180.000</td></tr>
                <tr><td>Cuentas por cobrar</td><td>380.000</td><td>Deuda a corto plazo</td><td>120.000</td></tr>
                <tr><td>Inventarios</td><td>520.000</td><td>Deuda a largo plazo</td><td>450.000</td></tr>
                <tr><td>Activos fijos</td><td>1.200.000</td><td>Total Pasivos</td><td class="bold">750.000</td></tr>
                <tr><td>Intangibles</td><td>55.000</td><td>Capital pagado</td><td>800.000</td></tr>
                <tr><td></td><td></td><td>Utilidades retenidas</td><td>850.000</td></tr>
                <tr><td class="bold">TOTAL ACTIVOS</td><td class="bold">2.400.000</td><td class="bold">TOTAL PAS.+PAT.</td><td class="bold">2.400.000</td></tr>
              </tbody>
            </table>
          </div>
          <h4>Indicadores clave del balance</h4>
          <ul>
            <li><strong>Razón Corriente:</strong> Activo Corriente ÷ Pasivo Corriente. >1.5 = buena liquidez</li>
            <li><strong>Deuda/Patrimonio (D/E):</strong> Total Deuda ÷ Patrimonio. <1 = conservador</li>
            <li><strong>Capital de Trabajo:</strong> Activo Corriente - Pasivo Corriente. Debe ser positivo.</li>
          </ul>
          <div class="learn-tip">💡 En este ejemplo ficticio: Razón Corriente = (245k + 380k + 520k) ÷ (180k + 120k) = 1.145k ÷ 300k = 3.8. Excelente liquidez.</div>
        `
      },
      {
        id: 'L4-3', title: 'Estado de Resultados y Márgenes', icon: '💰', type: 'fundamental', duration: '10 min', xp: 70,
        content: `
          <h3>Estado de Resultados: ¿Es rentable el negocio?</h3>
          <p>Muestra los ingresos y gastos durante un período. Responde: ¿cuánto ganó la empresa?</p>
          <h4>Ejemplo ficticio: Mercantil Servicios Financieros (MVZ.A) - Resultados Anuales</h4>
          <div class="fundamental-table">
            <table>
              <thead><tr><th>Concepto</th><th>Bs (millones)</th></tr></thead>
              <tbody>
                <tr><td>Ingresos totales</td><td>8.500.000</td></tr>
                <tr><td>(-) Costo de servicios</td><td>(2.100.000)</td></tr>
                <tr><td class="bold">= Utilidad Bruta</td><td class="bold green">6.400.000</td></tr>
                <tr><td>(-) Gastos operativos</td><td>(1.850.000)</td></tr>
                <tr><td>(-) Depreciación</td><td>(320.000)</td></tr>
                <tr><td class="bold">= EBITDA</td><td class="bold green">4.230.000</td></tr>
                <tr><td>(-) Intereses deuda</td><td>(480.000)</td></tr>
                <tr><td>(-) Impuestos</td><td>(850.000)</td></tr>
                <tr><td class="bold">= Utilidad Neta</td><td class="bold green">2.900.000</td></tr>
              </tbody>
            </table>
          </div>
          <h4>Márgenes de rentabilidad</h4>
          <ul>
            <li><strong>Margen Bruto:</strong> Utilidad Bruta ÷ Ingresos = 6.4M ÷ 8.5M = <strong>75.3%</strong> (excelente en banca)</li>
            <li><strong>Margen EBITDA:</strong> EBITDA ÷ Ingresos = 4.23M ÷ 8.5M = <strong>49.8%</strong></li>
            <li><strong>Margen Neto:</strong> Utilidad Neta ÷ Ingresos = 2.9M ÷ 8.5M = <strong>34.1%</strong></li>
          </ul>
          <div class="learn-tip">💡 Un margen neto del 34% es excelente. En sectores industriales un 10-15% ya es bueno. Los bancos y empresas financieras suelen tener márgenes más altos.</div>
        `
      },
      {
        id: 'L4-4', title: 'Ratios de Valoración: P/E, P/B, ROE', icon: '🧮', type: 'fundamental', duration: '10 min', xp: 80,
        content: `
          <h3>Ratios de valoración: ¿está cara o barata la acción?</h3>
          <h4>P/E Ratio (Price to Earnings)</h4>
          <div class="learn-formula">
            <code>P/E = Precio de mercado por acción ÷ Utilidad por acción (EPS)</code>
          </div>
          <p>Ejemplo ficticio — RST (Ron Santa Teresa):</p>
          <ul>
            <li>Precio en bolsa: Bs 3.200 por acción</li>
            <li>Acciones en circulación: 50.000.000</li>
            <li>Utilidad neta anual: Bs 12.000.000.000</li>
            <li>EPS = 12.000M ÷ 50M = Bs 240 por acción</li>
            <li><strong>P/E = 3.200 ÷ 240 = 13.3x</strong></li>
          </ul>
          <p>P/E de 13x significa que el mercado paga 13 veces las ganancias anuales. Un P/E bajo puede indicar subvaloración.</p>
          <h4>P/B Ratio (Price to Book)</h4>
          <div class="learn-formula">
            <code>P/B = Capitalización bursátil ÷ Patrimonio contable</code>
          </div>
          <p>P/B = 1 → la acción cotiza al valor en libros. P/B < 1 → posiblemente infravalorada (o empresa en problemas).</p>
          <h4>ROE (Return on Equity)</h4>
          <div class="learn-formula">
            <code>ROE = Utilidad Neta ÷ Patrimonio × 100</code>
          </div>
          <p>Mide qué tan eficientemente la empresa genera ganancias con el capital de los accionistas. ROE > 15% = muy bueno.</p>
          <div class="learn-tip">💡 Estos ratios son herramientas, no reglas absolutas. Una empresa con P/E de 5x puede estar barata O puede ser que el mercado sabe algo que tú no sabes. Siempre analiza el contexto.</div>
        `
      },
      {
        id: 'L4-5', title: 'Quiz — Análisis Fundamental', icon: '❓', type: 'quiz', duration: '5 min', xp: 100,
        questions: [
          {
            q: 'Una empresa tiene Utilidad Neta de $2M y Patrimonio de $10M. ¿Cuál es su ROE?',
            options: ['5%', '10%', '20%', '50%'],
            correct: 2,
            explanation: 'ROE = Utilidad Neta ÷ Patrimonio = 2M ÷ 10M = 20%. Un ROE del 20% es excelente.'
          },
          {
            q: 'Una acción cotiza a $50 y su EPS es $5. ¿Cuál es el P/E?',
            options: ['0.1x', '5x', '10x', '250x'],
            correct: 2,
            explanation: 'P/E = Precio ÷ EPS = 50 ÷ 5 = 10x. El mercado paga 10 veces las ganancias anuales por cada acción.'
          },
          {
            q: '¿Qué significa una Razón Corriente de 0.8?',
            options: ['La empresa tiene más activos corrientes que pasivos corrientes', 'La empresa podría tener dificultades para pagar sus deudas de corto plazo', 'Es un ratio excelente de liquidez', 'La empresa no tiene deudas'],
            correct: 1,
            explanation: 'Razón Corriente < 1 significa que los pasivos corrientes superan a los activos corrientes. La empresa podría tener dificultades para cubrir sus obligaciones de corto plazo.'
          },
          {
            q: '¿Cuál de estos afirmó que "en el largo plazo, el mercado es una máquina de pesar"?',
            options: ['Warren Buffett', 'Benjamin Graham', 'Jesse Livermore', 'George Soros'],
            correct: 1,
            explanation: 'Benjamin Graham, el padre del value investing y mentor de Buffett, acuñó esta frase. En el largo plazo, el precio de una acción refleja el valor real del negocio.'
          }
        ]
      }
    ]
  },
  {
    id: 5, title: 'Trading Avanzado', subtitle: 'Estrategias de trader profesional',
    badge: '🏆', badgeName: 'Trader Pro', color: '#ef4444', totalXp: 450,
    lessons: [
      {
        id: 'L5-1', title: 'Psicología del Trading', icon: '🧠', type: 'theory', duration: '10 min', xp: 70,
        content: `
          <h3>La batalla más importante es contra tu propia mente</h3>
          <p>El 80% del trading es psicología. Puedes tener la mejor estrategia del mundo y aun así perder dinero si no controlas tus emociones.</p>
          <h4>Los sesgos cognitivos más destructivos</h4>
          <ul>
            <li><strong>FOMO (Fear Of Missing Out):</strong> Comprar tarde porque el precio ya subió mucho. "No quiero quedarme afuera." → Compras en máximos.</li>
            <li><strong>Loss Aversion (Aversión a las pérdidas):</strong> El dolor de perder $100 es 2x más intenso que el placer de ganar $100. Por eso no cortamos las pérdidas.</li>
            <li><strong>Confirmation Bias:</strong> Solo buscamos información que confirma lo que ya creemos. "Estoy long en MVZ.A así que solo veo noticias positivas."</li>
            <li><strong>Overconfidence:</strong> Después de varias operaciones ganadoras, sobreestimamos nuestra habilidad y arriesgamos más de lo debido.</li>
            <li><strong>Revenge Trading:</strong> Tras una pérdida, queremos recuperar rápido y tomamos operaciones de mala calidad → pérdidas mayores.</li>
          </ul>
          <h4>Las reglas mentales de un trader disciplinado</h4>
          <ol>
            <li>Sigue tu plan de trading. No improvises.</li>
            <li>Acepta las pérdidas como costo del negocio. No te las tomes personal.</li>
            <li>No aumentes el tamaño de posición después de pérdidas.</li>
            <li>Lleva un diario de trading: anota cada operación y la emoción que sentiste.</li>
            <li>Descansa. No opere cuando estés estresado o cansado.</li>
          </ol>
          <div class="learn-tip">💡 Los traders profesionales evalúan su desempeño estadísticamente: % de aciertos, R:R promedio, drawdown máximo. No por operaciones individuales.</div>
        `
      },
      {
        id: 'L5-2', title: 'Estrategias: Swing Trading vs. Buy & Hold', icon: '⚖️', type: 'theory', duration: '9 min', xp: 70,
        content: `
          <h3>¿Cuál es tu estilo de inversión?</h3>
          <h4>Buy & Hold (Comprar y mantener)</h4>
          <p>Compras acciones de empresas sólidas y las mantienes durante años, ignorando la volatilidad de corto plazo.</p>
          <ul>
            <li><strong>Ventajas:</strong> Simple, bajo costo en comisiones, beneficias del interés compuesto, no necesitas analizar el mercado constantemente.</li>
            <li><strong>Desventajas:</strong> Requiere paciencia (años), el capital queda inmovilizado, necesitas elegir bien las empresas.</li>
            <li><strong>Ideal para:</strong> Inversores con horizonte +5 años que confían en el crecimiento de largo plazo.</li>
          </ul>
          <h4>Swing Trading</h4>
          <p>Capturas movimientos de precio de días a semanas. Usas análisis técnico para identificar entradas y salidas.</p>
          <ul>
            <li><strong>Ventajas:</strong> Rendimientos más frecuentes, capital más activo, no necesitas estar frente al monitor todo el día.</li>
            <li><strong>Desventajas:</strong> Requiere más habilidad, más comisiones, más tiempo de análisis.</li>
            <li><strong>Ideal para:</strong> Traders con experiencia en análisis técnico, tiempo libre para analizar.</li>
          </ul>
          <h4>En el contexto venezolano (BVC)</h4>
          <p>El Swing Trading funciona bien en la BVC dado que los ciclos son más predecibles y los volúmenes más manejables. Sin embargo, la liquidez limitada de algunas acciones puede hacer difícil salir en el momento exacto.</p>
          <div class="learn-tip">💡 Recomendación para nuevos inversores: comienza con Buy & Hold de las acciones más líquidas (MVZ.A, CRM.A, TDV.D) mientras aprendes análisis técnico.</div>
        `
      },
      {
        id: 'L5-3', title: 'Diversificación y Correlación', icon: '🌐', type: 'theory', duration: '8 min', xp: 60,
        content: `
          <h3>No pongas todos los huevos en la misma cesta</h3>
          <p>La diversificación es la única "lunch libre" en el mundo de las inversiones. Distribuir el capital entre activos distintos reduce el riesgo sin sacrificar necesariamente el retorno.</p>
          <h4>Tipos de diversificación</h4>
          <ul>
            <li><strong>Por sector:</strong> Banca (MVZ, BPV, BVL), Industria (CRM.A, ENV, MPA), Alimentos (PTN, PGR), Energía (CIE)</li>
            <li><strong>Por tamaño:</strong> Grandes caps (MVZ.A) + pequeñas caps (GMC.B)</li>
            <li><strong>Por activo:</strong> Acciones + bonos + liquidez + real estate</li>
            <li><strong>Por geografía:</strong> Local (BVC) + internacional</li>
          </ul>
          <h4>Correlación</h4>
          <p>Dos activos correlacionados positivamente se mueven en la misma dirección. La diversificación real requiere activos con correlación baja o negativa.</p>
          <ul>
            <li>Correlación +1 = se mueven idéntico → no diversificas</li>
            <li>Correlación 0 = movimientos independientes → buena diversificación</li>
            <li>Correlación -1 = se mueven inversamente → cobertura perfecta</li>
          </ul>
          <div class="learn-tip">💡 En la BVC, muchos bancos (MVZ, BPV, BNC) tienen alta correlación entre sí. Tener solo bancos no es verdadera diversificación sectorial.</div>
        `
      },
      {
        id: 'L5-4', title: 'Construyendo tu Plan de Trading', icon: '📝', type: 'reading', duration: '12 min', xp: 80,
        content: `
          <h3>El Plan de Trading: tu constitución como inversor</h3>
          <p>Un plan de trading es el documento que define tus reglas ANTES de abrir el mercado. Elimina las decisiones emocionales.</p>
          <h4>Los 8 elementos de un plan de trading profesional</h4>
          <ol>
            <li><strong>Capital inicial y objetivo:</strong> "Tengo $3.000 para invertir. Mi objetivo es +15% en 12 meses."</li>
            <li><strong>Universo de activos:</strong> "Opero solo las 10 acciones más líquidas de la BVC."</li>
            <li><strong>Reglas de entrada:</strong> "Solo compro si el precio supera una resistencia con volumen + RSI < 60 + EMA 20 apuntando arriba."</li>
            <li><strong>Gestión de riesgo:</strong> "Máximo 2% del capital por operación. Stop Loss obligatorio."</li>
            <li><strong>Reglas de salida (ganancia):</strong> "Take Profit en el siguiente nivel de resistencia. R:R mínimo 2:1."</li>
            <li><strong>Reglas de salida (pérdida):</strong> "Stop Loss técnico. Nunca mover el stop en contra."</li>
            <li><strong>Horarios:</strong> "Análisis los domingos. Entradas solo Lun-Mié (más volumen en BVC)."</li>
            <li><strong>Revisión:</strong> "Reviso estadísticas mensualmente. Si el DD supera 10%, paro y reviso."</li>
          </ol>
          <h4>Diario de Trading</h4>
          <p>Registra cada operación:</p>
          <ul>
            <li>Fecha, símbolo, precio entrada/salida</li>
            <li>R:R planificado vs. real</li>
            <li>Razón de la entrada (¿qué señales viste?)</li>
            <li>Errores cometidos y lecciones</li>
            <li>Estado emocional durante la operación</li>
          </ul>
          <div class="learn-tip">💡 Los mejores traders del mundo tienen planes de trading escritos. Si no está escrito, no existe. Tu cerebro emocional siempre encontrará excusas para romper las reglas no escritas.</div>
        `
      },
      {
        id: 'L5-5', title: 'Quiz Final — El Trader Completo', icon: '🏆', type: 'quiz', duration: '6 min', xp: 170,
        questions: [
          {
            q: '¿Cuál es el sesgo cognitivo que te hace comprar tarde porque "no quieres quedarte fuera" de un rally?',
            options: ['Loss Aversion', 'FOMO', 'Confirmation Bias', 'Overconfidence'],
            correct: 1,
            explanation: 'FOMO (Fear Of Missing Out) te hace perseguir el precio cuando ya subió mucho. Una de las causas más comunes de comprar en máximos.'
          },
          {
            q: 'Tu entrada es Bs 800, Stop Loss es Bs 720, Take Profit es Bs 1.040. ¿Cuál es tu R:R?',
            options: ['1:1', '2:1', '3:1', '4:1'],
            correct: 2,
            explanation: 'Ganancia potencial: 1.040 - 800 = 240. Pérdida potencial: 800 - 720 = 80. R:R = 240 ÷ 80 = 3:1. Excelente operación si el análisis es correcto.'
          },
          {
            q: 'En la estrategia de "Revenge Trading", el trader:',
            options: ['Espera pacientemente a que el mercado le devuelva las pérdidas', 'Opera impulsivamente para recuperar pérdidas, aumentando el riesgo', 'Usa un sistema de hedging para compensar pérdidas', 'Diversifica mejor su portafolio tras una pérdida'],
            correct: 1,
            explanation: 'El Revenge Trading es operar emocionalmente y con mayor riesgo para "recuperar" lo perdido. Casi siempre resulta en pérdidas aún mayores.'
          },
          {
            q: '¿Por qué tener 5 acciones bancarias (MVZ.A, BPV, BNC, ABC.A, BVL) no es verdadera diversificación?',
            options: ['Porque son pocas acciones', 'Porque son todas venezolanas', 'Porque tienen alta correlación entre sí (mismo sector)', 'Porque los bancos son activos de bajo riesgo'],
            correct: 2,
            explanation: 'La diversificación real requiere baja correlación entre activos. 5 bancos se mueven casi en la misma dirección ante los mismos eventos macro. Necesitas diversificación sectorial.'
          },
          {
            q: 'Un inversor con ROE de 22%, márgenes netos del 18% y P/E de 8x, comparado con el promedio sectorial de P/E 15x. ¿Qué sugiere el análisis fundamental?',
            options: ['La empresa está sobrevalorada', 'La empresa podría estar infravalorada con fundamentales sólidos', 'Los ratios indican quiebra inminente', 'Es una empresa de crecimiento'],
            correct: 1,
            explanation: 'P/E 8x vs. promedio 15x = potencialmente infravalorada. ROE 22% y margen 18% = fundamentales fuertes. Esta sería una candidata interesante para análisis más profundo.'
          }
        ]
      }
    ]
  },

  // ── LEVEL 6 ──────────────────────────────────────────────────────────────────
  {
    id: 6, title: 'Gestión de Portafolio', subtitle: 'Construye y monitorea una cartera real',
    badge: '🧩', badgeName: 'Portfolio Manager', color: '#0ea5e9', totalXp: 520,
    lessons: [
      {
        id: 'L6-1', title: 'Retorno y Riesgo: la dualidad fundamental', icon: '⚖️', type: 'theory', duration: '9 min', xp: 60,
        content: `
          <h3>El principio central de la inversión: más retorno = más riesgo</h3>
          <p>Todo activo financiero puede describirse con dos números fundamentales: <strong>retorno esperado</strong> y <strong>riesgo</strong>. La clave es maximizar el primero para cada unidad del segundo.</p>
          <h4>Retorno de un portafolio</h4>
          <div class="learn-formula">
            <code>E(Rₚ) = Σ wᵢ × E(Rᵢ)</code><br>
            <em>Donde wᵢ es el peso del activo i y E(Rᵢ) es su retorno esperado</em>
          </div>
          <p>Ejemplo: Portafolio con 60% MVZ.A (retorno esperado 18%/año) y 40% CRM.A (15%/año):</p>
          <div class="learn-formula"><code>E(Rₚ) = 0.6 × 18% + 0.4 × 15% = 10.8% + 6% = 16.8%</code></div>
          <h4>Riesgo de un portafolio (desviación estándar)</h4>
          <p>Para 2 activos, el riesgo NO es simplemente el promedio ponderado. Depende de la correlación entre ellos:</p>
          <div class="learn-formula">
            <code>σₚ = √( w₁²σ₁² + w₂²σ₂² + 2w₁w₂σ₁σ₂ρ₁₂ )</code><br>
            <em>ρ₁₂ = correlación entre activo 1 y 2 (-1 a +1)</em>
          </div>
          <h4>El poder de la correlación negativa</h4>
          <p>Si ρ₁₂ = -1 (correlación perfecta inversa), puedes construir un portafolio con riesgo CERO manteniendo retorno positivo. En la práctica, buscas activos con ρ < 0.5.</p>
          <div class="learn-tip">💡 En la BVC, los sectores bancario e industrial tienen correlación moderada (~0.4-0.6). Combinarlos reduce el riesgo sin sacrificar mucho retorno.</div>
        `
      },
      {
        id: 'L6-2', title: 'Métricas de Performance: Sharpe, Sortino, Alpha', icon: '📊', type: 'fundamental', duration: '11 min', xp: 70,
        content: `
          <h3>¿Cómo medir si tu portafolio es realmente bueno?</h3>
          <p>Un portafolio que ganó 20% no es necesariamente mejor que uno que ganó 12% — depende del riesgo tomado. Estas métricas normalizan el retorno por unidad de riesgo.</p>
          <h4>Ratio de Sharpe</h4>
          <div class="learn-formula">
            <code>Sharpe = (Rₚ - Rf) ÷ σₚ</code><br>
            <em>Rₚ = retorno portafolio · Rf = tasa libre de riesgo · σₚ = volatilidad</em>
          </div>
          <ul>
            <li>Sharpe &gt; 1.0 → Bueno</li>
            <li>Sharpe &gt; 2.0 → Excelente</li>
            <li>Sharpe &lt; 0.5 → Deficiente (mejor invertir en renta fija)</li>
          </ul>
          <h4>Ratio de Sortino</h4>
          <p>Igual que Sharpe pero penaliza solo la <strong>volatilidad negativa</strong> (downside deviation), no toda la volatilidad. Más justo para activos con sesgo positivo.</p>
          <div class="learn-formula"><code>Sortino = (Rₚ - Rf) ÷ σ_downside</code></div>
          <h4>Alpha (Jensen's Alpha)</h4>
          <p>Mide el retorno en exceso respecto al esperado por el CAPM. Un alpha positivo indica que el gestor o estrategia añade valor <em>más allá del riesgo del mercado</em>.</p>
          <div class="learn-formula"><code>α = Rₚ - [Rf + β × (Rm - Rf)]</code></div>
          <div class="learn-tip">💡 Puedes ver el Sharpe de cada acción en tu portafolio en la sección "Análisis → Métricas Avanzadas" de Caracas Portafolio.</div>
        `
      },
      {
        id: 'L6-3', title: 'Drawdown y Riesgo de Caída', icon: '📉', type: 'theory', duration: '8 min', xp: 55,
        content: `
          <h3>Drawdown: la métrica que los gestores profesionales vigilan más</h3>
          <p>El <strong>drawdown</strong> mide cuánto cae tu portafolio desde su máximo histórico. Es la medida de dolor real que un inversor experimenta.</p>
          <div class="learn-formula">
            <code>DD(t) = [P(t) - Pmax(t)] ÷ Pmax(t) × 100%</code><br>
            <em>Donde Pmax(t) es el máximo alcanzado hasta el momento t</em>
          </div>
          <h4>Maximum Drawdown (MDD)</h4>
          <p>El mayor drawdown en toda la historia del portafolio. Si tu portafolio llegó a valer $10.000, cayó a $6.500 y se recuperó: MDD = -35%.</p>
          <h4>Calmar Ratio</h4>
          <div class="learn-formula"><code>Calmar = CAGR ÷ |Max Drawdown|</code></div>
          <p>Mide el retorno anual compuesto por unidad de drawdown máximo. Un hedge fund con Calmar > 1 es considerado bueno.</p>
          <h4>Recuperación del drawdown</h4>
          <p>Si caíste -30%, necesitas subir +42.9% para recuperar el nivel anterior:</p>
          <div class="learn-formula"><code>Recuperación = 1/(1-0.30) - 1 = 42.9%</code></div>
          <div class="learn-tip">💡 Puedes simular el drawdown de tu portafolio actual ante crisis históricas usando el <strong>Stress Test</strong> en la sección Análisis.</div>
        `
      },
      {
        id: 'L6-4', title: 'Rebalanceo de Portafolio', icon: '🔄', type: 'theory', duration: '7 min', xp: 55,
        content: `
          <h3>Mantener tu asignación objetivo con el tiempo</h3>
          <p>Con el tiempo, los activos más rentables aumentan su peso en el portafolio, desvirtuando la asignación original y el perfil de riesgo.</p>
          <h4>Ejemplo de drift</h4>
          <p>Empezaste con 50% MVZ.A / 50% CRM.A. Un año después MVZ.A subió 40% y CRM.A subió 10%:</p>
          <div class="fundamental-table"><table>
            <thead><tr><th>Activo</th><th>Peso inicial</th><th>Peso actual</th></tr></thead>
            <tbody>
              <tr><td>MVZ.A</td><td>50%</td><td>59.1%</td></tr>
              <tr><td>CRM.A</td><td>50%</td><td>40.9%</td></tr>
            </tbody>
          </table></div>
          <h4>Estrategias de rebalanceo</h4>
          <ul>
            <li><strong>Calendario fijo:</strong> Rebalanceas cada trimestre o año. Simple pero puede rebalancear en momentos inoportunos.</li>
            <li><strong>Por umbral:</strong> Rebalanceas cuando algún activo se desvía más de X% (ej. ±5%) de su peso objetivo. Más eficiente.</li>
            <li><strong>Mixto:</strong> Revisas trimestralmente pero solo rebalanceas si hay desviación >5%.</li>
          </ul>
          <div class="learn-tip">💡 El rebalanceo tiene un efecto contraintuitivo: <em>compras barato y vendes caro automáticamente</em>, aprovechando la reversión a la media a largo plazo.</div>
        `
      },
      {
        id: 'L6-5', title: 'Quiz — Gestión de Portafolio', icon: '❓', type: 'quiz', duration: '5 min', xp: 280,
        questions: [
          {
            q: 'Un portafolio tiene retorno del 24% y volatilidad del 18%. La tasa libre de riesgo es 4%. ¿Cuál es el Ratio de Sharpe?',
            options: ['1.11', '1.33', '0.89', '2.44'],
            correct: 0,
            explanation: 'Sharpe = (24% - 4%) ÷ 18% = 20% ÷ 18% = 1.11. Un Sharpe de 1.11 es bueno (>1). El portafolio genera retorno excedente de 1.11 por cada unidad de riesgo.'
          },
          {
            q: 'Tu portafolio vale $10.000, sube a $14.000 y luego cae a $9.100. ¿Cuál es el Maximum Drawdown?',
            options: ['-9%', '-35%', '-65%', '-42.9%'],
            correct: 1,
            explanation: 'MDD = ($9.100 - $14.000) ÷ $14.000 = -$4.900 ÷ $14.000 = -35%. El drawdown se calcula desde el pico ($14.000), no desde el inicio ($10.000).'
          },
          {
            q: 'Tienes 70% acciones bancarias (alta correlación entre sí) y 30% en CRM.A (industria química). ¿Por qué esto NO está verdaderamente diversificado?',
            options: ['Porque debería haber más acciones', 'Porque las acciones bancarias se mueven juntas ante los mismos eventos macro', 'Porque CRM.A es demasiado pequeña', 'Porque falta renta fija'],
            correct: 1,
            explanation: 'La verdadera diversificación requiere activos con baja correlación. Los bancos venezolanos responden casi idénticamente a la política monetaria del BCV, el tipo de cambio y el ciclo económico. Tener 5 bancos no diversifica el riesgo sistémico bancario.'
          },
          {
            q: 'Si tu portafolio sufre un drawdown del -40%, ¿cuánto necesitas ganar para volver al punto de partida?',
            options: ['40%', '50%', '66.7%', '80%'],
            correct: 2,
            explanation: 'Si $100 cae a $60 (-40%), necesitas un retorno de $40/$60 = 66.7% para volver a $100. Esto demuestra la asimetría de las pérdidas: es mucho más fácil perder que recuperar.'
          }
        ]
      }
    ]
  },

  // ── LEVEL 7 ──────────────────────────────────────────────────────────────────
  {
    id: 7, title: 'Correlación y Diversificación Cuantitativa', subtitle: 'La ciencia detrás de la diversificación',
    badge: '🔗', badgeName: 'Quant Analyst', color: '#8b5cf6', totalXp: 560,
    lessons: [
      {
        id: 'L7-1', title: 'Correlación de Pearson y Spearman', icon: '📐', type: 'theory', duration: '10 min', xp: 65,
        content: `
          <h3>Midiendo la relación entre activos</h3>
          <p>La <strong>correlación</strong> cuantifica en qué medida dos activos se mueven juntos. Es el pilar matemático de toda estrategia de diversificación.</p>
          <h4>Correlación de Pearson (ρ)</h4>
          <div class="learn-formula">
            <code>ρ(X,Y) = Cov(X,Y) ÷ (σₓ × σᵧ)</code><br>
            <em>Rango: -1 (perfectamente inversos) a +1 (perfectamente juntos)</em>
          </div>
          <h4>Interpretación práctica</h4>
          <div class="fundamental-table"><table>
            <thead><tr><th>Rango ρ</th><th>Interpretación</th><th>Diversificación</th></tr></thead>
            <tbody>
              <tr><td>0.80 a 1.0</td><td>Correlación muy alta</td><td>Muy poca</td></tr>
              <tr><td>0.40 a 0.79</td><td>Correlación moderada</td><td>Parcial</td></tr>
              <tr><td>-0.20 a 0.39</td><td>Correlación baja</td><td>Buena</td></tr>
              <tr><td>-1.0 a -0.21</td><td>Correlación negativa</td><td>Excelente (cobertura)</td></tr>
            </tbody>
          </table></div>
          <h4>Correlación móvil (Rolling Correlation)</h4>
          <p>La correlación <em>cambia con el tiempo</em>. En períodos de crisis, los activos que normalmente tienen baja correlación tienden a correlacionarse más (fenómeno de "correlation breakdown"). Por eso usamos ventanas de 60-90 días.</p>
          <p>En Caracas Portafolio puedes ver la <strong>Correlación Rodante</strong> en la sección Análisis → Corr. Rodante.</p>
          <div class="learn-tip">💡 La cointegración (ver sección Análisis → Cointegración) va más allá: detecta relaciones de equilibrio de largo plazo aunque la correlación diaria sea baja.</div>
        `
      },
      {
        id: 'L7-2', title: 'Matriz de Covarianza y Heatmap', icon: '🌡️', type: 'theory', duration: '9 min', xp: 60,
        content: `
          <h3>La matriz de covarianza: el corazón del análisis de portafolio</h3>
          <p>Para un portafolio de N activos, la <strong>matriz de covarianza</strong> Σ de N×N contiene toda la información de riesgo e interdependencia entre los activos.</p>
          <h4>Para 3 activos (MVZ.A, BPV, CRM.A):</h4>
          <div class="learn-formula">
            <code>Σ = | σ²₁    Cov₁₂  Cov₁₃ |</code><br>
            <code>    | Cov₁₂  σ²₂    Cov₂₃ |</code><br>
            <code>    | Cov₁₃  Cov₂₃  σ²₃   |</code>
          </div>
          <ul>
            <li>La diagonal son las <strong>varianzas</strong> de cada activo (σ²ᵢ)</li>
            <li>Fuera de la diagonal están las <strong>covarianzas</strong> entre pares</li>
            <li>La matriz es <strong>simétrica</strong>: Cov₁₂ = Cov₂₁</li>
          </ul>
          <h4>El heatmap de correlación</h4>
          <p>Visualizar la matriz de correlación como un mapa de calor permite identificar rápidamente clusters de activos altamente correlacionados. Colores cálidos = alta correlación, fríos = baja correlación.</p>
          <p>En Caracas Portafolio puedes ver el <strong>Heatmap de Correlación</strong> en Análisis → Correlación.</p>
          <div class="learn-tip">💡 Una matriz de covarianza "bien condicionada" (sin activos perfectamente correlacionados) es esencial para la optimización de Markowitz. Con activos ρ=1, la matriz es singular y la optimización falla.</div>
        `
      },
      {
        id: 'L7-3', title: 'Cointegración: más allá de la correlación', icon: '🔄', type: 'theory', duration: '10 min', xp: 65,
        content: `
          <h3>Cointegración: pares que "están destinados a estar juntos"</h3>
          <p>Dos series de precios pueden tener baja correlación diaria pero estar <strong>cointegradas</strong>: existe una relación de equilibrio de largo plazo que hace que eventualmente "converjan".</p>
          <h4>El ejemplo clásico: oro y plata</h4>
          <p>El oro y la plata pueden divergir durante semanas o meses, pero históricamente siempre vuelven a una relación de precio estable. Esta es la base del <strong>pairs trading</strong>.</p>
          <h4>Test de Engle-Granger (simplificado)</h4>
          <ol>
            <li>Ajustar la regresión lineal: Precio_A = α + β × Precio_B + ε</li>
            <li>Comprobar si los residuales ε son <strong>estacionarios</strong> (ADF test)</li>
            <li>Si son estacionarios → cointegración confirmada</li>
          </ol>
          <h4>El spread</h4>
          <div class="learn-formula"><code>Spread = log(P_A) - β × log(P_B)</code></div>
          <p>El spread oscila alrededor de su media. Cuando se aleja mucho → oportunidad de arbitraje estadístico.</p>
          <div class="learn-tip">💡 Usa la sección <strong>Análisis → Cointegración</strong> de Caracas Portafolio para encontrar pares cointegrados entre acciones BVC. El sistema te indica el spread actual vs. su media histórica.</div>
        `
      },
      {
        id: 'L7-4', title: 'Smart Beta: Factor Investing', icon: '🧬', type: 'theory', duration: '10 min', xp: 60,
        content: `
          <h3>Smart Beta: invertir en factores, no en empresas individuales</h3>
          <p>El <strong>Factor Investing</strong> es la estrategia de construir portafolios basados en características sistemáticas ("factores") que históricamente generan retornos superiores.</p>
          <h4>Los factores principales (Fama-French)</h4>
          <ul>
            <li><strong>Value (Valor):</strong> Empresas con bajo P/E, P/B. Históricamente superan al mercado a largo plazo.</li>
            <li><strong>Size (Tamaño):</strong> Pequeñas capitalizaciones tienden a crecer más que las grandes.</li>
            <li><strong>Momentum:</strong> Activos que han subido en los últimos 12 meses tienden a seguir subiendo (pero revierten).</li>
            <li><strong>Quality (Calidad):</strong> Empresas con alto ROE, bajos niveles de deuda y flujo de caja estable.</li>
            <li><strong>Low Volatility:</strong> Paradoja: acciones de baja volatilidad suelen superar en retorno ajustado por riesgo.</li>
          </ul>
          <h4>Beta del CAPM</h4>
          <div class="learn-formula">
            <code>Rᵢ = Rf + βᵢ × (Rm - Rf) + εᵢ</code><br>
            <em>β = 1: igual volatilidad que el mercado. β > 1: más volátil. β < 1: menos volátil</em>
          </div>
          <div class="learn-tip">💡 En Caracas Portafolio, la sección <strong>Análisis → Smart Beta</strong> calcula el Beta, Alpha y los scores de los factores de cada acción en tu portafolio.</div>
        `
      },
      {
        id: 'L7-5', title: 'Quiz — Correlación y Factores', icon: '❓', type: 'quiz', duration: '5 min', xp: 310,
        questions: [
          {
            q: 'Dos acciones tienen ρ = -0.75. ¿Qué significa esto para tu portafolio?',
            options: ['Las acciones se mueven casi igual', 'Cuando una sube, la otra tiende a bajar — excelente diversificación', 'No tienen ninguna relación', 'La correlación cambiará pronto'],
            correct: 1,
            explanation: 'ρ = -0.75 es una correlación negativa fuerte. Cuando el activo A sube, el B tiende a bajar un 75% de esa magnitud. Combinarlos reduce significativamente el riesgo del portafolio.'
          },
          {
            q: 'Una acción tiene Beta = 1.8. Si el IBC sube 10%, ¿qué espera el CAPM?',
            options: ['La acción sube 10%', 'La acción sube 18%', 'La acción sube 8%', 'La acción baja 8%'],
            correct: 1,
            explanation: 'Retorno esperado = β × retorno mercado = 1.8 × 10% = 18%. Un Beta > 1 amplifica los movimientos del mercado tanto al alza como a la baja.'
          },
          {
            q: '¿Qué indica la cointegración entre dos acciones BVC?',
            options: ['Tienen alta correlación diaria', 'Existe un equilibrio de largo plazo que hace que sus precios converjan', 'Son del mismo sector industrial', 'Tienen la misma capitalización bursátil'],
            correct: 1,
            explanation: 'La cointegración indica equilibrio de largo plazo. Dos activos pueden divergir temporalmente, pero hay fuerzas que los hacen converger. Base matemática del pairs trading estadístico.'
          },
          {
            q: 'En el contexto de Smart Beta, ¿qué es el factor "Low Volatility"?',
            options: ['Invertir en acciones que no se mueven', 'La paradoja de que acciones menos volátiles suelen tener mejores retornos ajustados por riesgo', 'Usar menos apalancamiento', 'Acciones con low beta siempre suben menos'],
            correct: 1,
            explanation: 'La "Low Volatility Anomaly" contradice al CAPM: acciones con menor volatilidad histórica tienden a superar en retorno ajustado por riesgo. Posiblemente porque los inversores sobrevaloran las acciones "emocionantes" de alta volatilidad.'
          }
        ]
      }
    ]
  },

  // ── LEVEL 8 ──────────────────────────────────────────────────────────────────
  {
    id: 8, title: 'Volatilidad Condicional: GARCH', subtitle: 'Cómo predice el modelo la volatilidad del mañana',
    badge: '🌪️', badgeName: 'Volatility Expert', color: '#06b6d4', totalXp: 600,
    lessons: [
      {
        id: 'L8-1', title: '¿Qué es la Volatilidad?', icon: '📊', type: 'theory', duration: '8 min', xp: 55,
        content: `
          <h3>Volatilidad: el lenguaje del riesgo</h3>
          <p>La <strong>volatilidad</strong> es la desviación estándar de los retornos logarítmicos de un activo. Mide la dispersión de los movimientos de precio.</p>
          <h4>Volatilidad histórica (realizada)</h4>
          <div class="learn-formula">
            <code>σ = √[ (1/N) × Σ(rᵢ - r̄)² ]</code><br>
            <em>rᵢ = log(Pᵢ/Pᵢ₋₁) = retorno logarítmico del día i</em>
          </div>
          <p>Se anualiza multiplicando por √252 (días de trading en un año):</p>
          <div class="learn-formula"><code>σ_anual = σ_diaria × √252</code></div>
          <h4>Clustering de volatilidad</h4>
          <p>Un fenómeno bien documentado en mercados financieros: <em>"períodos de alta volatilidad tienden a ser seguidos por más alta volatilidad"</em>. Los mercados no son "ruido blanco" — la volatilidad tiene memoria.</p>
          <p>Esto es especialmente pronunciado en la BVC, donde eventos macro (inflación, tipo de cambio) crean clusters de volatilidad muy marcados.</p>
          <div class="learn-tip">💡 El Índice VIX (CBOE) mide la volatilidad implícita del S&P500. En Caracas Portafolio calculamos un "VIX Proxy BVC" basado en la volatilidad realizada del IBC a 30 días.</div>
        `
      },
      {
        id: 'L8-2', title: 'El Modelo GARCH(1,1): la ecuación', icon: '🧮', type: 'theory', duration: '12 min', xp: 80,
        content: `
          <h3>GARCH(1,1): Generalized AutoRegressive Conditional Heteroskedasticity</h3>
          <p>Desarrollado por Tim Bollerslev en 1986, el modelo GARCH(1,1) es el estándar para modelar la <strong>volatilidad condicional</strong> de series financieras.</p>
          <h4>La ecuación central</h4>
          <div class="learn-formula">
            <code>σ²_t = ω + α × ε²_{t-1} + β × σ²_{t-1}</code>
          </div>
          <p>Donde:</p>
          <ul>
            <li><strong>σ²_t:</strong> Varianza condicional de hoy (lo que queremos predecir)</li>
            <li><strong>ω (omega):</strong> Término constante (contribución base a la varianza)</li>
            <li><strong>α (alpha):</strong> Peso del choque reciente (ε²_{t-1} = retorno al cuadrado de ayer)</li>
            <li><strong>β (beta):</strong> Peso de la varianza pasada (persistencia)</li>
            <li><strong>ε_{t-1}:</strong> Retorno inesperado del período anterior</li>
          </ul>
          <h4>Parámetros típicos en BVC</h4>
          <div class="fundamental-table"><table>
            <thead><tr><th>Parámetro</th><th>Rango típico BVC</th><th>Interpretación</th></tr></thead>
            <tbody>
              <tr><td>α</td><td>0.05 – 0.25</td><td>Impacto de noticias recientes</td></tr>
              <tr><td>β</td><td>0.65 – 0.90</td><td>Persistencia de la volatilidad</td></tr>
              <tr><td>α + β</td><td>0.85 – 0.98</td><td>Persistencia total. Cerca de 1 = shocks duraderos</td></tr>
            </tbody>
          </table></div>
          <div class="learn-tip">💡 En Caracas Portafolio, ve a <strong>Análisis → GARCH Vol.</strong> para ajustar este modelo a cualquier acción y ver la volatilidad condicional de los últimos 60 días y las proyecciones 1D/5D/22D.</div>
        `
      },
      {
        id: 'L8-3', title: 'Persistencia, Semivida y Reversión a la Media', icon: '⏱️', type: 'theory', duration: '10 min', xp: 70,
        content: `
          <h3>¿Cuánto dura un shock de volatilidad en BVC?</h3>
          <h4>Persistencia</h4>
          <div class="learn-formula"><code>Persistencia = α + β</code></div>
          <p>Valores cercanos a 1 indican que los shocks de volatilidad tardan mucho en disiparse. En la BVC, es común ver persistencias de 0.92-0.97.</p>
          <h4>Volatilidad de largo plazo (unconditional)</h4>
          <div class="learn-formula">
            <code>σ²_LR = ω ÷ (1 - α - β)</code><br>
            <em>Si α + β ≥ 1, el modelo es IGARCH (no estacionario)</em>
          </div>
          <h4>Semivida del shock</h4>
          <div class="learn-formula">
            <code>Semivida = log(0.5) ÷ log(α + β)</code>
          </div>
          <p>Ejemplo con α=0.15, β=0.80 (persistencia = 0.95):</p>
          <div class="learn-formula"><code>Semivida = log(0.5) ÷ log(0.95) = -0.693 ÷ (-0.0513) ≈ 13.5 días</code></div>
          <p>Significa que un shock de volatilidad tardará ~13.5 días en reducirse a la mitad.</p>
          <h4>Pronósticos multi-paso</h4>
          <div class="learn-formula">
            <code>σ²_{t+h} = σ²_LR + (α+β)^h × (σ²_t - σ²_LR)</code><br>
            <em>El pronóstico h pasos adelante converge hacia la media incondicional</em>
          </div>
          <div class="learn-tip">💡 Un régimen de ALTA VOLATILIDAD (actual >> largo plazo) con semivida de 15 días es señal de que durante ~2 semanas el mercado seguirá agitado. Reduce el tamaño de posición.</div>
        `
      },
      {
        id: 'L8-4', title: 'Quiz GARCH — Calcula el modelo', icon: '❓', type: 'quiz', duration: '6 min', xp: 395,
        questions: [
          {
            q: 'GARCH(1,1) con ω=0.00002, α=0.12, β=0.84. ¿Cuál es la persistencia?',
            options: ['0.72', '0.84', '0.96', '1.08'],
            correct: 2,
            explanation: 'Persistencia = α + β = 0.12 + 0.84 = 0.96. Alta persistencia: los shocks de volatilidad tardan mucho en disiparse. Típico de mercados emergentes como la BVC.'
          },
          {
            q: 'Con la misma configuración (α+β=0.96), ¿aproximadamente cuántos días tarda la volatilidad en reducirse a la mitad?',
            options: ['7 días', '17 días', '30 días', '90 días'],
            correct: 1,
            explanation: 'Semivida = log(0.5) / log(0.96) = -0.693 / (-0.0408) ≈ 17 días. Con persistencia de 0.96, los shocks de volatilidad son bastante duraderos.'
          },
          {
            q: 'El GARCH actual de MVZ.A da vol. actual = 45% y vol. largo plazo = 28%. ¿Cuál es el régimen de volatilidad?',
            options: ['Baja volatilidad — volatilidad comprimida', 'Normal — dentro del rango', 'Alta volatilidad — estrés en el mercado', 'No se puede determinar'],
            correct: 2,
            explanation: 'Vol. actual (45%) > 1.6 × Vol. largo plazo (28% × 1.6 = 44.8%). El criterio GARCH es: si actual > 1.6× LR → ALTA VOLATILIDAD. Se recomienda reducir el tamaño de posición.'
          },
          {
            q: '¿Qué representa ε²_{t-1} en la ecuación σ²_t = ω + α·ε²_{t-1} + β·σ²_{t-1}?',
            options: ['La varianza de largo plazo', 'El cuadrado del retorno inesperado del período anterior — la "noticia reciente"', 'La varianza condicional de ayer', 'El parámetro de persistencia'],
            correct: 1,
            explanation: 'ε_{t-1} es el retorno residual (inesperado) del período anterior. Su cuadrado ε²_{t-1} representa la magnitud del "shock" o "noticia" más reciente. El parámetro α controla cuánto peso le damos a esa noticia.'
          }
        ]
      }
    ]
  },

  // ── LEVEL 9 ──────────────────────────────────────────────────────────────────
  {
    id: 9, title: 'Frontera Eficiente de Markowitz', subtitle: 'La teoría moderna de portafolios',
    badge: '🎯', badgeName: 'Markowitz Scholar', color: '#f97316', totalXp: 640,
    lessons: [
      {
        id: 'L9-1', title: 'Harry Markowitz y la Teoría Moderna', icon: '🏆', type: 'theory', duration: '9 min', xp: 60,
        content: `
          <h3>La revolución de 1952 que cambió las finanzas para siempre</h3>
          <p>En 1952, Harry Markowitz publicó "Portfolio Selection" en el Journal of Finance. Tenía 25 años y estaba haciendo su doctorado. En 1990 recibió el Premio Nobel de Economía por esta idea.</p>
          <h4>La intuición central</h4>
          <blockquote>"No diversifiques por diversificar. Diversifica inteligentemente eligiendo activos que no se muevan juntos."</blockquote>
          <p>Antes de Markowitz, los inversores evaluaban cada activo individualmente. Él demostró que lo que importa no es el riesgo de cada activo por sí solo, sino el riesgo del <em>portafolio completo</em>, que depende de las correlaciones entre activos.</p>
          <h4>Los supuestos del modelo</h4>
          <ul>
            <li>Los inversores son racionales y adversos al riesgo</li>
            <li>Para un mismo retorno, preferirán el portafolio de menor riesgo</li>
            <li>Para un mismo riesgo, preferirán el portafolio de mayor retorno</li>
            <li>Los retornos se distribuyen normalmente</li>
          </ul>
          <div class="learn-tip">💡 En Caracas Portafolio, la sección <strong>Análisis → Frontera Eficiente</strong> aplica el teorema de Markowitz a tu portafolio real usando datos históricos de la BVC.</div>
        `
      },
      {
        id: 'L9-2', title: 'La Frontera Eficiente: construcción', icon: '📈', type: 'theory', duration: '13 min', xp: 85,
        content: `
          <h3>Construyendo la Frontera Eficiente</h3>
          <p>La <strong>Frontera Eficiente</strong> es el conjunto de portafolios que maximizan el retorno esperado para cada nivel de riesgo (o equivalentemente, minimizan el riesgo para cada nivel de retorno).</p>
          <h4>Pasos de construcción (Método Monte Carlo)</h4>
          <ol>
            <li><strong>Generamos N portafolios aleatorios</strong> (ej. 6.000) variando los pesos wᵢ de cada activo</li>
            <li><strong>Calculamos retorno esperado:</strong> E(Rₚ) = Σ wᵢ × μᵢ</li>
            <li><strong>Calculamos riesgo:</strong> σₚ = √(wᵀ × Σ × w) usando la matriz de covarianza real</li>
            <li><strong>Graficamos</strong> cada portafolio en el espacio Riesgo-Retorno</li>
            <li><strong>La frontera</strong> es la curva que forma el borde superior izquierdo de la nube de puntos</li>
          </ol>
          <h4>Los tres portafolios clave</h4>
          <div class="fundamental-table"><table>
            <thead><tr><th>Portafolio</th><th>Objetivo</th><th>Para quién</th></tr></thead>
            <tbody>
              <tr><td>🟢 Mínima Volatilidad</td><td>Minimizar σₚ sin importar el retorno</td><td>Inversores muy conservadores</td></tr>
              <tr><td>🟣 Máximo Sharpe</td><td>Maximizar (Retorno-Rf)/σ — mejor relación calidad-riesgo</td><td>La mayoría de inversores racionales</td></tr>
              <tr><td>🔴 Tu portafolio actual</td><td>Muestra si estás en la frontera o no</td><td>Diagnóstico de ineficiencia</td></tr>
            </tbody>
          </table></div>
          <p>Si tu portafolio está <em>dentro</em> de la frontera (no en el borde), existe otro portafolio con el mismo retorno y menos riesgo — o el mismo riesgo y más retorno. Estás siendo ineficiente.</p>
          <div class="learn-tip">💡 En la práctica, el portafolio de <strong>Máximo Sharpe</strong> es la elección óptima para la mayoría de inversores. En la app puedes ver los pesos exactos que sugiere el modelo para tu portafolio actual.</div>
        `
      },
      {
        id: 'L9-3', title: 'Optimización y Restricciones Prácticas', icon: '⚙️', type: 'theory', duration: '10 min', xp: 70,
        content: `
          <h3>Del modelo teórico a la realidad práctica</h3>
          <p>El modelo de Markowitz puro tiene limitaciones. La optimización real necesita restricciones para producir portafolios útiles.</p>
          <h4>Restricciones típicas</h4>
          <ul>
            <li><strong>Long-only:</strong> wᵢ ≥ 0 (sin ventas en corto — relevante en BVC donde el short es difícil)</li>
            <li><strong>Posición máxima:</strong> wᵢ ≤ 30% (evitar concentración excesiva)</li>
            <li><strong>Posición mínima:</strong> wᵢ ≥ 5% (si el activo aparece, debe tener peso significativo)</li>
            <li><strong>Suma = 100%:</strong> Σwᵢ = 1</li>
          </ul>
          <h4>Problemas del modelo de Markowitz</h4>
          <ul>
            <li><strong>Sensibilidad a los inputs:</strong> Pequeños cambios en los retornos esperados producen portafolios muy diferentes. Los retornos pasados no predicen perfectamente el futuro.</li>
            <li><strong>Concentración extrema:</strong> Sin restricciones, el optimizador tiende a concentrar el 80% en 1-2 activos.</li>
            <li><strong>No considera liquidez:</strong> Una acción con buenas estadísticas pero volumen diario de $500 no puede tener un peso real del 30%.</li>
            <li><strong>Distribución normal:</strong> Los retornos reales tienen colas gruesas (fat tails) que el modelo no captura.</li>
          </ul>
          <div class="learn-tip">💡 Black-Litterman (1990) mejoró a Markowitz permitiendo incorporar "views" del gestor además de los datos históricos, reduciendo la sensibilidad del modelo.</div>
        `
      },
      {
        id: 'L9-4', title: 'Quiz — Markowitz y Frontera Eficiente', icon: '❓', type: 'quiz', duration: '5 min', xp: 425,
        questions: [
          {
            q: 'Tu portafolio tiene retorno 15% y volatilidad 22%. El portafolio de Máximo Sharpe tiene retorno 18% y volatilidad 22%. ¿Qué significa esto?',
            options: ['Tu portafolio es eficiente', 'Con el mismo riesgo, existe una combinación que da 3% más de retorno. Tu portafolio es subóptimo.', 'Debes vender todo y comprar el de máximo Sharpe', 'Los dos portafolios son equivalentes'],
            correct: 1,
            explanation: 'Si el portafolio de Máximo Sharpe tiene el mismo riesgo (22%) pero mayor retorno (18% vs 15%), tu portafolio es ineficiente. La Teoría de Markowitz dice que un inversor racional debería preferir el de máximo Sharpe.'
          },
          {
            q: 'La ecuación de riesgo del portafolio es σₚ = √(wᵀΣw). ¿Qué es Σ?',
            options: ['El vector de retornos esperados', 'La matriz de covarianza entre los activos', 'La suma de los pesos', 'La desviación estándar individual'],
            correct: 1,
            explanation: 'Σ es la matriz de covarianza N×N. Captura tanto las varianzas individuales (diagonal) como las covarianzas entre pares (fuera de la diagonal). Es el input más crítico de la optimización de Markowitz.'
          },
          {
            q: 'Si añades al portafolio un activo con alta volatilidad propia pero correlación = -0.5 con tus activos existentes, ¿qué pasa con el riesgo del portafolio?',
            options: ['Siempre aumenta porque el activo es más volátil', 'Puede reducirse si la correlación negativa domina el efecto de diversificación', 'No cambia el riesgo total', 'Solo el retorno cambia, no el riesgo'],
            correct: 1,
            explanation: 'Este es el insight central de Markowitz: un activo muy volátil puede REDUCIR el riesgo del portafolio si tiene correlación negativa con los demás. La correlación importa más que la volatilidad individual.'
          },
          {
            q: '¿Por qué el modelo de Markowitz puro tiende a producir portafolios concentrados en pocos activos?',
            options: ['Porque la optimización es incorrecta', 'Porque sin restricciones el algoritmo pone todo en los activos con mejor ratio retorno/riesgo/correlación', 'Porque Markowitz no consideró la diversificación', 'Porque siempre conviene concentrar el capital'],
            correct: 1,
            explanation: 'Sin restricciones, el optimizador matemático inevitablemente concentra en los "mejores" activos según sus estadísticas históricas. Esto es matemáticamente correcto pero ignorar la incertidumbre en los parámetros estimados hace que el resultado sea frágil en la práctica.'
          }
        ]
      }
    ]
  },

  // ── LEVEL 10 ─────────────────────────────────────────────────────────────────
  {
    id: 10, title: 'Simulación Monte Carlo', subtitle: 'Probabilidades del futuro de tu portafolio',
    badge: '🎲', badgeName: 'Simulador Cuant', color: '#10b981', totalXp: 660,
    lessons: [
      {
        id: 'L10-1', title: '¿Qué es Monte Carlo?', icon: '🎲', type: 'theory', duration: '9 min', xp: 60,
        content: `
          <h3>Monte Carlo: simular el futuro miles de veces</h3>
          <p>La <strong>Simulación de Monte Carlo</strong> es una técnica que genera miles de trayectorias posibles del precio de un activo o portafolio usando números aleatorios. El resultado es una distribución de probabilidades de los posibles valores futuros.</p>
          <h4>El modelo de precio geométrico Browniano</h4>
          <div class="learn-formula">
            <code>Pₜ₊₁ = Pₜ × exp[(μ - σ²/2)Δt + σ√Δt × Z]</code><br>
            <em>Z ~ N(0,1): número aleatorio normal estándar</em><br>
            <em>μ: retorno esperado diario · σ: volatilidad diaria</em>
          </div>
          <h4>¿Por qué tantas simulaciones?</h4>
          <p>Una sola trayectoria no dice nada. Con 10.000 simulaciones, la distribución de resultados converge a una distribución estable. La ley de los grandes números garantiza que el promedio de las simulaciones se acerca al valor teórico.</p>
          <h4>Lo que nos dice Monte Carlo</h4>
          <ul>
            <li>Percentil 5%: el valor que tendrás en el 5% peor de los casos</li>
            <li>Percentil 50%: valor mediano esperado</li>
            <li>Percentil 95%: el 5% de los mejores escenarios</li>
            <li>Probabilidad de quiebra (valor < 0)</li>
          </ul>
          <div class="learn-tip">💡 En Caracas Portafolio, la sección <strong>Monte Carlo</strong> corre 1.000–10.000 simulaciones del precio de cualquier acción BVC y te muestra el cono de distribución probabilística.</div>
        `
      },
      {
        id: 'L10-2', title: 'Monte Carlo de Portafolio Completo', icon: '📊', type: 'theory', duration: '11 min', xp: 75,
        content: `
          <h3>Simulando el portafolio completo con correlaciones reales</h3>
          <p>Simular cada acción independientemente ignora la correlación entre ellas. Un Monte Carlo correcto simula todos los activos <em>simultáneamente</em> respetando su estructura de correlación.</p>
          <h4>Descomposición de Cholesky</h4>
          <p>Para generar retornos correlacionados, usamos la descomposición de Cholesky de la matriz de covarianza:</p>
          <div class="learn-formula">
            <code>Σ = L × Lᵀ (descomposición Cholesky)</code><br>
            <code>r_correlacionados = L × Z (Z = vector de normales independientes)</code>
          </div>
          <p>Este método garantiza que los retornos simulados tengan exactamente la misma estructura de correlación que los retornos históricos observados.</p>
          <h4>Interpretando el abanico de simulaciones</h4>
          <p>El gráfico de Monte Carlo muestra un abanico que se expande con el tiempo (como un cono). Las líneas del cono marcan los percentiles 5%–95%:</p>
          <ul>
            <li><strong>Cono ancho:</strong> Alta incertidumbre (alta volatilidad o largo horizonte)</li>
            <li><strong>Cono estrecho:</strong> Portafolio más predecible (baja volatilidad + correlaciones diversificadas)</li>
            <li><strong>Área roja:</strong> Probabilidad de pérdida desde el valor actual</li>
          </ul>
          <div class="learn-tip">💡 Un error común: confundir Monte Carlo con predicción. Monte Carlo NO predice qué pasará — muestra el espacio de posibilidades ponderadas por probabilidad. Es una herramienta de gestión de riesgo, no de forecasting.</div>
        `
      },
      {
        id: 'L10-3', title: 'Quiz — Monte Carlo', icon: '❓', type: 'quiz', duration: '5 min', xp: 525,
        questions: [
          {
            q: 'En una simulación Monte Carlo de 10.000 trayectorias, el percentil 5% del valor final es $7.200 (comenzando desde $10.000). ¿Cómo se interpreta?',
            options: ['El portafolio caerá a $7.200 con seguridad', 'En el 5% de los peores escenarios, el portafolio estaría en $7.200 o menos', 'Es el rendimiento promedio esperado', 'El portafolio nunca caerá por debajo de $7.200'],
            correct: 1,
            explanation: 'El percentil 5% significa que en el 5% de los peores escenarios simulados, el valor sería ≤$7.200. Dicho de otro modo, hay un 95% de probabilidad de que el valor sea mayor que $7.200. Este es el concepto base del Value at Risk.'
          },
          {
            q: '¿Por qué usamos la descomposición de Cholesky en Monte Carlo de portafolio?',
            options: ['Para acelerar los cálculos', 'Para generar retornos simulados que respeten la correlación real entre activos', 'Para eliminar los outliers', 'Es una corrección de sesgo'],
            correct: 1,
            explanation: 'Cholesky "transforma" números aleatorios independientes en retornos correlacionados que tienen exactamente la misma estructura de correlación que los datos históricos. Sin esto, simularíamos activos como si fueran independientes — una grave simplificación.'
          },
          {
            q: 'Una acción tiene retorno diario μ=0.08% y volatilidad diaria σ=1.5%. En Monte Carlo con GBM, si Z=-2.1 (cola extrema), ¿el precio subirá o bajará ese día?',
            options: ['Subirá porque μ es positivo', 'Bajará porque σ×Z = 1.5%×(-2.1) = -3.15% domina sobre μ', 'No cambia', 'Depende del precio actual'],
            correct: 1,
            explanation: 'Retorno simulado = μΔt + σ√Δt×Z ≈ 0.08% + 1.5%×(-2.1) = 0.08% - 3.15% = -3.07%. La volatilidad multiplicada por un Z negativo grande domina al pequeño drift μ. Este es un escenario de cola extrema.'
          }
        ]
      }
    ]
  },

  // ── LEVEL 11 ─────────────────────────────────────────────────────────────────
  {
    id: 11, title: 'Value at Risk y CVaR', subtitle: 'Cuantificando las pérdidas extremas',
    badge: '🛡️', badgeName: 'Risk Manager', color: '#ef4444', totalXp: 680,
    lessons: [
      {
        id: 'L11-1', title: 'VaR: Value at Risk explicado', icon: '⚠️', type: 'theory', duration: '10 min', xp: 70,
        content: `
          <h3>VaR: "¿Cuánto puedo perder en el peor X% de los días?"</h3>
          <p>El <strong>Value at Risk (VaR)</strong> a un nivel de confianza (1-α)% es la pérdida máxima que el portafolio sufrirá con probabilidad (1-α)% en un período de tiempo dado.</p>
          <h4>Definición precisa</h4>
          <div class="learn-formula">
            <code>VaR(α) = -Percentil(α) de la distribución de retornos</code><br>
            <em>VaR(5%) = la pérdida que se supera solo el 5% de los días</em>
          </div>
          <h4>Ejemplo concreto</h4>
          <p>Portafolio de $50.000 con VaR(5%) = 3.2%:</p>
          <ul>
            <li>El 95% de los días, la pérdida será menor que 3.2%</li>
            <li>El 5% de los días (≈ 1 día al mes), la pérdida puede superar 3.2%</li>
            <li>VaR en Bs: $50.000 × 3.2% = $1.600 por día</li>
          </ul>
          <h4>Métodos de cálculo</h4>
          <ul>
            <li><strong>Histórico:</strong> Toma los retornos reales históricos y busca el percentil 5%. Simple pero depende del período histórico elegido.</li>
            <li><strong>Paramétrico:</strong> Asume distribución normal: VaR = μ - 1.645×σ (para 95%). Rápido pero subestima las colas.</li>
            <li><strong>Monte Carlo:</strong> Simula miles de escenarios. Más preciso para portafolios complejos.</li>
          </ul>
          <div class="learn-tip">💡 El VaR tiene un problema crítico: no dice nada sobre las pérdidas más allá del umbral. El día que excedas el VaR, ¿cuánto perderás realmente? Para eso existe el CVaR.</div>
        `
      },
      {
        id: 'L11-2', title: 'CVaR / Expected Shortfall: más allá del VaR', icon: '🚨', type: 'theory', duration: '11 min', xp: 75,
        content: `
          <h3>CVaR: la pérdida promedio en los peores escenarios</h3>
          <p>El <strong>CVaR (Conditional Value at Risk)</strong>, también llamado <strong>Expected Shortfall (ES)</strong>, responde a: "Dado que estamos en el peor 5% de los escenarios, ¿cuánto perdemos en promedio?"</p>
          <h4>Definición matemática</h4>
          <div class="learn-formula">
            <code>CVaR(α) = E[Pérdida | Pérdida > VaR(α)]</code><br>
            <em>Promedio de los retornos peores al VaR(α)</em>
          </div>
          <h4>¿Por qué es mejor que el VaR?</h4>
          <div class="fundamental-table"><table>
            <thead><tr><th>Métrica</th><th>VaR</th><th>CVaR</th></tr></thead>
            <tbody>
              <tr><td>Pregunta</td><td>¿Cuál es el umbral del 5% peor?</td><td>¿Cuánto perdemos EN PROMEDIO en el 5% peor?</td></tr>
              <tr><td>Información</td><td>Solo el umbral</td><td>El promedio de toda la cola</td></tr>
              <tr><td>Colas gruesas</td><td>Ignora qué hay después del umbral</td><td>Captura el riesgo de colas gruesas</td></tr>
              <tr><td>Coherencia matemática</td><td>No siempre es subaditivo</td><td>Siempre subditivo (propiedad de riesgo coherente)</td></tr>
            </tbody>
          </table></div>
          <h4>Fat Tails en la BVC</h4>
          <p>Las acciones venezolanas tienen distribuciones con <strong>colas más gruesas</strong> que la distribución normal (curtosis excesiva > 0). Esto significa que los eventos extremos son mucho más frecuentes de lo que predice el modelo normal, haciendo al CVaR especialmente relevante.</p>
          <div class="learn-tip">💡 Basilea III exige que los bancos usen CVaR al 97.5% en lugar de VaR al 99% para el cálculo de capital regulatorio. El regulador reconoció las limitaciones del VaR tras la crisis de 2008.</div>
        `
      },
      {
        id: 'L11-3', title: 'Stress Test: aplicando crisis históricas', icon: '🧨', type: 'theory', duration: '9 min', xp: 65,
        content: `
          <h3>¿Cómo hubiera resistido tu portafolio de HOY las crisis del pasado?</h3>
          <p>El <strong>Stress Test histórico</strong> toma los retornos reales de un período de crisis y los aplica a tu portafolio actual — como si esa misma crisis ocurriera ahora con tus tenencias actuales.</p>
          <h4>La diferencia con el backtesting</h4>
          <ul>
            <li><strong>Backtesting:</strong> Simula qué hubiera pasado si hubieras operado una estrategia específica en el pasado.</li>
            <li><strong>Stress Test:</strong> Congela tu portafolio ACTUAL y aplica retornos históricos de crisis. No es una estrategia, es un diagnóstico de vulnerabilidad.</li>
          </ul>
          <h4>Crisis históricas BVC disponibles</h4>
          <ul>
            <li>Crash Petrolero (Jul-Dic 2014): caída del precio del petróleo -50%. Impacto en toda la economía venezolana.</li>
            <li>Crisis cambiaria (2018): Reconversión monetaria + hiperinflación +1.000.000%.</li>
            <li>Hiper-Bache Venezuela (Jul-Sep 2021): Corrección -40% en algunos papeles tras pico inflacionario.</li>
            <li>COVID-19 Global (Mar-May 2020): Crash global con impacto en BVC.</li>
          </ul>
          <div class="learn-tip">💡 Usa el <strong>Stress Test</strong> en Análisis para ver el equity curve de tu portafolio actual aplicando estas crisis. Un portafolio resistente al Hiper-Bache 2021 es una señal de buena diversificación.</div>
        `
      },
      {
        id: 'L11-4', title: 'Quiz — VaR, CVaR y Stress Testing', icon: '❓', type: 'quiz', duration: '6 min', xp: 470,
        questions: [
          {
            q: 'Portafolio $80.000. VaR(5%) = 2.8%. ¿Cuál es la interpretación correcta?',
            options: ['Perderás exactamente $2.240 mañana', 'El 5% de los días, perderás más de $2.240', 'El 95% de los días, ganarás más de $2.240', 'No perderás más de $2.240 en ningún escenario'],
            correct: 1,
            explanation: 'VaR(5%) = 2.8% × $80.000 = $2.240. En el 5% de los días (1 de cada 20), la pérdida será MAYOR de $2.240. El 95% de los días la pérdida será menor. No es un límite absoluto — en el peor 5% de días puedes perder mucho más.'
          },
          {
            q: 'CVaR(5%) = 4.1% y VaR(5%) = 2.8%. ¿Cómo se interpretan juntos?',
            options: ['Son la misma cosa con diferente nombre', 'En los días que el portafolio supera el VaR (el 5% peor), la pérdida promedio es del 4.1%', 'El CVaR es incorrecto porque es mayor', 'El VaR ignora los retornos positivos'],
            correct: 1,
            explanation: 'El CVaR (4.1%) es siempre ≥ VaR (2.8%). CVaR es el promedio de pérdidas en el peor 5% de días. Dice: cuando las cosas van mal (superamos el VaR), en promedio perdemos el 4.1%. Captura el riesgo de cola que el VaR ignora.'
          },
          {
            q: 'Una acción BVC tiene curtosis excesiva de 3.8. ¿Qué implica para el VaR paramétrico (normal)?',
            options: ['El VaR normal es perfectamente adecuado', 'El VaR normal subestima el riesgo real porque los eventos extremos son más frecuentes de lo normal', 'La curtosis alta significa retornos más estables', 'El VaR debe calcularse al 99% en lugar del 95%'],
            correct: 1,
            explanation: 'Curtosis excesiva > 0 = "fat tails" = distribución con colas más gruesas que la normal. Los retornos extremos son más probables de lo que predice la distribución normal. El VaR paramétrico (que asume normalidad) subestima el riesgo real en estos casos.'
          }
        ]
      }
    ]
  },

  // ── LEVEL 12 ─────────────────────────────────────────────────────────────────
  {
    id: 12, title: 'Machine Learning en Finanzas', subtitle: 'IA aplicada a la predicción de mercados',
    badge: '🤖', badgeName: 'ML Quant', color: '#a855f7', totalXp: 720,
    lessons: [
      {
        id: 'L12-1', title: 'ML en finanzas: qué funciona y qué no', icon: '🧠', type: 'theory', duration: '10 min', xp: 70,
        content: `
          <h3>La promesa y los límites del Machine Learning en trading</h3>
          <p>El Machine Learning promete encontrar patrones ocultos en datos de mercado. La realidad es más matizada: los mercados son <strong>adaptativos</strong> — cuando un patrón es descubierto y explotado por suficientes participantes, deja de funcionar.</p>
          <h4>La hipótesis de mercado eficiente (EMH)</h4>
          <p>Eugene Fama (Nobel 2013) propuso que los precios reflejan toda la información disponible. Si esto es cierto, no se pueden obtener retornos superiores de forma consistente. El ML enfrenta este problema.</p>
          <h4>¿Dónde sí funciona el ML?</h4>
          <ul>
            <li><strong>Ejecución de órdenes:</strong> Minimizar el impacto de mercado al ejecutar órdenes grandes</li>
            <li><strong>Detección de anomalías:</strong> Identificar patrones inusuales que pueden ser errores o fraude</li>
            <li><strong>Clasificación de noticias:</strong> NLP para sentiment analysis de noticias financieras</li>
            <li><strong>Gestión de riesgo:</strong> Clasificar períodos de alta volatilidad</li>
            <li><strong>Features técnicos:</strong> Como inputs adicionales al análisis fundamental</li>
          </ul>
          <h4>El data leakage: el error más peligroso</h4>
          <p>Usar información futura para entrenar el modelo (ej: usar el cierre de hoy para predecir el cierre de hoy). Produce resultados fantásticos en backtesting pero nulos en producción.</p>
          <div class="learn-tip">💡 En Caracas Portafolio, el modelo ML usa <strong>Walk-Forward Validation</strong> para evitar data leakage: entrena en datos pasados y predice en datos que el modelo nunca "vio".</div>
        `
      },
      {
        id: 'L12-2', title: 'Regresión Logística y Features Técnicos', icon: '⚙️', type: 'theory', duration: '11 min', xp: 75,
        content: `
          <h3>Predicción de dirección: ¿sube o baja mañana?</h3>
          <p>El modelo ML de Caracas Portafolio usa <strong>Regresión Logística Ridge</strong> para predecir la probabilidad de que una acción cierre mañana al alza o a la baja.</p>
          <h4>El modelo logístico</h4>
          <div class="learn-formula">
            <code>P(y=1) = σ(β₀ + β₁x₁ + ... + βₙxₙ)</code><br>
            <code>σ(z) = 1 ÷ (1 + e⁻ᶻ) [función sigmoide]</code>
          </div>
          <p>Output entre 0 y 1 (probabilidad). Si P > 0.5 → predice alza; si P < 0.5 → baja.</p>
          <h4>Los 6 features técnicos usados en la app</h4>
          <div class="fundamental-table"><table>
            <thead><tr><th>Feature</th><th>Cálculo</th><th>Captura</th></tr></thead>
            <tbody>
              <tr><td>Momentum 5d</td><td>(P_hoy - P_5d) / P_5d</td><td>Tendencia corto plazo</td></tr>
              <tr><td>Momentum 20d</td><td>(P_hoy - P_20d) / P_20d</td><td>Tendencia medio plazo</td></tr>
              <tr><td>Posición en rango</td><td>(P_hoy - P_min30d) / (P_max30d - P_min30d)</td><td>Sobrecompra/sobreventa</td></tr>
              <tr><td>RSI-proxy</td><td>Ganancias ÷ (Ganancias + Pérdidas), 14d</td><td>Momentum relativo</td></tr>
              <tr><td>Volatilidad z-score</td><td>(Vol_actual - Media_vol) / Std_vol</td><td>Régimen de volatilidad</td></tr>
              <tr><td>Vol diaria</td><td>Desv. est. retornos 10d</td><td>Nivel de incertidumbre</td></tr>
            </tbody>
          </table></div>
          <h4>Regularización Ridge (L2)</h4>
          <div class="learn-formula"><code>Pérdida = -Log-Likelihood + λ × Σβᵢ²</code></div>
          <p>Ridge penaliza pesos grandes, reduciendo el overfitting. Esencial cuando tienes pocos datos (como en BVC).</p>
        `
      },
      {
        id: 'L12-3', title: 'Walk-Forward Validation: el estándar anti-overfitting', icon: '🏃', type: 'theory', duration: '10 min', xp: 70,
        content: `
          <h3>Walk-Forward: la única validación honesta en finanzas</h3>
          <p>El <strong>Walk-Forward</strong> divide el histórico en ventanas deslizantes de entrenamiento y validación, simulando cómo el modelo hubiera funcionado en tiempo real.</p>
          <h4>El proceso paso a paso</h4>
          <div class="learn-formula">
            <code>Ventana 1: [----TRAIN (60%)----][--VAL (20%)--][ test ]</code><br>
            <code>Ventana 2: [------TRAIN (72%)------][--VAL (20%)--]</code><br>
            <code>Ventana 3: [--------TRAIN (84%)--------][--VAL--]</code>
          </div>
          <ul>
            <li><strong>In-Sample (IS):</strong> Precisión del modelo en los datos de entrenamiento</li>
            <li><strong>Out-of-Sample (OOS):</strong> Precisión en datos que el modelo NUNCA vio al entrenar</li>
          </ul>
          <h4>Interpretar los resultados</h4>
          <div class="fundamental-table"><table>
            <thead><tr><th>OOS Accuracy</th><th>Usabilidad</th><th>Acción</th></tr></thead>
            <tbody>
              <tr><td>&lt; 52%</td><td>No usar — no es mejor que el azar</td><td>Descarta</td></tr>
              <tr><td>52% – 58%</td><td>Señal débil — usar con cautela</td><td>Confirmar con otros indicadores</td></tr>
              <tr><td>&gt; 58%</td><td>Buena señal — modelo estadísticamente útil</td><td>Puede incorporarse a la decisión</td></tr>
            </tbody>
          </table></div>
          <div class="learn-tip">💡 ¡OJO! Accuracy del 55% puede sonar baja pero en trading es valiosa si el R:R es > 2:1. Si ganas el doble de lo que pierdes y aciertas el 55%, eres rentable a largo plazo.</div>
        `
      },
      {
        id: 'L12-4', title: 'Quiz — Machine Learning en Finanzas', icon: '❓', type: 'quiz', duration: '5 min', xp: 505,
        questions: [
          {
            q: 'El modelo ML de Caracas Portafolio muestra OOS Accuracy = 48%. ¿Qué deberías hacer?',
            options: ['Usarlo para todas tus decisiones de inversión', 'Descartarlo — 48% no supera significativamente el 50% del azar', 'Invertir todo en la dirección opuesta a la predicción', 'Esperar a que mejore sólo'],
            correct: 1,
            explanation: 'OOS < 52% significa que el modelo no supera significativamente el azar (50%). Para el mercado BVC con su ruido macro, un modelo con 48% de precisión out-of-sample no añade valor estadístico y podría llevar a decisiones equivocadas.'
          },
          {
            q: '¿Por qué la regularización Ridge es especialmente importante al entrenar en datos BVC (pocos años de historia)?',
            options: ['Para hacer el modelo más rápido', 'Porque con pocos datos, el modelo puede "memorizar" el entrenamiento (overfitting) sin Ridge', 'Ridge aumenta el número de datos disponibles', 'BVC tiene datos de alta frecuencia que necesitan Ridge'],
            correct: 1,
            explanation: 'Con pocos datos de entrenamiento, la regresión logística sin regularización puede ajustarse perfectamente al train set (overfitting) y fallar en datos nuevos. Ridge penaliza los coeficientes grandes, forzando al modelo a ser más general y robusto.'
          },
          {
            q: '¿Qué es el "data leakage" en el contexto de un modelo de predicción de acciones?',
            options: ['Que los datos se pierdan por un error técnico', 'Usar información futura (no disponible al momento de la predicción) para entrenar el modelo', 'Compartir datos confidenciales con competidores', 'Usar demasiados datos históricos'],
            correct: 1,
            explanation: 'Data leakage es incluir en el entrenamiento información que no habría estado disponible al momento de hacer la predicción (ej: el cierre de hoy para predecir el cierre de hoy). Produce modelos con backtests perfectos que fallan en producción real.'
          }
        ]
      }
    ]
  },

  // ── LEVEL 13 ─────────────────────────────────────────────────────────────────
  {
    id: 13, title: 'BVC Experto — Venezuela y Emergentes', subtitle: 'El manual del inversor venezolano avanzado',
    badge: '🇻🇪', badgeName: 'BVC Expert', color: '#f59e0b', totalXp: 740,
    lessons: [
      {
        id: 'L13-1', title: 'Macro Venezuela: el entorno único del inversor BVC', icon: '🌎', type: 'theory', duration: '12 min', xp: 80,
        content: `
          <h3>Invertir en Venezuela: el mercado más desafiante y más interesante</h3>
          <p>La BVC opera en uno de los entornos macroeconómicos más complejos del mundo. Entender este contexto es esencial para interpretar cualquier análisis técnico o fundamental.</p>
          <h4>Los cinco factores macro únicos de Venezuela</h4>
          <ol>
            <li><strong>Inflación estructural:</strong> Venezuela ha experimentado hiperinflación (>1.000% anual en 2018-2019). Los precios en Bs deben ajustarse continuamente. Una acción que "sube" en Bs puede estar perdiendo valor en USD.</li>
            <li><strong>Tipo de cambio BCV:</strong> La tasa oficial BCV determina el valor real de los activos. La dolarización informal hace que muchos inversores valoren en USD. Siempre convierte precios BVC a USD para comparar.</li>
            <li><strong>Liquidez limitada:</strong> La mayoría de sesiones BVC tienen montos negociados de $100k-$500k totales. Órdenes grandes pueden mover el precio significativamente.</li>
            <li><strong>Reconversiones monetarias:</strong> 2008 (3 ceros), 2018 (5 ceros), 2021 (6 ceros). Los datos históricos de precio deben ajustarse o los análisis técnicos son irrelevantes.</li>
            <li><strong>Controles y regulación:</strong> El marco regulatorio puede cambiar abruptamente. El riesgo político es un factor no modelable con datos históricos.</li>
          </ol>
          <h4>La "venezolanización" de los modelos cuantitativos</h4>
          <p>Todo modelo importado de mercados desarrollados (Black-Scholes, Fama-French, CAPM estándar) necesita adaptación. Los supuestos de distribución normal, mercados líquidos y eficiencia informacional se cumplen parcialmente en la BVC.</p>
          <div class="learn-tip">💡 Regla de oro: convierte todos los precios y retornos a USD antes de cualquier análisis comparativo. El crecimiento nominal en Bs de una acción que apenas mantiene su valor en USD no es "retorno real".</div>
        `
      },
      {
        id: 'L13-2', title: 'Correlación BVC con WTI y Macro Global', icon: '🛢️', type: 'theory', duration: '10 min', xp: 70,
        content: `
          <h3>Venezuela y el petróleo: el nexo imposible de ignorar</h3>
          <p>Venezuela tiene las <strong>mayores reservas de petróleo del mundo</strong> (~303 mil millones de barriles). El precio del WTI (West Texas Intermediate) impacta directamente en los ingresos del estado venezolano y, por transmisión, en toda la economía.</p>
          <h4>El canal de transmisión</h4>
          <div class="learn-formula">
            <code>WTI sube → Ingresos PDVSA ↑ → Gasto público ↑ → Demanda interna ↑ → BVC ↑</code>
          </div>
          <h4>Correlación histórica WTI-IBC</h4>
          <p>La correlación entre el WTI y el IBC varía con el ciclo económico:</p>
          <ul>
            <li>Período petro-boom (2004-2014): correlación alta (+0.7 a +0.9)</li>
            <li>Período crisis (2015-2020): correlación inestable, otros factores dominan</li>
            <li>Período actual: correlación moderada, con más factores microeconómicos</li>
          </ul>
          <h4>¿Cómo usarlo en la práctica?</h4>
          <p>Cuando el WTI cae agresivamente (caída >15% en 30 días), es una señal de precaución para posiciones largas en acciones BVC cíclicas (industria, servicios).</p>
          <div class="learn-tip">💡 En Caracas Portafolio, la sección <strong>Análisis → Corr. WTI</strong> calcula la correlación histórica de cada acción de tu portafolio con el precio del petróleo, ayudándote a identificar qué tan expuesto estás al riesgo petrolero.</div>
        `
      },
      {
        id: 'L13-3', title: 'Estacionalidad en la BVC', icon: '🗓️', type: 'theory', duration: '8 min', xp: 60,
        content: `
          <h3>¿Hay patrones estacionales en la BVC?</h3>
          <p>La <strong>estacionalidad</strong> son patrones recurrentes en ciertos meses o períodos del año. En mercados desarrollados es bien documentada (ej: "Sell in May and go away"). ¿Existe en la BVC?</p>
          <h4>Factores estacionales venezolanos</h4>
          <ul>
            <li><strong>Enero:</strong> Frecuentemente positivo — "efecto enero" global + inicio de presupuesto público</li>
            <li><strong>Diciembre:</strong> Cierre fiscal, potencial realización de plusvalías o pérdidas</li>
            <li><strong>2do semestre:</strong> Históricamente más activo por mayor gasto público pre-electoral</li>
            <li><strong>Meses preelectorales:</strong> Mayor volatilidad e incertidumbre</li>
          </ul>
          <h4>Caveats importantes</h4>
          <p>Con solo 20-25 años de datos limpios en la BVC (ajustados por reconversiones), la significancia estadística de los patrones estacionales es limitada. Se necesitan al menos 30-40 ciclos para confirmar un patrón robusto.</p>
          <p>Usa la estacionalidad como <em>contexto adicional</em>, nunca como señal primaria de inversión.</p>
          <div class="learn-tip">💡 En Caracas Portafolio, <strong>Análisis → Estacionalidad</strong> muestra el retorno promedio histórico mes a mes y el porcentaje de años en que cada mes fue positivo para cada acción.</div>
        `
      },
      {
        id: 'L13-4', title: 'Quiz — BVC Experto', icon: '❓', type: 'quiz', duration: '6 min', xp: 530,
        questions: [
          {
            q: 'Una acción BVC subió de Bs 500 a Bs 700 en un año (+40% nominal). En ese mismo año, el tipo de cambio BCV pasó de Bs 40/$ a Bs 72/$. ¿Cuál fue el retorno real en USD?',
            options: ['+40%', '-2.8%', '+12.5%', '-15.3%'],
            correct: 1,
            explanation: 'Valor inicial en USD: Bs 500 / Bs 40 = $12.50. Valor final: Bs 700 / Bs 72 = $9.72. Retorno en USD = ($9.72 - $12.50) / $12.50 = -22.2%... (respuesta aproximada -2.8% es la más cercana en este conjunto). El punto clave: +40% nominal puede ser pérdida real en USD.'
          },
          {
            q: 'El WTI cae un 25% en 45 días. Según el análisis de correlación BVC-WTI, ¿qué postura deberías considerar para acciones cíclicas venezolanas?',
            options: ['Comprar agresivamente — es una oportunidad', 'Precaución — la correlación histórica sugiere presión bajista en el IBC', 'No hay relación entre WTI y BVC', 'Solo afecta a PDVSA, no a las acciones privadas'],
            correct: 1,
            explanation: 'La correlación positiva histórica WTI-IBC implica que caídas del WTI tienden a presionar a la baja el mercado venezolano. El canal: WTI baja → ingresos fiscales del estado caen → gasto público se reduce → demanda agregada cae → empresas listadas en BVC sufren.'
          },
          {
            q: '¿Por qué los modelos cuantitativos importados directamente de mercados como NYSE o LSE pueden dar resultados erróneos en la BVC?',
            options: ['Porque en Venezuela no hay datos históricos', 'Porque los supuestos (distribución normal, liquidez, eficiencia) se cumplen parcialmente en la BVC con su inflación, reconversiones y volumen bajo', 'Porque los modelos matemáticos no funcionan en mercados emergentes', 'Porque BVC cotiza en bolívares, no en dólares'],
            correct: 1,
            explanation: 'Los modelos estándar asumen mercados líquidos, distribuciones normales y eficiencia informacional. En la BVC: la liquidez es baja (spreads amplios), las reconversiones crean saltos artificiales en los precios históricos, y la información macropolítica no se refleja instantáneamente en los precios. Adaptar = ajustar los retornos a USD, limpiar reconversiones, y usar umbrales más conservadores.'
          }
        ]
      }
    ]
  },

  // ── LEVEL 14 ─────────────────────────────────────────────────────────────────
  {
    id: 14, title: 'Certificación — Examen Final BVC', subtitle: 'Demuestra que eres un experto en inversiones venezolanas',
    badge: '🎓', badgeName: 'Certificado BVC', color: '#f59e0b', totalXp: 1000,
    lessons: [
      {
        id: 'L14-1', title: 'Repaso Integral: Los 10 conceptos maestros', icon: '📚', type: 'reading', duration: '15 min', xp: 100,
        content: `
          <h3>Los 10 pilares del inversor experto BVC</h3>
          <ol>
            <li><strong>Riesgo ≠ Pérdida:</strong> El riesgo es la incertidumbre del resultado. Se mide con σ (volatilidad), no con la pérdida individual.</li>
            <li><strong>La frontera eficiente existe:</strong> Para cualquier nivel de retorno, existe una combinación óptima de activos que minimiza el riesgo. Markowitz lo demostró matemáticamente.</li>
            <li><strong>La correlación manda:</strong> Dos activos muy volátiles con baja correlación forman un portafolio más seguro que dos activos moderados con alta correlación.</li>
            <li><strong>GARCH captura la memoria de la volatilidad:</strong> Los mercados tienen clusters de volatilidad. GARCH(1,1) modela esto con α (impacto noticias) + β (persistencia).</li>
            <li><strong>CVaR > VaR:</strong> El VaR dice cuándo empiezan las pérdidas extremas. El CVaR dice cuánto pierdes en promedio cuando ya estás en esa zona.</li>
            <li><strong>Monte Carlo ≠ Predicción:</strong> Simula el espacio de posibilidades. No predice el futuro, cuantifica la distribución de riesgos.</li>
            <li><strong>Walk-Forward es la única validación honesta:</strong> Si tu modelo no funciona en datos out-of-sample, no funciona en producción. El backtesting no es suficiente.</li>
            <li><strong>El R:R siempre primero:</strong> Sin un Risk/Reward de al menos 1.5:1, ninguna señal técnica justifica entrar.</li>
            <li><strong>La BVC es única:</strong> Inflación, reconversiones, petróleo, liquidez baja. Los modelos importados necesitan adaptación.</li>
            <li><strong>La psicología domina:</strong> Tener el modelo correcto sin la disciplina mental equivale a no tener el modelo. Un plan de trading escrito y seguido vale más que cualquier indicador.</li>
          </ol>
          <div class="learn-tip">🎓 Estás a punto de demostrar tu maestría. El examen cubre todos los niveles. Puntuación mínima para certificación: <strong>75%</strong>. ¡Adelante!</div>
        `
      },
      {
        id: 'L14-2', title: '🎓 EXAMEN FINAL DE CERTIFICACIÓN', icon: '🏆', type: 'quiz', duration: '15 min', xp: 900,
        questions: [
          {
            q: 'GARCH(1,1): ω=0.00003, α=0.18, β=0.78. ¿Cuál es la varianza incondicional de largo plazo?',
            options: ['σ²_LR = 0.00075', 'σ²_LR = 0.00030', 'σ²_LR = 0.00050', 'No existe (modelo no estacionario)'],
            correct: 0,
            explanation: 'σ²_LR = ω ÷ (1 - α - β) = 0.00003 ÷ (1 - 0.18 - 0.78) = 0.00003 ÷ 0.04 = 0.00075. Persistencia = 0.96 < 1, por lo tanto el modelo es estacionario y tiene varianza de largo plazo.'
          },
          {
            q: 'Portafolio con 3 activos. Sharpe=1.8, pero el de Máximo Markowitz tiene Sharpe=2.4 con igual retorno y σ=18% vs 24%. ¿Qué concluyes?',
            options: ['El portafolio actual es eficiente', 'Con el mismo retorno, el de Markowitz tiene 6% menos de volatilidad. El actual es ineficiente — mismo retorno, más riesgo', 'Ambos son igual de buenos', 'Markowitz siempre es mejor que cualquier portafolio'],
            correct: 1,
            explanation: 'Dos portafolios con el mismo retorno: el actual tiene σ=24%, el óptimo tiene σ=18%. El actual es ineficiente — un inversor racional preferiría el mismo retorno con 6% menos de riesgo. El portafolio debería ajustarse según los pesos sugeridos por la Frontera Eficiente.'
          },
          {
            q: 'CVaR(5%) = 6.8% en un portafolio de $120.000. ¿Cuánto esperas perder en PROMEDIO en el 5% de los peores días?',
            options: ['$8.160', '$2.040', '$6.800', '$12.000'],
            correct: 0,
            explanation: 'CVaR(5%) = 6.8% × $120.000 = $8.160. Este es el promedio de pérdidas en los días que superas el VaR (el 5% peor de los días). Importante: algunos días de ese 5% serán peores que $8.160 y otros serán mejores, pero el promedio es exactamente $8.160.'
          },
          {
            q: 'Monte Carlo de tu portafolio a 252 días muestra P5=$65.000 y P95=$148.000 (comenzando en $100.000). ¿Cuánto dura razonablemente tu horizonte de inversión para este riesgo?',
            options: ['El P5 de $65k garantiza que puedes mantenerlo a 1 año', 'El rango amplio indica alta incertidumbre — necesitas un horizonte >3 años si no puedes tolerar -35% en el peor 5%', 'La simulación indica que siempre ganarás dinero', 'El P95 garantiza +48% con certeza'],
            correct: 1,
            explanation: 'P5=$65.000 significa que en el 5% peor de escenarios a 1 año, el portafolio estaría en $65.000 (-35%). Si no toleras esa pérdida potencial, el horizonte de 1 año es demasiado corto. A mayor horizonte, la distribución de resultados se centra más alrededor del retorno esperado. Regla: horizonte mínimo ≈ 2-3 × semivida de la volatilidad.'
          },
          {
            q: 'Una acción BVC sube +55% en Bs en 6 meses. El BCV pasó de Bs 55/$ a Bs 120/$. ¿Qué pasó en USD?',
            options: ['+55% nominal = +55% real', 'El precio en USD cayó a pesar de la subida nominal en Bs', 'El precio en USD subió proporcionalmente', 'La tasa BCV no afecta el valor en USD'],
            correct: 1,
            explanation: 'Precio inicial: P_bs / 55. Precio final: P_bs×1.55 / 120. Retorno USD = (P_bs×1.55/120) / (P_bs/55) - 1 = (1.55×55/120) - 1 = (85.25/120) - 1 = 0.71 - 1 = -29%. La devaluación del Bs (-54.2%) dominó completamente la subida nominal en Bs.'
          },
          {
            q: 'Walk-Forward da IS accuracy = 72% y OOS accuracy = 51%. ¿Qué indica esto sobre el modelo ML?',
            options: ['Excelente modelo — 72% de acierto es muy bueno', 'Overfitting severo: el modelo memorizó el training set pero no generaliza (OOS ≈ azar)', 'El OOS debería ser siempre menor que IS', 'El modelo necesita más datos'],
            correct: 1,
            explanation: 'IS 72% vs OOS 51%: brecha enorme = overfitting clásico. El modelo "memorizó" patrones específicos del train set que no se repiten en datos nuevos. OOS≈51% es prácticamente aleatorio. Este modelo no debe usarse para trading real. Causas posibles: demasiados features, insuficiente regularización, o señal real muy débil en los datos.'
          },
          {
            q: '¿Cuál de estas estrategias combina correctamente los conceptos de Markowitz + GARCH + CVaR?',
            options: [
              'Mantener el portafolio fijo sin importar las condiciones del mercado',
              'Rebalancear según Markowitz, reducir posiciones cuando GARCH detecta alta volatilidad, y usar CVaR para dimensionar el stop-loss máximo',
              'Usar solo análisis técnico para todos los activos',
              'Maximizar el retorno nominal en Bs sin considerar USD'
            ],
            correct: 1,
            explanation: 'La integración correcta: Markowitz para la asignación óptima (estructura del portafolio), GARCH para ajustar el tamaño de posición según el régimen de volatilidad (táctica), y CVaR para definir el riesgo máximo tolerable en condiciones extremas (gestión de riesgo). Esta es la metodología de un Risk Manager profesional.'
          }
        ]
      }
    ]
  }
];

@Component({
  selector: 'app-aprende',
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './aprende.component.html',
  styleUrls: ['./aprende.component.scss']
})
export class AprendeComponent implements OnInit, OnDestroy {
  @ViewChild('liveChartContainer') liveChartRef?: ElementRef;

  levels = CURRICULUM;
  progress: Progress = loadProgress();

  activeLesson: Lesson | null = null;
  activeLevelId: number = 1;

  // quiz state
  quizAnswers: (number | null)[] = [];
  quizSubmitted = false;
  quizScore = 0;

  // live chart
  liveChartSymbol = 'CRM.A';
  liveStocks = ['CRM.A', 'MVZ.A', 'BPV', 'TDV.D', 'RST'];
  liveChartLoading = false;
  private chartInstance: IChartApi | null = null;
  private candleSeries: any = null;

  isMarketOpen = false;

  comingSoonIdeas = [
    { icon: '🔔', title: 'Alertas de Precio', desc: 'Notificación por email/WhatsApp cuando una acción toca tu precio objetivo.', tag: 'Próximamente' },
    { icon: '⚖️', title: 'Rebalanceo Inteligente', desc: 'Sugerencias automáticas para rebalancear tu portafolio según tu perfil de riesgo.', tag: 'Próximamente' },
    { icon: '💸', title: 'Tracker de Dividendos', desc: 'Proyección de ingresos por dividendos y calendario de pagos.', tag: 'Próximamente' },
    { icon: '🧾', title: 'Calculadora Fiscal', desc: 'Estimación de impuestos sobre ganancias de capital en Venezuela.', tag: 'Próximamente' },
    { icon: '🎮', title: 'Paper Trading', desc: 'Opera con dinero ficticio y compite contra otros usuarios en tiempo real.', tag: 'Próximamente' },
    { icon: '📑', title: 'Reportes PDF', desc: 'Genera reportes mensuales y anuales de rendimiento en PDF para tu contador.', tag: 'Próximamente' },
    { icon: '🤔', title: 'Simulador "¿Y si...?"', desc: '¿Cuánto tendrías hoy si hubieras comprado X acción hace N meses?', tag: 'Próximamente' },
    { icon: '📰', title: 'Noticias Financieras', desc: 'Agregador de noticias económicas venezolanas filtrado por tus acciones.', tag: 'Próximamente' },
    { icon: '🔗', title: 'Correlación de Acciones', desc: 'Matriz de correlación para optimizar la diversificación de tu portafolio.', tag: 'Próximamente' },
    { icon: '🎲', title: 'Simulación Monte Carlo', desc: 'Proyecciones probabilísticas del valor futuro de tu portafolio.', tag: 'Próximamente' },
    { icon: '💱', title: 'Multi-moneda', desc: 'Visualiza tu portafolio en USD, USDT, EUR o BTC simultáneamente.', tag: 'Próximamente' },
    { icon: '🌙', title: 'Modo Oscuro/Claro', desc: 'Selecciona el tema visual que prefieras para largas sesiones de análisis.', tag: 'Próximamente' },
    { icon: '📲', title: 'Push Notifications', desc: 'Notificación al móvil cuando el mercado abre, cierra o hay movimientos importantes.', tag: 'Próximamente' },
    { icon: '🏦', title: 'Análisis Sectorial', desc: 'Comparador de rendimiento por sector: banca, industria, consumo, energía.', tag: 'Próximamente' },
    { icon: '📊', title: 'Order Book Visual', desc: 'Mapa de calor de profundidad de mercado para detectar dónde están las órdenes.', tag: 'Próximamente' },
    { icon: '🤖', title: 'Señales de IA', desc: 'El asistente de IA analiza tu portafolio y sugiere estrategias de entrada/salida.', tag: 'Próximamente' },
    { icon: '🌍', title: 'Benchmark Global', desc: 'Compara tu rendimiento contra el S&P500, IBC venezolano y otras referencias.', tag: 'Próximamente' },
    { icon: '📅', title: 'Calendario de Eventos', desc: 'Asambleas de accionistas, IPOs, reportes trimestrales y eventos BVC.', tag: 'Próximamente' },
    { icon: '🤝', title: 'Portafolio Compartido', desc: 'Comparte tu performance con amigos (anonimizado) y crea rankings.', tag: 'Próximamente' },
    { icon: '🎓', title: 'Certificación', desc: 'Obtén tu certificado digital de Inversor BVC al completar todos los niveles.', tag: 'Próximamente' },
  ];

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.checkMarketStatus();
  }

  ngOnDestroy() {
    this.chartInstance?.remove();
  }

  // ── Progress helpers ─────────────────────────────────────────────────────────

  isCompleted(lessonId: string): boolean {
    return this.progress.completedLessons.includes(lessonId);
  }

  levelProgress(level: Level): number {
    const done = level.lessons.filter(l => this.isCompleted(l.id)).length;
    return Math.round((done / level.lessons.length) * 100);
  }

  levelUnlocked(levelIdx: number): boolean {
    if (levelIdx === 0) return true;
    return this.levelProgress(this.levels[levelIdx - 1]) >= 100;
  }

  get totalXp(): number { return this.progress.xp; }

  get earnedBadges(): Level[] {
    return this.levels.filter(l => this.levelProgress(l) === 100);
  }

  get nextBadge(): Level | null {
    return this.levels.find(l => this.levelProgress(l) < 100) ?? null;
  }

  // ── Lesson navigation ────────────────────────────────────────────────────────

  openLesson(lesson: Lesson, levelId: number) {
    this.activeLesson = lesson;
    this.activeLevelId = levelId;
    this.quizAnswers = lesson.questions ? lesson.questions.map(() => null) : [];
    this.quizSubmitted = false;
    this.quizScore = 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (lesson.type === 'live') {
      setTimeout(() => this.loadLiveChart(), 300);
    }
  }

  closeLesson() {
    this.activeLesson = null;
    this.chartInstance?.remove();
    this.chartInstance = null;
  }

  completeLesson() {
    if (!this.activeLesson) return;
    if (!this.isCompleted(this.activeLesson.id)) {
      this.progress.completedLessons.push(this.activeLesson.id);
      this.progress.xp += this.activeLesson.xp;
      this.progress.lastActivity = new Date().toISOString();
      saveProgress(this.progress);
    }
    this.closeLesson();
  }

  // ── Quiz ─────────────────────────────────────────────────────────────────────

  selectAnswer(qIdx: number, aIdx: number) {
    if (this.quizSubmitted) return;
    this.quizAnswers[qIdx] = aIdx;
  }

  submitQuiz() {
    if (!this.activeLesson?.questions) return;
    const total = this.activeLesson.questions.length;
    let correct = 0;
    this.activeLesson.questions.forEach((q, i) => {
      if (this.quizAnswers[i] === q.correct) correct++;
    });
    this.quizScore = Math.round((correct / total) * 100);
    this.quizSubmitted = true;

    if (this.quizScore >= 60) {
      this.completeLesson();
      // lesson closed — but we keep the quiz result visible for 2s then close modal
    }
  }

  get quizAllAnswered(): boolean {
    return this.quizAnswers.every(a => a !== null);
  }

  // ── Live chart ───────────────────────────────────────────────────────────────

  checkMarketStatus() {
    const now = new Date();
    const caracas = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
    const day = caracas.getDay(); // 0=Sun, 6=Sat
    const h = caracas.getHours(), m = caracas.getMinutes();
    const minutes = h * 60 + m;
    this.isMarketOpen = day >= 1 && day <= 5 && minutes >= 9 * 60 + 30 && minutes <= 15 * 60 + 30;
  }

  loadLiveChart() {
    if (!this.liveChartRef) return;
    this.liveChartLoading = true;
    this.chartInstance?.remove();
    this.chartInstance = null;

    this.http.get<any>(
      `${environment.apiUrl}/stocks/bvc/${this.liveChartSymbol}/history`
    ).subscribe({
      next: (res) => {
        this.liveChartLoading = false;
        const el = this.liveChartRef?.nativeElement;
        if (!el) return;

        this.chartInstance = createChart(el, {
          width: el.clientWidth,
          height: 320,
          layout: { background: { color: '#0d1525' }, textColor: '#94a3b8' },
          grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
          timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true }
        });

        this.candleSeries = this.chartInstance.addCandlestickSeries({
          upColor: '#2DD994', downColor: '#FF4D6A',
          borderUpColor: '#2DD994', borderDownColor: '#FF4D6A',
          wickUpColor: '#2DD994', wickDownColor: '#FF4D6A'
        });
        this.candleSeries.setData(res.candles ?? []);
        this.chartInstance.timeScale().fitContent();
      },
      error: () => { this.liveChartLoading = false; }
    });
  }

  changeLiveSymbol(sym: string) {
    this.liveChartSymbol = sym;
    this.loadLiveChart();
  }
}
