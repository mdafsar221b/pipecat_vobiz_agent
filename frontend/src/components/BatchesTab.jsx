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
  Download,
  Languages,
  FileText,
  Check,
  Headphones,
} from 'lucide-react';
import {
  formatBytes,
  formatDuration,
  formatTime,
  formatCallbackTime,
  getDispositionConfig,
  getDiagnosticConfig,
} from '../utils/formatters';

// Helper to format batch launch timestamps safely
const formatLaunchTimestamp = (b) => {
  try {
    if (b?.started_at) {
      const ms = typeof b.started_at === 'number' && b.started_at < 1e11 ? b.started_at * 1000 : b.started_at;
      const dt = new Date(ms);
      if (!isNaN(dt.getTime())) {
        const dStr = dt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric' });
        const tStr = dt.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
        return `${dStr} ${tStr}`;
      }
    }
    if (b?.created_at) {
      const clean = String(b.created_at).replace(' ', 'T');
      const dt = new Date(clean);
      if (!isNaN(dt.getTime())) {
        const dStr = dt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric' });
        const tStr = dt.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
        return `${dStr} ${tStr}`;
      }
    }
  } catch {
    // fallback
  }
  return b?.created_at || '--';
};

// Helper to guarantee 100% pure target language without leftover Telugu script
const cleanTurnText = (text, lang) => {
  if (!text) return '';
  const str = String(text).trim();
  const hasTelugu = /[\u0C00-\u0C7F]/.test(str);
  if (lang === 'en' && hasTelugu) {
    const match = str.match(/\(([^)]+)\)/);
    if (match && !/[\u0C00-\u0C7F]/.test(match[1])) return match[1].trim();
    const noTelugu = str.replace(/[\u0C00-\u0C7F]+/g, '').replace(/^[()\-:\s.,]+|[()\-:\s.,]+$/g, '').trim();
    if (noTelugu && /[a-zA-Z]/.test(noTelugu)) return noTelugu;
  }
  if (lang === 'hi' && hasTelugu) {
    const match = str.match(/\(([^)]+)\)/);
    if (match && /[\u0900-\u097F]/.test(match[1]) && !/[\u0C00-\u0C7F]/.test(match[1])) return match[1].trim();
    const noTelugu = str.replace(/[\u0C00-\u0C7F]+/g, '').replace(/^[()\-:\s.,]+|[()\-:\s.,]+$/g, '').trim();
    if (noTelugu && /[\u0900-\u097F]/.test(noTelugu)) return noTelugu;
  }
  return str;
};

