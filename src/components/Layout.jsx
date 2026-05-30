import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import DemoBanner from "./DemoBanner";
import { Outlet } from "react-router-dom";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: sessions = [] } = useQuery({
    queryKey: ["activeBotSession"],
    queryFn: () => base44.entities.BotSession.filter({ active: true }),
    refetchInterval: 15000,
  });
  const isDemo = sessions[0]?.mode === "demo";

  return (
    <div className="min-h-screen bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <div className="lg:pl-64">
        <DemoBanner />
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 lg:px-6 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-muted text-muted-foreground"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3 ml-auto">
            <div className={`flex flex-col items-center px-3 py-1.5 rounded-full border ${isDemo ? 'bg-chart-3/10 border-chart-3/30' : 'bg-primary/10 border-primary/20'}`}>
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isDemo ? 'bg-chart-3' : 'bg-primary'}`} />
                <span className={`text-xs font-mono font-medium ${isDemo ? 'text-chart-3' : 'text-primary'}`}>LIVE</span>
              </div>
              {isDemo && <span className="text-[9px] font-mono font-bold text-chart-3 leading-tight">DEMO</span>}
            </div>
          </div>
        </header>
        
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}