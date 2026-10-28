import React, { useState, useMemo } from 'react';

// Pending missed calls list from CRM with filtering and queue actions
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

  // Filter calls by unique numbers and search text
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
      batch_name: `Batch (${dateRangeStr}) - ${leads.length} calls`,
      source_filter: `CRM Missed Calls (${dateRangeStr})`,
    };

    try {
      await onQueueLeads(payload);
    } finally {
      setIsQueueing(false);
    }
  };

  const uniqueNote = uniqueOnly
    ? ` (unique callers, ${crmCalls.length} total pending)`
    : ` (${crmCalls.length} total pending)`;

  return (
    <div>
      {/* Filter Bar */}
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <div className="flex items-center gap-1">
          <span className="text-[0.72rem] text-[#64748b] uppercase tracking-wide">From:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-white border border-[#cbd5e1] text-[#0f172a] text-[0.78rem] p-[5px_8px] rounded-[3px] outline-none focus:border-[#2563eb]"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[0.72rem] text-[#64748b] uppercase tracking-wide">To:</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-white border border-[#cbd5e1] text-[#0f172a] text-[0.78rem] p-[5px_8px] rounded-[3px] outline-none focus:border-[#2563eb]"
          />
        </div>
        <div className="flex gap-1">
          <button
            onClick={setDateToday}
            className="bg-white border border-[#cbd5e1] text-[#334155] p-[4px_8px] text-[0.72rem] font-semibold rounded-[3px] hover:bg-[#f1f5f9]"
          >
            Today
          </button>
          <button
            onClick={setDateYesterday}
            className="bg-white border border-[#cbd5e1] text-[#334155] p-[4px_8px] text-[0.72rem] font-semibold rounded-[3px] hover:bg-[#f1f5f9]"
          >
            Yesterday
          </button>
        </div>
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Filter by phone or campaign..."
          className="w-[170px] bg-white border border-[#cbd5e1] text-[#0f172a] text-[0.78rem] p-[5px_8px] rounded-[3px] outline-none focus:border-[#2563eb]"
        />
        <label className="flex items-center gap-[5px] text-[0.75rem] text-[#0f172a] cursor-pointer select-none mx-1 whitespace-nowrap">
          <input
            type="checkbox"
            checked={uniqueOnly}
            onChange={(e) => setUniqueOnly(e.target.checked)}
          />
          <span>Unique numbers only</span>
        </label>
        <button
          onClick={() => onFetchCrmCalls(startDate, endDate)}
          disabled={isLoadingCrm}
          className="p-[7px_10px] rounded-[3px] text-[0.78rem] font-semibold text-center transition bg-[#2563eb] hover:bg-[#1d4ed8] text-white disabled:opacity-40"
        >
          {isLoadingCrm ? 'Fetching...' : 'Fetch Calls'}
        </button>
        <button
          onClick={handleQueueSelected}
          disabled={isQueueing || selectedCalls.length === 0}
          className="ml-auto p-[7px_10px] rounded-[3px] text-[0.78rem] font-semibold text-center transition bg-[#059669] hover:bg-[#047857] text-white disabled:opacity-40"
        >
          {isQueueing ? 'Queueing...' : `Queue Selected to Dialer (${selectedCalls.length})`}
        </button>
      </div>

      {/* Pending Table */}
      <div className="overflow-x-auto max-h-[480px] border border-[#e2e8f0] rounded-[3px] bg-white">
        <table className="w-full border-collapse text-left text-[0.75rem]">
          <thead>
            <tr>
              <th className="w-[30px] sticky top-0 bg-[#f8fafc] text-[#64748b] font-semibold uppercase tracking-wider p-[7px_10px] border-b border-[#e2e8f0] whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="sticky top-0 bg-[#f8fafc] text-[#64748b] font-semibold uppercase tracking-wider p-[7px_10px] border-b border-[#e2e8f0] whitespace-nowrap">
                Customer Number
              </th>
              <th className="sticky top-0 bg-[#f8fafc] text-[#64748b] font-semibold uppercase tracking-wider p-[7px_10px] border-b border-[#e2e8f0] whitespace-nowrap">
                Customer Name
              </th>
              <th className="sticky top-0 bg-[#f8fafc] text-[#64748b] font-semibold uppercase tracking-wider p-[7px_10px] border-b border-[#e2e8f0] whitespace-nowrap">
                Marketing Source
              </th>
              <th className="sticky top-0 bg-[#f8fafc] text-[#64748b] font-semibold uppercase tracking-wider p-[7px_10px] border-b border-[#e2e8f0] whitespace-nowrap">
                Missed Agent
              </th>
              <th className="sticky top-0 bg-[#f8fafc] text-[#64748b] font-semibold uppercase tracking-wider p-[7px_10px] border-b border-[#e2e8f0] whitespace-nowrap">
                Missed Time
              </th>
              <th className="sticky top-0 bg-[#f8fafc] text-[#64748b] font-semibold uppercase tracking-wider p-[7px_10px] border-b border-[#e2e8f0] whitespace-nowrap">
                Ring
              </th>
              <th className="sticky top-0 bg-[#f8fafc] text-[#64748b] font-semibold uppercase tracking-wider p-[7px_10px] border-b border-[#e2e8f0] whitespace-nowrap">
                Status
              </th>
              <th className="sticky top-0 bg-[#f8fafc] text-[#64748b] font-semibold uppercase tracking-wider p-[7px_10px] border-b border-[#e2e8f0] whitespace-nowrap">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoadingCrm ? (
              <tr>
                <td colSpan="9" className="text-center text-[#64748b] p-5">
                  Fetching pending calls from CRM...
                </td>
              </tr>
            ) : crmError ? (
              <tr>
                <td colSpan="9" className="text-center text-[#f87171] p-5">
                  Failed to fetch calls. Check real MongoDB connection.
                </td>
              </tr>
            ) : filteredCalls.length === 0 ? (
              <tr>
                <td colSpan="9" className="text-center text-[#64748b] p-6">
                  {crmCalls.length === 0
                    ? "Click 'Fetch Calls' to load pending missed calls from CRM..."
                    : "No pending calls found for this filter."}
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
                  <tr key={c.id || idx} className="hover:bg-[#f8fafc]">
                    <td className="p-[7px_10px] border-b border-[#f1f5f9] whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePhone(c.phone_number)}
                      />
                    </td>
                    <td className="p-[7px_10px] border-b border-[#f1f5f9] font-mono font-semibold whitespace-nowrap text-[#0f172a]">
                      {c.phone_number}
                    </td>
                    <td className="p-[7px_10px] border-b border-[#f1f5f9] whitespace-nowrap text-[#0f172a]">
                      {c.customer_name || '--'}
                    </td>
                    <td className="p-[7px_10px] border-b border-[#f1f5f9] whitespace-nowrap text-[#0f172a]">
                      {c.source || c.campaign || '--'}
                    </td>
                    <td className="p-[7px_10px] border-b border-[#f1f5f9] whitespace-nowrap text-[#0f172a]">
                      {(c.missedAgents && c.missedAgents[0]) || 'Queue'}
                    </td>
                    <td className="p-[7px_10px] border-b border-[#f1f5f9] font-mono text-[#64748b] whitespace-nowrap">
                      {timeStr}
                    </td>
                    <td className="p-[7px_10px] border-b border-[#f1f5f9] font-mono whitespace-nowrap text-[#0f172a]">
                      {c.duration || 0}s
                    </td>
                    <td className="p-[7px_10px] border-b border-[#f1f5f9] whitespace-nowrap">
                      <span className="text-[0.68rem] px-[6px] py-[2px] rounded-[2px] font-mono font-medium bg-[rgba(37,99,235,0.08)] border border-[#3b82f6] text-[#1d4ed8]">
                        Pending
                      </span>
                    </td>
                    <td className="p-[7px_10px] border-b border-[#f1f5f9] whitespace-nowrap">
                      <button
                        onClick={() => onTriggerManualDial(c.phone_number, c.customer_name || '')}
                        disabled={isDialingManual}
                        className="p-[2px_6px] text-[0.7rem] font-semibold rounded-[3px] bg-white border border-[#cbd5e1] text-[#334155] hover:bg-[#f1f5f9] disabled:opacity-40"
                      >
                        Dial
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mt-2 text-[0.72rem] text-[#64748b]">
        <span>
          Showing {filteredCalls.length} of {sourceCalls.length} pending calls{uniqueNote}
        </span>
        <span>Real CRM: realestate_db</span>
      </div>
    </div>
  );
}