// Campaign batches history and per-batch drilldown view with interactive KPI card filters
export default function BatchesTab({
  batches = [],
  isLoadingBatches = false,
  onRefreshBatches,
  onRefreshCampaign,
  onQueueLeads,
}) {
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [batchDetail, setBatchDetail] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [openTranscriptId, setOpenTranscriptId] = useState(null);
  const [openTimelineId, setOpenTimelineId] = useState(null);

  // Batch Detail Filters
  const [batchKpiFilter, setBatchKpiFilter] = useState('all');
  const [batchSearchQuery, setBatchSearchQuery] = useState('');
  const [batchListSearch, setBatchListSearch] = useState('');

  // Batch Detail Selection State
  const [selectedBatchUuids, setSelectedBatchUuids] = useState(new Set());
  const [isQueueingBatchCalls, setIsQueueingBatchCalls] = useState(false);

  // Transcript Translation & Export State
  const [activeLangByCall, setActiveLangByCall] = useState({}); // { [uuid]: 'orig' | 'en' | 'hi' }
  const [translationsByCall, setTranslationsByCall] = useState({}); // { [uuid]: { en?: [], hi?: [] } }
  const [translatingCallId, setTranslatingCallId] = useState(null); // `${uuid}-${lang}`
  const [translationError, setTranslationError] = useState({}); // { [uuid]: string }

  const handleSwitchLanguage = async (callUuid, targetLang, defaultTurns = []) => {
    if (targetLang === 'orig') {
      setActiveLangByCall((prev) => ({ ...prev, [callUuid]: 'orig' }));
      return;
    }

    setActiveLangByCall((prev) => ({ ...prev, [callUuid]: targetLang }));

    // Check if we already have it in translationsByCall or if the call entry has it
    const cached = translationsByCall[callUuid]?.[targetLang];
    if (cached && cached.length > 0) return;

    // Trigger translation from API
    setTranslatingCallId(`${callUuid}-${targetLang}`);
    setTranslationError((prev) => ({ ...prev, [callUuid]: null }));

    try {
      const res = await fetch(`/api/calls/${encodeURIComponent(callUuid)}/translate?lang=${targetLang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: targetLang }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to translate conversation');
      }
      setTranslationsByCall((prev) => ({
        ...prev,
        [callUuid]: {
          ...(prev[callUuid] || {}),
          [targetLang]: data.turns || [],
        },
      }));
    } catch (err) {
      setTranslationError((prev) => ({
        ...prev,
        [callUuid]: err.message,
      }));
    } finally {
      setTranslatingCallId(null);
    }
  };

  const handleReTranscribeFromAudio = async (callUuid, targetLang = 'en') => {
    const lang = targetLang || activeLangByCall[callUuid] || 'en';
    setActiveLangByCall((prev) => ({ ...prev, [callUuid]: lang }));
    setTranslatingCallId(`${callUuid}-${lang}-audio`);
    setTranslationError((prev) => ({ ...prev, [callUuid]: null }));

    try {
      const res = await fetch(`/api/calls/${encodeURIComponent(callUuid)}/translate?lang=${lang}&force_audio=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang, force_audio: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to re-transcribe from audio recording');
      }
      setTranslationsByCall((prev) => ({
        ...prev,
        [callUuid]: {
          ...(prev[callUuid] || {}),
          [lang]: data.turns || [],
          ...(lang === 'orig' ? { orig: data.turns || [] } : {}),
          [`${lang}_source`]: 'audio',
        },
      }));
    } catch (err) {
      setTranslationError((prev) => ({
        ...prev,
        [callUuid]: err.message,
      }));
    } finally {
      setTranslatingCallId(null);
    }
  };

  const handleDownloadTranscriptTxt = (callUuid, displayPhone, turns, lang) => {
    if (!turns || turns.length === 0) return;
    const header = `Swargaseema Voice AI - Call Transcript\nPhone: ${displayPhone}\nCall UUID: ${callUuid}\nLanguage: ${String(lang).toUpperCase()}\nDate: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: true })}\n${'='.repeat(40)}\n\n`;
    const body = turns
      .map((t) => `[${t.role === 'agent' ? 'Ananya (Voice AI)' : 'Customer'}]:\n${t.text}\n`)
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${displayPhone}-${lang}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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

  // Filter batches list by search query (Top-level hook to satisfy React Rules of Hooks)
  const filteredBatches = useMemo(() => {
    if (!batchListSearch.trim()) return batches;
    const q = batchListSearch.trim().toLowerCase();
    return batches.filter(
      (b) =>
        (b.name || '').toLowerCase().includes(q) ||
        (b.batch_id || '').toLowerCase().includes(q) ||
        (b.source_filter || '').toLowerCase().includes(q) ||
        (b.status || '').toLowerCase().includes(q)
    );
  }, [batches, batchListSearch]);

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
          return 'Not Interested';
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

    const selectedBatchCalls = calls.filter((c) => selectedBatchUuids.has(c.call_uuid));
    const allBatchSelected =
      filteredBatchCalls.length > 0 &&
      filteredBatchCalls.every((c) => selectedBatchUuids.has(c.call_uuid));

    const toggleSelectBatchCall = (uuid) => {
      setSelectedBatchUuids((prev) => {
        const next = new Set(prev);
        if (next.has(uuid)) {
          next.delete(uuid);
        } else {
          next.add(uuid);
        }
        return next;
      });
    };

    const toggleSelectAllBatchCalls = () => {
      if (allBatchSelected) {
        setSelectedBatchUuids(new Set());
      } else {
        setSelectedBatchUuids(new Set(filteredBatchCalls.map((c) => c.call_uuid)));
      }
    };

    const handleQueueSelectedBatchCalls = async () => {
      if (selectedBatchCalls.length === 0) return;
      setIsQueueingBatchCalls(true);
      try {
        const leads = selectedBatchCalls
          .map((c) => {
            const num = c.phone_number || (c.events || []).find((e) => e.to || e.params?.To)?.to || '';
            const name = c.customer_name || c.contact_name || '';
            const disp = c.disposition || 'retry';
            return {
              phone_number: num,
              customer_name: name,
              source: `Batch Retry (${b.name || b.batch_id || 'Batch'})`,
              metadata: {
                batch_origin: b.batch_id,
                original_uuid: c.call_uuid,
                prev_disposition: disp,
              },
            };
          })
          .filter((l) => Boolean(l.phone_number));

        if (leads.length === 0) {
          alert('No valid phone numbers found in selected calls.');
          return;
        }

        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\u202f/g, ' ');
        const batchName = `Batch Retry (${b.name || b.batch_id || 'Batch'}) - ${leads.length} calls (${timeStr})`;
        const sourceFilter = `Batch ${b.batch_id} Retry`;

        if (onQueueLeads) {
          await onQueueLeads({
            leads,
            batch_name: batchName,
            source_filter: sourceFilter,
          });
          setSelectedBatchUuids(new Set());
        }
      } catch (err) {
        alert(`Failed to queue leads: ${err.message}`);
      } finally {
        setIsQueueingBatchCalls(false);
      }
    };

    return (
      <div className="space-y-5">
        {/* Detail Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/70">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToBatches}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition"
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
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider border ${
                isCompleted
                  ? 'bg-slate-100 text-slate-600 border-slate-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 ${isCompleted ? 'bg-slate-400' : 'bg-emerald-500 animate-pulse'}`} />
              {(b.status || 'ACTIVE').toUpperCase()}
            </span>
            <button
              onClick={handleDeleteBatch}
              className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 transition"
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
              className={`border p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'all'
                  ? 'bg-slate-900 text-white border-slate-900'
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
              className={`border p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'dialed'
                  ? 'bg-[#008792] text-white border-[#008792]'
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
              className={`border p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'interested'
                  ? 'bg-emerald-600 text-white border-emerald-600'
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

            {/* Not Interested Card */}
            <div
              onClick={() => handleKpiCardClick('declined')}
              role="button"
              tabIndex={0}
              title="Click to filter not interested calls"
              className={`border p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'declined'
                  ? 'bg-rose-600 text-white border-rose-600'
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
              }`}>Not Interested</span>
            </div>

            {/* Wrong Card */}
            <div
              onClick={() => handleKpiCardClick('wrong')}
              role="button"
              tabIndex={0}
              title="Click to filter wrong number calls"
              className={`border p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'wrong'
                  ? 'bg-purple-600 text-white border-purple-600'
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
              className={`border p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'silent'
                  ? 'bg-amber-600 text-white border-amber-600'
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
              className={`border p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'no_answer'
                  ? 'bg-slate-700 text-white border-slate-700'
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
              className={`border p-2.5 text-center cursor-pointer transition-all select-none ${
                batchKpiFilter === 'dropped'
                  ? 'bg-red-700 text-white border-red-700'
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
        <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 bg-slate-50/70 border border-slate-200">
          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={batchSearchQuery}
                onChange={(e) => setBatchSearchQuery(e.target.value)}
                placeholder="Search calls in this batch by phone, customer name, diagnostic root cause..."
                className="w-full bg-white border border-slate-200 text-slate-800 text-xs pl-8 pr-8 py-1.5 outline-none focus:ring-1 focus:ring-[#008792] focus:border-[#008792]"
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

          <div className="flex items-center gap-2 text-xs flex-wrap">
            {batchKpiFilter !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#008792]/10 text-[#008792] font-semibold border border-[#008792]/20">
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

            <button
              onClick={handleQueueSelectedBatchCalls}
              disabled={isQueueingBatchCalls || selectedBatchCalls.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white transition disabled:opacity-40 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {isQueueingBatchCalls
                  ? 'Queueing...'
                  : `Queue Selected to Dialer (${selectedBatchCalls.length})`}
              </span>
            </button>
          </div>
        </div>

        {/* Calls in this batch - High Density Slate Table */}
        <div className="overflow-x-auto max-h-[calc(100vh-320px)] border border-slate-200 bg-white">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px] sticky top-0 z-10 backdrop-blur-sm">
                <th className="w-10 px-3.5 py-3">
                  <input
                    type="checkbox"
                    checked={allBatchSelected}
                    onChange={toggleSelectAllBatchCalls}
                    className="text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                  />
                </th>
                <th className="px-3.5 py-3 whitespace-nowrap">Recipient</th>
                <th className="px-3.5 py-3 whitespace-nowrap">Disposition</th>
                <th className="px-3.5 py-3 whitespace-nowrap">Stream Health</th>
                <th className="px-3.5 py-3 whitespace-nowrap">Duration</th>
                <th className="px-3.5 py-3 whitespace-nowrap">Time &amp; Callback</th>
                <th className="px-3.5 py-3 whitespace-nowrap">Diagnostic Summary</th>
                <th className="px-3.5 py-3 whitespace-nowrap">Audio Recording</th>
                <th className="px-3.5 py-3 text-right whitespace-nowrap">Investigation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoadingDetail ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin text-[#008792] mx-auto mb-2" />
                    <span className="text-xs font-medium">Fetching call audio telemetry and transcripts...</span>
                  </td>
                </tr>
              ) : filteredBatchCalls.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 bg-slate-50/50">
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
                        className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-[#008792] hover:bg-slate-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset Batch Filters</span>
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredBatchCalls.map((entry, idx) => {
                  const callUuid = entry.call_uuid || entry.lead_id || `call-${idx}`;
                  const shortUuid = String(callUuid).slice(0, 8);
                  const displayPhone = entry.phone_number || String(callUuid).slice(0, 12);
                  const recUrl = entry.recording_url;
                  const durationSec = entry.duration || 0;
                  const dispConf = getDispositionConfig(entry.disposition);
                  const diagConf = getDiagnosticConfig(entry.diagnostic?.classification);
                  const custName = entry.customer_name || entry.contact_name || '';
                  const cbTime = formatCallbackTime(entry.callback_time || '');
                  const diag = entry.diagnostic || {};
                  const am = diag.audio_metrics || entry.audio_metrics || {};
                  const inBytes = am.inbound_bytes || 0;
                  const outBytes = am.outbound_bytes || 0;
                  const inChunks = am.inbound_chunks || 0;

                  const isTranscriptOpen = openTranscriptId === callUuid;
                  const isTimelineOpen = openTimelineId === callUuid;
                  const turnsCount = (entry.turns || []).length;
                  const eventsCount = (entry.events || []).length;
                  const isChecked = selectedBatchUuids.has(callUuid);

                  return (
                    <React.Fragment key={callUuid}>
                      <tr className={`hover:bg-slate-50/80 transition-colors ${isChecked ? 'bg-[#008792]/5' : isTranscriptOpen || isTimelineOpen ? 'bg-slate-50/50' : ''}`}>
                        {/* Checkbox */}
                        <td className="px-3.5 py-3">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectBatchCall(callUuid)}
                            className="text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                          />
                        </td>

                        {/* Recipient */}
                        <td className="px-3.5 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-900">
                              {displayPhone}
                            </span>
                            {custName && (
                              <span className="text-[11px] font-semibold text-[#008792] bg-[#008792]/10 px-1.5 py-0.5 border border-[#008792]/20">
                                {custName}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                            #{shortUuid}
                          </div>
                        </td>

                        {/* Disposition */}
                        <td className="px-3.5 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold border ${dispConf.bg} ${dispConf.text} ${dispConf.border}`}>
                            <span className={`w-1.5 h-1.5 ${dispConf.dot}`} />
                            {dispConf.label}
                          </span>
                        </td>

                        {/* Stream Health */}
                        <td className="px-3.5 py-3 whitespace-nowrap">
                          {diagConf ? (
                            <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${diagConf.bg} ${diagConf.text} ${diagConf.border}`}>
                              {diagConf.label}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">--</span>
                          )}
                        </td>

                        {/* Duration */}
                        <td className="px-3.5 py-3 whitespace-nowrap font-mono text-xs text-slate-700">
                          <span className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 px-2 py-0.5">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>{formatDuration(durationSec)}</span>
                          </span>
                        </td>

                        {/* Time & Callback */}
                        <td className="px-3.5 py-3 whitespace-nowrap">
                          <div className="text-slate-700 font-mono text-[11px]">
                            {formatTime(entry.created_at)}
                          </div>
                          {cbTime && (
                            <div className="mt-1 inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 border border-emerald-200 text-[10px]">
                              <span>Callback: {cbTime}</span>
                            </div>
                          )}
                        </td>

                        {/* Diagnostic Summary */}
                        <td className="px-3.5 py-3 max-w-[280px]">
                          <div className="text-xs text-slate-800 line-clamp-2 leading-snug" title={diag.root_cause_summary || 'Normal conversational call'}>
                            {diag.root_cause_summary || <span className="text-slate-400 italic">Normal conversational call</span>}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-1 flex items-center gap-1.5">
                            <span>In: {formatBytes(inBytes)} ({inChunks}c)</span>
                            <span>&bull;</span>
                            <span>Out: {formatBytes(outBytes)}</span>
                          </div>
                        </td>

                        {/* Audio Recording */}
                        <td className="px-3.5 py-3 whitespace-nowrap min-w-[240px]">
                          {(recUrl || (durationSec > 5 && (inBytes > 0 || outBytes > 0))) ? (
                            <div className="flex items-center gap-1.5">
                              <audio
                                controls
                                preload="none"
                                className="w-44 h-7 outline-none"
                                src={`/api/recording/${encodeURIComponent(callUuid)}`}
                              />
                              <a
                                href={`/api/recording/${encodeURIComponent(callUuid)}?download=1`}
                                download={`call-${displayPhone || shortUuid}.mp3`}
                                title="Download Audio Recording (.mp3)"
                                className="inline-flex items-center justify-center w-7 h-7 bg-white hover:bg-[#008792] text-slate-500 hover:text-white border border-slate-200 transition-colors shadow-xs flex-shrink-0 cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">No recording</span>
                          )}
                        </td>

                        {/* Investigation Actions */}
                        <td className="px-3.5 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => toggleTranscript(callUuid)}
                              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold border transition ${
                                isTranscriptOpen
                                  ? 'bg-[#008792] text-white border-[#008792]'
                                  : 'bg-white text-[#008792] border-slate-200 hover:border-[#008792]'
                              }`}
                              title="Toggle dialog turns transcript"
                            >
                              <span>Transcript ({turnsCount})</span>
                              {isTranscriptOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>

                            <button
                              onClick={() => toggleTimeline(callUuid)}
                              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold border transition ${
                                isTimelineOpen
                                  ? 'bg-slate-800 text-white border-slate-800'
                                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                              }`}
                              title="Toggle carrier lifecycle events"
                            >
                              <Activity className="w-3 h-3" />
                              {isTimelineOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Accordion Row */}
                      {(isTranscriptOpen || isTimelineOpen) && (() => {
                        const activeLang = activeLangByCall[callUuid] || 'orig';
                        const currentTurns =
                          activeLang === 'en'
                            ? (translationsByCall[callUuid]?.en || entry.transcripts_en || entry.turns || [])
                            : activeLang === 'hi'
                            ? (translationsByCall[callUuid]?.hi || entry.transcripts_hi || entry.turns || [])
                            : (entry.turns || []);
                        const isTranslating = translatingCallId === `${callUuid}-${activeLang}`;
                        const isAudioTranscribing = translatingCallId === `${callUuid}-${activeLang}-audio`;
                        const err = translationError[callUuid];

                        return (
                          <tr className="bg-slate-50/70 border-b border-slate-200">
                            <td colSpan={9} className="p-3.5">
                              {isTranscriptOpen && (
                                <div className="bg-white border border-slate-200 p-3 space-y-2 mb-2.5">
                                  {/* Transcript Header with Language Switch & Actions */}
                                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200 text-xs">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-slate-800 uppercase tracking-wider">
                                        Dialog Transcript ({currentTurns.length} turns)
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-mono">
                                        #{shortUuid}
                                      </span>
                                      {activeLang !== 'orig' && (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase">
                                          <Check className="w-2.5 h-2.5" />
                                          {translationsByCall[callUuid]?.[`${activeLang}_source`] === 'audio' ? '🎧 Audio: ' : ''}
                                          {activeLang === 'en' ? 'English' : 'Hindi'} {translationsByCall[callUuid]?.[`${activeLang}_source`] === 'audio' ? 'Transcribed' : 'Translation'}
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2 flex-wrap">
                                      {/* Text View Switch Buttons */}
                                      <div className="inline-flex items-center bg-slate-100 p-0.5 border border-slate-200 text-xs">
                                        <span className="px-1.5 text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                                          <Languages className="w-3 h-3 text-slate-500" />
                                          View:
                                        </span>
                                        <button
                                          onClick={() => handleSwitchLanguage(callUuid, 'orig')}
                                          className={`px-2 py-0.5 text-[11px] font-semibold transition cursor-pointer ${
                                            activeLang === 'orig'
                                              ? 'bg-white text-slate-900 shadow-xs'
                                              : 'text-slate-600 hover:text-slate-900'
                                          }`}
                                        >
                                          Original (Telugu)
                                        </button>
                                        <button
                                          onClick={() => handleSwitchLanguage(callUuid, 'en', entry.turns)}
                                          className={`px-2 py-0.5 text-[11px] font-semibold transition flex items-center gap-1 cursor-pointer ${
                                            activeLang === 'en'
                                              ? 'bg-[#008792] text-white shadow-xs'
                                              : 'text-slate-600 hover:text-slate-900'
                                          }`}
                                          title="Translate current transcript to English"
                                        >
                                          <span>English</span>
                                          {translatingCallId === `${callUuid}-en` && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
                                        </button>
                                        <button
                                          onClick={() => handleSwitchLanguage(callUuid, 'hi', entry.turns)}
                                          className={`px-2 py-0.5 text-[11px] font-semibold transition flex items-center gap-1 cursor-pointer ${
                                            activeLang === 'hi'
                                              ? 'bg-[#008792] text-white shadow-xs'
                                              : 'text-slate-600 hover:text-slate-900'
                                          }`}
                                          title="Translate current transcript to Hindi"
                                        >
                                          <span>Hindi</span>
                                          {translatingCallId === `${callUuid}-hi` && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
                                        </button>
                                      </div>

                                      {/* Direct Audio Re-transcribe Options (English / Hindi) */}
                                      {(recUrl || (durationSec > 5 && (inBytes > 0 || outBytes > 0))) && (
                                        <div className="inline-flex items-center bg-emerald-50/90 p-0.5 border border-emerald-300 text-xs">
                                          <span className="px-1.5 text-[10px] font-bold text-emerald-800 uppercase flex items-center gap-1">
                                            <Headphones className="w-3 h-3 text-emerald-700" />
                                            Re-transcribe Audio:
                                          </span>
                                          <button
                                            onClick={() => handleReTranscribeFromAudio(callUuid, 'en')}
                                            disabled={translatingCallId === `${callUuid}-en-audio`}
                                            className={`px-2 py-0.5 text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 ${
                                              activeLang === 'en' && translationsByCall[callUuid]?.['en_source'] === 'audio'
                                                ? 'bg-emerald-700 text-white shadow-xs'
                                                : 'bg-white text-emerald-900 hover:bg-emerald-600 hover:text-white border border-emerald-200'
                                            }`}
                                            title="Listen to call audio recording and re-transcribe directly into English"
                                          >
                                            <span>English</span>
                                            {translatingCallId === `${callUuid}-en-audio` && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
                                          </button>
                                          <button
                                            onClick={() => handleReTranscribeFromAudio(callUuid, 'hi')}
                                            disabled={translatingCallId === `${callUuid}-hi-audio`}
                                            className={`px-2 py-0.5 text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 ml-0.5 ${
                                              activeLang === 'hi' && translationsByCall[callUuid]?.['hi_source'] === 'audio'
                                                ? 'bg-emerald-700 text-white shadow-xs'
                                                : 'bg-white text-emerald-900 hover:bg-emerald-600 hover:text-white border border-emerald-200'
                                            }`}
                                            title="Listen to call audio recording and re-transcribe directly into Hindi"
                                          >
                                            <span>Hindi</span>
                                            {translatingCallId === `${callUuid}-hi-audio` && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
                                          </button>
                                        </div>
                                      )}

                                      {/* Direct Audio Download */}
                                      {(recUrl || (durationSec > 5 && (inBytes > 0 || outBytes > 0))) && (
                                        <a
                                          href={`/api/recording/${encodeURIComponent(callUuid)}?download=1`}
                                          download={`recording-${displayPhone || shortUuid}.mp3`}
                                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition cursor-pointer"
                                          title="Download Call Recording (.mp3)"
                                        >
                                          <Download className="w-3 h-3 text-[#008792]" />
                                          <span>Audio (.mp3)</span>
                                        </a>
                                      )}

                                      {/* Export Transcript */}
                                      {currentTurns.length > 0 && (
                                        <button
                                          onClick={() => handleDownloadTranscriptTxt(callUuid, displayPhone, currentTurns, activeLang)}
                                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition cursor-pointer"
                                          title="Download Transcript as Text (.txt)"
                                        >
                                          <FileText className="w-3 h-3 text-slate-500" />
                                          <span>Export (.txt)</span>
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Translation / Audio Transcription Loading State */}
                                  {isAudioTranscribing ? (
                                    <div className="text-center py-8 bg-emerald-50/50 border border-dashed border-emerald-300">
                                      <RefreshCw className="w-5 h-5 animate-spin text-emerald-600 mx-auto mb-2" />
                                      <p className="text-xs font-semibold text-emerald-900">
                                        Listening to call audio recording and re-transcribing with Gemini Multimodal AI...
                                      </p>
                                      <p className="text-[11px] text-emerald-700 mt-0.5">
                                        Analyzing speech waveform directly to capture all customer and agent dialogue.
                                      </p>
                                    </div>
                                  ) : isTranslating ? (
                                    <div className="text-center py-8 bg-slate-50 border border-dashed border-slate-200">
                                      <RefreshCw className="w-5 h-5 animate-spin text-[#008792] mx-auto mb-2" />
                                      <p className="text-xs font-semibold text-slate-700">
                                        Converting &amp; Translating conversation to {activeLang === 'en' ? 'English' : 'Hindi'} with Gemini AI...
                                      </p>
                                      <p className="text-[11px] text-slate-400 mt-0.5">
                                        Generating natural dialogue translation with speaker diarization.
                                      </p>
                                    </div>
                                  ) : err ? (
                                    <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                                      <p className="font-semibold">Translation Error</p>
                                      <p className="text-[11px] mt-0.5">{err}</p>
                                      <button
                                        onClick={() => handleSwitchLanguage(callUuid, activeLang, entry.turns)}
                                        className="mt-2 text-xs font-bold text-rose-800 underline cursor-pointer"
                                      >
                                        Retry Translation
                                      </button>
                                    </div>
                                  ) : currentTurns.length > 0 ? (
                                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                                      {currentTurns.map((t, idx) => {
                                        const isAgent = t.role === 'agent';
                                        return (
                                          <div
                                            key={idx}
                                            className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'}`}
                                          >
                                            <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5 px-1 font-semibold uppercase">
                                              {isAgent ? <Bot className="w-3 h-3 text-[#008792]" /> : <User className="w-3 h-3 text-emerald-600" />}
                                              <span>{isAgent ? 'Ananya (Voice AI)' : 'Customer'}</span>
                                            </div>
                                            <div
                                              className={`max-w-[85%] px-3 py-1.5 text-xs leading-relaxed ${
                                                isAgent
                                                  ? 'bg-[#008792]/10 text-teal-950 border border-[#008792]/20'
                                                  : 'bg-white text-slate-900 border border-slate-200'
                                              }`}
                                            >
                                              {cleanTurnText(t.text, activeLang)}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="text-center py-5 bg-slate-50/60 border border-slate-200 px-4">
                                      <p className="text-xs text-slate-600 font-medium">No live dialog turns recorded during call.</p>
                                      {(recUrl || (durationSec > 5 && (inBytes > 0 || outBytes > 0))) ? (
                                        <div className="mt-2">
                                          <p className="text-[11px] text-slate-400 mb-2">
                                            Call recording is available. You can convert the audio recording directly into an English or Hindi transcript:
                                          </p>
                                          <div className="inline-flex items-center gap-2">
                                            <button
                                              onClick={() => handleSwitchLanguage(callUuid, 'en', [])}
                                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#008792] text-white hover:bg-[#007680] transition cursor-pointer"
                                            >
                                              <Languages className="w-3.5 h-3.5" />
                                              <span>Convert Audio to English</span>
                                            </button>
                                            <button
                                              onClick={() => handleSwitchLanguage(callUuid, 'hi', [])}
                                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-[#008792] text-[#008792] hover:bg-[#008792]/5 transition cursor-pointer"
                                            >
                                              <Languages className="w-3.5 h-3.5" />
                                              <span>Convert Audio to Hindi</span>
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="text-[11px] text-slate-400 mt-1">No audio recording available for this call.</p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                            {isTimelineOpen && (
                              <div className="bg-white border border-slate-200 p-3">
                                <div className="flex items-center justify-between pb-2 border-b border-slate-100 text-xs mb-3">
                                  <span className="font-bold text-slate-800 uppercase tracking-wider">
                                    Carrier Lifecycle Timeline ({eventsCount} events)
                                  </span>
                                </div>

                                {eventsCount > 0 ? (
                                  <div className="relative pl-4 space-y-3 before:absolute before:left-1.5 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-slate-200 max-h-60 overflow-y-auto">
                                    {entry.events.map((ev, idx) => (
                                      <div key={idx} className="flex justify-between text-xs font-mono text-slate-600">
                                        <span>{ev.event}</span>
                                        <span className="text-slate-400">{ev.timestamp ? ev.timestamp.slice(11, 23) : '--'}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-400 text-center py-2">No events recorded.</p>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })()}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
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
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition self-start sm:self-auto disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBatches ? 'animate-spin text-[#008792]' : ''}`} />
          <span>{isLoadingBatches ? 'Refreshing...' : 'Refresh Batches'}</span>
        </button>
      </div>

      {/* Batches Search & Stats Filter */}
      {batches.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 bg-slate-50 border border-slate-200 p-2.5 text-xs">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search batches by name (e.g. 10-09, 150), Batch ID, or status..."
              value={batchListSearch}
              onChange={(e) => setBatchListSearch(e.target.value)}
              className="w-full bg-transparent outline-none text-slate-800 placeholder-slate-400 text-xs"
            />
            {batchListSearch && (
              <button onClick={() => setBatchListSearch('')} className="text-slate-400 hover:text-slate-600">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Showing <span className="font-bold text-slate-900">{filteredBatches.length}</span> of {batches.length} batches
          </div>
        </div>
      )}

      <div className="space-y-3 max-h-[720px] overflow-y-auto pr-1">
        {filteredBatches.length === 0 ? (
          <div className="text-center py-14 bg-slate-50/50 border border-dashed border-slate-200">
            <Layers className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-semibold text-slate-700">
              {batchListSearch ? 'No batches match your search filter' : 'No campaign batches recorded yet'}
            </p>
            {batchListSearch && (
              <button
                onClick={() => setBatchListSearch('')}
                className="mt-2 text-xs font-semibold text-[#008792] hover:underline"
              >
                Clear Search
              </button>
            )}
            {!batchListSearch && (
              <p className="text-[11px] text-slate-400 mt-0.5">
                Select leads from the CRM Pending Queue and click 'Queue Selected to Dialer' to launch a batch.
              </p>
            )}
          </div>
        ) : (
          filteredBatches.map((b) => {
            const m = b.metrics || {};
            const isCompleted = b.status === 'completed';
            const launchTimestamp = formatLaunchTimestamp(b);

            return (
              <div
                key={b.batch_id}
                onClick={() => openBatchDetail(b.batch_id)}
                className="bg-white border border-slate-200 hover:border-[#008792] p-4 transition cursor-pointer group"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="font-bold text-sm text-slate-900 group-hover:text-[#008792] transition-colors">
                    {b.name || b.batch_id}
                  </h4>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider border ${
                      isCompleted
                        ? 'bg-slate-100 text-slate-600 border-slate-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 ${isCompleted ? 'bg-slate-400' : 'bg-emerald-500 animate-pulse'}`} />
                    {(b.status || 'ACTIVE').toUpperCase()}
                  </span>
                </div>

                <div className="text-xs text-slate-400 mb-3 flex items-center gap-2">
                  <span>ID: <span className="font-mono text-slate-600">{b.batch_id}</span></span>
                  <span>&bull;</span>
                  <span>Launched: {launchTimestamp}</span>
                  <span>&bull;</span>
                  <span>{b.source_filter || 'CRM Missed Calls'}</span>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="text-xs font-mono px-2 py-0.5 bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                    Total: {b.total_leads || 0}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 bg-[#008792]/10 text-[#008792] font-semibold border border-[#008792]/20">
                    Dialed: {m.dialed || 0}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                    Interested: {m.interested || 0}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 bg-rose-50 text-rose-700 font-semibold border border-rose-200">
                    Not Interested: {m.not_interested || 0}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 bg-purple-50 text-purple-700 font-semibold border border-purple-200">
                    Wrong: {m.wrong_number || 0}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 bg-amber-50 text-amber-700 font-semibold border border-amber-200">
                    Silent: {m.not_talking || 0}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 bg-slate-100 text-slate-600 font-semibold border border-slate-200">
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
