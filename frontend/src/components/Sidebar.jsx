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

// Official compact shadcn sidebar implementation
export default function AppSidebar({
  activeNav,
  setActiveNav,
  campaignData,
  crmCount = 0,
  batchesCount = 0,
  completedCount = 0,
  ...props
}) {
  const isRunning = campaignData?.is_running;
  const isPaused = campaignData?.is_paused;
  const activeCall = campaignData?.active_calls?.[0];

  const navItems = [
    {
      id: 'live',
      title: 'Live Monitor & Dialer',
      icon: Activity,
      badge: activeCall ? 'Active' : null,
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
          <SidebarGroupLabel className="text-[10px] uppercase font-bold tracking-wider px-2 h-6 text-muted-foreground/80">
            Platform
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
                      <SidebarMenuBadge className="bg-[#008792] text-white text-[9px] h-3.5 px-1 leading-none font-semibold">
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

      {/* Footer: Compact Trunk Status */}
      <SidebarFooter className="p-1.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="default"
              className="h-9 px-1.5 gap-2 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-6 shrink-0 items-center justify-center rounded bg-sidebar-accent text-sidebar-foreground">
                <Radio className={cn('size-3.5 text-[#008792]', isRunning && 'animate-pulse')} />
              </div>
              <div className="grid flex-1 text-left leading-tight min-w-0">
                <span className="truncate font-mono text-[11px] font-medium text-sidebar-foreground">
                  +918071583794
                </span>
                <span className="truncate text-[9px] text-muted-foreground">
                  {isRunning ? (isPaused ? 'OBD Paused' : 'OBD Streaming') : '1 Active Trunk'}
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
        </SidebarMenu>
      </SidebarFooter>

      {/* Rail */}
      <SidebarRail />
    </Sidebar>
  );
}
