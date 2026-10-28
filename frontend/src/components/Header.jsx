import React from 'react';

// Top header with brand and live status pills
export default function Header({ isPaused, isRunning }) {
  let statusText = 'OBD: Idle';
  let statusClass = 'border-slate-300 text-slate-500 bg-slate-100';

  if (isRunning) {
    if (isPaused) {
      statusText = 'OBD: Paused';
      statusClass = 'border-amber-600 text-amber-700 bg-amber-500/10';
    } else {
      statusText = 'OBD: Running';
      statusClass = 'border-emerald-600 text-emerald-700 bg-emerald-500/10';
    }
  }

  return (
    <header className="flex justify-between items-center pb-3 border-b border-[#e2e8f0] mb-4">
      <div>
        <div className="text-[1.15rem] font-bold tracking-tight text-[#0f172a]">
          Swargaseema AI Telephony Console
        </div>
        <div className="text-[0.75rem] text-[#64748b]">
          Automated Outbound Calling &amp; Qualification Engine
        </div>
      </div>
      <div className="flex gap-2 items-center">
        <span className={`text-[0.72rem] font-mono px-2 py-[3px] rounded-[3px] border font-semibold uppercase tracking-wider ${statusClass}`}>
          {statusText}
        </span>
        <span className="text-[0.72rem] font-mono px-2 py-[3px] rounded-[3px] border border-[#e2e8f0] bg-white text-[#64748b]">
          DID: Loading...
        </span>
        <span className="text-[0.72rem] font-mono px-2 py-[3px] rounded-[3px] border border-[#e2e8f0] bg-white text-[#64748b]">
          Channels: 1 Active
        </span>
      </div>
    </header>
  );
}
