import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export default function OperateButton({ variant = "button" }) {
  const { data: sessions = [] } = useQuery({
    queryKey: ["activeBotSession"],
    queryFn: () => base44.entities.BotSession.filter({ active: true }),
    refetchInterval: 15000,
  });
  const mode = sessions[0]?.mode || "real";
  const isDemo = mode === "demo";

  return (
    <Button
      asChild
      size={variant === "nav" ? "default" : "lg"}
      className={cn(
        "gap-2 text-white",
        variant === "nav"
          ? "w-full justify-start rounded-lg shadow-none px-3 py-2.5 text-sm font-medium"
          : "shadow-lg",
        isDemo ? "bg-accent hover:bg-accent/90" : "bg-primary hover:bg-primary/90"
      )}
    >
      <Link to="/operar">
        {isDemo ? (
          "🔵 OPERAR (DEMO)"
        ) : (
          <>
            <Zap className="w-4 h-4" />
            OPERAR
          </>
        )}
      </Link>
    </Button>
  );
}