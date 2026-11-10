import RiskProfileSelector from "../components/RiskProfileSelector";
import { Settings as SettingsIcon, ShieldCheck } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
          <SettingsIcon className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Ajustes</h2>
          <p className="text-sm text-muted-foreground">Configuración y preferencias</p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Credenciales del exchange</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Las claves de Kraken se guardan solo en los secretos del backend (KRAKEN_API_KEY y KRAKEN_API_SECRET) y nunca
          se escriben, guardan ni envían desde el navegador. La app únicamente lee saldos y órdenes del servidor.
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-1">Perfil de Riesgo</h3>
        <p className="text-xs text-muted-foreground mb-4">Ajusta el comportamiento de todos los bots simultáneamente. Conservador (4 bots), Balanceado (5 bots), Agresivo (6 bots).</p>
        <RiskProfileSelector />
      </div>
    </div>
  );
}