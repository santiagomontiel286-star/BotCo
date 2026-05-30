import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { LayoutDashboard, Cpu, TrendingUp, Brain, Shield, Clock, Wallet, Settings, Bell, X, Activity, Archive, ChevronRight, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/bots", label: "Bots", icon: Cpu },
  { path: "/wallet", label: "Wallet", icon: Wallet },
  { path: "/settings", label: "Ajustes", icon: Settings },
];

const analysisItems = [
  { path: "/market", label: "Mercado", icon: TrendingUp },
  { path: "/ai", label: "Análisis IA", icon: Brain },
  { path: "/risk", label: "Riesgo", icon: Shield },
  { path: "/alerts", label: "Alertas", icon: Bell },
];

const recordsItems = [
  { path: "/history", label: "Historial", icon: Clock },
  { path: "/sessions", label: "Sesiones", icon: Archive },
];

const PROFILE_LABELS = { conservador: "Modo Conservador", balanceado: "Modo Balanceado", agresivo: "Modo Agresivo" };

export default function Sidebar({ open, onClose }) {
  const location = useLocation();
  const [openMenu, setOpenMenu] = useState(null);
  const { data: sessions = [] } = useQuery({
    queryKey: ["activeBotSession"],
    queryFn: () => base44.entities.BotSession.filter({ active: true }),
    refetchInterval: 15000,
  });
  const session = sessions[0];
  const profileLabel = PROFILE_LABELS[session?.risk_profile] || "Modo Conservador";
  const isActive = session?.active;
  const isAnalysisActive = analysisItems.some(item => item.path === location.pathname);
  const isRecordsActive = recordsItems.some(item => item.path === location.pathname);

  const renderFlyout = (items) => (
    <div className="absolute left-full top-0 ml-2 w-56 rounded-xl border border-border bg-card shadow-2xl p-2 z-[60]">
      {items.map(item => {
        const active = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={onClose}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={onClose} />
      )}
      <aside className={cn(
        "fixed top-0 left-0 z-50 h-full w-64 border-r border-sidebar-border flex flex-col transition-transform duration-300 lg:translate-x-0",
        session?.mode === "demo" ? "bg-slate-900" : "bg-sidebar",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center glow-green-sm">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-foreground text-lg tracking-tight">BotCo</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">AI Trading</p>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-1">
          {navItems.map(item => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  active
                    ? "bg-primary/10 text-primary glow-green-sm"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className={cn("w-[18px] h-[18px]", active && "text-primary")} />
                {item.label}
              </Link>
            );
          })}

          <div className="relative" onMouseEnter={() => setOpenMenu("analysis")} onMouseLeave={() => setOpenMenu(null)}>
            <button
              onClick={() => setOpenMenu(openMenu === "analysis" ? null : "analysis")}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                isAnalysisActive ? "bg-primary/10 text-primary glow-green-sm" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <BarChart3 className="w-[18px] h-[18px]" />
              Análisis
              <ChevronRight className="w-4 h-4 ml-auto" />
            </button>
            {openMenu === "analysis" && renderFlyout(analysisItems)}
          </div>

          <div className="relative" onMouseEnter={() => setOpenMenu("records")} onMouseLeave={() => setOpenMenu(null)}>
            <button
              onClick={() => setOpenMenu(openMenu === "records" ? null : "records")}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                isRecordsActive ? "bg-primary/10 text-primary glow-green-sm" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Clock className="w-[18px] h-[18px]" />
              Historial
              <ChevronRight className="w-4 h-4 ml-auto" />
            </button>
            {openMenu === "records" && renderFlyout(recordsItems)}
          </div>
        </nav>

        <div className="p-4 mx-3 mb-4 rounded-lg bg-primary/5 border border-primary/10">
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-primary animate-pulse' : 'bg-muted-foreground'}`} />
            <span className="text-xs font-medium text-primary">{isActive ? "Sistema Activo" : "Sistema Inactivo"}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{profileLabel}</p>
        </div>
      </aside>
    </>
  );
}