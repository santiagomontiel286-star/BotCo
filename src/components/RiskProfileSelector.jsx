import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { Shield, Zap, Flame } from "lucide-react";

const PROFILES = [
  {
    key: "conservador",
    label: "Conservador",
    icon: Shield,
    color: "text-primary",
    activeBg: "bg-primary/10 border-primary/30",
    desc: "TP 1% · SL 0.6% · 4 bots · Riesgo 0.5%/trade",
  },
  {
    key: "balanceado",
    label: "Balanceado",
    icon: Zap,
    color: "text-accent",
    activeBg: "bg-accent/10 border-accent/30",
    desc: "TP 1.5% · SL 0.9% · 5 bots · Riesgo 1.5%/trade",
  },
  {
    key: "agresivo",
    label: "Agresivo",
    icon: Flame,
    color: "text-destructive",
    activeBg: "bg-destructive/10 border-destructive/30",
    desc: "TP 2.5% · SL 1.2% · 6 bots · Riesgo 3%/trade",
  },
];

const PROFILE_KEY = "botco_risk_profile";

export function getSavedProfile() {
  return localStorage.getItem(PROFILE_KEY) || "conservador";
}

export default function RiskProfileSelector() {
  const queryClient = useQueryClient();
  const [localProfile, setLocalProfile] = useState(getSavedProfile());

  const { data: sessions = [] } = useQuery({
    queryKey: ["activeBotSession"],
    queryFn: () => base44.entities.BotSession.filter({ active: true }),
  });

  const activeSession = sessions[0];
  // DB value takes priority if session exists, otherwise use localStorage
  const currentProfile = activeSession?.risk_profile || localProfile;

  const updateProfile = useMutation({
    mutationFn: ({ profile }) => {
      if (!activeSession) return Promise.resolve();
      return base44.entities.BotSession.update(activeSession.id, { risk_profile: profile });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["activeBotSession"] }),
  });

  const handleSelect = (profile) => {
    // Always save to localStorage (works with or without active session)
    localStorage.setItem(PROFILE_KEY, profile);
    setLocalProfile(profile);
    // Also update DB if session exists
    updateProfile.mutate({ profile });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Perfil de riesgo:</span>
      {PROFILES.map(p => {
        const Icon = p.icon;
        const isActive = currentProfile === p.key;
        return (
          <button
            key={p.key}
            onClick={() => handleSelect(p.key)}
            title={p.desc}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all",
              isActive
                ? `${p.activeBg} ${p.color}`
                : "border-border text-muted-foreground hover:text-foreground bg-muted/30"
            )}
          >
            <Icon className="w-3 h-3" />
            {p.label}
          </button>
        );
      })}
    </div>
  );
}