import React from 'react';
import { Radio, ShieldCheck } from 'lucide-react';
import LiveCallHud from './LiveCallHud';
import NextCallCard from './NextCallCard';
import CampaignController from './CampaignController';

// Dedicated full-width workspace for live call telemetry, audio streaming, and campaign orchestration
export default function LiveConsoleView({
  activeCall,
  lastCompletedCall,
  nextCall,
  stats,
  isRunning,
  isPaused,
  activeCalls,
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
}) {
  return (
    <div className="flex flex-col flex-1 h-full min-h-0 bg-white">
      {/* Workspace Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-2 border-b border-slate-200 flex-shrink-0 bg-white">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-slate-900 tracking-tight">
              Live Monitor &amp; Voice AI Console
            </h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-[#008792]/10 text-[#008792] border border-[#008792]/20">
              <Radio className="w-2.5 h-2.5 animate-pulse" />
              Live Stream
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Real-time carrier audio streaming, bidirectional AI dialog monitoring, and automated outbound campaigns
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-50 border border-slate-200 text-slate-700">
            <ShieldCheck className="w-3.5 h-3.5 text-[#008792]" />
            <span>Vobiz Trunk: <strong className="text-slate-900 font-mono">100.1.251.10</strong></span>
          </div>
        </div>
      </div>

      {/* Viewport-Fitted Dual Column Slate Grid: Zero gaps, clean 1px gray lines */}
      <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 bg-white">
        {/* Left Column: Live Call Stream & Dialog HUD */}
        <div className="lg:col-span-7 flex flex-col h-full min-h-0 bg-white">
          <LiveCallHud
            activeCall={activeCall}
            lastCompletedCall={lastCompletedCall}
          />
        </div>

        {/* Right Column: Queue Pipeline & Dialer Controls */}
        <div className="lg:col-span-5 flex flex-col h-full min-h-0 bg-white divide-y divide-slate-200">
          <div className="flex-shrink-0">
            <NextCallCard nextCall={nextCall} />
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            <CampaignController
              stats={stats}
              isRunning={isRunning}
              isPaused={isPaused}
              activeCalls={activeCalls}
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
        </div>
      </div>
    </div>
  );
}
