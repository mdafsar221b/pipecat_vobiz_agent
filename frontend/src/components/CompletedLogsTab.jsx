import React, { useState, useMemo } from 'react';
import {
  RefreshCw,
  Phone,
  Clock,
  Calendar,
  Volume2,
  ChevronDown,
  ChevronUp,
  Activity,
  Bot,
  User,
  ArrowDownLeft,
  ArrowUpRight,
  Info,
  Search,
  X,
  RotateCcw,
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

// Completed calls inspection table with date filtering and batch re-queueing
export default function CompletedLogsTab({
  completedCalls = [],
  isLoadingLogs = false,
  onRefreshLogs,
  onQueueLeads,
}) {
  const [openTranscriptId, setOpenTranscriptId] = useState(null);
  const [openTimelineId, setOpenTimelineId] = useState(null);

  // Date Filter State
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateFilterActive, setDateFilterActive] = useState(false);

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [dispositionFilter, setDispositionFilter] = useState('all');
  const [healthFilter, setHealthFilter] = useState('all');
  const [recordingOnly, setRecordingOnly] = useState(false);
  const [callbackOnly, setCallbackOnly] = useState(false);
  const [durationFilter, setDurationFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [uniqueOnly, setUniqueOnly] = useState(true);

  // Lead Selection State for Batch Creation
  const [selectedUuids, setSelectedUuids] = useState(new Set());
  const [isQueueing, setIsQueueing] = useState(false);

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

  const setDateToday = () => {
    const today = new Date().toISOString().slice(0, 10);
    setStartDate(today);
    setEndDate(today);
    setDateFilterActive(true);
    if (onRefreshLogs) onRefreshLogs(today, today);
  };

  const setDateYesterday = () => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = y.toISOString().slice(0, 10);
    setStartDate(yesterday);
    setEndDate(yesterday);
    setDateFilterActive(true);
    if (onRefreshLogs) onRefreshLogs(yesterday, yesterday);
  };

  const handleFetchCalls = () => {
    setDateFilterActive(true);
    if (onRefreshLogs) onRefreshLogs(startDate, endDate);
  };

  const resetAllFilters = () => {
    setSearchQuery('');
    setDispositionFilter('all');
    setHealthFilter('all');
    setRecordingOnly(false);
    setCallbackOnly(false);
    setDurationFilter('all');
    setSortBy('newest');
    setUniqueOnly(true);
    setDateFilterActive(false);
    if (onRefreshLogs) onRefreshLogs(null, null);
  };

  // Compute counts across dataset
  const dispositionCounts = useMemo(() => {
    const counts = { all: completedCalls.length };
    for (const entry of completedCalls) {
      const d = (entry.disposition || 'completed').toLowerCase();
      counts[d] = (counts[d] || 0) + 1;
    }
    return counts;
  }, [completedCalls]);

  const notAnsweringCount = useMemo(() => {
    return completedCalls.filter((c) => {
      const d = (c.disposition || '').toLowerCase();
      return ['no_answer', 'busy', 'not_talking', 'dropped'].includes(d);
    }).length;
  }, [completedCalls]);

  // Filter and sort calls
  const filteredCalls = useMemo(() => {
    let result = [...completedCalls];

    // 1. Date Range Filter
    if (dateFilterActive && startDate && endDate) {
      result = result.filter((entry) => {
        const rawTime = entry.started || entry.created_at;
        if (!rawTime) return true;
        const callDate = new Date(rawTime).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        return callDate >= startDate && callDate <= endDate;
      });
    }

    // 2. Text Search (phone, name, UUID, reason, diagnostic summary, or dialog turn text)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((entry) => {
        const phone = (entry.phone_number || '').toLowerCase();
        const name = (entry.customer_name || entry.contact_name || '').toLowerCase();
        const uuid = (entry.call_uuid || '').toLowerCase();
        const reason = (entry.reason || '').toLowerCase();
        const diag = (entry.diagnostic?.root_cause_summary || '').toLowerCase();
        const inTurns = (entry.turns || []).some((t) => (t.text || '').toLowerCase().includes(q));
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

    // 3. Disposition Filter
    if (dispositionFilter !== 'all') {
      result = result.filter((entry) => {
        const disp = (entry.disposition || 'completed').toLowerCase();
        if (dispositionFilter === 'not_answering_busy') {
          return ['no_answer', 'busy', 'not_talking', 'dropped'].includes(disp);
        }
        if (dispositionFilter === 'interested') return disp === 'interested';
        if (dispositionFilter === 'not_interested') return disp === 'not_interested' || disp === 'declined';
        if (dispositionFilter === 'wrong_number') return disp === 'wrong_number';
        if (dispositionFilter === 'not_talking') return disp === 'not_talking';
        if (dispositionFilter === 'no_answer') return disp === 'no_answer' || disp === 'busy';
        if (dispositionFilter === 'dropped') return disp === 'dropped';
        return disp === dispositionFilter;
      });
    }

    // 4. Health / Diagnostic Classification
    if (healthFilter !== 'all') {
      result = result.filter((entry) => {
        const cls = (entry.diagnostic?.classification || '').toLowerCase();
        return cls === healthFilter;
      });
    }

    // 5. Audio Recording Filter
    if (recordingOnly) {
      result = result.filter((entry) => {
        const recEvent = (entry.events || []).find((e) => e.kind === 'recording');
        const hasUrl = Boolean(
          entry.recording_url || (recEvent && (recEvent.recording_url || recEvent.params?.RecordUrl))
        );
        const rawDur = entry.duration || 0;
        const am = entry.diagnostic?.audio_metrics || entry.audio_metrics || {};
        return hasUrl || (rawDur > 5 && (am.inbound_bytes > 0 || am.outbound_bytes > 0));
      });
    }

    // 6. Callback Scheduled Filter
    if (callbackOnly) {
      result = result.filter((entry) => Boolean(entry.callback_time));
    }

    // 7. Duration Filter
    if (durationFilter !== 'all') {
      result = result.filter((entry) => {
        const hangupEvent = (entry.events || []).find((e) => e.kind === 'hangup');
        const dur =
          Number(
            entry.duration !== undefined && entry.duration !== null && entry.duration > 0
              ? entry.duration
              : hangupEvent?.params?.Duration || 0
          ) || 0;

        if (durationFilter === 'under15') return dur < 15;
        if (durationFilter === '15to30') return dur >= 15 && dur <= 30;
        if (durationFilter === '30to60') return dur > 30 && dur <= 60;
        if (durationFilter === 'over60') return dur > 60;
        return true;
      });
    }

    // 8. Sorting
    result.sort((a, b) => {
      if (sortBy === 'oldest') {
        return new Date(a.started || a.created_at || 0) - new Date(b.started || b.created_at || 0);
      }
      if (sortBy === 'duration_desc') {
        return (Number(b.duration) || 0) - (Number(a.duration) || 0);
      }
      if (sortBy === 'turns_desc') {
        return (b.turns || []).length - (a.turns || []).length;
      }
      return new Date(b.started || b.created_at || 0) - new Date(a.started || a.created_at || 0);
    });

    // 9. Unique Callers Filter (preserves latest interaction per 10-digit number)
    if (uniqueOnly) {
      const seen = new Set();
      const uniqueList = [];
      for (const entry of result) {
        const rawNum =
          entry.phone_number ||
          (entry.events || []).find((e) => e.to || e.params?.To)?.to ||
          (entry.events || []).find((e) => e.params?.To)?.params?.To ||
          (entry.events || []).find((e) => e.params?.From)?.params?.From ||
          '';
        const num10 = String(rawNum).replace(/\D/g, '').slice(-10);
        if (num10 && !seen.has(num10)) {
          seen.add(num10);
          uniqueList.push(entry);
        } else if (!num10) {
          uniqueList.push(entry);
        }
      }
      result = uniqueList;
    }

    return result;
  }, [
    completedCalls,
    dateFilterActive,
    startDate,
    endDate,
    searchQuery,
    dispositionFilter,
    healthFilter,
    recordingOnly,
    callbackOnly,
    durationFilter,
    sortBy,
    uniqueOnly,
  ]);

  // Selection helpers
  const selectedCalls = useMemo(() => {
    return filteredCalls.filter((c) => selectedUuids.has(c.call_uuid));
  }, [filteredCalls, selectedUuids]);

  const allSelected = filteredCalls.length > 0 && filteredCalls.every((c) => selectedUuids.has(c.call_uuid));

  const toggleSelect = (uuid) => {
    setSelectedUuids((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedUuids(new Set());
    } else {
      setSelectedUuids(new Set(filteredCalls.map((c) => c.call_uuid)));
    }
  };

  // Queue selected completed calls to outbound dialer
  const handleQueueSelected = async () => {
    if (selectedCalls.length === 0) return;
    setIsQueueing(true);
    try {
      const leads = selectedCalls
        .map((c) => {
          const num = c.phone_number || (c.events || []).find((e) => e.to || e.params?.To)?.to || '';
          const name = c.customer_name || c.contact_name || '';
          const disp = c.disposition || 'retry';
          return {
            phone_number: num,
            customer_name: name,
            source: `Call Logs Retry (${disp})`,
            metadata: {
              original_uuid: c.call_uuid,
              prev_disposition: disp,
              callback_time: c.callback_time,
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
      const dispLabel = dispositionFilter !== 'all' ? dispositionFilter.toUpperCase() : 'CALL LOGS';
      const batchName = `Call Logs Retry [${dispLabel}] (${timeStr}) - ${leads.length} calls`;
      const sourceFilter = `Call Logs (${startDate} to ${endDate})`;

      if (onQueueLeads) {
        await onQueueLeads({
          leads,
          batch_name: batchName,
          source_filter: sourceFilter,
        });
        setSelectedUuids(new Set());
      }
    } catch (err) {
      alert(`Failed to queue leads: ${err.message}`);
    } finally {
      setIsQueueing(false);
    }
  };

  const activeFiltersCount = [
    dateFilterActive,
    Boolean(searchQuery.trim()),
    dispositionFilter !== 'all',
    healthFilter !== 'all',
    recordingOnly,
    callbackOnly,
    durationFilter !== 'all',
    sortBy !== 'newest',
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/70">
        <div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">
            Completed Call Logs &amp; Transcripts
          </h3>
          <p className="text-xs text-slate-500">
            Turn-by-turn conversations, audio recordings, and qualification outcomes from Ananya
          </p>
        </div>

        <button
          onClick={() => onRefreshLogs && onRefreshLogs(dateFilterActive ? startDate : null, dateFilterActive ? endDate : null)}
          disabled={isLoadingLogs}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition self-start sm:self-auto disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin text-[#008792]' : ''}`} />
          <span>{isLoadingLogs ? 'Refreshing...' : 'Refresh History'}</span>
        </button>
      </div>

      {/* Date Filter & Batch Queue Toolbar */}
      <div className="bg-slate-50/70 border border-slate-200 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Date Picker Group */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1.5 text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[10px] font-bold uppercase text-slate-400">From</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="outline-none text-slate-800 bg-transparent text-xs font-medium cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1.5 text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[10px] font-bold uppercase text-slate-400">To</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="outline-none text-slate-800 bg-transparent text-xs font-medium cursor-pointer"
            />
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={setDateToday}
              className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition"
            >
              Today
            </button>
            <button
              onClick={setDateYesterday}
              className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition"
            >
              Yesterday
            </button>
          </div>

          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by phone, name, UUID, dialog text..."
              className="w-full bg-white border border-slate-200 text-slate-800 text-xs pl-8 pr-3 py-1.5 outline-none focus:ring-1 focus:ring-[#008792] focus:border-[#008792]"
            />
          </div>

          {/* Unique Checkbox */}
          <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer select-none bg-white px-2.5 py-1.5 border border-slate-200">
            <input
              type="checkbox"
              checked={uniqueOnly}
              onChange={(e) => setUniqueOnly(e.target.checked)}
              className="text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
            />
            <span>Unique callers only</span>
          </label>
        </div>

        {/* Action Row: Fetch Calls on Left & Queue Selected on Right */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60">
          <button
            onClick={handleFetchCalls}
            disabled={isLoadingLogs}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin text-[#008792]' : ''}`} />
            <span>{isLoadingLogs ? 'Querying Logs...' : 'Fetch Calls'}</span>
          </button>

          <button
            onClick={handleQueueSelected}
            disabled={isQueueing || selectedCalls.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white transition disabled:opacity-40 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {isQueueing
                ? 'Queueing to Dialer...'
                : `Queue Selected to Dialer (${selectedCalls.length})`}
            </span>
          </button>
        </div>
      </div>

      {/* Quick Filter Chips & Dropdowns */}
      <div className="bg-slate-50/80 border border-slate-200 p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Disposition Chips */}
            <button
              onClick={() => setDispositionFilter('all')}
              className={`px-2.5 py-1 text-xs font-semibold transition border ${
                dispositionFilter === 'all'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border-slate-200'
              }`}
            >
              All ({completedCalls.length})
            </button>

            {/* Targeted Not Answering & Busy Retry Filter */}
            <button
              onClick={() => setDispositionFilter('not_answering_busy')}
              className={`px-2.5 py-1 text-xs font-semibold transition border ${
                dispositionFilter === 'not_answering_busy'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white text-amber-800 hover:bg-amber-50 border-amber-300'
              }`}
              title="Filter No Answer, Busy, Silent, or Dropped calls for re-dialing"
            >
              Not Answering / Busy ({notAnsweringCount})
            </button>

            <button
              onClick={() => setDispositionFilter('no_answer')}
              className={`px-2.5 py-1 text-xs font-semibold transition border ${
                dispositionFilter === 'no_answer'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white text-amber-700 hover:bg-amber-50 border-amber-200'
              }`}
            >
              No Answer ({dispositionCounts.no_answer || 0})
            </button>

            <button
              onClick={() => setDispositionFilter('not_interested')}
              className={`px-2.5 py-1 text-xs font-semibold transition border ${
                dispositionFilter === 'not_interested'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-white text-rose-700 hover:bg-rose-50 border-rose-200'
              }`}
            >
              Declined ({dispositionCounts.not_interested || 0})
            </button>

            <button
              onClick={() => setDispositionFilter('interested')}
              className={`px-2.5 py-1 text-xs font-semibold transition border ${
                dispositionFilter === 'interested'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-emerald-700 hover:bg-emerald-50 border-emerald-200'
              }`}
            >
              Interested ({dispositionCounts.interested || 0})
            </button>

            <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />

            {/* Toggle: Audio Recording Only */}
            <button
              onClick={() => setRecordingOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold transition border ${
                recordingOnly
                  ? 'bg-[#008792]/10 text-[#008792] border-[#008792]/30'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Volume2 className="w-3.5 h-3.5 text-[#008792]" />
              <span>Has Audio Recording</span>
            </button>

            {/* Toggle: Callback Scheduled Only */}
            <button
              onClick={() => setCallbackOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold transition border ${
                callbackOnly
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-emerald-600" />
              <span>Callback Scheduled</span>
            </button>
          </div>

          {/* Active Filter Clear Action */}
          {activeFiltersCount > 0 && (
            <button
              onClick={resetAllFilters}
              className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-white border border-rose-200 px-2.5 py-1 transition"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Filters ({activeFiltersCount})</span>
            </button>
          )}
        </div>

        {/* Secondary Select Dropdowns */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/60">
          {/* Disposition Dropdown */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 text-xs">
            <span className="text-[10px] font-bold uppercase text-slate-400">Disposition</span>
            <select
              value={dispositionFilter}
              onChange={(e) => setDispositionFilter(e.target.value)}
              className="outline-none text-slate-800 bg-transparent text-xs font-medium cursor-pointer"
            >
              <option value="all">All Dispositions</option>
              <option value="not_answering_busy">Not Answering &amp; Busy (Retry Queue)</option>
              <option value="interested">Interested ({dispositionCounts.interested || 0})</option>
              <option value="not_interested">Not Interested ({dispositionCounts.not_interested || 0})</option>
              <option value="wrong_number">Wrong Number ({dispositionCounts.wrong_number || 0})</option>
              <option value="not_talking">Not Talking ({dispositionCounts.not_talking || 0})</option>
              <option value="no_answer">No Answer ({dispositionCounts.no_answer || 0})</option>
              <option value="dropped">Dropped ({dispositionCounts.dropped || 0})</option>
            </select>
          </div>

          {/* Stream Health Dropdown */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 text-xs">
            <span className="text-[10px] font-bold uppercase text-slate-400">Health</span>
            <select
              value={healthFilter}
              onChange={(e) => setHealthFilter(e.target.value)}
              className="outline-none text-slate-800 bg-transparent text-xs font-medium cursor-pointer"
            >
              <option value="all">All Stream States</option>
              <option value="success">Bidirectional OK</option>
              <option value="no_incoming_audio">No Inbound Audio</option>
              <option value="incoming_audio_exists_gemini_missing">Gemini Output Missing</option>
              <option value="gemini_audio_produced_caller_silence">Caller Silence</option>
              <option value="everything_stopped_together">Early Disconnect</option>
            </select>
          </div>

          {/* Duration select filter */}
          <div className="flex items-center gap-1 bg-white border border-slate-200 px-2.5 py-1 text-xs">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={durationFilter}
              onChange={(e) => setDurationFilter(e.target.value)}
              className="outline-none text-slate-700 bg-transparent text-xs font-medium cursor-pointer"
            >
              <option value="all">Any Duration</option>
              <option value="under15">&lt; 15s (Short)</option>
              <option value="15to30">15s - 30s</option>
              <option value="30to60">30s - 60s</option>
              <option value="over60">&gt; 1 minute</option>
            </select>
          </div>

          {/* Sort By Dropdown */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 text-xs">
            <span className="text-[10px] font-bold uppercase text-slate-400">Sort</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="outline-none text-slate-800 bg-transparent text-xs font-medium cursor-pointer"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="duration_desc">Longest Duration</option>
              <option value="turns_desc">Most Dialog Turns</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results & Selection Header */}
      <div className="flex items-center justify-between text-xs text-slate-500 font-medium px-1">
        <div className="flex items-center gap-2">
          <span>
            Showing <strong className="text-slate-800">{filteredCalls.length}</strong> of{' '}
            <strong className="text-slate-800">{completedCalls.length}</strong> calls
            {uniqueOnly && ' (unique callers)'}
          </span>
          {selectedCalls.length > 0 && (
            <span className="text-[#008792] font-semibold">
              ({selectedCalls.length} selected for dialer queue)
            </span>
          )}
        </div>
        {activeFiltersCount > 0 && (
          <span className="text-[#008792] font-semibold text-xs">
            {activeFiltersCount} active filter{activeFiltersCount > 1 ? 's' : ''} applied
          </span>
        )}
      </div>

      {/* Call Logs Table View */}
      <div className="overflow-x-auto max-h-[calc(100vh-320px)] border border-slate-200 bg-white">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px] sticky top-0 z-10 backdrop-blur-sm">
              <th className="w-10 px-3.5 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
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
            {filteredCalls.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-12 bg-slate-50/50">
                  <Phone className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-700">No calls match the selected filters</p>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                    Try clearing search terms or selecting 'All Dispositions' to view all completed telephony sessions.
                  </p>
                  {activeFiltersCount > 0 && (
                    <button
                      onClick={resetAllFilters}
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-[#008792] hover:bg-slate-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Clear All Filters</span>
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              filteredCalls.map((entry) => {
                const recEvent = (entry.events || []).find((e) => e.kind === 'recording');
                const recUrl =
                  entry.recording_url ||
                  (recEvent ? recEvent.recording_url || recEvent.params?.RecordUrl : '');
                const hangupEvent = (entry.events || []).find((e) => e.kind === 'hangup');
                const rawDuration =
                  entry.duration !== undefined && entry.duration !== null && entry.duration > 0
                    ? entry.duration
                    : hangupEvent
                    ? hangupEvent.params?.Duration || 0
                    : 0;

                const durationSec = Number(rawDuration) || 0;
                const dispConf = getDispositionConfig(entry.disposition);
                const diagConf = getDiagnosticConfig(entry.diagnostic?.classification);
                const custName = entry.customer_name || entry.contact_name || '';
                const cbTime = formatCallbackTime(entry.callback_time || '');

                const toNum =
                  entry.phone_number ||
                  (entry.events || []).find((e) => e.to || e.params?.To)?.to ||
                  (entry.events || []).find((e) => e.params?.To)?.params?.To ||
                  (entry.events || []).find((e) => e.params?.From)?.params?.From ||
                  '';

                const diag = entry.diagnostic || {};
                const am = diag.audio_metrics || entry.audio_metrics || {};
                const inBytes = am.inbound_bytes || 0;
                const outBytes = am.outbound_bytes || 0;
                const inChunks = am.inbound_chunks || 0;
                const hangupCause = diag.hangup?.cause || hangupEvent?.params?.HangupCause || '';

                const isTranscriptOpen = openTranscriptId === entry.call_uuid;
                const isTimelineOpen = openTimelineId === entry.call_uuid;
                const turnsCount = (entry.turns || []).length;
                const eventsCount = (entry.events || []).length;
                const isChecked = selectedUuids.has(entry.call_uuid);

                return (
                  <React.Fragment key={entry.call_uuid}>
                    <tr className={`hover:bg-slate-50/80 transition-colors ${isChecked ? 'bg-[#008792]/5' : isTranscriptOpen || isTimelineOpen ? 'bg-slate-50/50' : ''}`}>
                      {/* Checkbox Column */}
                      <td className="px-3.5 py-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(entry.call_uuid)}
                          className="text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                        />
                      </td>

                      {/* Recipient Column */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900">
                            {toNum || entry.call_uuid.slice(0, 12)}
                          </span>
                          {custName && (
                            <span className="text-[11px] font-semibold text-[#008792] bg-[#008792]/10 px-1.5 py-0.5 border border-[#008792]/20">
                              {custName}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          #{entry.call_uuid.slice(0, 8)}
                        </div>
                      </td>

                      {/* Disposition Column */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold border ${dispConf.bg} ${dispConf.text} ${dispConf.border}`}>
                          <span className={`w-1.5 h-1.5 ${dispConf.dot}`} />
                          {dispConf.label}
                        </span>
                      </td>

                      {/* Stream Health Column */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        {diagConf ? (
                          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${diagConf.bg} ${diagConf.text} ${diagConf.border}`}>
                            {diagConf.label}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">--</span>
                        )}
                      </td>

                      {/* Duration Column */}
                      <td className="px-3.5 py-3 whitespace-nowrap font-mono text-xs text-slate-700">
                        <span className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 px-2 py-0.5">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>{formatDuration(durationSec)}</span>
                        </span>
                      </td>

                      {/* Time & Callback Column */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <div className="text-slate-700 font-mono text-[11px]">
                          {formatTime(entry.started)}
                        </div>
                        {cbTime ? (
                          <div className="mt-1 inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 border border-emerald-200 text-[10px]">
                            <Calendar className="w-2.5 h-2.5 text-emerald-600" />
                            <span>{cbTime}</span>
                          </div>
                        ) : (
                          hangupCause && (
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                              {hangupCause}
                            </div>
                          )
                        )}
                      </td>

                      {/* Diagnostic Summary Column */}
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

                      {/* Audio Recording Column */}
                      <td className="px-3.5 py-3 whitespace-nowrap min-w-[240px]">
                        {(recUrl || (durationSec > 5 && (inBytes > 0 || outBytes > 0))) ? (
                          <div className="flex items-center gap-1.5">
                            <audio
                              controls
                              preload="none"
                              className="w-44 h-7 outline-none"
                              src={`/api/recording/${encodeURIComponent(entry.call_uuid)}`}
                            />
                            <a
                              href={`/api/recording/${encodeURIComponent(entry.call_uuid)}?download=1`}
                              download={`recording-${toNum || entry.call_uuid.slice(0, 8)}.mp3`}
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

                      {/* Investigation Actions Column */}
                      <td className="px-3.5 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => toggleTranscript(entry.call_uuid)}
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
                            onClick={() => toggleTimeline(entry.call_uuid)}
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

                    {/* Expandable Accordion Row for Transcript & Timeline */}
                    {(isTranscriptOpen || isTimelineOpen) && (() => {
                      const callUuid = entry.call_uuid;
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
                                      #{entry.call_uuid.slice(0, 8)}
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
                                        href={`/api/recording/${encodeURIComponent(entry.call_uuid)}?download=1`}
                                        download={`recording-${toNum || entry.call_uuid.slice(0, 8)}.mp3`}
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
                                        onClick={() => handleDownloadTranscriptTxt(entry.call_uuid, toNum || entry.call_uuid.slice(0, 8), currentTurns, activeLang)}
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
                                            className={`max-w-[85%] px-3 py-2 text-xs leading-relaxed ${
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
                                  {entry.events.map((ev, idx) => {
                                    const note =
                                      ev.details?.telephony_status ||
                                      ev.details?.cause ||
                                      ev.details?.error ||
                                      '';
                                    return (
                                      <div key={idx} className="relative text-xs">
                                        <span className="absolute -left-[14px] top-1.5 w-2 h-2 bg-[#008792] ring-2 ring-white" />
                                        <div className="flex items-baseline justify-between gap-2">
                                          <div className="font-semibold text-slate-800">
                                            <span>{ev.event}</span>
                                            {note && (
                                              <span className="text-[11px] font-normal text-slate-500 ml-2">
                                                ({note})
                                              </span>
                                            )}
                                          </div>
                                          <span className="font-mono text-[10px] text-slate-400 flex-shrink-0">
                                            {ev.timestamp ? ev.timestamp.slice(11, 23) : '--'}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400 text-center py-2">
                                  No milestone events recorded.
                                </p>
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
