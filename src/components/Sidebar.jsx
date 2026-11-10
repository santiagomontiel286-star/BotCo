import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Building2, Clock, Settings, X, Activity, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { useBot } from "@/hooks/useBot";

const NAV = [
  { path: "/", label: "Panel", icon: LayoutDashboard },
  { path: "/oficina", label: "Oficina", icon: Building2 },
  { path: "/history", label: "Historial", icon: Clock },
  { path: "/settings", label: "Ajustes", icon: Settings },
];

export default function Sidebar({ open, onClose }) {
  const location = useLocation();
  const { logout } = useAuth();
  const { running, mode } = useBot();

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={onClose} />}
      <aside className={cn("fixed top-0 left-0 z-50 h-full w-60 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-300 lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center"><Activity className="w-5 h-5 text-primary" /></div>
            <div>
              <h1 className="font-bold text-foreground text-lg tracking-tight leading-none">BotCo</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1">Trading en Kraken</p>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden text-muted-foreground hover:text-foreground" aria-label="Cerrar menú"><X className="w-5 h-5" /></button>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-1">
          {NAV.map(item => {
            const active = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path} onClick={onClose}
                className={cn("flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  active ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
                <item.icon className="w-[18px] h-[18px]" />{item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 space-y-2">
          <div className="px-3 py-3 rounded-lg bg-background/50 border border-sidebar-border">
            <div className="flex items-center gap-2">
              <span className={cn("w-2 h-2 rounded-full", running ? "bg-primary animate-pulse" : "bg-muted-foreground/50")} />
              <span className="text-xs font-medium text-foreground">{running ? "Bot encendido" : "Bot apagado"}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{mode === "live" ? "Dinero real en Kraken" : "Modo simulado"}</p>
          </div>
          <button onClick={() => logout()} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent">
            <LogOut className="w-4 h-4" />Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  );
}
