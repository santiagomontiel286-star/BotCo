import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

export default function StatCard({ label, value, change, icon: Icon, prefix = "", suffix = "", positive }) {
  const isPositive = positive !== undefined ? positive : (change && change > 0);
  
  return (
    <div className="bg-card rounded-xl border border-border p-4 hover:border-primary/20 transition-all duration-300 group">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center group-hover:glow-green-sm transition-all">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        )}
      </div>
      <div className="flex items-end justify-between">
        <p className="text-xl font-mono font-bold text-foreground">
          {prefix}{typeof value === 'number' ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value}{suffix}
        </p>
        {change !== undefined && (
          <div className={cn("flex items-center gap-0.5 text-xs font-mono font-medium", isPositive ? "text-profit" : "text-loss")}>
            {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(change).toFixed(2)}%
          </div>
        )}
      </div>
    </div>
  );
}