import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Wallet as WalletIcon, Plus, Minus, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function WalletPage() {
  const queryClient = useQueryClient();
  const { data: bots = [] } = useQuery({ queryKey: ["bots"], queryFn: () => base44.entities.Bot.list() });
  const { data: txns = [] } = useQuery({ queryKey: ["wallet"], queryFn: () => base44.entities.WalletTransaction.list("-created_date", 20) });
  
  const [dialog, setDialog] = useState(null);
  const [amount, setAmount] = useState("");
  const [selectedBot, setSelectedBot] = useState("");

  const totalCapital = bots.reduce((s, b) => s + (b.capital || 0), 0);

  const createTxn = useMutation({
    mutationFn: (data) => base44.entities.WalletTransaction.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["wallet"] }); setDialog(null); setAmount(""); toast.success("Transacción completada"); }
  });

  const handleSubmit = () => {
    if (!amount || isNaN(amount)) return;
    const num = parseFloat(amount);
    if (dialog === "deposit") {
      createTxn.mutate({ type: "deposit", amount: num, description: "Depósito manual" });
    } else if (dialog === "withdraw") {
      createTxn.mutate({ type: "withdrawal", amount: num, description: "Retiro manual" });
    } else if (dialog === "transfer" && selectedBot) {
      createTxn.mutate({ type: "transfer", amount: num, to_bot: selectedBot, description: `Transferencia a ${selectedBot}` });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center glow-green-sm">
          <WalletIcon className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Wallet</h2>
          <p className="text-sm text-muted-foreground">Gestión de capital y distribución</p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-primary/20 p-6 glow-green">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">Balance Total</span>
        <p className="text-3xl font-mono font-bold text-foreground mt-2">${totalCapital.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
        <div className="flex gap-2 mt-4">
          <Button size="sm" className="bg-primary hover:bg-primary/90 gap-1.5" onClick={() => setDialog("deposit")}><Plus className="w-3.5 h-3.5" /> Depositar</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDialog("withdraw")}><Minus className="w-3.5 h-3.5" /> Retirar</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDialog("transfer")}><ArrowUpRight className="w-3.5 h-3.5" /> Distribuir</Button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Capital por Bot</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {bots.map(b => (
            <div key={b.id} className="bg-card rounded-xl border border-border p-4">
              <span className="text-xs text-muted-foreground">{b.name}</span>
              <p className="text-lg font-mono font-bold text-foreground mt-1">${(b.capital || 0).toLocaleString()}</p>
              <div className="w-full bg-muted rounded-full h-1.5 mt-2">
                <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${totalCapital ? ((b.capital || 0) / totalCapital * 100) : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Transacciones Recientes</h3>
        <div className="space-y-2">
          {txns.map(t => (
            <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
              <div className="flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", t.type === "deposit" ? "bg-primary/10" : t.type === "withdrawal" ? "bg-destructive/10" : "bg-accent/10")}>
                  {t.type === "deposit" ? <Plus className="w-4 h-4 text-primary" /> : t.type === "withdrawal" ? <Minus className="w-4 h-4 text-destructive" /> : <ArrowUpRight className="w-4 h-4 text-accent" />}
                </div>
                <div>
                  <p className="text-xs font-medium text-foreground">{t.description || t.type}</p>
                  <p className="text-[10px] text-muted-foreground">{t.status}</p>
                </div>
              </div>
              <span className={cn("font-mono text-sm font-semibold", t.type === "deposit" ? "text-profit" : t.type === "withdrawal" ? "text-loss" : "text-accent")}>
                {t.type === "withdrawal" ? "-" : "+"}{t.amount?.toLocaleString()} USD
              </span>
            </div>
          ))}
          {txns.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No hay transacciones aún</p>}
        </div>
      </div>

      <Dialog open={!!dialog} onOpenChange={() => setDialog(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {dialog === "deposit" ? "Depositar Fondos" : dialog === "withdraw" ? "Retirar Fondos" : "Distribuir Capital"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Monto (USD)</label>
              <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="font-mono" />
            </div>
            {dialog === "transfer" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Bot destino</label>
                <Select value={selectedBot} onValueChange={setSelectedBot}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar bot" /></SelectTrigger>
                  <SelectContent>{bots.map(b => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button onClick={handleSubmit} className="bg-primary hover:bg-primary/90">Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}