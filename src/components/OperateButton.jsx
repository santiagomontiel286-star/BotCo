import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { X, Zap } from "lucide-react";
import BotActivationPanel from "./BotActivationPanel";
import { cn } from "@/lib/utils";

export default function OperateButton() {
  const [open, setOpen] = useState(false);
  const { data: sessions = [] } = useQuery({
    queryKey: ["activeBotSession"],
    queryFn: () => base44.entities.BotSession.filter({ active: true }),
    refetchInterval: 15000,
  });
  const mode = sessions[0]?.mode || "real";
  const isDemo = mode === "demo";

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="lg"
        className={cn("gap-2 text-white shadow-lg", isDemo ? "bg-accent hover:bg-accent/90" : "bg-primary hover:bg-primary/90")}
      >
        {isDemo ? "🔵 OPERAR (DEMO)" : <><Zap className="w-4 h-4" /> OPERAR</>}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 flex justify-end">
          <div className="w-full max-w-2xl h-full bg-background border-l border-border shadow-2xl overflow-y-auto p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">Panel de operación</h3>
                <p className="text-xs text-muted-foreground">Control aislado para modo {isDemo ? "DEMO" : "LIVE"}</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <BotActivationPanel />
          </div>
        </div>
      )}
    </>
  );
}