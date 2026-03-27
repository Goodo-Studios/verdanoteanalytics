import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, UserPlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserManagementSectionProps {
  users: any[] | undefined;
  accounts: any[];
  onCreateUser: () => void;
  onDeleteUser: (userId: string) => void;
  onUpdateRole: (userId: string, role: string) => void;
}

export function UserManagementSection({ users, accounts, onCreateUser, onDeleteUser, onUpdateRole }: UserManagementSectionProps) {
  return (
    <section className="glass-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-[22px] text-forest">User Management</h2>
          <p className="font-body text-[13px] text-slate font-light mt-0.5">Create and manage users. Assign roles and link clients to accounts.</p>
        </div>
        <Button size="sm" className="bg-verdant text-white hover:bg-verdant-light font-body text-[13px] font-semibold rounded-[6px]" onClick={onCreateUser}>
          <UserPlus className="h-3.5 w-3.5 mr-1.5" />Create User
        </Button>
      </div>

      {!users?.length ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="font-body text-[13px] text-sage">No users yet. Create your first user above.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border-light">
          <Table>
            <TableHeader>
              <TableRow className="bg-cream-dark">
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">User</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Role</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold">Linked Accounts</TableHead>
                <TableHead className="font-label text-[11px] uppercase tracking-[0.04em] text-slate font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u: any) => (
                <TableRow key={u.user_id} className="border-b border-border-light">
                  <TableCell>
                    <div>
                      <div className="font-body text-[14px] font-semibold text-charcoal">{u.display_name || u.email}</div>
                      {u.display_name && <div className="font-body text-[12px] text-sage">{u.email}</div>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select value={u.role || "none"} onValueChange={(val) => onUpdateRole(u.user_id, val)}>
                      <SelectTrigger className="w-[120px] h-8 text-[12px] font-body bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="client">Client</SelectItem>
                        <SelectItem value="employee">Employee</SelectItem>
                        <SelectItem value="builder">Builder</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {u.account_ids?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {u.account_ids.map((id: string) => {
                          const acc = (accounts || []).find((a: any) => a.id === id);
                          return <Badge key={id} variant="secondary" className="font-body text-[10px]">{acc?.name || id}</Badge>;
                        })}
                      </div>
                    ) : (
                      <span className="font-body text-[13px] text-charcoal">{u.role === "client" ? "None" : "All"}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="text-sage hover:text-red-600" onClick={() => onDeleteUser(u.user_id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
