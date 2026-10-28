import React, { useState, useMemo } from 'react';
import {
  Calendar,
  Search,
  PhoneCall,
  Download,
  Database,
  RefreshCw,
} from 'lucide-react';

// Pending missed calls list from CRM with filtering and batch queue actions
export default function PendingCallsTab({
  crmCalls = [],
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
  const [deselectedPhones, setDeselectedPhones] = useState(new Set());
  const [isQueueing, setIsQueueing] = useState(false);

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

  // Filter calls by text query
  const filteredCalls = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return sourceCalls;
    return sourceCalls.filter((c) => {
      return (
        (c.phone_number || '').toLowerCase().includes(query) ||
        (c.customer_name || '').toLowerCase().includes(query) ||
        (c.source || '').toLowerCase().includes(query)
      );
    });
  }, [sourceCalls, searchText]);

  const selectedCalls = useMemo(() => {
    return filteredCalls.filter((c) => !deselectedPhones.has(c.phone_number));
  }, [filteredCalls, deselectedPhones]);

  const allSelected =
    filteredCalls.length > 0 &&
    filteredCalls.every((c) => !deselectedPhones.has(c.phone_number));

  const toggleSelectAll = () => {
    if (allSelected) {
      setDeselectedPhones(new Set(filteredCalls.map((c) => c.phone_number)));
    } else {
      setDeselectedPhones(new Set());
    }
  };

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
    const payload = {
      leads,
      batch_name: `CRM Batch (${dateRangeStr}) - ${leads.length} calls`,
      source_filter: `CRM Missed Calls (${dateRangeStr})`,
    };

    try {
      await onQueueLeads(payload);
    } finally {
      setIsQueueing(false);
    }
  };

  const uniqueNote = uniqueOnly
    ? ` (unique callers, ${crmCalls.length} total raw leads)`
    : ` (${crmCalls.length} total raw leads)`;

  return (
    <div className="space-y-4">
      {/* Modern Filter Toolbar */}
      <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-3.5 space-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Date Picker Group */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs shadow-2xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[10px] font-bold uppercase text-slate-400">From</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="outline-none text-slate-800 bg-transparent text-xs font-medium cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs shadow-2xs">
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
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs transition"
            >
              Today
            </button>
            <button
              onClick={setDateYesterday}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs transition"
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
              placeholder="Search by phone, name, campaign source..."
              className="w-full bg-white border border-slate-200 text-slate-800 text-xs pl-8 pr-3 py-1.5 rounded-lg outline-none focus:ring-1 focus:ring-[#008792] focus:border-[#008792] shadow-2xs"
            />
          </div>

          {/* Unique Checkbox */}
          <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer select-none bg-white px-2.5 py-1.5 border border-slate-200 rounded-lg shadow-2xs">
            <input
              type="checkbox"
              checked={uniqueOnly}
              onChange={(e) => setUniqueOnly(e.target.checked)}
              className="rounded text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
            />
            <span>Unique callers only</span>
          </label>
        </div>

        {/* Action Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60">
          <button
            onClick={() => onFetchCrmCalls(startDate, endDate)}
            disabled={isLoadingCrm}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs transition disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCrm ? 'animate-spin text-[#008792]' : ''}`} />
            <span>{isLoadingCrm ? 'Querying CRM...' : 'Fetch Calls'}</span>
          </button>

          <button
            onClick={handleQueueSelected}
            disabled={isQueueing || selectedCalls.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white shadow-sm transition disabled:opacity-40 cursor-pointer"
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

      {/* Pending Calls Table with Nugget High-Contrast Styling */}
      <div className="overflow-x-auto max-h-[540px] border border-slate-200 rounded-xl bg-white shadow-sm">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px] sticky top-0 z-10 backdrop-blur-sm">
              <th className="w-10 px-3.5 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="rounded text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                />
              </th>
              <th className="px-3.5 py-3">Customer Number</th>
              <th className="px-3.5 py-3">Customer Name</th>
              <th className="px-3.5 py-3">Marketing Source</th>
              <th className="px-3.5 py-3">Missed Agent</th>
              <th className="px-3.5 py-3">Missed Time</th>
              <th className="px-3.5 py-3">Ring</th>
              <th className="px-3.5 py-3">Status</th>
              <th className="px-3.5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoadingCrm ? (
              <tr>
                <td colSpan="9" className="text-center text-slate-400 py-12">
                  <RefreshCw className="w-6 h-6 animate-spin text-[#008792] mx-auto mb-2" />
                  <span className="font-medium text-xs">Querying MongoDB CRM for inbound missed leads...</span>
                </td>
              </tr>
            ) : crmError ? (
              <tr>
                <td colSpan="9" className="text-center text-rose-600 py-8 bg-rose-50/40">
                  <span className="font-semibold text-xs">Failed to load calls from CRM: {crmError}</span>
                </td>
              </tr>
            ) : filteredCalls.length === 0 ? (
              <tr>
                <td colSpan="9" className="text-center text-slate-400 py-12">
                  <span className="text-xs font-medium">
                    {crmCalls.length === 0
                      ? "Click 'Fetch Calls' above to load pending leads from CRM."
                      : 'No calls match the current search or unique filter.'}
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
                        className="rounded text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                      />
                    </td>
                    <td className="px-3.5 py-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                      {c.phone_number}
                    </td>
                    <td className="px-3.5 py-3 font-medium text-slate-700 whitespace-nowrap">
                      {c.customer_name || '--'}
                    </td>
                    <td className="px-3.5 py-3 text-slate-600 whitespace-nowrap">
                      <span className="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px] font-medium">
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
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#008792]/10 text-[#008792] border border-[#008792]/20">
                        Pending
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => onTriggerManualDial(c.phone_number, c.customer_name || '')}
                        disabled={isDialingManual}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-[#008792]/10 hover:text-[#008792] hover:border-[#008792]/30 shadow-2xs transition disabled:opacity-40"
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
          <strong className="text-slate-800">{sourceCalls.length}</strong> pending calls{uniqueNote}
        </span>
        <div className="flex items-center gap-1.5 text-slate-400">
          <Database className="w-3.5 h-3.5" />
          <span>MongoDB CRM: <strong className="font-mono text-slate-600">realestate_db</strong></span>
        </div>
      </div>
    </div>
  );
}
