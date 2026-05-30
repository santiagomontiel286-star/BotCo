import { useState, useEffect } from "react";
import RiskProfileSelector from "../components/RiskProfileSelector";
import { Settings as SettingsIcon, Eye, EyeOff, Save, ExternalLink, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const SESSION_KEY = "botco_api_keys";

function loadFromSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveToSession(data) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function ConfirmDialog({ onAccept, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">¿Recordar credenciales?</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Tus API keys se guardarán en esta sesión del navegador. Se borrarán automáticamente cuando cierres la pestaña o el navegador.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onCancel} className="flex-1 gap-1.5">
            <X className="w-3.5 h-3.5" /> Solo guardar
          </Button>
          <Button onClick={onAccept} className="flex-1 gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Recordar sesión
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [binanceKey, setBinanceKey] = useState("");
  const [binanceSecret, setBinanceSecret] = useState("");
  const [krakenKey, setKrakenKey] = useState("");
  const [krakenSecret, setKrakenSecret] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [remembered, setRemembered] = useState(false);

  // Load from sessionStorage on mount
  useEffect(() => {
    const saved = loadFromSession();
    if (saved) {
      setBinanceKey(saved.binanceKey || "");
      setBinanceSecret(saved.binanceSecret || "");
      setKrakenKey(saved.krakenKey || "");
      setKrakenSecret(saved.krakenSecret || "");
      setRemembered(true);
    }
  }, []);

  const handleSave = () => {
    setShowConfirm(true);
  };

  const handleAcceptRemember = () => {
    saveToSession({ binanceKey, binanceSecret, krakenKey, krakenSecret });
    setRemembered(true);
    setShowConfirm(false);
    toast.success("Configuración guardada y recordada", { description: "Las credenciales se mantendrán hasta que cierres el navegador." });
  };

  const handleDeclineRemember = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setRemembered(false);
    setShowConfirm(false);
    toast.success("Configuración guardada", { description: "Las credenciales no se recordarán al recargar." });
  };

  const handleForget = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setRemembered(false);
    toast.success("Credenciales olvidadas", { description: "Las claves han sido eliminadas de la sesión." });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {showConfirm && (
        <ConfirmDialog onAccept={handleAcceptRemember} onCancel={handleDeclineRemember} />
      )}

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
          <SettingsIcon className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Ajustes</h2>
          <p className="text-sm text-muted-foreground">Configuración de APIs y preferencias</p>
        </div>
      </div>

      {remembered && (
        <div className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-primary">
            <ShieldCheck className="w-4 h-4" />
            Credenciales recordadas en esta sesión
          </div>
          <button onClick={handleForget} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
            Olvidar
          </button>
        </div>
      )}

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
            <p className="text-xs text-muted-foreground mt-0.5">Conecta tu cuenta de Kraken como exchange principal</p>
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

      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-1">Perfil de Riesgo</h3>
        <p className="text-xs text-muted-foreground mb-4">Ajusta el comportamiento de todos los bots simultáneamente. Conservador (4 bots), Balanceado (5 bots), Agresivo (6 bots).</p>
        <RiskProfileSelector />
      </div>

      <Button onClick={handleSave} className="bg-primary hover:bg-primary/90 gap-2">
        <Save className="w-4 h-4" /> Guardar Configuración
      </Button>
    </div>
  );
}