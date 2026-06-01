import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function TradingLoopButton() {
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState(null);

  const runLoop = async () => {
    setRunning(true);
    setSummary(null);
    try {
      const scanner = await base44.functions.invoke("signalScanner", { autoMode: true });
      const execution = await base44.functions.invoke("tradingTick", { runOnce: true, autoMode: true });
      setSummary({
        ok: true,
        loopTick: new Date().toISOString(),
        scanner: scanner.data,
        execution: execution.data,
      });
      toast.success("Loop ejecutado");
    } catch (error) {
      const message = error?.response?.data?.error || error.message;
      setSummary({ ok: false, error: message });
      toast.error(message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Signal Bus Loop</h3>
          <p className="text-xs text-muted-foreground">Escanea señales y ejecuta la mejor si pasa Risk Guardian.</p>
        </div>
        <Button onClick={runLoop} disabled={running} className="gap-2">
          <RefreshCw className={cn("w-4 h-4", running && "animate-spin")} />
          Ejecutar loop ahora
        </Button>
      </div>
      {summary && (
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          {JSON.stringify(summary, null, 2)}
        </pre>
      )}
    </div>
  );
}