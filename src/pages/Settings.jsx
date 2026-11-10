import { useEffect, useState } from "react";
import { ChevronDown, ShieldCheck, Save, Loader2, FlaskConical, Banknote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useBot, RISK_DEFAULTS } from "@/hooks/useBot";

const RISK_FIELDS = [
  { key: "max_loss_per_trade_eur", label: "Pérdida máxima por operación", unit: "€", step: "0.1", help: "Lo máximo que puede perder una operación si salta el stop, con comisiones. Recomendado: 1 % del capital." },
  { key: "max_daily_loss_eur", label: "Pérdida máxima al día", unit: "€", step: "0.1", help: "Al llegar aquí, no abre más operaciones hasta mañana." },
  { key: "max_trades_per_day", label: "Operaciones máximas al día", unit: "", step: "1", help: "Menos operaciones, menos comisiones." },
  { key: "max_order_eur", label: "Tamaño máximo de una compra", unit: "€", step: "1", help: "Ninguna compra superará esta cantidad." },
];
const PROTECTION_FIELDS = [
  { key: "cooldown_after_stop_minutes", label: "Pausa tras un stop-loss", unit: "min", step: "15", help: "Evita entrar en caliente justo después de perder." },
  { key: "stoploss_guard_limit", label: "Stop-loss en 24 h para pausar", unit: "", step: "1", help: "Si se acumula esta racha, deja de entrar durante el día." },
  { key: "max_drawdown_pct", label: "Caída máxima de la sesión", unit: "%", step: "1", help: "Si el capital cae este porcentaje, el bot deja de abrir operaciones." },
];
const ADVANCED_FIELDS = [
  { key: "target_r", label: "Objetivo (veces el riesgo)", unit: "R", step: "0.5", help: "3R = intenta ganar el triple de lo que arriesga." },
  { key: "min_reward_risk", label: "Beneficio/riesgo mínimo tras comisiones", unit: "", step: "0.1" },
  { key: "tm_min_edge_points", label: "Ventaja mínima de la Máquina del Tiempo", unit: "puntos", step: "1", help: "Cuánto por encima del equilibrio tiene que salir la simulación." },
  { key: "max_hold_minutes", label: "Tiempo máximo por operación", unit: "min", step: "15" },
  { key: "session_anchor_utc_hour", label: "Inicio del rango de apertura (hora UTC)", unit: "h", step: "1", help: "7 = 08:00 en España (09:00 en verano)." },
  { key: "entry_window_utc_start", label: "Primera entrada posible (UTC)", unit: "", type: "time" },
  { key: "entry_window_utc_end", label: "Última entrada posible (UTC)", unit: "", type: "time" },
];

function Field({ field, value, onChange }) {
  return (
    <label className="block">
      <span className="text-sm text-foreground">{field.label}</span>
      <div className="flex items-center gap-2 mt-1.5">
        <Input type={field.type || "number"} step={field.step} value={value ?? ""} onChange={e => onChange(field.key, e.target.value)} className="font-mono max-w-[160px]" />
        {field.unit && <span className="text-xs text-muted-foreground">{field.unit}</span>}
      </div>
      {field.help && <span className="block text-[11px] text-muted-foreground mt-1">{field.help}</span>}
    </label>
  );
}

