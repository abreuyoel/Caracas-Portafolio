import google.generativeai as genai
from typing import Optional, List, Dict
from datetime import datetime
from decimal import Decimal
import json
import asyncio
from app.config import settings
import logging

logger = logging.getLogger(__name__)

class AIAgent:
    def __init__(self):
        """Inicializar el agente de IA con Gemini"""
        try:
            genai.configure(api_key=settings.gemini_api_key_clean, transport="rest")
            self.model = genai.GenerativeModel(settings.gemini_model)
            self.chat = None
            logger.info("✅ Gemini AI initialized successfully")
        except Exception as e:
            logger.error(f"❌ Error initializing Gemini: {e}")
            self.model = None

    def start_chat(self, user_context: str = ""):
        """Iniciar sesión de chat con contexto del usuario"""
        if not self.model:
            return None
        
        system_instruction = """
        Eres un asistente financiero experto en la Bolsa de Valores de Caracas (BVC).
        Tu rol es ayudar a los usuarios a gestionar sus inversiones de manera inteligente.
        
        Reglas:
        1. Responde en español de Venezuela
        2. Sé claro, conciso y profesional
        3. No des consejos financieros definitivos, siempre sugiere consultar expertos
        4. Usa datos reales cuando los tengas disponibles
        5. Sé empático con la situación económica de Venezuela
        6. Explica conceptos financieros de manera sencilla
        7. Considera la inflación y la tasa BCV en tus análisis
        8. Recomienda diversificación del portafolio
        9. Alerta sobre riesgos cuando sea necesario
        10. Mantén confidencialidad sobre los datos del usuario
        
        Formato de respuestas:
        - Usa emojis moderadamente para hacer la experiencia amigable
        - Usa listas y viñetas para información compleja
        - Incluye porcentajes y montos en USD y Bs cuando sea relevante
        - Sé optimista pero realista
        """
        
        try:
            self.chat = self.model.start_chat(history=[])
            
            # Enviar contexto inicial
            if user_context:
                self.chat.send_message(f"Contexto del usuario: {user_context}")
            
            return self.chat
        except Exception as e:
            logger.error(f"Error starting chat: {e}")
            return None

    async def analyze_portfolio(self, portfolio_data: Dict) -> Dict:
        """Analizar el portafolio del usuario y dar recomendaciones"""
        if not self.model:
            return {"error": "IA no disponible"}
        
        prompt = f"""
        Analiza este portafolio de inversión de la Bolsa de Valores de Caracas y proporciona:
        
        1. **Resumen del Portafolio**
        2. **Distribución Actual** (por acción y porcentaje)
        3. **Rendimiento General** (ganancias/pérdidas)
        4. **Top 3 Mejores Acciones**
        5. **Top 3 Acciones a Revisar**
        6. **Recomendaciones de Rebalanceo**
        7. **Oportunidades Detectadas**
        8. **Riesgos Identificados**
        9. **Meta Sugerida** para los próximos 3 meses
        
        Datos del Portafolio:
        {json.dumps(portfolio_data, indent=2, default=str)}
        
        Fecha de análisis: {datetime.now().strftime('%d/%m/%Y')}
        Tasa BCV参考: Considera la tasa actual del BCV
        
        Responde en formato JSON estructurado con las secciones mencionadas.
        """
        
        try:
            response = await asyncio.to_thread(self.model.generate_content, prompt)
            # Extraer JSON de la respuesta
            return self._parse_json_response(response.text)
        except Exception as e:
            logger.error(f"Error analyzing portfolio: {e}")
            return {"error": str(e)}

    async def get_investment_advice(self, 
                                    stock_symbol: str,
                                    current_price: float,
                                    user_goal: str = "") -> Dict:
        """Obtener consejo de inversión para una acción específica"""
        if not self.model:
            return {"error": "IA no disponible"}
        
        prompt = f"""
        El usuario está considerando invertir en: {stock_symbol}
        Precio actual: {current_price} Bs
        Objetivo del usuario: {user_goal or 'Crecimiento a largo plazo'}
        
        Proporciona:
        1. **Análisis Técnico Breve** (tendencia actual)
        2. **Niveles de Soporte y Resistencia** (estimados)
        3. **Recomendación** (Comprar/Mantener/Vender)
        4. **Precio Objetivo** (estimado a 3 meses)
        5. **Stop Loss Sugerido**
        6. **Riesgos Principales**
        7. **Catalizadores Positivos**
        8. **Alternativas Similares** en la BVC
        
        IMPORTANTE:
        - Aclara que esto NO es consejo financiero profesional
        - Recomienda hacer su propia investigación (DYOR)
        - Considera el contexto económico venezolano
        
        Responde en español de manera clara y estructurada.
        """
        
        try:
            response = await asyncio.to_thread(self.model.generate_content, prompt)
            return {"advice": response.text, "stock": stock_symbol}
        except Exception as e:
            logger.error(f"Error getting investment advice: {e}")
            return {"error": str(e)}

    async def generate_market_summary(self, 
                                      stocks_data: List[Dict],
                                      period: str = "semanal") -> str:
        """Generar resumen del mercado de la BVC"""
        if not self.model:
            return "IA no disponible"
        
        prompt = f"""
        Genera un resumen del mercado de la Bolsa de Valores de Caracas para el período {period}.
        
        Datos del mercado:
        {json.dumps(stocks_data, indent=2, default=str)}
        
        Incluye:
        1. **Comportamiento General del Mercado** (alcista/bajista/lateral)
        2. **Sectores Más Fuertes**
        3. **Sectores Más Débiles**
        4. **Acciones Destacadas** (mayores ganancias)
        5. **Acciones en Caída** (mayores pérdidas)
        6. **Volumen de Negociación** (alto/bajo/promedio)
        7. **Noticias Relevantes** que puedan afectar el mercado
        8. **Perspectivas** para la próxima {period}
        9. **Recomendación General** para inversionistas
        
        Tono: Profesional pero accesible, como un boletín financiero.
        Longitud: 300-500 palabras.
        Incluye emojis relevantes para hacerlo más atractivo.
        """
        
        try:
            response = await asyncio.to_thread(self.model.generate_content, prompt)
            return response.text
        except Exception as e:
            logger.error(f"Error generating market summary: {e}")
            return "Error generando resumen del mercado"

    async def answer_question(self, 
                              question: str, 
                              user_context: Dict = None) -> str:
        """Responder preguntas del usuario sobre sus inversiones"""
        if not self.model:
            return "IA no disponible en este momento"
        
        context_str = json.dumps(user_context, default=str) if user_context else "Sin contexto adicional"
        
        prompt = f"""
        Eres un asistente financiero experto. Responde la pregunta del usuario.
        
        Contexto del usuario:
        {context_str}
        
        Pregunta del usuario: {question}
        
        Directrices:
        1. Sé preciso y basado en datos cuando sea posible
        2. Explica conceptos técnicos de manera sencilla
        3. Proporciona ejemplos cuando sea útil
        4. Menciona riesgos cuando aplique
        5. Recomienda consultar profesionales para decisiones importantes
        6. Usa un tono amigable y profesional
        7. Responde en español de Venezuela
        8. Máximo 300 palabras
        
        Respuesta:
        """
        
        try:
            if not self.chat:
                self.start_chat()
            
            response = self.chat.send_message(prompt)
            return response.text
        except Exception as e:
            logger.error(f"Error answering question: {e}")
            return "Lo siento, tuve un error procesando tu pregunta. Por favor intenta de nuevo."

    async def detect_anomalies(self, 
                               transactions: List[Dict],
                               portfolio: Dict) -> List[Dict]:
        """Detectar anomalías o patrones interesantes en las transacciones"""
        if not self.model:
            return []
        
        prompt = f"""
        Analiza estas transacciones y portafolio para detectar:
        1. Patrones de compra/venta inusuales
        2. Concentración de riesgo (demasiado en una acción)
        3. Oportunidades de toma de ganancias
        4. Posibles errores (precios atípicos, comisiones altas)
        5. Momentos óptimos de entrada/salida basados en histórico
        
        Transacciones:
        {json.dumps(transactions, indent=2, default=str)}
        
        Portafolio:
        {json.dumps(portfolio, indent=2, default=str)}
        
        Devuelve un array JSON con las anomalías detectadas, cada una con:
        - tipo: "riesgo" | "oportunidad" | "advertencia" | "error_potencial"
        - severidad: "alta" | "media" | "baja"
        - descripcion: explicación clara
        - recomendacion: acción sugerida
        - impacto_estimado: en porcentaje o monto USD
        """
        
        try:
            response = await asyncio.to_thread(self.model.generate_content, prompt)
            anomalies = self._parse_json_response(response.text)
            return anomalies if isinstance(anomalies, list) else []
        except Exception as e:
            logger.error(f"Error detecting anomalies: {e}")
            return []

    def _parse_json_response(self, text: str) -> Dict:
        """Extraer JSON de la respuesta del modelo"""
        try:
            # Buscar bloques JSON en la respuesta
            import re
            json_match = re.search(r'\{[\s\S]*\}', text)
            if json_match:
                return json.loads(json_match.group())
            return {"raw_response": text}
        except:
            return {"raw_response": text}


# Singleton instance
ai_agent = AIAgent()