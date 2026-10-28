import React, { useRef, useEffect } from 'react';

// Live call HUD monitor showing real-time dialing and dialog state
export default function LiveCallHud({ activeCall, lastCompletedCall }) {
  const transcriptRef = useRef(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [activeCall?.turns, lastCompletedCall?.turns]);

  if (activeCall) {
    const isDialing = activeCall.status === 'dialing';
    const isInCall = activeCall.status === 'in_call';
    const elapsedSec = activeCall.elapsed_sec || 0;
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const secs = String(elapsedSec % 60).padStart(2, '0');
    const timerStr = `${mins}:${secs}`;

    const containerStyle = isDialing
      ? { borderColor: '#fde68a', backgroundColor: '#fffbeb' }
      : { borderColor: '#86efac', backgroundColor: '#f0fdf4' };

    const dotColor = isDialing ? '#f59e0b' : '#16a34a';
    const phaseText = isDialing ? 'DIALING' : 'ANSWERED / IN CALL';
    const phaseColor = isDialing ? '#b45309' : '#15803d';

    const phoneDisplay = activeCall.customer_name
      ? `${activeCall.customer_name} (${activeCall.phone_number})`
      : activeCall.phone_number;

    return (
      <div className="border rounded-[4px] p-[10px] px-3 mb-3 block" style={containerStyle}>
        <div className="flex justify-between items-center mb-[6px]">
          <span className="text-[0.7rem] font-bold font-mono flex items-center gap-[6px]">
            <span
              className="w-2 h-2 rounded-full inline-block pulse-dot"
              style={{ background: dotColor }}
            />
            <span style={{ color: phaseColor }}>{phaseText}</span>
          </span>
          <span className="font-mono text-[0.8rem] font-semibold" style={{ color: phaseColor }}>
            {timerStr}
          </span>
        </div>

        <div className="font-mono text-[0.95rem] font-bold text-[#0f172a] mb-[2px]">
          {phoneDisplay}
        </div>
        <div className="text-[0.72rem] text-[#475569] mb-2">
          Call UUID: {activeCall.call_uuid ? activeCall.call_uuid.slice(0, 12) : ''}... | Status: {activeCall.status}
        </div>

        <div
          ref={transcriptRef}
          className="max-h-[140px] overflow-y-auto bg-white border border-[#cbd5e1] rounded-[3px] p-2 text-[0.75rem] flex flex-col gap-[6px]"
        >
          {isDialing ? (
            <div className="text-[#b45309] text-[0.72rem] p-1">
              Ringing customer handset... Awaiting pickup
            </div>
          ) : activeCall.turns && activeCall.turns.length > 0 ? (
            activeCall.turns.map((t, idx) => (
              <div
                key={idx}
                className={`p-1 px-2 rounded-[2px] leading-[1.35] ${
                  t.role === 'agent'
                    ? 'bg-[rgba(37,99,235,0.06)] border-l-2 border-[#2563eb]'
                    : 'bg-[rgba(5,150,105,0.06)] border-l-2 border-[#059669]'
                }`}
              >
                <div
                  className={`text-[0.65rem] font-bold uppercase tracking-wider mb-[2px] ${
                    t.role === 'agent' ? 'text-[#1d4ed8]' : 'text-[#047857]'
                  }`}
                >
                  {t.role === 'agent' ? 'Ananya (AI)' : 'Customer'}
                </div>
                <div>{t.text}</div>
              </div>
            ))
          ) : isInCall ? (
            <div className="text-[#15803d] text-[0.72rem] p-1">
              Connected! Establishing audio stream...
            </div>
          ) : (
            <div className="text-[#64748b] text-[0.72rem] p-1">
              Ringing customer handset...
            </div>
          )}
        </div>
      </div>
    );
  }

  if (lastCompletedCall) {
    const lc = lastCompletedCall;
    const disp = lc.disposition || 'completed';
    const diagClass = lc.diagnostic?.classification || '';
    const healthBadge = diagClass ? ` | Health: ${diagClass.toUpperCase()}` : '';

    return (
      <div
        className="border border-[#cbd5e1] bg-[#f8fafc] rounded-[4px] p-[10px] px-3 mb-3 block"
      >
        <div className="flex justify-between items-center mb-[6px]">
          <span className="text-[0.7rem] font-bold font-mono flex items-center gap-[6px]">
            <span className="w-2 h-2 rounded-full inline-block bg-[#64748b]" />
            <span style={{ color: disp === 'interested' ? '#047857' : '#475569' }}>
              COMPLETED: {disp.toUpperCase()}
            </span>
          </span>
          <span className="font-mono text-[0.8rem] font-semibold text-[#64748b]">
            {lc.duration || 0}s
          </span>
        </div>

        <div className="font-mono text-[0.95rem] font-bold text-[#0f172a] mb-[2px]">
          {lc.phone_number ? `Last Call: ${lc.phone_number}` : 'No active call'}
        </div>
        <div className="text-[0.72rem] text-[#475569] mb-2">
          Disposition: {disp} | Duration: {lc.duration || 0}s{healthBadge}
        </div>

        <div
          ref={transcriptRef}
          className="max-h-[140px] overflow-y-auto bg-white border border-[#cbd5e1] rounded-[3px] p-2 text-[0.75rem] flex flex-col gap-[6px]"
        >
          {lc.turns && lc.turns.length > 0 ? (
            lc.turns.map((t, idx) => (
              <div
                key={idx}
                className={`p-1 px-2 rounded-[2px] leading-[1.35] ${
                  t.role === 'agent'
                    ? 'bg-[rgba(37,99,235,0.06)] border-l-2 border-[#2563eb]'
                    : 'bg-[rgba(5,150,105,0.06)] border-l-2 border-[#059669]'
                }`}
              >
                <div
                  className={`text-[0.65rem] font-bold uppercase tracking-wider mb-[2px] ${
                    t.role === 'agent' ? 'text-[#1d4ed8]' : 'text-[#047857]'
                  }`}
                >
                  {t.role === 'agent' ? 'Ananya (AI)' : 'Customer'}
                </div>
                <div>{t.text}</div>
              </div>
            ))
          ) : (
            <div className="text-[#64748b] text-[0.72rem] p-1">
              No dialog recorded for last call.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-[#e2e8f0] bg-[#f8fafc] rounded-[4px] p-[10px] px-3 mb-3 block">
      <div className="flex justify-between items-center mb-[6px]">
        <span className="text-[0.7rem] font-bold font-mono flex items-center gap-[6px]">
          <span className="w-2 h-2 rounded-full inline-block bg-[#94a3b8]" />
          <span className="text-[#64748b]">IDLE</span>
        </span>
        <span className="font-mono text-[0.8rem] font-semibold text-[#64748b]">--:--</span>
      </div>
      <div className="font-mono text-[0.9rem] font-bold text-[#64748b] mb-[2px]">
        No active call in progress
      </div>
      <div className="text-[0.72rem] text-[#475569] mb-2">
        Dialer is idle. Start OBD or trigger a single test dial.
      </div>
      <div className="max-h-[140px] overflow-y-auto bg-white border border-[#cbd5e1] rounded-[3px] p-2 text-[0.75rem] flex flex-col gap-[6px]">
        <div className="text-[#64748b] text-[0.72rem] p-1">
          Awaiting active call session...
        </div>
      </div>
    </div>
  );
}
