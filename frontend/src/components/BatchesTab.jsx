import React, { useState } from 'react';

// Campaign batches history and per-batch drill-down details
export default function BatchesTab({
  batches = [],
  isLoadingBatches = false,
  onRefreshBatches,
  onRefreshCampaign,
}) {
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [batchDetail, setBatchDetail] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const openBatchDetail = async (batchId) => {
    setActiveBatchId(batchId);
    setIsLoadingDetail(true);
    setBatchDetail(null);

    try {
      const res = await fetch(`/api/campaign/batches/${encodeURIComponent(batchId)}`);
      if (!res.ok) throw new Error('Failed to load batch detail');
      const data = await res.json();
      setBatchDetail(data);
    } catch (err) {
      alert(`Error loading batch: ${err.message}`);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleBackToBatches = () => {
    setActiveBatchId(null);
    setBatchDetail(null);
    onRefreshBatches?.();
  };

  const handleDeleteBatch = async () => {
    if (!activeBatchId) return;
    if (!window.confirm(`Delete batch ${activeBatchId}?`)) return;

    try {
      const res = await fetch(`/api/campaign/batches/${encodeURIComponent(activeBatchId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        handleBackToBatches();
        onRefreshCampaign?.();
      }
    } catch (err) {
      alert(`Failed to delete batch: ${err.message}`);
    }
  };

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

  // View B: Detail View
  if (activeBatchId) {
    const b = batchDetail?.batch || {};
    const calls = batchDetail?.calls || [];
    const m = b.metrics || {};
    const isCompleted = b.status === 'completed';

    return (
      <div>
        <div className="flex justify-between items-center mb-[10px] pb-2 border-b border-[#e2e8f0]">
          <div className="flex gap-2 items-center">
            <button
              onClick={handleBackToBatches}
              className="bg-white border border-[#cbd5e1] text-[#334155] p-[4px_8px] text-[0.72rem] font-semibold rounded-[3px] hover:bg-[#f1f5f9]"
            >
              &larr; Back to Batches
            </button>
            <div className="font-bold text-[0.85rem] text-[#0f172a]">
              {isLoadingDetail ? `Loading ${activeBatchId}...` : b.name || b.batch_id}
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <span
              className={`text-[0.72rem] font-mono px-2 py-[3px] rounded-[3px] border font-semibold uppercase tracking-wider ${
                isCompleted
                  ? 'border-slate-300 text-slate-500 bg-slate-100'
                  : 'border-emerald-600 text-emerald-700 bg-emerald-500/10'
              }`}
            >
              {(b.status || 'ACTIVE').toUpperCase()}
            </span>
            <button
              onClick={handleDeleteBatch}
              className="p-[3px_8px] rounded-[3px] text-[0.7rem] font-semibold transition bg-[#dc2626] hover:bg-[#b91c1c] text-white"
            >
              Delete Batch
            </button>
          </div>
        </div>

        {/* Dynamic batch KPI row */}
        <div className="grid grid-cols-4 gap-[6px] mb-3">
          <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
            <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#0f172a]">
              {b.total_leads || 0}
            </span>
            <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b]">Total</span>
          </div>
          <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
            <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#2563eb]">
              {m.dialed || 0}
            </span>
            <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b]">Dialed</span>
          </div>
          <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
            <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#059669]">
              {m.interested || 0}
            </span>
            <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b]">Interested</span>
          </div>
          <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
            <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#dc2626]">
              {m.not_interested || 0}
            </span>
            <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b]">Declined</span>
          </div>
          <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
            <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#7c3aed]">
              {m.wrong_number || 0}
            </span>
            <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b]">Wrong Num</span>
          </div>
          <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
            <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#ea580c]">
              {m.not_talking || 0}
            </span>
            <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b]">Not Talking</span>
          </div>
          <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
            <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#64748b]">
              {m.no_answer || 0}
            </span>
            <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b]">No Answer</span>
          </div>
          <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
            <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#e11d48]">
              {m.dropped || 0}
            </span>
            <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b]">Dropped</span>
          </div>
          <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
            <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#0f172a]">
              {m.pending || 0}
            </span>
            <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b]">Pending</span>
          </div>
        </div>

        <div className="text-[0.75rem] font-semibold uppercase text-[#64748b] mb-[6px]">
          Calls in this Batch ({calls.length})
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {isLoadingDetail ? (
            <div className="text-center p-6 text-[#64748b]">
              Fetching call records and audio recordings...
            </div>
          ) : calls.length === 0 ? (
            <div className="text-center p-6 text-[#64748b]">
              No calls executed in this batch yet.
            </div>
          ) : (
            calls.map((entry) => {
              const recUrl = entry.recording_url;
              const duration = entry.duration || 0;
              const disp = entry.disposition || 'completed';
              const custName = entry.customer_name || entry.contact_name || '';
              const cbTime = entry.callback_time || '';
              const toNum = entry.phone_number || '';
              const diag = entry.diagnostic || {};
              const am = diag.audio_metrics || entry.audio_metrics || {};
              const ws = diag.websocket || {};
              const hg = diag.hangup || {};
              const formattedTime = entry.created_at
                ? new Date(entry.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
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
                    {entry.reason && <span>Note: {entry.reason}</span>}
                    <span>Time: {formattedTime}</span>
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
                      View Transcript ({(entry.turns || []).length} turns)
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

  // View A: Batches List
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <div>
          <span className="text-[0.82rem] font-bold uppercase text-[#0f172a]">
            Campaign Batches History
          </span>
          <span className="text-[0.72rem] text-[#64748b] ml-2">
            Breakdown of launched batches and performance
          </span>
        </div>
        <button
          onClick={onRefreshBatches}
          disabled={isLoadingBatches}
          className="bg-white border border-[#cbd5e1] text-[#334155] p-[4px_8px] text-[0.72rem] font-semibold rounded-[3px] hover:bg-[#f1f5f9]"
        >
          {isLoadingBatches ? 'Refreshing...' : 'Refresh Batches'}
        </button>
      </div>

      <div className="max-h-[500px] overflow-y-auto">
        {batches.length === 0 ? (
          <div className="text-center p-8 text-[#64748b]">
            No campaign batches recorded yet. Queue contacts from CRM to start your first batch.
          </div>
        ) : (
          batches.map((b) => {
            const m = b.metrics || {};
            const isCompleted = b.status === 'completed';
            const startedTime = b.started_at
              ? new Date(b.started_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '--';
            const startedDate = b.started_at
              ? new Date(b.started_at).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                })
              : '';
            const statusClass = isCompleted
              ? 'border-slate-300 text-slate-500 bg-slate-100'
              : 'border-emerald-600 text-emerald-700 bg-emerald-500/10';

            return (
              <div
                key={b.batch_id}
                onClick={() => openBatchDetail(b.batch_id)}
                className="bg-white border border-[#e2e8f0] rounded-[4px] p-[12px_14px] mb-[10px] cursor-pointer hover:bg-[#f8fafc] hover:border-[#94a3b8] transition"
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-[0.88rem] text-[#0f172a]">
                    {b.name || b.batch_id}
                  </span>
                  <span
                    className={`text-[0.72rem] font-mono px-2 py-[3px] rounded-[3px] border font-semibold uppercase tracking-wider ${statusClass}`}
                  >
                    {(b.status || 'ACTIVE').toUpperCase()}
                  </span>
                </div>
                <div className="text-[0.72rem] text-[#64748b] mb-2">
                  <span>ID: {b.batch_id}</span> &bull;{' '}
                  <span>
                    Launched: {startedDate} {startedTime}
                  </span>{' '}
                  &bull; <span>{b.source_filter || 'CRM Missed Calls'}</span>
                </div>
                <div className="flex flex-wrap gap-[6px] mb-1">
                  <span className="text-[0.7rem] font-mono font-semibold px-[7px] py-[2px] rounded-[3px] bg-[#f1f5f9] text-[#475569] border border-[#e2e8f0]">
                    Total: {b.total_leads || 0}
                  </span>
                  <span className="text-[0.7rem] font-mono font-semibold px-[7px] py-[2px] rounded-[3px] bg-[#f1f5f9] text-[#475569] border border-[#e2e8f0]">
                    Dialed: {m.dialed || 0}
                  </span>
                  <span className="text-[0.7rem] font-mono font-semibold px-[7px] py-[2px] rounded-[3px] bg-[rgba(5,150,105,0.08)] text-[#047857] border border-[rgba(5,150,105,0.2)]">
                    Interested: {m.interested || 0}
                  </span>
                  <span className="text-[0.7rem] font-mono font-semibold px-[7px] py-[2px] rounded-[3px] bg-[rgba(220,38,38,0.08)] text-[#b91c1c] border border-[rgba(220,38,38,0.2)]">
                    Declined: {m.not_interested || 0}
                  </span>
                  <span className="text-[0.7rem] font-mono font-semibold px-[7px] py-[2px] rounded-[3px] bg-[rgba(124,58,237,0.08)] text-[#7c3aed] border border-[rgba(124,58,237,0.2)]">
                    Wrong: {m.wrong_number || 0}
                  </span>
                  <span className="text-[0.7rem] font-mono font-semibold px-[7px] py-[2px] rounded-[3px] bg-[rgba(234,88,12,0.08)] text-[#c2410c] border border-[rgba(234,88,12,0.2)]">
                    Not Talking: {m.not_talking || 0}
                  </span>
                  <span className="text-[0.7rem] font-mono font-semibold px-[7px] py-[2px] rounded-[3px] bg-[#f1f5f9] text-[#64748b] border border-[#cbd5e1]">
                    No Answer: {m.no_answer || 0}
                  </span>
                  <span className="text-[0.7rem] font-mono font-semibold px-[7px] py-[2px] rounded-[3px] bg-[#fff1f2] text-[#b91c1c] border border-[#fca5a5]">
                    Dropped: {m.dropped || 0}
                  </span>
                </div>
                <div className="text-[0.72rem] text-[#2563eb] font-semibold mt-[6px]">
                  View Call Recordings &amp; Transcripts &rarr;
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
