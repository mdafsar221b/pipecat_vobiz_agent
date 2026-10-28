import React, { useState, useMemo } from 'react';
import {
  ArrowLeft,
  Trash2,
  RefreshCw,
  Layers,
  Clock,
  Volume2,
  ChevronDown,
  ChevronUp,
  Activity,
  Bot,
  User,
  Info,
  Search,
  X,
  RotateCcw,
  ArrowRight,
} from 'lucide-react';
import {
  formatBytes,
  formatDuration,
  formatTime,
  getDispositionConfig,
  getDiagnosticConfig,
} from '../utils/formatters';

// Campaign batches history and per-batch drilldown view with interactive KPI card filters
export default function BatchesTab({
  batches = [],
  isLoadingBatches = false,
  onRefreshBatches,
  onRefreshCampaign,
}) {
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [batchDetail, setBatchDetail] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [openTranscriptId, setOpenTranscriptId] = useState(null);
  const [openTimelineId, setOpenTimelineId] = useState(null);

  // Batch Detail Filters
  const [batchKpiFilter, setBatchKpiFilter] = useState('all');
  const [batchSearchQuery, setBatchSearchQuery] = useState('');

  const toggleTranscript = (callUuid) => {
    setOpenTranscriptId((prev) => (prev === callUuid ? null : callUuid));
  };

  const toggleTimeline = (callUuid) => {
    setOpenTimelineId((prev) => (prev === callUuid ? null : callUuid));
  };

  const openBatchDetail = async (batchId) => {
    setActiveBatchId(batchId);
    setIsLoadingDetail(true);
    setBatchDetail(null);
    setBatchKpiFilter('all');
    setBatchSearchQuery('');

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
    setBatchKpiFilter('all');
    setBatchSearchQuery('');
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

  const handleKpiCardClick = (filterKey) => {
    setBatchKpiFilter((prev) => (prev === filterKey ? 'all' : filterKey));
  };

  // Filter calls inside the open batch detail
  const filteredBatchCalls = useMemo(() => {
    if (!batchDetail?.calls) return [];
    let list = [...batchDetail.calls];

    // Filter by KPI Card Selection
    if (batchKpiFilter !== 'all') {
      list = list.filter((c) => {
        const disp = (c.disposition || 'completed').toLowerCase();
        if (batchKpiFilter === 'dialed') {
          return (
            c.status === 'in_call' ||
            c.status === 'hung_up' ||
            (c.duration || 0) > 0 ||
            (c.events && c.events.length > 0)
          );
        }
        if (batchKpiFilter === 'interested') return disp === 'interested';
        if (batchKpiFilter === 'declined') return disp === 'not_interested' || disp === 'declined';
        if (batchKpiFilter === 'wrong') return disp === 'wrong_number';
        if (batchKpiFilter === 'silent') return disp === 'not_talking';
        if (batchKpiFilter === 'no_answer') return disp === 'no_answer' || disp === 'busy';
        if (batchKpiFilter === 'dropped') return disp === 'dropped';
        return true;
      });
    }

    // Filter by text search query in batch
    if (batchSearchQuery.trim()) {
      const q = batchSearchQuery.trim().toLowerCase();
      list = list.filter((c) => {
        const phone = (c.phone_number || '').toLowerCase();
        const name = (c.customer_name || c.contact_name || '').toLowerCase();
        const uuid = (c.call_uuid || '').toLowerCase();
        const reason = (c.reason || '').toLowerCase();
        const diag = (c.diagnostic?.root_cause_summary || '').toLowerCase();
        const inTurns = (c.turns || []).some((t) => (t.text || '').toLowerCase().includes(q));
        return (
          phone.includes(q) ||
          name.includes(q) ||
          uuid.includes(q) ||
          reason.includes(q) ||
          diag.includes(q) ||
          inTurns
        );
      });
    }

    return list;
  }, [batchDetail, batchKpiFilter, batchSearchQuery]);

  // View B: Detail View
  if (activeBatchId) {
    const b = batchDetail?.batch || {};
    const calls = batchDetail?.calls || [];
    const m = b.metrics || {};
    const isCompleted = b.status === 'completed';

    const getFilterLabel = (key) => {
      switch (key) {
        case 'dialed':
          return 'Dialed';
        case 'interested':
          return 'Interested';
        case 'declined':
          return 'Declined';
        case 'wrong':
          return 'Wrong Number';
        case 'silent':
          return 'Silent';
        case 'no_answer':
          return 'No Answer';
        case 'dropped':
          return 'Dropped';
        default:
          return 'All Calls';
      }
    };

    return (
      <div className="space-y-5">
        {/* Detail Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/70">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToBatches}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Batches</span>
            </button>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {isLoadingDetail ? `Loading ${activeBatchId}...` : b.name || b.batch_id}
              </h3>
              <p className="text-xs text-slate-400">
                Batch ID: <span className="font-mono text-slate-600">{b.batch_id}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border ${
                isCompleted
                  ? 'bg-slate-100 text-slate-600 border-slate-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isCompleted ? 'bg-slate-400' : 'bg-emerald-500 animate-pulse'}`} />
              {(b.status || 'ACTIVE').toUpperCase()}
            </span>
            <button
              onClick={handleDeleteBatch}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 shadow-2xs transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Batch</span>
            </button>
          </div>
        </div>

        {/* Clickable KPI Filter Cards Row */}
        <div>
          <div className="flex items-center justify-between mb-2 px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Interactive KPI Breakdown (Click Card to Filter)
            </span>
            {batchKpiFilter !== 'all' && (
              <button
                onClick={() => setBatchKpiFilter('all')}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#008792] hover:underline"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Show All ({calls.length})</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {/* Total Card */}
            <div
              onClick={() => handleKpiCardClick('all')}
              role="button"
              tabIndex={0}
              title="Click to view all leads in batch"
              className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'all'
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm scale-[1.02]'
                  : 'bg-white border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className={`block text-base font-bold font-mono leading-tight ${
                batchKpiFilter === 'all' ? 'text-white' : 'text-slate-900'
              }`}>
                {b.total_leads || 0}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                batchKpiFilter === 'all' ? 'text-slate-300' : 'text-slate-400'
              }`}>Total</span>
            </div>

            {/* Dialed Card */}
            <div
              onClick={() => handleKpiCardClick('dialed')}
              role="button"
              tabIndex={0}
              title="Click to filter dialed calls"
              className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'dialed'
                  ? 'bg-[#008792] text-white border-[#008792] shadow-sm scale-[1.02]'
                  : 'bg-white border-slate-200 hover:bg-[#008792]/5'
              }`}
            >
              <span className={`block text-base font-bold font-mono leading-tight ${
                batchKpiFilter === 'dialed' ? 'text-white' : 'text-[#008792]'
              }`}>
                {m.dialed || 0}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                batchKpiFilter === 'dialed' ? 'text-teal-100' : 'text-slate-400'
              }`}>Dialed</span>
            </div>

            {/* Interested Card */}
            <div
              onClick={() => handleKpiCardClick('interested')}
              role="button"
              tabIndex={0}
              title="Click to filter interested calls"
              className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'interested'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm scale-[1.02]'
                  : 'bg-white border-slate-200 hover:bg-emerald-50'
              }`}
            >
              <span className={`block text-base font-bold font-mono leading-tight ${
                batchKpiFilter === 'interested' ? 'text-white' : 'text-emerald-700'
              }`}>
                {m.interested || 0}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                batchKpiFilter === 'interested' ? 'text-emerald-100' : 'text-slate-400'
              }`}>Interested</span>
            </div>

            {/* Declined Card */}
            <div
              onClick={() => handleKpiCardClick('declined')}
              role="button"
              tabIndex={0}
              title="Click to filter declined calls"
              className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'declined'
                  ? 'bg-rose-600 text-white border-rose-600 shadow-sm scale-[1.02]'
                  : 'bg-white border-slate-200 hover:bg-rose-50'
              }`}
            >
              <span className={`block text-base font-bold font-mono leading-tight ${
                batchKpiFilter === 'declined' ? 'text-white' : 'text-rose-700'
              }`}>
                {m.not_interested || 0}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                batchKpiFilter === 'declined' ? 'text-rose-100' : 'text-slate-400'
              }`}>Declined</span>
            </div>

            {/* Wrong Card */}
            <div
              onClick={() => handleKpiCardClick('wrong')}
              role="button"
              tabIndex={0}
              title="Click to filter wrong number calls"
              className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'wrong'
                  ? 'bg-purple-600 text-white border-purple-600 shadow-sm scale-[1.02]'
                  : 'bg-white border-slate-200 hover:bg-purple-50'
              }`}
            >
              <span className={`block text-base font-bold font-mono leading-tight ${
                batchKpiFilter === 'wrong' ? 'text-white' : 'text-purple-700'
              }`}>
                {m.wrong_number || 0}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                batchKpiFilter === 'wrong' ? 'text-purple-100' : 'text-slate-400'
              }`}>Wrong</span>
            </div>

            {/* Silent Card */}
            <div
              onClick={() => handleKpiCardClick('silent')}
              role="button"
              tabIndex={0}
              title="Click to filter silent / not talking calls"
              className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'silent'
                  ? 'bg-amber-600 text-white border-amber-600 shadow-sm scale-[1.02]'
                  : 'bg-white border-slate-200 hover:bg-amber-50'
              }`}
            >
              <span className={`block text-base font-bold font-mono leading-tight ${
                batchKpiFilter === 'silent' ? 'text-white' : 'text-amber-700'
              }`}>
                {m.not_talking || 0}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                batchKpiFilter === 'silent' ? 'text-amber-100' : 'text-slate-400'
              }`}>Silent</span>
            </div>

            {/* No Answer Card */}
            <div
              onClick={() => handleKpiCardClick('no_answer')}
              role="button"
              tabIndex={0}
              title="Click to filter unanswered calls"
              className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'no_answer'
                  ? 'bg-slate-700 text-white border-slate-700 shadow-sm scale-[1.02]'
                  : 'bg-white border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className={`block text-base font-bold font-mono leading-tight ${
                batchKpiFilter === 'no_answer' ? 'text-white' : 'text-slate-700'
              }`}>
                {m.no_answer || 0}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                batchKpiFilter === 'no_answer' ? 'text-slate-200' : 'text-slate-400'
              }`}>No Answer</span>
            </div>

            {/* Dropped Card */}
            <div
              onClick={() => handleKpiCardClick('dropped')}
              role="button"
              tabIndex={0}
              title="Click to filter dropped calls"
              className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'dropped'
                  ? 'bg-red-700 text-white border-red-700 shadow-sm scale-[1.02]'
                  : 'bg-white border-slate-200 hover:bg-red-50'
              }`}
            >
              <span className={`block text-base font-bold font-mono leading-tight ${
                batchKpiFilter === 'dropped' ? 'text-white' : 'text-red-700'
              }`}>
                {m.dropped || 0}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                batchKpiFilter === 'dropped' ? 'text-red-100' : 'text-slate-400'
              }`}>Dropped</span>
            </div>
          </div>
        </div>

        {/* Search & Active Filter Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 bg-slate-50/70 rounded-xl border border-slate-200/80">
          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={batchSearchQuery}
                onChange={(e) => setBatchSearchQuery(e.target.value)}
                placeholder="Search calls in this batch by phone, customer name, diagnostic root cause..."
                className="w-full bg-white border border-slate-200 text-slate-800 text-xs pl-8 pr-8 py-1.5 rounded-lg outline-none focus:ring-1 focus:ring-[#008792] focus:border-[#008792] shadow-2xs"
              />
              {batchSearchQuery && (
                <button
                  onClick={() => setBatchSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {batchKpiFilter !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#008792]/10 text-[#008792] font-semibold border border-[#008792]/20">
                <span>Filter: {getFilterLabel(batchKpiFilter)}</span>
                <button
                  onClick={() => setBatchKpiFilter('all')}
                  className="hover:text-[#007680]"
                >
                  <X className="w-3 h-3 ml-0.5" />
                </button>
              </span>
            )}

            <span className="font-mono text-xs font-semibold text-slate-600">
              Showing {filteredBatchCalls.length} of {calls.length} calls
            </span>
          </div>
        </div>

        {/* Calls in this batch */}
        <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
          {isLoadingDetail ? (
            <div className="text-center py-12 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin text-[#008792] mx-auto mb-2" />
              <span className="text-xs font-medium">Fetching call audio telemetry and transcripts...</span>
            </div>
          ) : filteredBatchCalls.length === 0 ? (
            <div className="text-center py-12 bg-slate-50/70 rounded-xl border border-dashed border-slate-200 text-slate-500 text-xs">
              <p className="font-semibold text-slate-700">No calls match the selected KPI filter</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Click 'Show All' above or click the Total card to view all {calls.length} calls in this batch.
              </p>
              {(batchKpiFilter !== 'all' || batchSearchQuery) && (
                <button
                  onClick={() => {
                    setBatchKpiFilter('all');
                    setBatchSearchQuery('');
                  }}
                  className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-[#008792] hover:bg-slate-50 shadow-2xs"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Batch Filters</span>
                </button>
              )}
            </div>
          ) : (
            filteredBatchCalls.map((entry) => {
              const recUrl = entry.recording_url;
              const durationSec = entry.duration || 0;
              const dispConf = getDispositionConfig(entry.disposition);
              const diagConf = getDiagnosticConfig(entry.diagnostic?.classification);
              const custName = entry.customer_name || entry.contact_name || '';
              const cbTime = entry.callback_time || '';
              const diag = entry.diagnostic || {};
              const am = diag.audio_metrics || entry.audio_metrics || {};

              const isTranscriptOpen = openTranscriptId === entry.call_uuid;
              const isTimelineOpen = openTimelineId === entry.call_uuid;
              const turnsCount = (entry.turns || []).length;
              const eventsCount = (entry.events || []).length;

              return (
                <div
                  key={entry.call_uuid}
                  className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-sm hover:border-slate-300 transition"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {entry.phone_number || entry.call_uuid.slice(0, 12)}
                      </span>
                      {custName && (
                        <span className="text-xs font-semibold text-[#008792] bg-[#008792]/10 px-2 py-0.5 rounded border border-[#008792]/20">
                          {custName}
                        </span>
                      )}
                      <span className="text-[11px] font-mono text-slate-400">
                        #{entry.call_uuid.slice(0, 8)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {diagConf && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${diagConf.bg} ${diagConf.text} ${diagConf.border}`}>
                          {diagConf.label}
                        </span>
                      )}
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${dispConf.bg} ${dispConf.text} ${dispConf.border}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${dispConf.dot}`} />
                        {dispConf.label}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>{formatDuration(durationSec)}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mb-2 font-mono">
                    {cbTime && (
                      <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-sans">
                        Callback: {cbTime}
                      </span>
                    )}
                    <span>Time: {formatTime(entry.created_at)}</span>
                    <span>Inbound: {formatBytes(am.inbound_bytes || 0)}</span>
                    <span>Outbound: {formatBytes(am.outbound_bytes || 0)}</span>
                  </div>

                  {diag.root_cause_summary && (
                    <div className="flex items-start gap-2 bg-slate-50 border border-slate-200/70 rounded-lg p-2.5 text-xs text-slate-700 mb-2.5">
                      <Info className="w-3.5 h-3.5 text-[#008792] flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-slate-900">Diagnostic Summary: </span>
                        <span>{diag.root_cause_summary}</span>
                      </div>
                    </div>
                  )}

                  {(recUrl || (durationSec > 5 && (am.inbound_bytes > 0 || am.outbound_bytes > 0))) && (
                    <div className="bg-slate-50/70 border border-slate-200/80 rounded-lg p-2.5 mb-2.5 flex items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 flex-shrink-0">
                        <Volume2 className="w-4 h-4 text-[#008792]" />
                        <span>Recording:</span>
                      </div>
                      <audio
                        controls
                        preload="none"
                        className="w-full h-8 outline-none rounded"
                        src={`/api/recording/${encodeURIComponent(entry.call_uuid)}`}
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={() => toggleTranscript(entry.call_uuid)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#008792] hover:text-[#007680]"
                    >
                      <span>Dialog Transcript ({turnsCount} turns)</span>
                      {isTranscriptOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      onClick={() => toggleTimeline(entry.call_uuid)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-800"
                    >
                      <Activity className="w-3.5 h-3.5 text-slate-400" />
                      <span>Carrier Timeline ({eventsCount} events)</span>
                      {isTimelineOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {isTranscriptOpen && (
                    <div className="mt-3 pt-3 border-t border-slate-100 bg-slate-50/60 rounded-lg p-3 space-y-2">
                      {turnsCount > 0 ? (
                        entry.turns.map((t, idx) => (
                          <div
                            key={idx}
                            className={`flex flex-col ${t.role === 'agent' ? 'items-start' : 'items-end'}`}
                          >
                            <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5 px-1 font-semibold uppercase">
                              {t.role === 'agent' ? <Bot className="w-3 h-3 text-[#008792]" /> : <User className="w-3 h-3 text-emerald-600" />}
                              <span>{t.role === 'agent' ? 'Ananya (Voice AI)' : 'Customer'}</span>
                            </div>
                            <div
                              className={`max-w-[85%] rounded-lg px-3 py-1.5 text-xs ${
                                t.role === 'agent'
                                  ? 'bg-[#008792]/10 text-teal-950 border border-[#008792]/20'
                                  : 'bg-white text-slate-900 border border-slate-200 shadow-2xs'
                              }`}
                            >
                              {t.text}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-slate-400 text-center py-1">No dialog turns recorded.</p>
                      )}
                    </div>
                  )}

                  {isTimelineOpen && (
                    <div className="mt-3 pt-3 border-t border-slate-100 bg-slate-50/80 rounded-lg p-3 space-y-1.5">
                      {eventsCount > 0 ? (
                        entry.events.map((ev, idx) => (
                          <div key={idx} className="flex justify-between text-xs font-mono text-slate-600">
                            <span>{ev.event}</span>
                            <span className="text-slate-400">{ev.timestamp ? ev.timestamp.slice(11, 23) : '--'}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-slate-400 text-center py-1">No events recorded.</p>
                      )}
                    </div>
                  )}
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
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/70">
        <div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">Campaign Batches History</h3>
          <p className="text-xs text-slate-500">
            Performance breakdown, lead progression, and recordings for launched batches
          </p>
        </div>
        <button
          onClick={onRefreshBatches}
          disabled={isLoadingBatches}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs transition self-start sm:self-auto disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBatches ? 'animate-spin text-[#008792]' : ''}`} />
          <span>{isLoadingBatches ? 'Refreshing...' : 'Refresh Batches'}</span>
        </button>
      </div>

      <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
        {batches.length === 0 ? (
          <div className="text-center py-14 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
            <Layers className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-semibold text-slate-700">No campaign batches recorded yet</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Select leads from the CRM Pending Queue and click 'Queue Selected to Dialer' to launch a batch.
            </p>
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

            return (
              <div
                key={b.batch_id}
                onClick={() => openBatchDetail(b.batch_id)}
                className="bg-white border border-slate-200/90 hover:border-[#008792] rounded-xl p-4 shadow-sm hover:shadow transition cursor-pointer group"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="font-bold text-sm text-slate-900 group-hover:text-[#008792] transition-colors">
                    {b.name || b.batch_id}
                  </h4>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border ${
                      isCompleted
                        ? 'bg-slate-100 text-slate-600 border-slate-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isCompleted ? 'bg-slate-400' : 'bg-emerald-500 animate-pulse'}`} />
                    {(b.status || 'ACTIVE').toUpperCase()}
                  </span>
                </div>

                <div className="text-xs text-slate-400 mb-3 flex items-center gap-2">
                  <span>ID: <span className="font-mono text-slate-600">{b.batch_id}</span></span>
                  <span>&bull;</span>
                  <span>Launched: {startedDate} {startedTime}</span>
                  <span>&bull;</span>
                  <span>{b.source_filter || 'CRM Missed Calls'}</span>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                    Total: {b.total_leads || 0}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#008792]/10 text-[#008792] font-semibold border border-[#008792]/20">
                    Dialed: {m.dialed || 0}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                    Interested: {m.interested || 0}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold border border-rose-200">
                    Declined: {m.not_interested || 0}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-semibold border border-purple-200">
                    Wrong: {m.wrong_number || 0}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold border border-amber-200">
                    Silent: {m.not_talking || 0}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold border border-slate-200">
                    No Answer: {m.no_answer || 0}
                  </span>
                </div>

                <div className="text-xs text-[#008792] font-semibold flex items-center gap-1 group-hover:underline">
                  <span>View Call Recordings &amp; Transcripts</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