function Section({ title, description, children }) {
  return (
    <section className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="text-xs text-muted-foreground mt-0.5 mb-4">{description}</p>}
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { config, saveConfig, running } = useBot();
  const [form, setForm] = useState(config);
  const [saving, setSaving] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const configKey = JSON.stringify(config);
  useEffect(() => { setForm(JSON.parse(configKey)); }, [configKey]);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const toPayload = values => {
    const out = {};
    for (const key of Object.keys(RISK_DEFAULTS)) {
      const v = values[key];
      out[key] = typeof RISK_DEFAULTS[key] === "number" ? Number(v) : typeof RISK_DEFAULTS[key] === "boolean" ? !!v : v;
    }
    return out;
  };
  const save = async (values = form, message = "Ajustes guardados") => {
    const payload = toPayload(values);
    const bad = Object.entries(payload).find(([k, v]) => typeof RISK_DEFAULTS[k] === "number" && (!Number.isFinite(v) || v < 0));
    if (bad) return toast.error("Revisa los valores: hay un número no válido");
    setSaving(true);
    try { await saveConfig(payload); toast.success(message); } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const chooseMode = mode => {
    if (running) return toast.error("Apaga el bot en el Panel antes de cambiar de modo");
    if (mode === "live") return setConfirmLive(true);
    const next = { ...form, mode: "paper" }; setForm(next); save(next, "Modo simulado activado");
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Ajustes</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Cómo opera el bot y cuánto puede arriesgar.</p>
      </div>

      <Section title="Modo de funcionamiento" description={running ? "Apaga el bot para cambiar de modo." : "Empieza en simulado. Cuando el historial te convenza, pasa a real."}>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            { key: "paper", icon: FlaskConical, title: "Simulado", text: "Opera con precios reales de Kraken y una cartera virtual. No se toca tu dinero." },
            { key: "live", icon: Banknote, title: "Real", text: "Compra y vende en tu cuenta de Kraken con stop-loss real en cada operación." },
          ].map(opt => (
            <button key={opt.key} onClick={() => chooseMode(opt.key)} disabled={running}
              className={cn("text-left rounded-lg border p-4 transition-colors disabled:opacity-60", form.mode === opt.key ? (opt.key === "live" ? "border-chart-3 bg-chart-3/10" : "border-primary bg-primary/10") : "border-border hover:border-muted-foreground/40")}>
              <opt.icon className={cn("w-5 h-5 mb-2", form.mode === opt.key ? (opt.key === "live" ? "text-chart-3" : "text-primary") : "text-muted-foreground")} />
              <p className="text-sm font-semibold text-foreground">{opt.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{opt.text}</p>
            </button>
          ))}
        </div>
        {form.mode === "paper" && (
          <div className="mt-4"><Field field={{ key: "paper_capital_eur", label: "Capital virtual para la simulación", unit: "€", step: "10", help: "Se aplica la próxima vez que enciendas el bot." }} value={form.paper_capital_eur} onChange={set} /></div>
        )}
      </Section>

      <Section title="Límites de riesgo" description="Se comprueban antes de cada compra. Las ventas para salir nunca se bloquean.">
        <div className="grid sm:grid-cols-2 gap-5">{RISK_FIELDS.map(f => <Field key={f.key} field={f} value={form[f.key]} onChange={set} />)}</div>
      </Section>

      <Section title="Protecciones automáticas" description="Pausas que evitan seguir operando en un mal momento.">
        <div className="grid sm:grid-cols-2 gap-5">{PROTECTION_FIELDS.map(f => <Field key={f.key} field={f} value={form[f.key]} onChange={set} />)}</div>
        <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 mt-5">
          <div>
            <p className="text-sm text-foreground">Freno de emergencia</p>
            <p className="text-[11px] text-muted-foreground">Activado, el bot no abre ninguna operación nueva (las abiertas siguen protegidas).</p>
          </div>
          <Switch checked={!!form.kill_switch} onCheckedChange={v => { const next = { ...form, kill_switch: v }; setForm(next); save(next, v ? "Freno activado" : "Freno desactivado"); }} />
        </div>
      </Section>

      <section className="bg-card rounded-xl border border-border">
        <button onClick={() => setShowAdvanced(s => !s)} className="w-full flex items-center justify-between p-5">
          <div className="text-left">
            <h3 className="text-sm font-semibold text-foreground">Ajustes avanzados de los agentes</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Solo si sabes lo que cambias. Los valores por defecto están probados.</p>
          </div>
          <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", showAdvanced && "rotate-180")} />
        </button>
        {showAdvanced && <div className="grid sm:grid-cols-2 gap-5 px-5 pb-5">{ADVANCED_FIELDS.map(f => <Field key={f.key} field={f} value={form[f.key]} onChange={set} />)}</div>}
      </section>

      <div className="flex justify-end">
        <Button onClick={() => save()} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Guardar ajustes</Button>
      </div>

      <section className="rounded-xl border border-border p-5 flex gap-3">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Las claves de Kraken viven solo en los secretos del servidor (KRAKEN_API_KEY y KRAKEN_API_SECRET) y nunca pasan por el navegador.
          Para operar en real además deben valer «true» los secretos KRAKEN_LIVE_TRADING y BOTCO_LIVE_ENABLED. Crea la clave de Kraken
          solo con permisos de consultar y operar, nunca de retirar fondos.
        </p>
      </section>

      <AlertDialog open={confirmLive} onOpenChange={setConfirmLive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Pasar a dinero real?</AlertDialogTitle>
            <AlertDialogDescription>
              La próxima vez que enciendas el bot operará con los euros de tu cuenta de Kraken. Con la configuración actual, cada operación puede perder como máximo unos {form.max_loss_per_trade_eur} € y el día {form.max_daily_loss_eur} €. Un stop-loss limita la pérdida, pero en movimientos bruscos puede ejecutarse algo peor. Hazlo solo con dinero que puedas permitirte perder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir en simulado</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const next = { ...form, mode: "live" }; setForm(next); save(next, "Modo real activado: se aplicará al encender el bot"); }}>Pasar a real</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
