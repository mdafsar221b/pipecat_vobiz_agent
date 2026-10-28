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
} from 'lucide-react';
import {
  formatBytes,
  formatDuration,
  formatTime,
  getDispositionConfig,
  getDiagnosticConfig,
} from '../utils/formatters';

// Comprehensive filter and inspection suite for completed call history
export default function CompletedLogsTab({
  completedCalls = [],
  isLoadingLogs = false,
  onRefreshLogs,
}) {
  const [openTranscriptId, setOpenTranscriptId] = useState(null);
  const [openTimelineId, setOpenTimelineId] = useState(null);

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [dispositionFilter, setDispositionFilter] = useState('all');
  const [healthFilter, setHealthFilter] = useState('all');
  const [recordingOnly, setRecordingOnly] = useState(false);
  const [callbackOnly, setCallbackOnly] = useState(false);
  const [durationFilter, setDurationFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  const toggleTranscript = (callUuid) => {
    setOpenTranscriptId((prev) => (prev === callUuid ? null : callUuid));
  };

  const toggleTimeline = (callUuid) => {
    setOpenTimelineId((prev) => (prev === callUuid ? null : callUuid));
  };

  const resetAllFilters = () => {
    setSearchQuery('');
    setDispositionFilter('all');
    setHealthFilter('all');
    setRecordingOnly(false);
    setCallbackOnly(false);
    setDurationFilter('all');
    setSortBy('newest');
  };

  // Compute disposition counts across dataset
  const dispositionCounts = useMemo(() => {
    const counts = { all: completedCalls.length };
    for (const entry of completedCalls) {
      const d = (entry.disposition || 'completed').toLowerCase();
      counts[d] = (counts[d] || 0) + 1;
    }
    return counts;
  }, [completedCalls]);

  // Filter and sort calls
  const filteredCalls = useMemo(() => {
    let result = [...completedCalls];

    // 1. Text Search (phone, name, UUID, reason, diagnostic summary, or dialog turn text)
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

    // 2. Disposition Filter
    if (dispositionFilter !== 'all') {
      result = result.filter((entry) => {
        const disp = (entry.disposition || 'completed').toLowerCase();
        if (dispositionFilter === 'interested') return disp === 'interested';
        if (dispositionFilter === 'not_interested') return disp === 'not_interested' || disp === 'declined';
        if (dispositionFilter === 'wrong_number') return disp === 'wrong_number';
        if (dispositionFilter === 'not_talking') return disp === 'not_talking';
        if (dispositionFilter === 'no_answer') return disp === 'no_answer' || disp === 'busy';
        if (dispositionFilter === 'dropped') return disp === 'dropped';
        return disp === dispositionFilter;
      });
    }

    // 3. Health / Diagnostic Classification
    if (healthFilter !== 'all') {
      result = result.filter((entry) => {
        const cls = (entry.diagnostic?.classification || '').toLowerCase();
        return cls === healthFilter;
      });
    }

    // 4. Audio Recording Filter
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

    // 5. Callback Scheduled Filter
    if (callbackOnly) {
      result = result.filter((entry) => Boolean(entry.callback_time));
    }

    // 6. Duration Filter
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

    // 7. Sorting
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

    return result;
  }, [
    completedCalls,
    searchQuery,
    dispositionFilter,
    healthFilter,
    recordingOnly,
    callbackOnly,
    durationFilter,
    sortBy,
  ]);

  const activeFiltersCount = [
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
          onClick={onRefreshLogs}
          disabled={isLoadingLogs}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs transition self-start sm:self-auto disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin text-[#008792]' : ''}`} />
          <span>{isLoadingLogs ? 'Refreshing...' : 'Refresh History'}</span>
        </button>
      </div>

      {/* Filter Control Center */}
      <div className="bg-slate-50/80 border border-slate-200/90 rounded-xl p-3.5 space-y-3">
        {/* Row 1: Search & Primary Selects */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Universal Search Input */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search phone, contact name, UUID, or dialog text..."
              className="w-full bg-white border border-slate-200 text-slate-800 text-xs pl-8 pr-8 py-2 rounded-lg outline-none focus:ring-1 focus:ring-[#008792] focus:border-[#008792] shadow-2xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Disposition Dropdown */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs shadow-2xs">
            <span className="text-[10px] font-bold uppercase text-slate-400">Disposition</span>
            <select
              value={dispositionFilter}
              onChange={(e) => setDispositionFilter(e.target.value)}
              className="outline-none text-slate-800 bg-transparent text-xs font-medium cursor-pointer"
            >
              <option value="all">All Dispositions</option>
              <option value="interested">Interested ({dispositionCounts.interested || 0})</option>
              <option value="not_interested">Not Interested ({dispositionCounts.not_interested || 0})</option>
              <option value="wrong_number">Wrong Number ({dispositionCounts.wrong_number || 0})</option>
              <option value="not_talking">Not Talking ({dispositionCounts.not_talking || 0})</option>
              <option value="no_answer">No Answer ({dispositionCounts.no_answer || 0})</option>
              <option value="dropped">Dropped ({dispositionCounts.dropped || 0})</option>
            </select>
          </div>

          {/* Stream Health Dropdown */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs shadow-2xs">
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

          {/* Sort By Dropdown */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs shadow-2xs">
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

        {/* Row 2: Quick Filter Chips & Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60">
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Disposition Chips */}
            <button
              onClick={() => setDispositionFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                dispositionFilter === 'all'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              All ({completedCalls.length})
            </button>
            <button
              onClick={() => setDispositionFilter('interested')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                dispositionFilter === 'interested'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
              }`}
            >
              Interested ({dispositionCounts.interested || 0})
            </button>
            <button
              onClick={() => setDispositionFilter('not_interested')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                dispositionFilter === 'not_interested'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'bg-white text-rose-700 hover:bg-rose-50 border border-rose-200'
              }`}
            >
              Declined ({dispositionCounts.not_interested || 0})
            </button>
            <button
              onClick={() => setDispositionFilter('no_answer')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                dispositionFilter === 'no_answer'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-white text-amber-700 hover:bg-amber-50 border border-amber-200'
              }`}
            >
              No Answer ({dispositionCounts.no_answer || 0})
            </button>

            <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />

            {/* Toggle: Audio Recording Only */}
            <button
              onClick={() => setRecordingOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition border ${
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
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition border ${
                callbackOnly
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-emerald-600" />
              <span>Callback Scheduled</span>
            </button>

            {/* Duration select filter */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs shadow-2xs">
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
          </div>

          {/* Active Filter Clear Action */}
          {activeFiltersCount > 0 && (
            <button
              onClick={resetAllFilters}
              className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-white border border-rose-200 rounded-lg px-2.5 py-1 shadow-2xs transition"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Filters ({activeFiltersCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between mb-3 text-xs text-slate-500 font-medium px-1">
        <span>
          Showing <strong className="text-slate-800">{filteredCalls.length}</strong> of{' '}
          <strong className="text-slate-800">{completedCalls.length}</strong> calls
        </span>
        {activeFiltersCount > 0 && (
          <span className="text-[#008792] font-semibold text-xs">
            {activeFiltersCount} active filter{activeFiltersCount > 1 ? 's' : ''} applied
          </span>
        )}
      </div>

      {/* Call Logs List */}
      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
        {filteredCalls.length === 0 ? (
          <div className="text-center py-12 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
            <Phone className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-semibold text-slate-700">No calls match the selected filters</p>
            <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
              Try clearing search terms or selecting 'All Dispositions' to view all completed telephony sessions.
            </p>
            {activeFiltersCount > 0 && (
              <button
                onClick={resetAllFilters}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-[#008792] hover:bg-slate-50 shadow-2xs"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Clear All Filters</span>
              </button>
            )}
          </div>
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
            const cbTime = entry.callback_time || '';

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

            return (
              <div
                key={entry.call_uuid}
                className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-sm hover:border-slate-300 transition"
              >
                {/* Header Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2.5 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-[#008792]/10 text-[#008792] flex items-center justify-center flex-shrink-0">
                      <Phone className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-slate-900">
                          {toNum || entry.call_uuid.slice(0, 12)}
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
                    </div>
                  </div>

                  {/* Badges on right */}
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

                {/* Metadata & Telemetry Strip */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mb-2.5">
                  <div className="flex items-center gap-1 text-slate-600">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>Started: {formatTime(entry.started)}</span>
                  </div>

                  {cbTime && (
                    <div className="flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      <span>Callback: {cbTime}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-1">
                    <ArrowDownLeft className="w-3.5 h-3.5 text-[#008792]" />
                    <span>In: {formatBytes(inBytes)} ({inChunks} chunks)</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Out: {formatBytes(outBytes)}</span>
                  </div>

                  {hangupCause && (
                    <div className="text-slate-400">
                      Hangup: <span className="font-mono text-slate-600">{hangupCause}</span>
                    </div>
                  )}
                </div>

                {/* Diagnostic Root Cause Callout */}
                {diag.root_cause_summary && (
                  <div className="flex items-start gap-2 bg-slate-50 border border-slate-200/70 rounded-lg p-2.5 text-xs text-slate-700 mb-3">
                    <Info className="w-4 h-4 text-[#008792] flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-slate-900">Diagnostic Summary: </span>
                      <span>{diag.root_cause_summary}</span>
                    </div>
                  </div>
                )}

                {/* Audio Recording Player */}
                {(recUrl || (durationSec > 5 && (inBytes > 0 || outBytes > 0))) && (
                  <div className="bg-slate-50/70 border border-slate-200/80 rounded-lg p-2.5 mb-3 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 flex-shrink-0">
                      <Volume2 className="w-4 h-4 text-[#008792]" />
                      <span>Audio Recording:</span>
                    </div>
                    <audio
                      controls
                      preload="none"
                      className="w-full h-8 outline-none rounded"
                      src={`/api/recording/${encodeURIComponent(entry.call_uuid)}`}
                    />
                  </div>
                )}

                {/* Collapsible Action Toggles */}
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={() => toggleTranscript(entry.call_uuid)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#008792] hover:text-[#007680] py-1"
                  >
                    <span>Transcript ({turnsCount} turns)</span>
                    {isTranscriptOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    onClick={() => toggleTimeline(entry.call_uuid)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 py-1"
                  >
                    <Activity className="w-3.5 h-3.5 text-slate-400" />
                    <span>Lifecycle Timeline ({eventsCount} events)</span>
                    {isTimelineOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Expanded Transcript Dialog */}
                {isTranscriptOpen && (
                  <div className="mt-3 pt-3 border-t border-slate-100 bg-slate-50/60 rounded-lg p-3 space-y-2">
                    {turnsCount > 0 ? (
                      entry.turns.map((t, idx) => {
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
                              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                                isAgent
                                  ? 'bg-[#008792]/10 text-teal-950 border border-[#008792]/20 rounded-tl-none'
                                  : 'bg-white text-slate-900 border border-slate-200 rounded-tr-none shadow-2xs'
                              }`}
                            >
                              {t.text}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-xs text-slate-400 text-center py-2">
                        No dialog turns recorded (unanswered or terminated before answer).
                      </p>
                    )}
                  </div>
                )}

                {/* Expanded Lifecycle Timeline */}
                {isTimelineOpen && (
                  <div className="mt-3 pt-3 border-t border-slate-100 bg-slate-50/80 rounded-lg p-3">
                    {eventsCount > 0 ? (
                      <div className="relative pl-4 space-y-3 before:absolute before:left-1.5 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-slate-200">
                        {entry.events.map((ev, idx) => {
                          const note =
                            ev.details?.telephony_status ||
                            ev.details?.cause ||
                            ev.details?.error ||
                            '';
                          return (
                            <div key={idx} className="relative text-xs">
                              <span className="absolute -left-[14px] top-1.5 w-2 h-2 rounded-full bg-[#008792] ring-2 ring-white" />
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
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
