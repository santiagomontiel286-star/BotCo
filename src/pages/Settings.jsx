import { useState } from "react";
import { Settings as SettingsIcon, Eye, EyeOff, Save, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

export default function SettingsPage() {
  const [binanceKey, setBinanceKey] = useState("");
  const [binanceSecret, setBinanceSecret] = useState("");
  const [krakenKey, setKrakenKey] = useState("");
  const [krakenSecret, setKrakenSecret] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const { toast } = useToast();

  const handleSave = () => {
    toast({ title: "✅ Configuración guardada", description: "Los cambios han sido aplicados correctamente." });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
          <SettingsIcon className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Ajustes</h2>
          <p className="text-sm text-muted-foreground">Configuración de APIs y preferencias</p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Binance API</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Conecta tu cuenta de Binance para trading automático</p>
          </div>
          <a href="https://www.binance.com/en/my/settings/api-management" target="_blank" rel="noopener noreferrer" className="text-xs text-accent flex items-center gap-1 hover:underline">
            Obtener API Key <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">API Key</label>
            <Input value={binanceKey} onChange={e => setBinanceKey(e.target.value)} placeholder="Tu Binance API Key" className="font-mono text-xs" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">API Secret</label>
            <div className="relative">
              <Input type={showSecrets ? "text" : "password"} value={binanceSecret} onChange={e => setBinanceSecret(e.target.value)} placeholder="Tu Binance API Secret" className="font-mono text-xs pr-10" />
              <button onClick={() => setShowSecrets(!showSecrets)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showSecrets ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Kraken API</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Conecta tu cuenta de Kraken como exchange secundario</p>
          </div>
          <a href="https://www.kraken.com/u/security/api" target="_blank" rel="noopener noreferrer" className="text-xs text-accent flex items-center gap-1 hover:underline">
            Obtener API Key <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">API Key</label>
            <Input value={krakenKey} onChange={e => setKrakenKey(e.target.value)} placeholder="Tu Kraken API Key" className="font-mono text-xs" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">API Secret</label>
            <Input type={showSecrets ? "text" : "password"} value={krakenSecret} onChange={e => setKrakenSecret(e.target.value)} placeholder="Tu Kraken API Secret" className="font-mono text-xs" />
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-2">OpenAI (Próximamente)</h3>
        <p className="text-xs text-muted-foreground">Integración con GPT para análisis avanzado de sentimiento y predicciones de mercado. Disponible en próxima actualización.</p>
      </div>

      <Button onClick={handleSave} className="bg-primary hover:bg-primary/90 gap-2">
        <Save className="w-4 h-4" /> Guardar Configuración
      </Button>
    </div>
  );
}