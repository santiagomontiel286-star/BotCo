import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";
import { useBot } from "@/hooks/useBot";
import { cn } from "@/lib/utils";

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { running, mode } = useBot();
  const live = mode === "live";

  return (
    <div className="min-h-screen bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 lg:px-8 flex items-center justify-between">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-muted text-muted-foreground" aria-label="Abrir menú"><Menu className="w-5 h-5" /></button>
          <div className={cn("ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-mono font-medium",
            !running ? "border-border text-muted-foreground" : live ? "bg-chart-3/10 border-chart-3/40 text-chart-3" : "bg-primary/10 border-primary/30 text-primary")}>
            <span className={cn("w-1.5 h-1.5 rounded-full", !running ? "bg-muted-foreground/60" : live ? "bg-chart-3 animate-pulse" : "bg-primary animate-pulse")} />
            {!running ? "APAGADO" : live ? "REAL" : "SIMULADO"}
          </div>
        </header>
        <main className="p-4 lg:p-8 max-w-6xl">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
