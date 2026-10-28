import React from 'react';

// Turn-by-turn conversations, audio recordings, and outcome logs from Ananya
export default function CompletedLogsTab({
  completedCalls = [],
  isLoadingLogs = false,
  onRefreshLogs,
}) {
  const getDiagBadge = (diagType) => {
    if (diagType === 'success') {
      return (
        <span className="text-[0.68rem] px-[6px] py-[2px] rounded-[2px] font-mono font-medium bg-[rgba(5,150,105,0.08)] border border-[#059669] text-[#047857]">
          OK: BIDIRECTIONAL
        </span>
      );
    }
    if (diagType === 'no_incoming_audio') {
      return (
        <span className="text-[0.68rem] px-[6px] py-[2px] rounded-[2px] font-mono font-medium bg-[rgba(220,38,38,0.08)] border border-[#dc2626] text-[#b91c1c]">
          NO INCOMING AUDIO
        </span>
      );
    }
    if (diagType === 'incoming_audio_exists_gemini_missing') {
      return (
        <span className="text-[0.68rem] px-[6px] py-[2px] rounded-[2px] font-mono font-medium bg-[rgba(217,119,6,0.08)] border border-[#d97706] text-[#b45309]">
          GEMINI OUTPUT MISSING
        </span>
      );
    }
    if (diagType === 'gemini_audio_produced_caller_silence') {
      return (
        <span className="text-[0.68rem] px-[6px] py-[2px] rounded-[2px] font-mono font-medium bg-[rgba(37,99,235,0.08)] border border-[#3b82f6] text-[#1d4ed8]">
          CALLER SILENCE
        </span>
      );
    }
    if (diagType === 'everything_stopped_together') {
      return (
        <span className="text-[0.68rem] px-[6px] py-[2px] rounded-[2px] font-mono font-medium bg-[#f1f5f9] border border-[#cbd5e1] text-[#475569]">
          DISCONNECTED EARLY
        </span>
      );
    }
    return null;
  };

  const getDispTag = (disp) => {
    let classes = 'bg-[#f1f5f9] border border-[#cbd5e1] text-[#475569]';
    if (disp === 'interested') {
      classes = 'bg-[rgba(5,150,105,0.08)] border border-[#059669] text-[#047857]';
    } else if (disp === 'not_interested' || disp === 'wrong_number' || disp === 'dropped') {
      classes = 'bg-[rgba(220,38,38,0.08)] border border-[#dc2626] text-[#b91c1c]';
    } else if (disp === 'no_answer' || disp === 'not_talking' || disp === 'busy') {
      classes = 'bg-[rgba(217,119,6,0.08)] border border-[#d97706] text-[#b45309]';
    }
    return (
      <span className={`text-[0.68rem] px-[6px] py-[2px] rounded-[2px] font-mono font-medium ${classes}`}>
        {disp.toUpperCase()}
      </span>
    );
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-[10px]">
        <span className="text-[0.75rem] text-[#64748b]">
          Turn-by-turn conversations and outcomes from Ananya
        </span>
        <button
          onClick={onRefreshLogs}
          disabled={isLoadingLogs}
          className="bg-white border border-[#cbd5e1] text-[#334155] p-[4px_10px] text-[0.72rem] font-semibold rounded-[3px] hover:bg-[#f1f5f9]"
        >
          {isLoadingLogs ? 'Refreshing...' : 'Refresh History'}
        </button>
      </div>

      <div className="max-h-[480px] overflow-y-auto">
        {completedCalls.length === 0 ? (
          <div className="text-center p-8 text-[#64748b]">
            No completed calls yet.
          </div>
        ) : (
          completedCalls.map((entry) => {
            const recEvent = (entry.events || []).find((e) => e.kind === 'recording');
            const recUrl =
              entry.recording_url ||
              (recEvent ? recEvent.recording_url || recEvent.params?.RecordUrl : '');
            const hangupEvent = (entry.events || []).find((e) => e.kind === 'hangup');
            const duration =
              entry.duration !== undefined && entry.duration !== null && entry.duration > 0
                ? entry.duration
                : hangupEvent
                ? hangupEvent.params?.Duration || 0
                : 0;
            const disp = entry.disposition || 'completed';
            const custName = entry.customer_name || entry.contact_name || '';
            const cbTime = entry.callback_time || '';

            const toNum =
              entry.phone_number ||
              (entry.events || []).find((e) => e.to || e.params?.To)?.to ||
              (entry.events || []).find((e) => e.params?.To)?.params?.To ||
              (entry.events || []).find((e) => e.params?.From)?.params?.From ||
              '';

            const diag = entry.diagnostic || {};
            const am = diag.audio_metrics || entry.audio_metrics || {};
            const ws = diag.websocket || {};
            const hg = diag.hangup || {};

            const formattedTime = entry.started
              ? new Date(entry.started).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : '--';

            return (
              <div
                key={entry.call_uuid}
                className="bg-white border border-[#e2e8f0] rounded-[3px] p-[10px_12px] mb-2"
              >
                <div className="flex justify-between items-center mb-[6px]">
                  <div>
                    <span className="font-mono font-semibold text-[0.85rem] text-[#0f172a]">
                      {toNum || entry.call_uuid.slice(0, 12)}
                    </span>
                    {custName && (
                      <span className="font-semibold ml-[6px] text-[#1e40af]">{custName}</span>
                    )}
                    <span className="text-[0.68rem] text-[#64748b] font-mono ml-[6px]">
                      ({entry.call_uuid.slice(0, 8)})
                    </span>
                  </div>
                  <div className="flex gap-[6px] items-center">
                    {getDiagBadge(diag.classification)}
                    {getDispTag(disp)}
                    <span className="font-mono text-[#64748b] text-[0.75rem]">{duration}s</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 text-[0.72rem] text-[#64748b] mb-[6px]">
                  {cbTime && (
                    <span className="text-[#047857] font-semibold">Callback: {cbTime}</span>
                  )}
                  <span>Started: {formattedTime}</span>
                  <span>
                    In: {am.inbound_bytes || 0}B ({am.inbound_chunks || 0})
                  </span>
                  <span>Out: {am.outbound_bytes || 0}B</span>
                  {ws.close_code && <span>WS: {ws.close_code}</span>}
                  {hg.cause && <span>Hangup: {hg.cause}</span>}
                </div>

                {diag.root_cause_summary && (
                  <div className="text-[0.71rem] text-[#334155] mb-1 p-[2px_4px] bg-[#f1f5f9] rounded-[2px]">
                    <strong>Diagnostic:</strong> {diag.root_cause_summary}
                  </div>
                )}

                {(recUrl || (duration > 5 && (am.inbound_bytes > 0 || am.outbound_bytes > 0))) && (
                  <div className="my-[6px]">
                    <div className="text-[0.68rem] text-[#475569] font-semibold mb-[2px]">
                      Call Recording:
                    </div>
                    <audio
                      controls
                      preload="none"
                      className="w-full h-8"
                      src={`/api/recording/${encodeURIComponent(entry.call_uuid)}`}
                    />
                  </div>
                )}

                <details className="mt-[6px]">
                  <summary className="cursor-pointer text-[0.72rem] text-[#64748b]">
                    View Transcript Conversation ({(entry.turns || []).length} turns)
                  </summary>
                  <div className="mt-1">
                    {entry.turns && entry.turns.length > 0 ? (
                      entry.turns.map((t, idx) => (
                        <div
                          key={idx}
                          className="mt-1 p-1 px-[6px] bg-[#f8fafc] border border-[#f1f5f9] rounded-[2px]"
                        >
                          <span
                            className={`font-semibold text-[0.68rem] uppercase mr-1 ${
                              t.role === 'agent' ? 'text-[#1d4ed8]' : 'text-[#047857]'
                            }`}
                          >
                            {t.role === 'agent' ? 'Ananya:' : 'Customer:'}
                          </span>
                          <span>{t.text}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-[#64748b] text-[0.7rem] mt-1">
                        No dialog recorded (unanswered or dropped).
                      </div>
                    )}
                  </div>
                </details>

                <details className="mt-1">
                  <summary className="cursor-pointer text-[0.7rem] text-[#2563eb]">
                    View Lifecycle Timeline ({(entry.events || []).length} events)
                  </summary>
                  <div className="mt-1 p-[6px] bg-[#f8fafc] border border-[#e2e8f0] rounded-[3px]">
                    {entry.events && entry.events.length > 0 ? (
                      entry.events.map((ev, idx) => {
                        const note =
                          ev.details?.telephony_status ||
                          ev.details?.cause ||
                          ev.details?.error ||
                          '';
                        return (
                          <div
                            key={idx}
                            className="text-[0.68rem] py-[2px] border-b border-dotted border-[#e2e8f0] font-mono flex justify-between items-baseline"
                          >
                            <div>
                              <span className="font-semibold text-[#1e40af]">{ev.event}</span>
                              {note && (
                                <span className="text-[#64748b] text-[0.62rem] ml-[6px]">
                                  ({note})
                                </span>
                              )}
                            </div>
                            <span className="text-[#64748b]">
                              {ev.timestamp ? ev.timestamp.slice(11, 23) : '--'}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-[0.68rem] text-[#64748b]">
                        No milestone events recorded.
                      </div>
                    )}
                  </div>
                </details>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
