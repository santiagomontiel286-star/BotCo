import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { FlaskConical } from "lucide-react";

export default function DemoBanner() {
  const { data: sessions = [] } = useQuery({
    queryKey: ["activeBotSession"],
    queryFn: () => base44.entities.BotSession.filter({ active: true }),
    refetchInterval: 15000,
  });

  if (sessions[0]?.mode !== "demo") return null;

  return (
    <div className="bg-chart-3/15 border-b border-chart-3/40 px-4 py-2 flex items-center justify-center gap-2">
      <FlaskConical className="w-3.5 h-3.5 text-chart-3 flex-shrink-0" />
      <span className="text-xs font-bold text-chart-3 tracking-wider text-center">
        MODO DEMO — Capital ficticio · Las órdenes son simuladas, no se opera con dinero real
      </span>
    </div>
  );
}