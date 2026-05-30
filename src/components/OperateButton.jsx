import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { X, Zap } from "lucide-react";
import BotActivationPanel from "./BotActivationPanel";
import { cn } from "@/lib/utils";

export default function OperateButton({ variant = "button" }) {
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
        size={variant === "nav" ? "default" : "lg"}
        className={cn(
          "gap-2 text-white",
          variant === "nav"
            ? "w-full justify-start rounded-lg shadow-none px-3 py-2.5 text-sm font-medium"
            : "shadow-lg",
          isDemo ? "bg-accent hover:bg-accent/90" : "bg-primary hover:bg-primary/90"
        )}
      >
        {isDemo ? (
          "🔵 OPERAR (DEMO)"
        ) : (
          <>
            <Zap className="w-4 h-4" />
            OPERAR
          </>
        )}
      </Button>

      {open && createPortal(
        <div className="fixed inset-0 z-[100] bg-background overflow-y-auto">
          <div className="min-h-screen p-4 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-6xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-2xl font-bold text-foreground">Panel de operación</h3>
                  <p className="text-sm text-muted-foreground mt-1">Control aislado para modo {isDemo ? "DEMO" : "LIVE"}</p>
                </div>
                <button onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <BotActivationPanel />
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}