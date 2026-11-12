import React, { useState, useMemo } from 'react';
import {
  Calendar,
  Search,
  PhoneCall,
  Download,
  Database,
  RefreshCw,
  Filter,
} from 'lucide-react';

// Pending missed calls list from CRM with AI disposition tracking and dialer queue actions
export default function PendingCallsTab({
  crmCalls = [],
  completedCalls = [],
  isLoadingCrm = false,
  crmError = '',
  onFetchCrmCalls,
  onQueueLeads,
  onTriggerManualDial,
  isDialingManual = false,
}) {
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [searchText, setSearchText] = useState('');
  const [uniqueOnly, setUniqueOnly] = useState(true);
  const [aiFilter, setAiFilter] = useState('all');
  const [crmFilter, setCrmFilter] = useState('all');
  const [deselectedPhones, setDeselectedPhones] = useState(new Set());
  const [isQueueing, setIsQueueing] = useState(false);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const selectAllRef = React.useRef(null);

  // Live in-session lookup for calls completed recently
  const completedMap = useMemo(() => {
    const map = new Map();
    for (const c of completedCalls) {
      const rawNum =
        c.phone_number ||
        (c.events || []).find((e) => e.to || e.params?.To)?.to ||
        (c.events || []).find((e) => e.params?.To)?.params?.To ||
        '';
      const num10 = String(rawNum).replace(/\D/g, '').slice(-10);
      if (num10 && !map.has(num10)) {
        map.set(num10, {
          disposition: c.disposition || 'completed',
          duration: c.duration || 0,
          call_uuid: c.call_uuid,
          created_at: c.started || c.created_at,
        });
      }
    }
    return map;
  }, [completedCalls]);

  // Resolve latest AI Voice Agent disposition for a CRM record
  const getAiCallInfo = (c) => {
    const num10 = String(c.phone_number || '').replace(/\D/g, '').slice(-10);
    if (completedMap.has(num10)) {
      return completedMap.get(num10);
    }
    if (c.ai_disposition) {
      return {
        disposition: c.ai_disposition,
        duration: c.ai_duration || 0,
        call_uuid: c.ai_call_uuid,
        created_at: c.ai_call_time,
      };
    }
    return null;
  };

  // Filter calls by unique numbers
  const sourceCalls = useMemo(() => {
    if (!uniqueOnly) return crmCalls;
    const seen = new Set();
    const result = [];
    for (const c of crmCalls) {
      const num10 = String(c.phone_number || '').replace(/\D/g, '').slice(-10);
      if (num10 && !seen.has(num10)) {
        seen.add(num10);
        result.push(c);
      }
    }
    return result;
  }, [crmCalls, uniqueOnly]);

  // Tally counts across AI voice dispositions and CRM status
  const dispoCounts = useMemo(() => {
    const counts = {
      all: sourceCalls.length,
      uncalled: 0,
      called: 0,
      not_answering_busy: 0,
      interested: 0,
      not_interested: 0,
      wrong_number: 0,
      no_answer: 0,
      busy: 0,
      not_talking: 0,
      dropped: 0,
      crmPending: 0,
      crmCalled: 0,
    };
    for (const c of sourceCalls) {
      if (c.status === 'called') counts.crmCalled++;
      else counts.crmPending++;

      const info = getAiCallInfo(c);
      const d = (info?.disposition || '').toLowerCase();
      if (!d) {
        counts.uncalled++;
      } else {
        counts.called++;
        if (counts[d] !== undefined) counts[d]++;
        if (['no_answer', 'busy', 'not_talking', 'dropped'].includes(d)) {
          counts.not_answering_busy++;
        }
      }
    }
    return counts;
  }, [sourceCalls, completedMap]);

  // Filter calls by CRM status, AI disposition and search text
  const filteredCalls = useMemo(() => {
    let result = sourceCalls;

    // 0. CRM Status Filter (all, pending, called)
    if (crmFilter !== 'all') {
      result = result.filter((c) => (c.status || 'pending') === crmFilter);
    }

    // 1. AI Disposition Filter
    if (aiFilter !== 'all') {
      result = result.filter((c) => {
        const info = getAiCallInfo(c);
        const d = (info?.disposition || '').toLowerCase();
        if (aiFilter === 'uncalled') return !d;
        if (aiFilter === 'called') return Boolean(d);
        if (aiFilter === 'not_answering_busy') {
          return ['no_answer', 'busy', 'not_talking', 'dropped'].includes(d);
        }
        if (aiFilter === 'interested') return d === 'interested';
        if (aiFilter === 'not_interested') return d === 'not_interested' || d === 'declined';
        if (aiFilter === 'wrong_number') return d === 'wrong_number';
        if (aiFilter === 'no_answer') return d === 'no_answer';
        if (aiFilter === 'busy') return d === 'busy';
        if (aiFilter === 'not_talking') return d === 'not_talking';
        if (aiFilter === 'dropped') return d === 'dropped';
        return d === aiFilter;
      });
    }

    // 2. Text Search
    const query = searchText.trim().toLowerCase();
    if (query) {
      result = result.filter((c) => {
        const info = getAiCallInfo(c);
        const d = (info?.disposition || '').toLowerCase();
        return (
          (c.phone_number || '').toLowerCase().includes(query) ||
          (c.customer_name || '').toLowerCase().includes(query) ||
          (c.source || '').toLowerCase().includes(query) ||
          d.includes(query)
        );
      });
    }

    return result;
  }, [sourceCalls, aiFilter, searchText, completedMap]);

  const selectedCalls = useMemo(() => {
    return filteredCalls.filter((c) => !deselectedPhones.has(c.phone_number));
  }, [filteredCalls, deselectedPhones]);

  const allSelected =
    filteredCalls.length > 0 &&
    filteredCalls.every((c) => !deselectedPhones.has(c.phone_number));

  // Select a slice of leads by 1-based index range [fromVal, toVal]
  const selectRange = (fromVal, toVal) => {
    if (filteredCalls.length === 0) return;

    let start = parseInt(fromVal, 10);
    let end = parseInt(toVal, 10);

    if (isNaN(start) && isNaN(end)) {
      setDeselectedPhones(new Set(sourceCalls.map((c) => c.phone_number)));
      return;
    }
    if (isNaN(start) || start <= 0) start = 1;
    if (isNaN(end) || end <= 0) end = filteredCalls.length;

    if (start > end) {
      const temp = start;
      start = end;
      end = temp;
    }

    start = Math.max(1, Math.min(start, filteredCalls.length));
    end = Math.max(start, Math.min(end, filteredCalls.length));

    const sliceStart = start - 1;
    const sliceEnd = end;
    const targetCalls = filteredCalls.slice(sliceStart, sliceEnd);
    const targetPhoneSet = new Set(targetCalls.map((c) => c.phone_number));

    const nextDeselected = new Set();
    for (const c of sourceCalls) {
      if (!targetPhoneSet.has(c.phone_number)) {
        nextDeselected.add(c.phone_number);
      }
    }
    setDeselectedPhones(nextDeselected);
  };

  // Select top N leads from filtered list
  const selectTopN = (n) => {
    setRangeFrom('1');
    setRangeTo(String(n));
    selectRange(1, n);
  };

  // Toggle selection across all currently filtered leads
  const toggleSelectAll = () => {
    if (selectedCalls.length === filteredCalls.length && filteredCalls.length > 0) {
      setRangeFrom('');
      setRangeTo('');
      selectRange(0, 0);
    } else {
      setRangeFrom('1');
      setRangeTo(String(filteredCalls.length));
      selectRange(1, filteredCalls.length);
    }
  };

  // Keep indeterminate state on header checkbox
  React.useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        selectedCalls.length > 0 && selectedCalls.length < filteredCalls.length;
    }
  }, [selectedCalls.length, filteredCalls.length]);

  const togglePhone = (phone) => {
    const next = new Set(deselectedPhones);
    if (next.has(phone)) {
      next.delete(phone);
    } else {
      next.add(phone);
    }
    setDeselectedPhones(next);
  };

  const setDateToday = () => {
    const d = new Date().toISOString().slice(0, 10);
    setStartDate(d);
    setEndDate(d);
    setDeselectedPhones(new Set());
    onFetchCrmCalls(d, d);
  };

  const setDateYesterday = () => {
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    setStartDate(y);
    setEndDate(y);
    setDeselectedPhones(new Set());
    onFetchCrmCalls(y, y);
  };

  const handleQueueSelected = async () => {
    if (selectedCalls.length === 0) {
      alert('Please select at least one call to queue.');
      return;
    }

    setIsQueueing(true);
    const leads = selectedCalls.map((c) => ({
      phone_number: c.phone_number,
      customer_name: c.customer_name || '',
      source: c.source || 'CRM Missed Call',
    }));

    const dateRangeStr = startDate === endDate ? startDate : `${startDate} to ${endDate}`;
    const aiLabel = aiFilter !== 'all' ? ` [${aiFilter.toUpperCase()}]` : '';
    const payload = {
      leads,
      batch_name: `CRM Batch${aiLabel} (${dateRangeStr}) - ${leads.length} calls`,
      source_filter: `CRM Missed Calls (${dateRangeStr})${aiFilter !== 'all' ? ` - ${aiFilter}` : ''}`,
    };

    try {
      await onQueueLeads(payload);
    } finally {
      setIsQueueing(false);
    }
  };

  // Render high-contrast clean slate AI disposition badge
  const renderAiBadge = (c) => {
    const info = getAiCallInfo(c);
    if (!info || !info.disposition) {
      return (
        <span className="inline-flex items-center text-[11px] font-mono text-slate-400 select-none">
          --
        </span>
      );
    }

    const d = info.disposition.toLowerCase();
    let badgeClass = 'bg-slate-100 text-slate-700 border-slate-300';
    let label = info.disposition.replace(/_/g, ' ');

    if (d === 'interested') {
      badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-300';
      label = 'Interested';
    } else if (d === 'not_interested' || d === 'declined') {
      badgeClass = 'bg-rose-50 text-rose-700 border-rose-200';
      label = 'Not Interested';
    } else if (d === 'wrong_number') {
      badgeClass = 'bg-slate-100 text-slate-700 border-slate-300';
      label = 'Wrong Number';
    } else if (d === 'no_answer') {
      badgeClass = 'bg-orange-50 text-orange-700 border-orange-300';
      label = 'No Answer';
    } else if (d === 'busy') {
      badgeClass = 'bg-amber-50 text-amber-700 border-amber-300';
      label = 'Busy';
    } else if (d === 'not_talking') {
      badgeClass = 'bg-amber-50 text-amber-800 border-amber-200';
      label = 'Not Talking';
    } else if (d === 'dropped') {
      badgeClass = 'bg-red-50 text-red-700 border-red-200';
      label = 'Dropped';
    }

    return (
      <div className="flex flex-col items-start gap-0.5">
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border ${badgeClass}`}
        >
          <span className="w-1.5 h-1.5 bg-current shrink-0" />
          <span>{label}</span>
        </span>
        {info.duration > 0 && (
          <span className="text-[10px] font-mono text-slate-400">
            {Math.round(info.duration)}s
          </span>
        )}
      </div>
    );
  };

  const uniqueNote = uniqueOnly
    ? ` (unique callers, ${crmCalls.length} total raw leads)`
    : ` (${crmCalls.length} total raw leads)`;

  return (
    <div className="space-y-4">
      {/* Modern Filter Toolbar */}
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
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by phone, name, source, or AI disposition..."
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

        {/* Action & AI Disposition Filter Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onFetchCrmCalls(startDate, endDate)}
              disabled={isLoadingCrm}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCrm ? 'animate-spin text-[#008792]' : ''}`} />
              <span>{isLoadingCrm ? 'Querying CRM...' : 'Fetch Calls'}</span>
            </button>

            {/* AI Disposition Filter Select */}
            <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 text-xs">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] font-bold uppercase text-slate-400">AI Disposition</span>
              <select
                value={aiFilter}
                onChange={(e) => setAiFilter(e.target.value)}
                className="outline-none text-slate-800 bg-transparent text-xs font-medium cursor-pointer"
              >
                <option value="all">All Leads ({sourceCalls.length})</option>
                <option value="uncalled">Uncalled / Never Dialed ({dispoCounts.uncalled || 0})</option>
                <option value="called">Any AI Call Made ({dispoCounts.called || 0})</option>
                <option value="not_answering_busy">Not Answering &amp; Busy ({dispoCounts.not_answering_busy || 0})</option>
                <option value="interested">Interested ({dispoCounts.interested || 0})</option>
                <option value="not_interested">Not Interested ({dispoCounts.not_interested || 0})</option>
                <option value="wrong_number">Wrong Number ({dispoCounts.wrong_number || 0})</option>
                <option value="not_talking">Not Talking ({dispoCounts.not_talking || 0})</option>
                <option value="no_answer">No Answer ({dispoCounts.no_answer || 0})</option>
                <option value="busy">Busy ({dispoCounts.busy || 0})</option>
                <option value="dropped">Dropped ({dispoCounts.dropped || 0})</option>
              </select>
            </div>

            {/* Quick Filter: Uncalled */}
            <button
              onClick={() => setAiFilter(aiFilter === 'uncalled' ? 'all' : 'uncalled')}
              className={`px-2.5 py-1 text-xs font-semibold transition border ${
                aiFilter === 'uncalled'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border-slate-200'
              }`}
            >
              Uncalled ({dispoCounts.uncalled || 0})
            </button>

            {/* Quick Filter: Retry Queue */}
            <button
              onClick={() => setAiFilter(aiFilter === 'not_answering_busy' ? 'all' : 'not_answering_busy')}
              className={`px-2.5 py-1 text-xs font-semibold transition border ${
                aiFilter === 'not_answering_busy'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white text-amber-800 hover:bg-amber-50 border-amber-300'
              }`}
            >
              Retry Queue ({dispoCounts.not_answering_busy || 0})
            </button>

            {/* Quick Filter: CRM Pending Callback Only */}
            <button
              onClick={() => setCrmFilter(crmFilter === 'pending' ? 'all' : 'pending')}
              className={`px-2.5 py-1 text-xs font-semibold transition border ${
                crmFilter === 'pending'
                  ? 'bg-[#008792] text-white border-[#008792]'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200'
              }`}
            >
              CRM Pending ({dispoCounts.crmPending || 0})
            </button>

            {(aiFilter !== 'all' || crmFilter !== 'all') && (
              <button
                onClick={() => {
                  setAiFilter('all');
                  setCrmFilter('all');
                }}
                className="text-xs font-semibold text-rose-600 hover:text-rose-700 bg-white border border-rose-200 px-2.5 py-1 transition"
              >
                Reset Filter
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Selection & Custom Range Controls */}
            <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 text-xs">
              <span className="text-[10px] font-bold uppercase text-slate-400 select-none">Select:</span>
              <button
                type="button"
                onClick={() => selectTopN(20)}
                className={`px-2 py-0.5 text-xs font-semibold transition border ${
                  rangeFrom === '1' && rangeTo === '20' && selectedCalls.length === 20 && selectedCalls.length < filteredCalls.length
                    ? 'bg-[#008792] text-white border-[#008792]'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
                }`}
                title="Select top 20 leads (1 to 20)"
              >
                Top 20
              </button>
              <button
                type="button"
                onClick={() => selectTopN(50)}
                className={`px-2 py-0.5 text-xs font-semibold transition border ${
                  rangeFrom === '1' && rangeTo === '50' && selectedCalls.length === 50 && selectedCalls.length < filteredCalls.length
                    ? 'bg-[#008792] text-white border-[#008792]'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
                }`}
                title="Select top 50 leads (1 to 50)"
              >
                Top 50
              </button>
              <button
                type="button"
                onClick={() => selectTopN(filteredCalls.length)}
                className={`px-2 py-0.5 text-xs font-semibold transition border ${
                  allSelected
                    ? 'bg-[#008792] text-white border-[#008792]'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
                }`}
                title="Select all filtered leads"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => {
                  setRangeFrom('');
                  setRangeTo('');
                  selectRange(0, 0);
                }}
                className="px-2 py-0.5 text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-500 border border-slate-200 transition"
                title="Deselect all"
              >
                None
              </button>

              <span className="h-3.5 w-px bg-slate-200 mx-0.5" />

              {/* Custom Range: From X to Y */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-bold uppercase text-slate-400 select-none">From</span>
                <input
                  type="number"
                  min="1"
                  max={filteredCalls.length || 1000}
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      selectRange(rangeFrom, rangeTo);
                    }
                  }}
                  placeholder="1"
                  className="w-14 px-1.5 py-0.5 text-xs border border-slate-200 text-slate-800 text-center outline-none focus:ring-1 focus:ring-[#008792] focus:border-[#008792]"
                  title="Starting lead index (e.g. 50)"
                />
                <span className="text-[10px] font-bold uppercase text-slate-400 select-none">To</span>
                <input
                  type="number"
                  min="1"
                  max={filteredCalls.length || 1000}
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      selectRange(rangeFrom, rangeTo);
                    }
                  }}
                  placeholder={String(Math.min(50, filteredCalls.length || 50))}
                  className="w-14 px-1.5 py-0.5 text-xs border border-slate-200 text-slate-800 text-center outline-none focus:ring-1 focus:ring-[#008792] focus:border-[#008792]"
                  title="Ending lead index (e.g. 100)"
                />
                <button
                  type="button"
                  onClick={() => selectRange(rangeFrom, rangeTo)}
                  disabled={!rangeFrom && !rangeTo}
                  className="px-2 py-0.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition disabled:opacity-40"
                  title="Apply custom index range"
                >
                  Apply
                </button>
              </div>
            </div>

            <button
              onClick={handleQueueSelected}
              disabled={isQueueing || selectedCalls.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white transition disabled:opacity-40 cursor-pointer shadow-sm"
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
      </div>

      {/* Pending Calls Table with Nugget High-Contrast Styling */}
      <div className="overflow-x-auto max-h-[540px] border border-slate-200 bg-white">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px] sticky top-0 z-10 backdrop-blur-sm">
              <th className="w-10 px-3.5 py-3">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                />
              </th>
              <th className="w-8 px-2 py-3 text-slate-400 font-mono text-[10px]">#</th>
              <th className="px-3.5 py-3">Customer Number</th>
              <th className="px-3.5 py-3">Customer Name</th>
              <th className="px-3.5 py-3">Marketing Source</th>
              <th className="px-3.5 py-3">Missed Agent</th>
              <th className="px-3.5 py-3">Missed Time</th>
              <th className="px-3.5 py-3">Ring</th>
              <th className="px-3.5 py-3">CRM Status</th>
              <th className="px-3.5 py-3">AI Disposition</th>
              <th className="px-3.5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoadingCrm ? (
              <tr>
                <td colSpan="11" className="text-center text-slate-400 py-12">
                  <RefreshCw className="w-6 h-6 animate-spin text-[#008792] mx-auto mb-2" />
                  <span className="font-medium text-xs">Querying MongoDB CRM for inbound missed leads...</span>
                </td>
              </tr>
            ) : crmError ? (
              <tr>
                <td colSpan="11" className="text-center text-rose-600 py-8 bg-rose-50/40">
                  <span className="font-semibold text-xs">Failed to load calls from CRM: {crmError}</span>
                </td>
              </tr>
            ) : filteredCalls.length === 0 ? (
              <tr>
                <td colSpan="11" className="text-center text-slate-400 py-12">
                  <span className="text-xs font-medium">
                    {crmCalls.length === 0
                      ? "Click 'Fetch Calls' above to load pending leads from CRM."
                      : 'No calls match the current search or AI disposition filter.'}
                  </span>
                </td>
              </tr>
            ) : (
              filteredCalls.map((c, idx) => {
                const timeStr = c.createdAt
                  ? new Date(c.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '--';
                const isChecked = !deselectedPhones.has(c.phone_number);

                return (
                  <tr
                    key={c.id || idx}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      isChecked ? 'bg-[#008792]/5' : ''
                    }`}
                  >
                    <td className="px-3.5 py-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePhone(c.phone_number)}
                        className="text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                      />
                    </td>
                    <td className="px-2 py-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {idx + 1}
                    </td>
                    <td className="px-3.5 py-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                      {c.phone_number}
                    </td>
                    <td className="px-3.5 py-3 font-medium text-slate-700 whitespace-nowrap">
                      {c.customer_name || '--'}
                    </td>
                    <td className="px-3.5 py-3 text-slate-600 whitespace-nowrap">
                      <span className="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                        {c.source || c.campaign || '--'}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-slate-600 whitespace-nowrap">
                      {(c.missedAgents && c.missedAgents[0]) || 'Queue'}
                    </td>
                    <td className="px-3.5 py-3 font-mono text-slate-500 whitespace-nowrap">
                      {timeStr}
                    </td>
                    <td className="px-3.5 py-3 font-mono text-slate-500 whitespace-nowrap">
                      {c.duration || 0}s
                    </td>
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border ${
                          c.status === 'called'
                            ? 'bg-slate-100 text-slate-600 border-slate-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}
                      >
                        {c.status === 'called' ? 'Called' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      {renderAiBadge(c)}
                    </td>
                    <td className="px-3.5 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => onTriggerManualDial(c.phone_number, c.customer_name || '')}
                        disabled={isDialingManual}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-[#008792]/10 hover:text-[#008792] hover:border-[#008792]/30 transition disabled:opacity-40"
                      >
                        <PhoneCall className="w-3 h-3" />
                        <span>Dial</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span>
          Showing <strong className="text-slate-800">{filteredCalls.length}</strong> of{' '}
          <strong className="text-slate-800">{sourceCalls.length}</strong> leads{uniqueNote}
          {crmFilter !== 'all' && (
            <span className="text-emerald-700 font-semibold ml-1.5">
              (CRM: {crmFilter})
            </span>
          )}
          {aiFilter !== 'all' && (
            <span className="text-[#008792] font-semibold ml-1.5">
              (AI: {aiFilter.replace(/_/g, ' ')})
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5 text-slate-400">
          <Database className="w-3.5 h-3.5" />
          <span>MongoDB CRM: <strong className="font-mono text-slate-600">realestate_db</strong></span>
        </div>
      </div>
    </div>
  );
}