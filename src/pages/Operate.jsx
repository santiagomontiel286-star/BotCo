import BotActivationPanel from "../components/BotActivationPanel";
import TradingLoopButton from "../components/TradingLoopButton";

export default function Operate() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Operar</h2>
        <p className="text-sm text-muted-foreground mt-1">Panel independiente de operación de bots</p>
      </div>
      <TradingLoopButton />
      <BotActivationPanel />
    </div>
  );
}