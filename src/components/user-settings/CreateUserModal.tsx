import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface CreateUserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  name: string; setName: (v: string) => void;
  role: string; setRole: (v: string) => void;
  accountIds: string[]; setAccountIds: (v: string[]) => void;
  accounts: any[];
  onSubmit: () => void;
  isPending: boolean;
}

export function CreateUserModal({
  open, onOpenChange, email, setEmail, password, setPassword,
  name, setName, role, setRole, accountIds, setAccountIds,
  accounts, onSubmit, isPending,
}: CreateUserModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>Create a new user account with a role assignment.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className="bg-background" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Strong password" className="bg-background" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Display Name (optional)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" className="bg-background" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="client">Client</SelectItem>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="builder">Builder</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {role === "client" && accounts?.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm">Linked Accounts</Label>
              <div className="space-y-2 max-h-40 overflow-auto">
                {accounts.map((acc: any) => (
                  <label key={acc.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={accountIds.includes(acc.id)}
                      onCheckedChange={(checked) => setAccountIds(checked ? [...accountIds, acc.id] : accountIds.filter(id => id !== acc.id))}
                    />
                    {acc.name}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit} disabled={!email || !password || isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Create User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
