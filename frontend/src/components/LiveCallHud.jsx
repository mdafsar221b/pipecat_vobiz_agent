import React, { useRef, useEffect } from 'react';
import { Radio, Clock, Bot, User, PhoneCall } from 'lucide-react';
import { getDispositionConfig } from '../utils/formatters';

// Nugget Voice AI Real-Time Telephony & Audio Stream Monitor
export default function LiveCallHud({ activeCall, lastCompletedCall }) {
  const transcriptRef = useRef(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [activeCall?.turns, lastCompletedCall?.turns]);

  // Active call view
  if (activeCall) {
    const isDialing = activeCall.status === 'dialing';
    const elapsedSec = activeCall.elapsed_sec || 0;
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const secs = String(elapsedSec % 60).padStart(2, '0');
    const timerStr = `${mins}:${secs}`;

    return (
      <div className="flex flex-col h-full min-h-0 bg-white">
        {/* Terminal Header */}
        <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between flex-shrink-0 bg-white">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase border ${
              isDialing
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-[#008792]/10 text-[#008792] border-[#008792]/20'
            }`}>
              <span className={`w-1.5 h-1.5 ${isDialing ? 'bg-amber-500 animate-ping' : 'bg-[#008792] animate-pulse'}`} />
              <span>{isDialing ? 'DIALING CARRIER' : 'VOICE STREAM ACTIVE'}</span>
            </span>

            {/* Voice Activity Waves */}
            {!isDialing && (
              <div className="flex items-center gap-1 h-5 px-2 bg-[#008792]/5 border border-[#008792]/20">
                <span className="w-1 bg-[#008792] wave-bar-1" />
                <span className="w-1 bg-[#008792] wave-bar-2" />
                <span className="w-1 bg-[#008792] wave-bar-3" />
                <span className="w-1 bg-[#008792] wave-bar-4" />
                <span className="w-1 bg-[#008792] wave-bar-5" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 font-mono text-xs font-bold px-2 py-0.5 bg-neutral-900 text-white">
            <Clock className="w-3 h-3 text-[#008792]" />
            <span>{timerStr}</span>
          </div>
        </div>

        {/* Recipient Details */}
        <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between flex-shrink-0 bg-slate-50/60">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold font-mono text-slate-900">
                {activeCall.phone_number}
              </span>
              {activeCall.customer_name && (
                <span className="text-xs font-semibold text-[#008792] bg-[#008792]/10 border border-[#008792]/20 px-2 py-0.2">
                  {activeCall.customer_name}
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400 font-mono mt-0.5">
              UUID: {activeCall.call_uuid ? activeCall.call_uuid.slice(0, 18) : ''}...
            </p>
          </div>

          <div className="text-right">
            <span className="text-xs font-semibold text-slate-700 block">Agent: Ananya</span>
            <span className="text-[10px] text-slate-400 block font-mono">16kHz In &bull; 24kHz Out</span>
          </div>
        </div>

        {/* Live Conversation Stream Slate */}
        <div
          ref={transcriptRef}
          className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5 bg-[#fafafa]"
        >
          {isDialing ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-amber-700">
              <Radio className="w-6 h-6 mb-2 text-amber-500 animate-pulse" />
              <span className="font-semibold text-xs">Ringing recipient handset...</span>
              <span className="text-[11px] text-slate-400 mt-0.5">Awaiting carrier answer signal to begin Live session</span>
            </div>
          ) : activeCall.turns && activeCall.turns.length > 0 ? (
            activeCall.turns.map((t, idx) => {
              const isAgent = t.role === 'agent';
              return (
                <div
                  key={idx}
                  className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'}`}
                >
                  <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5 px-0.5 font-semibold uppercase tracking-wider">
                    {isAgent ? (
                      <span className="inline-flex items-center gap-1 text-[#008792]">
                        <Bot className="w-3 h-3" />
                        <span>Ananya (AI)</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-600">
                        <User className="w-3 h-3" />
                        <span>Customer</span>
                      </span>
                    )}
                  </div>
                  <div
                    className={`max-w-[85%] p-2.5 text-xs leading-relaxed border ${
                      isAgent
                        ? 'bg-white text-slate-900 border-slate-200'
                        : 'bg-[#008792]/10 text-teal-950 border-[#008792]/20'
                    }`}
                  >
                    {t.text}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-[#008792]">
              <Radio className="w-6 h-6 mb-2 text-[#008792] animate-pulse" />
              <span className="font-semibold text-xs">Connected! Audio pipeline active</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Last completed call recap view
  if (lastCompletedCall) {
    const lc = lastCompletedCall;
    const dispConf = getDispositionConfig(lc.disposition);
    const diagSummary = lc.diagnostic?.root_cause_summary;

    return (
      <div className="flex flex-col h-full min-h-0 bg-white">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between flex-shrink-0 bg-white">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-slate-400" />
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Last Call Session Recap
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${dispConf.bg} ${dispConf.text} ${dispConf.border}`}>
              <span className={`w-1.5 h-1.5 ${dispConf.dot}`} />
              {dispConf.label}
            </span>

            <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 border border-slate-200">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>{lc.duration || 0}s</span>
            </span>
          </div>
        </div>

        {/* Recipient line */}
        <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between flex-shrink-0 bg-slate-50/60">
          <div className="text-base font-bold font-mono text-slate-900">
            {lc.phone_number || 'Completed Session'}
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            {lc.ended_at ? new Date(lc.ended_at * 1000).toLocaleTimeString() : ''}
          </span>
        </div>

        {diagSummary && (
          <div className="px-4 py-2 border-b border-slate-200 bg-[#008792]/5 text-xs text-slate-800 flex-shrink-0">
            <strong className="text-[#008792] block text-[11px]">Diagnostic Report:</strong>
            <span>{diagSummary}</span>
          </div>
        )}

        {/* Completed Call Turns Box */}
        <div
          ref={transcriptRef}
          className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5 bg-[#fafafa]"
        >
          {lc.turns && lc.turns.length > 0 ? (
            lc.turns.map((t, idx) => {
              const isAgent = t.role === 'agent';
              return (
                <div
                  key={idx}
                  className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'}`}
                >
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide px-0.5 mb-0.5">
                    {isAgent ? 'Ananya (AI)' : 'Customer'}
                  </span>
                  <div
                    className={`max-w-[85%] p-2.5 text-xs leading-relaxed border ${
                      isAgent
                        ? 'bg-white text-slate-900 border-slate-200'
                        : 'bg-[#008792]/10 text-teal-950 border-[#008792]/20'
                    }`}
                  >
                    {t.text}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="h-full flex items-center justify-center text-center text-slate-400 text-xs">
              No dialog turns captured (call rang out or was terminated immediately).
            </div>
          )}
        </div>
      </div>
    );
  }

  // Idle state view
  return (
    <div className="bg-white p-8 text-center h-full min-h-0 flex flex-col items-center justify-center">
      <div className="w-12 h-12 bg-[#008792]/10 border border-[#008792]/20 flex items-center justify-center text-[#008792] mb-3">
        <PhoneCall className="w-6 h-6 animate-pulse" />
      </div>
      <h3 className="text-sm font-bold text-slate-900">Audio Telemetry Standby</h3>
      <p className="text-xs text-slate-500 max-w-xs mt-1">
        Start automated OBD dialing or trigger a test call on the right to monitor live AI voice telemetry.
      </p>
      <div className="mt-4 flex items-center gap-1.5 text-[11px] font-mono text-slate-400 bg-slate-50 border border-slate-200 px-3 py-1">
        <span className="w-1.5 h-1.5 bg-emerald-500" />
        <span>Carrier &bull; SIP Trunk 100.1.251.10 Ready</span>
      </div>
    </div>
  );
}
