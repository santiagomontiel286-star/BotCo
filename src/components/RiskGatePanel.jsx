import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ShieldAlert, Save } from "lucide-react";
import { toast } from "sonner";

const DEFAULTS = { kill_switch: false, strategy_engine: "day_trader", max_open_trades: 1, max_loss_per_trade_eur: 0.2, max_daily_loss_eur: 0.6, max_trades_per_day: 3, min_reward_risk: 1.5, max_hold_minutes: 240, max_order_eur: 16, target_r: 3, tm_min_edge_points: 5 };

const FIELDS = [
  { key: "max_open_trades", label: "Máx. trades abiertos", step: "1" },
  { key: "max_loss_per_trade_eur", label: "Pérdida máx. por trade (€)", step: "0.01" },
  { key: "max_daily_loss_eur", label: "Pérdida máx. diaria (€)", step: "0.01" },
  { key: "max_trades_per_day", label: "Máx. trades al día", step: "1" },
  { key: "min_reward_risk", label: "Beneficio/riesgo mínimo", step: "0.1" },
  { key: "max_hold_minutes", label: "Tiempo máx. por operación (min)", step: "15" },
  { key: "max_order_eur", label: "Orden máxima (€)", step: "1" },
  { key: "target_r", label: "Objetivo (múltiplos del riesgo)", step: "0.5" },
  { key: "tm_min_edge_points", label: "Ventaja mínima Máquina del Tiempo (puntos)", step: "1" },
];

function toPayload(config) {
  const payload = { kill_switch: !!config.kill_switch, strategy_engine: config.strategy_engine === "sentinel" ? "sentinel" : "day_trader" };
  FIELDS.forEach(field => { payload[field.key] = Number(config[field.key]); });
  return payload;
}

export default function RiskGatePanel() {
  const [config, setConfig] = useState(DEFAULTS);
  const [recordId, setRecordId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.RiskConfig.list("-created_date", 1)
      .then(rows => {
        const record = (Array.isArray(rows) ? rows : rows?.items || [])[0];
        if (record) { setRecordId(record.id); setConfig({ ...DEFAULTS, ...record }); }
      })
      .catch(() => {});
  }, []);

  const save = async (next) => {
    setSaving(true);
    try {
      const payload = toPayload(next);
      if (recordId) await base44.entities.RiskConfig.update(recordId, payload);
      else { const created = await base44.entities.RiskConfig.create(payload); setRecordId(created.id); }
      toast.success("RiskConfig guardado");
    } catch (error) {
      toast.error(error.message || "No se pudo guardar RiskConfig");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-chart-3" />
          <h3 className="text-sm font-semibold text-foreground">RiskConfig — puerta de riesgo</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${config.kill_switch ? "text-loss" : "text-primary"}`}>{config.kill_switch ? "Kill switch ON" : "Kill switch OFF"}</span>
          <Switch checked={!!config.kill_switch} onCheckedChange={value => { const next = { ...config, kill_switch: value }; setConfig(next); save(next); }} />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 mb-4">
        <div>
          <p className="text-xs font-semibold text-foreground">Motor de decisión: {config.strategy_engine === "sentinel" ? "SentinelAI (anterior)" : "Agentes DayTrader"}</p>
          <p className="text-[11px] text-muted-foreground">DayTrader: ruptura del rango de apertura + Máquina del Tiempo. Lo ves trabajar en Oficina.</p>
        </div>
        <Switch checked={config.strategy_engine !== "sentinel"} onCheckedChange={value => { const next = { ...config, strategy_engine: value ? "day_trader" : "sentinel" }; setConfig(next); save(next); }} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {FIELDS.map(field => (
          <div key={field.key} className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">{field.label}</Label>
            <Input type="number" step={field.step} value={config[field.key] ?? ""} onChange={event => setConfig({ ...config, [field.key]: event.target.value })} className="font-mono text-xs" />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-4">
        <p className="text-[11px] text-muted-foreground">Se aplica antes de cada compra. Las ventas de cierre nunca se bloquean.</p>
        <Button size="sm" onClick={() => save(config)} disabled={saving}><Save className="w-3.5 h-3.5 mr-1.5" />{saving ? "Guardando…" : "Guardar"}</Button>
      </div>
    </div>
  );
}