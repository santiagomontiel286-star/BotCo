import BotActivationPanel from "../components/BotActivationPanel";

export default function Operate() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Operar</h2>
        <p className="text-sm text-muted-foreground mt-1">Panel independiente de operación de bots</p>
      </div>
      <BotActivationPanel />
    </div>
  );
}