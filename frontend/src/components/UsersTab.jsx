import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Mail,
  Phone,
  Shield,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Ban,
  Copy,
  Check,
  RefreshCw,
  Search,
  AlertCircle,
  X,
  FileCode,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiFetch } from '@/utils/auth';

export default function UsersTab({ currentAdmin }) {
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  // Modal State
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [notification, setNotification] = useState(null);

  // Fetch users list (loaded strictly from .env - zero database calls)
  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/auth/users');
      let data = {};
      try {
        data = await res.json();
      } catch {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      if (res.ok && data.ok) {
        setUsers(data.users || []);
      } else {
        setNotification({ type: 'error', text: data.error || 'Failed to fetch user directory' });
      }
    } catch (err) {
      setNotification({ type: 'error', text: `Error loading team directory: ${err.message}` });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const activeCount = users.filter((u) => u.is_active).length;

  // Filter users based on query and dropdowns
  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.slot && u.slot.toLowerCase().includes(q));

    const matchesRole = filterRole === 'all' || u.role === filterRole;
    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'active' && u.is_active) ||
      (filterStatus === 'empty' && !u.is_active);

    return matchesSearch && matchesRole && matchesStatus;
  });

  const handleCopyEnvExample = () => {
    const exampleSnippet = `# Add employee in .env:
USER_2_EMAIL=employee@swargaseema.com
USER_2_PASSWORD=SecretPassword123
USER_2_NAME=Ramesh Kumar
USER_2_ROLE=employee
USER_2_PHONE=+919876543210`;
    navigator.clipboard.writeText(exampleSnippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2500);
  };

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 bg-background overflow-y-auto">
      {/* Top Banner / Actions Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 border-b border-border bg-card gap-4 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <Users className="size-5 text-[#008792]" />
            <h1 className="text-base font-bold text-foreground">Team & Employee Directory (.env)</h1>
            <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/30 font-mono">
              {activeCount} Active / {users.length} Slots
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Zero-database authentication mode. Users are loaded directly from <code className="text-[#008792] font-mono">.env</code> without disturbing production database tables.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchUsers}
            disabled={isLoading}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={() => setIsInviteOpen(true)}
            className="h-8 gap-1.5 text-xs bg-[#008792] hover:bg-teal-700 text-white"
          >
            <FileCode className="size-3.5" />
            Add / Configure in .env
          </Button>
        </div>
      </div>

      {/* Zero DB Touch Protection Banner */}
      <div className="mx-6 mt-4 p-3 rounded-lg bg-teal-500/10 border border-teal-500/30 text-teal-800 dark:text-teal-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-[#008792] shrink-0" />
          <span>
            <strong>Production DB Protected:</strong> MongoDB user tables are untouched. Up to 10 employees can be configured in <code className="font-mono bg-teal-500/20 px-1 py-0.5 rounded text-foreground">.env</code>. When email and password are provided, login works immediately.
          </span>
        </div>
        <Badge variant="outline" className="border-teal-500/40 text-[#008792] text-[10px] uppercase font-bold shrink-0 self-start sm:self-auto">
          10 Slots Ready
        </Badge>
      </div>

      {/* Global Notifications */}
      {notification && (
        <div
          className={`mx-6 mt-3 p-3 rounded-lg text-xs flex items-center justify-between border ${
            notification.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'error' ? (
              <AlertCircle className="size-4 shrink-0" />
            ) : (
              <CheckCircle2 className="size-4 shrink-0" />
            )}
            <span>{notification.text}</span>
          </div>
          <button onClick={() => setNotification(null)} className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="px-6 py-3 mt-3 border-y border-border bg-muted/20 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or slot..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-7 text-xs bg-background"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none"
          >
            <option value="all">All Roles</option>
            <option value="admin">Administrators</option>
            <option value="employee">Employees</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active (.env Configured)</option>
            <option value="empty">Empty Slots (Available)</option>
          </select>
        </div>
      </div>

      {/* Users Directory Table */}
      <div className="p-6">
        <Card className="border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-muted-foreground font-semibold">
                  <th className="py-2.5 px-4">Slot</th>
                  <th className="py-2.5 px-4">Employee Name</th>
                  <th className="py-2.5 px-4">Work Email</th>
                  <th className="py-2.5 px-4">Role</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Phone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-8 text-center text-muted-foreground">
                      No slots found matching your filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => {
                    const isRoot = user.id === 'admin_root';
                    const isActive = user.is_active;

                    return (
                      <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-4 font-mono font-bold text-xs text-[#008792]">
                          {user.slot}
                        </td>

                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className={`size-7 rounded-full flex items-center justify-center text-[11px] font-bold ${
                              isActive ? 'bg-[#008792]/20 text-[#008792] border border-[#008792]/30' : 'bg-muted text-muted-foreground'
                            }`}>
                              {user.name ? user.name[0].toUpperCase() : 'U'}
                            </div>
                            <div>
                              <div className="font-semibold text-foreground flex items-center gap-1.5">
                                <span>{user.name}</span>
                                {isRoot && (
                                  <Badge variant="outline" className="text-[9px] py-0 px-1 border-teal-500/30 text-teal-600 font-bold uppercase">
                                    Master Root
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-2.5 px-4 font-mono text-[11px] text-foreground">
                          {user.email}
                        </td>

                        <td className="py-2.5 px-4">
                          <Badge
                            variant="outline"
                            className={`text-[10px] uppercase font-bold tracking-wider ${
                              user.role === 'admin'
                                ? 'bg-purple-500/10 border-purple-500/30 text-purple-600'
                                : 'bg-slate-500/10 border-slate-500/30 text-slate-600'
                            }`}
                          >
                            {user.role === 'admin' ? (
                              <ShieldCheck className="size-3 mr-1 inline" />
                            ) : (
                              <Users className="size-3 mr-1 inline" />
                            )}
                            {user.role}
                          </Badge>
                        </td>

                        <td className="py-2.5 px-4">
                          {isActive ? (
                            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 border-emerald-500/30 text-emerald-600 gap-1 font-semibold">
                              <CheckCircle2 className="size-2.5" />
                              Active (.env Configured)
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] bg-muted/40 text-muted-foreground gap-1">
                              <Clock className="size-2.5" />
                              Empty Slot (Fill in .env)
                            </Badge>
                          )}
                        </td>

                        <td className="py-2.5 px-4 font-mono text-[11px] text-muted-foreground">
                          {user.phone || '--'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Add / Instructions Modal Dialog */}
      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogContent className="max-w-lg p-6 bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <FileCode className="size-4 text-[#008792]" />
              How to Add Employees in .env
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-xs text-foreground mt-2">
            <p className="leading-relaxed text-muted-foreground">
              To protect the production MongoDB database, user accounts are read directly from your <code className="text-[#008792] font-mono">.env</code> file.
            </p>

            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <div className="font-semibold text-xs mb-1.5 flex items-center justify-between">
                <span>Example .env Configuration:</span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={handleCopyEnvExample}
                  className="h-6 text-[10px] gap-1 text-[#008792]"
                >
                  {copiedSnippet ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                  {copiedSnippet ? 'Copied!' : 'Copy Template'}
                </Button>
              </div>
              <pre className="font-mono text-[11px] bg-background p-2.5 rounded border border-border select-all overflow-x-auto text-emerald-600 dark:text-emerald-400">
{`# User 2 Slot
USER_2_EMAIL=employee@swargaseema.com
USER_2_PASSWORD=SecretPassword123
USER_2_NAME=Ramesh Kumar
USER_2_ROLE=employee
USER_2_PHONE=+919876543210`}
              </pre>
            </div>

            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Fill Email & Password:</strong> The employee can immediately log in on their machine.</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Leave Empty:</strong> If email or password is empty, the slot remains disabled.</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Zero DB Touch:</strong> No data is created, deleted, or modified in MongoDB.</span>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-border">
              <Button
                variant="default"
                size="sm"
                onClick={() => setIsInviteOpen(false)}
                className="bg-[#008792] text-white text-xs h-8 px-4"
              >
                Got It
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
