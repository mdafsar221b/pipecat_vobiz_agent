import React from 'react';
import { ShieldCheck, Radio } from 'lucide-react';
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
    <div className="space-y-6">
      {/* Workspace Header with Status Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200/60">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Live Monitor &amp; Voice AI Console
            </h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#008792]/10 text-[#008792] border border-[#008792]/20">
              <Radio className="w-3 h-3 animate-pulse" />
              Live Audio Stream
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time carrier audio telemetry, bidirectional AI dialog monitoring, and automated outbound campaigns
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-slate-200/90 text-slate-700 shadow-2xs">
            <ShieldCheck className="w-3.5 h-3.5 text-[#008792]" />
            <span>Vobiz SIP Trunk: <strong className="text-slate-900 font-mono">100.1.251.10</strong></span>
          </div>
        </div>
      </div>

      {/* Grid: Live Call Stream on Left, Queue Preview on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <LiveCallHud
            activeCall={activeCall}
            lastCompletedCall={lastCompletedCall}
          />
        </div>
        <div>
          <NextCallCard nextCall={nextCall} />
        </div>
      </div>

      {/* Campaign Controls & Dialer Section */}
      <div>
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
  );
}
