import React, { useRef, useEffect } from 'react';
import { Radio, Clock, Bot, User, CheckCircle2 } from 'lucide-react';
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
      <div className="bg-white rounded-2xl border border-[#e5e5e5] p-5 shadow-sm space-y-4">
        {/* Terminal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-100">
          <div className="flex items-center gap-2.5">
            <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold tracking-wide ${
              isDialing
                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : 'bg-[#f4f9f9] text-[#008792] border border-[#c3e1e5]'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isDialing ? 'bg-amber-500 animate-ping' : 'bg-[#008792] animate-pulse'}`} />
              <span>{isDialing ? 'DIALING CARRIER' : 'VOICE STREAM ACTIVE'}</span>
            </span>

            {/* Voice Activity Waves */}
            {!isDialing && (
              <div className="flex items-center gap-1 h-5 px-2 bg-[#f4f9f9] rounded-full border border-[#c3e1e5]">
                <span className="w-1 bg-[#008792] rounded-full wave-bar-1" />
                <span className="w-1 bg-[#008792] rounded-full wave-bar-2" />
                <span className="w-1 bg-[#008792] rounded-full wave-bar-3" />
                <span className="w-1 bg-[#008792] rounded-full wave-bar-4" />
                <span className="w-1 bg-[#008792] rounded-full wave-bar-5" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 font-mono text-xs font-bold px-3 py-1 rounded-lg bg-neutral-900 text-white shadow-xs">
            <Clock className="w-3.5 h-3.5 text-[#008792]" />
            <span>{timerStr}</span>
          </div>
        </div>

        {/* Recipient Details */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-xl font-bold font-mono text-neutral-900 tracking-tight">
                {activeCall.phone_number}
              </span>
              {activeCall.customer_name && (
                <span className="text-xs font-semibold text-[#008792] bg-[#f4f9f9] border border-[#c3e1e5] px-2.5 py-0.5 rounded-full">
                  {activeCall.customer_name}
                </span>
              )}
            </div>
            <p className="text-[11px] text-neutral-400 font-mono mt-0.5">
              Session UUID: {activeCall.call_uuid ? activeCall.call_uuid.slice(0, 16) : ''}...
            </p>
          </div>

          <div className="text-right">
            <span className="text-xs font-semibold text-neutral-500 block">AI Agent: Ananya</span>
            <span className="text-[11px] text-neutral-400 block font-mono">16kHz In / 24kHz Out</span>
          </div>
        </div>

        {/* Live Conversation Stream Box */}
        <div
          ref={transcriptRef}
          className="max-h-[260px] min-h-[160px] overflow-y-auto bg-neutral-50/80 rounded-xl border border-neutral-200/80 p-4 space-y-3 shadow-inner"
        >
          {isDialing ? (
            <div className="h-32 flex flex-col items-center justify-center text-center text-amber-700">
              <Radio className="w-6 h-6 mb-2 text-amber-500 animate-pulse" />
              <span className="font-semibold text-xs">Ringing recipient handset...</span>
              <span className="text-[11px] text-neutral-400 mt-0.5">Awaiting carrier answer signal to begin Live session</span>
            </div>
          ) : activeCall.turns && activeCall.turns.length > 0 ? (
            activeCall.turns.map((t, idx) => {
              const isAgent = t.role === 'agent';
              return (
                <div
                  key={idx}
                  className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'}`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 mb-1 px-1 font-semibold uppercase tracking-wider">
                    {isAgent ? (
                      <span className="inline-flex items-center gap-1 text-[#008792]">
                        <Bot className="w-3 h-3" />
                        <span>Ananya (AI)</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-neutral-600">
                        <User className="w-3 h-3" />
                        <span>Customer</span>
                      </span>
                    )}
                  </div>
                  <div
                    className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed shadow-xs ${
                      isAgent
                        ? 'bg-white text-neutral-900 border border-[#c3e1e5] rounded-tl-sm'
                        : 'bg-[#f4f9f9] text-neutral-900 border border-[#e0efef] rounded-tr-sm'
                    }`}
                  >
                    {t.text}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="h-32 flex flex-col items-center justify-center text-center text-[#008792]">
              <CheckCircle2 className="w-6 h-6 mb-2 text-[#008792] animate-bounce" />
              <span className="font-semibold text-xs">Connected! Establishing bidirectional Gemini Live stream...</span>
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
      <div className="bg-white rounded-2xl border border-[#e5e5e5] p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-neutral-100">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-neutral-400" />
            <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider">
              Last Call Session Recap
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-semibold border ${dispConf.bg} ${dispConf.text} ${dispConf.border}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${dispConf.dot}`} />
              {dispConf.label}
            </span>

            <span className="inline-flex items-center gap-1 font-mono text-xs text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded">
              <Clock className="w-3 h-3 text-neutral-400" />
              <span>{lc.duration || 0}s</span>
            </span>
          </div>
        </div>

        <div className="flex items-baseline justify-between">
          <div className="text-lg font-bold font-mono text-neutral-900">
            {lc.phone_number || 'Completed Session'}
          </div>
          <span className="text-xs text-neutral-400 font-mono">
            {lc.ended_at ? new Date(lc.ended_at * 1000).toLocaleTimeString() : ''}
          </span>
        </div>

        {diagSummary && (
          <div className="text-xs bg-[#f4f9f9] border border-[#c3e1e5] rounded-xl p-3 text-neutral-800">
            <strong className="text-[#008792] block mb-0.5">Diagnostic Report:</strong>
            <span>{diagSummary}</span>
          </div>
        )}

        {/* Completed Call Turns Box */}
        <div
          ref={transcriptRef}
          className="max-h-[200px] overflow-y-auto bg-neutral-50/80 rounded-xl border border-neutral-200/80 p-3 space-y-2 text-xs"
        >
          {lc.turns && lc.turns.length > 0 ? (
            lc.turns.map((t, idx) => {
              const isAgent = t.role === 'agent';
              return (
                <div
                  key={idx}
                  className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'}`}
                >
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide px-1 mb-0.5">
                    {isAgent ? 'Ananya (AI)' : 'Customer'}
                  </span>
                  <div
                    className={`max-w-[85%] rounded-xl p-2.5 text-xs leading-relaxed ${
                      isAgent
                        ? 'bg-white text-neutral-900 border border-neutral-200 shadow-2xs'
                        : 'bg-[#f4f9f9] text-neutral-900 border border-[#c3e1e5]'
                    }`}
                  >
                    {t.text}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-4 text-neutral-400 text-xs">
              No dialog turns captured (call rang out or was terminated immediately).
            </div>
          )}
        </div>
      </div>
    );
  }

  // Idle state view
  return (
    <div className="bg-white rounded-2xl border border-[#e5e5e5] p-6 shadow-sm text-center">
      <div className="w-12 h-12 rounded-2xl bg-[#f4f9f9] border border-[#c3e1e5] flex items-center justify-center text-[#008792] mx-auto mb-3 shadow-xs">
        <Radio className="w-6 h-6 animate-pulse" />
      </div>
      <h3 className="text-sm font-bold text-neutral-900">Audio Terminal Ready</h3>
      <p className="text-xs text-neutral-500 max-w-sm mx-auto mt-1">
        Start the automated campaign dialer or place a test call on the right to stream real-time bidirectional audio.
      </p>
    </div>
  );
}
