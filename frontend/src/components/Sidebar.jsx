import React from 'react';
import {
  PhoneCall,
  Activity,
  PhoneIncoming,
  Layers,
  History,
  Sparkles,
  Radio,
  ChevronsUpDown,
  Users,
  LogOut,
  Shield,
  User,
} from 'lucide-react';
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarFooter,
  SidebarRail,
} from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Official compact shadcn sidebar implementation with Multi-User & Team Navigation
export default function AppSidebar({
  activeNav,
  setActiveNav,
  campaignData,
  crmCount = 0,
  batchesCount = 0,
  completedCount = 0,
  currentUser = null,
  onLogout,
  ...props
}) {
  const isRunning = campaignData?.is_running;
  const isPaused = campaignData?.is_paused;
  const activeCallsCount = campaignData?.channels_active || campaignData?.active_calls?.length || 0;
  const maxConcurrency = campaignData?.max_concurrency || 20;

  const navItems = [
    {
      id: 'live',
      title: 'Live Monitor & Dialer',
      icon: Activity,
      badge: activeCallsCount > 0 ? `${activeCallsCount} Active` : null,
    },
    {
      id: 'pending',
      title: 'CRM Missed Calls',
      icon: PhoneIncoming,
      count: crmCount,
    },
    {
      id: 'batches',
      title: 'Campaign Batches',
      icon: Layers,
      count: batchesCount,
    },
    {
      id: 'templates',
      title: 'Scripts & Prompts',
      icon: Sparkles,
      badge: 'New',
    },
    {
      id: 'completed',
      title: 'Completed Logs & Audio',
      icon: History,
      count: completedCount,
    },
  ];

  // If Admin, include Team & User Management tab
  if (currentUser?.role === 'admin') {
    navItems.push({
      id: 'users',
      title: 'Team & Employees',
      icon: Users,
      badge: 'Admin',
    });
  }

  return (
    <Sidebar collapsible="icon" className="text-xs" {...props}>
      {/* Header: App Brand switcher in compact size */}
      <SidebarHeader className="p-1.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="default"
              className="h-9 px-1.5 gap-2 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-6 shrink-0 items-center justify-center rounded bg-[#008792] text-sidebar-primary-foreground">
                <PhoneCall className="size-3.5 text-white" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold text-xs text-sidebar-foreground">
                  Swargaseema AI
                </span>
                <span className="truncate text-[10px] text-muted-foreground">Voice AI Platform</span>
              </div>
              <ChevronsUpDown className="ml-auto size-3 text-muted-foreground shrink-0" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Content: Groups & Nav Items with compact typography */}
      <SidebarContent className="px-1">
        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="text-[10px] uppercase font-bold tracking-wider px-2 h-6 text-muted-foreground/80 flex items-center justify-between">
            <span>Platform</span>
            {activeCallsCount > 0 && (
              <span className="text-[9px] text-emerald-500 font-mono font-normal">
                {activeCallsCount}/{maxConcurrency} Parallel
              </span>
            )}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={activeNav === item.id}
                    tooltip={item.title}
                    onClick={() => setActiveNav(item.id)}
                    className="h-7 text-xs px-2 gap-2 font-medium"
                  >
                    <item.icon className="size-3.5 shrink-0" />
                    <span className="text-xs truncate">{item.title}</span>
                    {item.badge && (
                      <SidebarMenuBadge
                        className={cn(
                          'text-[9px] h-3.5 px-1 leading-none font-semibold',
                          item.badge === 'Admin'
                            ? 'bg-purple-600 text-white'
                            : 'bg-[#008792] text-white'
                        )}
                      >
                        {item.badge}
                      </SidebarMenuBadge>
                    )}
                    {item.count !== undefined && !item.badge && (
                      <SidebarMenuBadge className="text-[10px] font-mono h-3.5 px-1 min-w-3.5 text-muted-foreground">
                        {item.count}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer: Multi-Channel Trunk Status and Logged-In User Profile */}
      <SidebarFooter className="p-1.5 space-y-1">
        {/* Trunk Status */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="default"
              className="h-8 px-1.5 gap-2 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-5 shrink-0 items-center justify-center rounded bg-sidebar-accent text-sidebar-foreground">
                <Radio className={cn('size-3 text-[#008792]', isRunning && 'animate-pulse')} />
              </div>
              <div className="grid flex-1 text-left leading-tight min-w-0">
                <span className="truncate font-mono text-[10px] font-medium text-sidebar-foreground">
                  {activeCallsCount > 0
                    ? `${activeCallsCount}/${maxConcurrency} Parallel Live`
                    : '20 Channels Ready'}
                </span>
                <span className="truncate text-[9px] text-muted-foreground">
                  {isRunning ? (isPaused ? 'Dialer Paused' : 'Parallel Calling') : 'Outbound Idle'}
                </span>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  'ml-auto text-[8px] px-1 py-0 h-3.5 border-sidebar-border font-bold uppercase shrink-0',
                  isRunning
                    ? isPaused
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                    : 'text-muted-foreground'
                )}
              >
                {isRunning ? (isPaused ? 'PAUSED' : 'LIVE') : 'IDLE'}
              </Badge>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Current User Card & Logout */}
          {currentUser && (
            <SidebarMenuItem>
              <div className="flex items-center justify-between p-1.5 rounded-lg bg-muted/40 border border-sidebar-border text-sidebar-foreground">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="size-6 rounded-full bg-[#008792]/20 border border-[#008792]/40 text-[#008792] flex items-center justify-center text-[10px] font-bold shrink-0">
                    {currentUser.name ? currentUser.name[0].toUpperCase() : 'U'}
                  </div>
                  <div className="grid flex-1 text-left leading-tight min-w-0">
                    <span className="truncate font-medium text-[11px]">
                      {currentUser.name || currentUser.email}
                    </span>
                    <span className="truncate text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">
                      {currentUser.role}
                    </span>
                  </div>
                </div>

                <button
                  onClick={onLogout}
                  title="Sign Out"
                  className="p-1 rounded text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors shrink-0"
                >
                  <LogOut className="size-3.5" />
                </button>
              </div>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>

      {/* Rail */}
      <SidebarRail />
    </Sidebar>
  );
}
