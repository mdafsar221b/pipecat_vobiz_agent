import React, { useState } from 'react';
import {
  Radio,
  ShieldCheck,
  Play,
  Pause,
  Square,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import LiveCallHud from './LiveCallHud';
import NextCallCard from './NextCallCard';
import CampaignController from './CampaignController';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from './ui/drawer';
import { cn } from '@/lib/utils';

// Full-width Live Call Workspace with slide-out shadcn Drawer for the Dialer Command Desk
export default function LiveConsoleView({
  activeCall,
  lastCompletedCall,
  nextCall,
  stats = {},
  isRunning = false,
  isPaused = false,
  activeCalls = [],
  templates = [],
  selectedTemplateId = 'production_callback_conversion',
  onSelectTemplate,
  onNavigateToTemplates,
  onStartCampaign,
  onPauseCampaign,
  onResumeCampaign,
  onStopCampaign,
  onResetQueue,
  onRetryFailed,
  onTriggerManualDial,
  manualDialStatus,
  manualDialFeedback,
  manualPhone,
  setManualPhone,
  isDialingManual,
  onRefreshCampaign,
  onRefreshBatches,
  completedCalls = [],
  onRefreshLogs,
  transcriptEnabled = false,
}) {
  const [isDeskOpen, setIsDeskOpen] = useState(false);

  const total = stats.total || 0;
  const pending = stats.pending || 0;
  const activeCount = (stats.dialing || 0) + (stats.in_call || 0);
  const completed = Math.max(0, total - pending - activeCount);
  const progressPercent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 bg-background">
      {/* Top Workspace Header Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0 bg-card">
        {/* Left: Branding, Dialer Status, and Trunk */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'w-2 h-2 rounded-full inline-block',
                isRunning && !isPaused
                  ? 'bg-emerald-500 animate-pulse'
                  : isPaused
                  ? 'bg-amber-500'
                  : 'bg-muted-foreground'
              )}
            />
            <h1 className="text-sm font-bold text-foreground tracking-tight">
              Live Call Workspace
            </h1>
          </div>

          <Badge
            variant="outline"
            className={cn(
              'text-[10px] font-bold tracking-wider uppercase h-5 px-2 gap-1',
              isRunning && !isPaused
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
                : isPaused
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-700'
                : 'border-border bg-muted/40 text-muted-foreground'
            )}
          >
            <Radio className="w-2.5 h-2.5 animate-pulse" />
            <span>{isRunning ? (isPaused ? 'DIALER PAUSED' : 'DIALER ACTIVE') : 'DIALER IDLE'}</span>
          </Badge>

          <div className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono text-muted-foreground bg-muted/30 border border-border rounded">
            <ShieldCheck className="w-3.5 h-3.5 text-[#008792]" />
            <span>
              Trunk: <strong className="text-foreground font-mono">100.1.251.10</strong>
            </span>
          </div>
        </div>

        {/* Right: Quick Controls, Progress & Command Desk Drawer Trigger */}
        <div className="flex items-center gap-3">
          {/* Quick OBD Action Buttons */}
          <div className="flex items-center gap-1">
            {!isRunning ? (
              <Button
                size="xs"
                onClick={onStartCampaign}
                className="h-7 bg-[#008792] hover:bg-[#007680] text-white gap-1 text-xs font-semibold px-2.5 cursor-pointer shadow-xs"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Start</span>
              </Button>
            ) : isPaused ? (
              <Button
                size="xs"
                variant="outline"
                onClick={onResumeCampaign}
                className="h-7 border-emerald-500/40 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 gap-1 text-xs font-semibold px-2.5 cursor-pointer"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Resume</span>
              </Button>
            ) : (
              <Button
                size="xs"
                variant="outline"
                onClick={onPauseCampaign}
                className="h-7 border-amber-500/40 bg-amber-50 text-amber-700 hover:bg-amber-100 gap-1 text-xs font-semibold px-2 cursor-pointer"
              >
                <Pause className="w-3 h-3 fill-current" />
                <span>Pause</span>
              </Button>
            )}
            {isRunning && (
              <Button
                size="xs"
                variant="destructive"
                onClick={onStopCampaign}
                className="h-7 gap-1 text-xs font-semibold px-2 cursor-pointer shadow-xs"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </Button>
            )}
          </div>

          {/* Progress Indicator */}
          <div className="hidden md:flex items-center gap-2 font-mono text-xs border-l border-border pl-3">
            <span className="font-bold text-foreground">
              {completed}/{total} Leads
            </span>
            <span className="text-[11px] text-muted-foreground">({progressPercent}%)</span>
          </div>

          {/* Slide-out Drawer Trigger for Dialer Command Desk */}
          <Button
            size="xs"
            variant="outline"
            onClick={() => setIsDeskOpen(true)}
            className="h-7 gap-1.5 px-2.5 text-xs font-semibold text-foreground border-border hover:border-[#008792] hover:text-[#008792] cursor-pointer"
          >
            <SlidersHorizontal className="w-3 h-3 text-[#008792]" />
            <span>Dialer Desk</span>
          </Button>
        </div>
      </div>

      {/* Main Full-Width Live Stream & Telephony Activity View */}
      <div className="flex-1 min-h-0 flex flex-col bg-card overflow-hidden">
        <LiveCallHud
          activeCall={activeCall}
          lastCompletedCall={lastCompletedCall}
          completedCalls={completedCalls}
          onRefreshLogs={onRefreshLogs}
          transcriptEnabled={transcriptEnabled}
        />
      </div>

      {/* Slide-out shadcn Drawer for Dialer Command Desk */}
      <Drawer
        open={isDeskOpen}
        onOpenChange={setIsDeskOpen}
        swipeDirection="right"
      >
        <DrawerContent className="p-0 border-l border-border bg-background flex flex-col h-full max-h-screen sm:max-w-md w-full">
          <DrawerHeader className="p-3 border-b border-border flex items-center justify-between shrink-0 bg-muted/20">
            <div className="flex items-center gap-2">
              <DrawerTitle className="text-sm font-bold text-foreground">
                Dialer Command Desk
              </DrawerTitle>
              <Badge
                variant="outline"
                className={cn(
                  'text-[9px] font-bold uppercase',
                  isRunning && !isPaused
                    ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700'
                    : isPaused
                    ? 'border-amber-500/40 bg-amber-50 text-amber-700'
                    : 'border-border text-muted-foreground'
                )}
              >
                {isRunning ? (isPaused ? 'PAUSED' : 'ACTIVE') : 'IDLE'}
              </Badge>
            </div>
            <DrawerClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </Button>
            </DrawerClose>
          </DrawerHeader>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border">
            <NextCallCard nextCall={nextCall} />
            <CampaignController
              stats={stats}
              isRunning={isRunning}
              isPaused={isPaused}
              activeCalls={activeCalls}
              templates={templates}
              selectedTemplateId={selectedTemplateId}
              onSelectTemplate={onSelectTemplate}
              onNavigateToTemplates={onNavigateToTemplates}
              onStartCampaign={onStartCampaign}
              onPauseCampaign={onPauseCampaign}
              onResumeCampaign={onResumeCampaign}
              onStopCampaign={onStopCampaign}
              onResetQueue={onResetQueue}
              onRetryFailed={onRetryFailed}
              onTriggerManualDial={onTriggerManualDial}
              manualDialStatus={manualDialStatus}
              manualDialFeedback={manualDialFeedback}
              manualPhone={manualPhone}
              setManualPhone={setManualPhone}
              isDialingManual={isDialingManual}
              onRefreshCampaign={onRefreshCampaign}
              onRefreshBatches={onRefreshBatches}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
