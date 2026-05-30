import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Bell, Check, Trash2, AlertTriangle, Info, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const sevConfig = {
  info: { icon: Info, color: "text-accent", bg: "bg-accent/10", border: "border-l-accent" },
  warning: { icon: AlertTriangle, color: "text-chart-3", bg: "bg-chart-3/10", border: "border-l-chart-3" },
  critical: { icon: Shield, color: "text-destructive", bg: "bg-destructive/10", border: "border-l-destructive" },
  success: { icon: Zap, color: "text-primary", bg: "bg-primary/10", border: "border-l-primary" },
};

export default function Alerts() {
  const queryClient = useQueryClient();
  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => base44.entities.Alert.list("-created_date", 50),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const markRead = useMutation({
    mutationFn: (id) => base44.entities.Alert.update(id, { is_read: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const deleteAlert = useMutation({
    mutationFn: (id) => base44.entities.Alert.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const unreadCount = alerts.filter(a => !a.is_read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-chart-3/10 flex items-center justify-center">
            <Bell className="w-5 h-5 text-chart-3" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Alertas</h2>
            <p className="text-sm text-muted-foreground">{unreadCount} sin leer</p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {alerts.map(a => {
          const sev = sevConfig[a.severity] || sevConfig.info;
          const SevIcon = sev.icon;
          return (
            <div key={a.id} className={cn("bg-card rounded-xl border border-border p-4 border-l-2 transition-all", sev.border, a.is_read && "opacity-60")}>
              <div className="flex items-start gap-3">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5", sev.bg)}>
                  <SevIcon className={cn("w-4 h-4", sev.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-foreground truncate">{a.title}</h4>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!a.is_read && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => markRead.mutate(a.id)}>
                          <Check className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => deleteAlert.mutate(a.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{a.message}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium uppercase", sev.bg, sev.color)}>{a.severity}</span>
                    {a.source && <span className="text-[10px] text-muted-foreground">{a.source}</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {alerts.length === 0 && (
          <div className="text-center py-16 bg-card rounded-xl border border-border">
            <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Todo tranquilo — sin alertas pendientes</p>
          </div>
        )}
      </div>
    </div>
  );
}