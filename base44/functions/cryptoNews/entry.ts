import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await base44.integrations.Core.InvokeLLM({
    prompt: `Eres un analista experto de criptomonedas. Busca las últimas noticias y eventos del mercado crypto de las últimas 24 horas.
    
    Devuelve un análisis estructurado con:
    1. Las 5 noticias más relevantes del mercado crypto (Bitcoin, Ethereum, altcoins)
    2. Sentimiento general del mercado (bullish/bearish/neutral) con puntuación 0-100
    3. 3 señales técnicas clave (BTC, ETH, altcoins)
    4. 2 riesgos o alertas importantes
    5. Resumen ejecutivo en 2 frases
    
    Sé preciso con precios y datos actuales.`,
    add_context_from_internet: true,
    response_json_schema: {
      type: "object",
      properties: {
        news: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              sentiment: { type: "string", enum: ["bullish", "bearish", "neutral"] },
              impact: { type: "string", enum: ["high", "medium", "low"] },
              source: { type: "string" }
            }
          }
        },
        market_sentiment: {
          type: "object",
          properties: {
            score: { type: "number" },
            label: { type: "string" },
            btc_trend: { type: "string" },
            eth_trend: { type: "string" }
          }
        },
        signals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              asset: { type: "string" },
              signal: { type: "string" },
              confidence: { type: "number" },
              action: { type: "string", enum: ["buy", "sell", "hold", "watch"] }
            }
          }
        },
        alerts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              severity: { type: "string", enum: ["critical", "warning", "info"] }
            }
          }
        },
        summary: { type: "string" },
        timestamp: { type: "string" }
      }
    }
  });

  return Response.json({ analysis: result, generatedAt: new Date().toISOString() });
});