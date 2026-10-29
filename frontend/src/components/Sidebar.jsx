import React from 'react';
import {
  PhoneCall,
  Radio,
  Phone,
  Activity,
  PhoneIncoming,
  Layers,
  History,
  User,
  Sparkles,
} from 'lucide-react';

// Modern Obsidian & Nugget-Teal Left Navigation Sidebar
export default function Sidebar({
  activeNav,
  setActiveNav,
  campaignData,
  crmCount = 0,
  batchesCount = 0,
  completedCount = 0,
}) {
  const isRunning = campaignData?.is_running;
  const isPaused = campaignData?.is_paused;
  const activeCall = campaignData?.active_calls?.[0];

  const navItems = [
    {
      id: 'live',
      label: 'Live Monitor & Dialer',
      icon: Activity,
      badge: activeCall ? 'Active' : null,
      badgeColor: activeCall?.status === 'dialing' ? 'bg-amber-500' : 'bg-[#008792]',
    },
    {
      id: 'pending',
      label: 'CRM Missed Calls',
      icon: PhoneIncoming,
      count: crmCount,
    },
    {
      id: 'batches',
      label: 'Campaign Batches',
      icon: Layers,
      count: batchesCount,
    },
    {
      id: 'completed',
      label: 'Completed Logs & Audio',
      icon: History,
      count: completedCount,
    },
  ];

  return (
    <aside className="w-64 h-full bg-[#0a0a0a] text-neutral-300 flex flex-col border-r border-[#222222] flex-shrink-0 select-none">
      {/* Brand Header */}
      <div className="p-5 border-b border-[#1c1c1c]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-[#008792] to-[#005f66] flex items-center justify-center text-white flex-shrink-0">
            <PhoneCall className="w-5 h-5" />
          </div>
          <div className="overflow-hidden">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold text-white tracking-tight truncate">
                Swargaseema AI
              </h1>
              <span className="w-1.5 h-1.5 bg-[#008792]" />
            </div>
            <p className="text-[11px] text-[#008792] font-semibold tracking-wide uppercase truncate">
              Voice AI Platform
            </p>
          </div>
        </div>

        {/* System Telephony Status Widget */}
        <div className="mt-4 pt-3 border-t border-[#1a1a1a] space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-neutral-500 text-[11px]">OBD State:</span>
            {isRunning ? (
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold ${
                isPaused
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'bg-[#008792]/15 text-[#66ccd1] border border-[#008792]/30'
              }`}>
                <span className={`w-1.5 h-1.5 ${isPaused ? 'bg-amber-400 animate-pulse' : 'bg-[#008792] animate-ping'}`} />
                {isPaused ? 'PAUSED' : 'STREAMING'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold bg-neutral-900 text-neutral-400 border border-neutral-800">
                <span className="w-1.5 h-1.5 bg-neutral-600" />
                STANDBY
              </span>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
            <span className="flex items-center gap-1 text-neutral-500">
              <Phone className="w-3 h-3 text-[#008792]" />
              <span>DID:</span>
            </span>
            <span className="text-neutral-200">+918071583794</span>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
            <span className="flex items-center gap-1 text-neutral-500">
              <Radio className="w-3 h-3 text-[#008792] animate-pulse" />
              <span>Carrier:</span>
            </span>
            <span className="text-neutral-200">1 Active Trunk</span>
          </div>
        </div>
      </div>

      {/* Navigation Menu */}
      <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
        <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 px-3 py-1">
          Workspace Navigation
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeNav === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-semibold transition-all ${
                isActive
                  ? 'bg-[#182326] text-white border-l-2 border-[#008792]'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-900/80'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-[#008792]' : 'text-neutral-500'}`} />
                <span className="truncate">{item.label}</span>
              </div>

              {item.badge && (
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 text-white ${item.badgeColor} animate-pulse`}>
                  {item.badge}
                </span>
              )}

              {item.count !== undefined && !item.badge && (
                <span
                  className={`text-[11px] font-mono font-bold px-2 py-0.5 ${
                    isActive
                      ? 'bg-[#008792] text-white'
                      : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Active Call Mini-Dock at bottom with Soundwaves */}
      {activeCall && (
        <div className="p-3 border-t border-[#1c1c1c] bg-[#0c1214]">
          <div className="bg-[#121f22] border border-[#008792]/40 p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-[#008792] font-bold uppercase tracking-wider">
                <span className="w-2 h-2 bg-[#008792] animate-ping" />
                <span>{activeCall.status === 'dialing' ? 'Dialing' : 'Live Call'}</span>
              </span>

              {/* Animated Mini Audio Wave */}
              <div className="flex items-center gap-0.5 h-3">
                <span className="w-0.5 bg-[#008792] wave-bar-1" />
                <span className="w-0.5 bg-[#008792] wave-bar-2" />
                <span className="w-0.5 bg-[#008792] wave-bar-3" />
                <span className="w-0.5 bg-[#008792] wave-bar-4" />
                <span className="w-0.5 bg-[#008792] wave-bar-5" />
              </div>

              <span className="font-mono text-[#66ccd1] font-bold">
                {String(Math.floor((activeCall.elapsed_sec || 0) / 60)).padStart(2, '0')}:
                {String((activeCall.elapsed_sec || 0) % 60).padStart(2, '0')}
              </span>
            </div>

            <div className="font-mono text-xs font-bold text-white truncate">
              {activeCall.phone_number}
            </div>

            {activeCall.customer_name && (
              <div className="text-[11px] text-neutral-400 flex items-center gap-1 truncate">
                <User className="w-3 h-3 text-[#008792]" />
                <span>{activeCall.customer_name}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer System Branding */}
      <div className="p-3 border-t border-[#1a1a1a] text-[10px] text-neutral-500 font-mono text-center flex items-center justify-center gap-1.5">
        <Sparkles className="w-3 h-3 text-[#008792]" />
        <span>Gemini Multimodal Live &bull; Pipecat</span>
      </div>
    </aside>
  );
}
