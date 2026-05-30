import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function DemoBanner() {
  const { data: sessions = [] } = useQuery({
    queryKey: ["activeBotSession"],
    queryFn: () => base44.entities.BotSession.filter({ active: true }),
    refetchInterval: 15000,
  });

  if (sessions[0]?.mode !== "demo") return null;

  return (
    <div className="bg-accent/15 border-b border-accent/30 px-4 py-2 text-center text-xs font-semibold text-accent">
      ⚠️ MODO DEMO — Capital ficticio. Ninguna operación es real.
    </div>
  );
}