import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import {
  PhoneCall,
  Download,
  Database,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from './ui/table';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { DateRangePicker } from './ui/date-range-picker';
import { StatusFacetedFilter } from './ui/faceted-filter';
import { cn } from '@/lib/utils';

// Pending missed calls list from CRM with AI disposition tracking and dialer queue actions
export default function PendingCallsTab({
  crmCalls = [],
  completedCalls = [],
  templates = [],
  selectedTemplateId = 'production_callback_conversion',
  onSelectTemplate,
  isLoadingCrm = false,
  crmError = '',
  onFetchCrmCalls,
  onQueueLeads,
  onTriggerManualDial,
  isDialingManual = false,
  searchText: externalSearchText,
  setSearchText: externalSetSearchText,
}) {
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    return { from: today, to: today };
  });
  const [internalSearchText, setInternalSearchText] = useState('');
  const searchText = externalSearchText !== undefined ? externalSearchText : internalSearchText;
  const setSearchText = externalSetSearchText || setInternalSearchText;
  const [statusFilter, setStatusFilter] = useState('all');
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

  // Unique callers by default
  const sourceCalls = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const c of crmCalls) {
      const num10 = String(c.phone_number || '').replace(/\D/g, '').slice(-10);
      if (num10 && !seen.has(num10)) {
        seen.add(num10);
        result.push(c);
      } else if (!num10) {
        result.push(c);
      }
    }
    return result;
  }, [crmCalls]);

  // Tally counts across lead statuses from telephony_calls
  const dispoCounts = useMemo(() => {
    const counts = {
      total: sourceCalls.length,
      pending: 0,
      attempted: 0,
      resolved: 0,
    };
    for (const c of sourceCalls) {
      if (c.status === 'resolved' || c.status === 'called') {
        counts.resolved++;
      } else if (c.status === 'attempted') {
        counts.attempted++;
      } else {
        counts.pending++;
      }
    }
    return counts;
  }, [sourceCalls]);

  // Status options for official faceted filter
  const statusOptions = useMemo(
    () => [
      { value: 'all', label: 'All Missed Calls', count: sourceCalls.length },
      { value: 'pending', label: 'Pending', count: dispoCounts.pending },
      { value: 'attempted', label: 'Attempted', count: dispoCounts.attempted },
      { value: 'resolved', label: 'Resolved', count: dispoCounts.resolved },
    ],
    [sourceCalls.length, dispoCounts]
  );

  // Filter calls by dropdown status and search text
  const filteredCalls = useMemo(() => {
    let result = sourceCalls;

    if (statusFilter !== 'all') {
      if (statusFilter === 'pending') {
        result = result.filter((c) => (c.status || 'pending') === 'pending');
      } else if (statusFilter === 'attempted') {
        result = result.filter((c) => c.status === 'attempted');
      } else if (statusFilter === 'resolved' || statusFilter === 'called') {
        result = result.filter((c) => c.status === 'resolved' || c.status === 'called');
      }
    }

    const query = searchText.trim().toLowerCase();
    if (query) {
      result = result.filter((c) => {
        const info = getAiCallInfo(c);
        const d = (info?.disposition || '').toLowerCase();
        return (
          (c.phone_number || '').toLowerCase().includes(query) ||
          (c.customer_name || '').toLowerCase().includes(query) ||
          (c.source || '').toLowerCase().includes(query) ||
          (c.crm_disposition || '').toLowerCase().includes(query) ||
          (c.crm_callback_agent || '').toLowerCase().includes(query) ||
          d.includes(query)
        );
      });
    }

    return result;
  }, [sourceCalls, statusFilter, searchText, completedMap]);

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

  const handleDateRangeChange = (range) => {
    setDateRange(range);
    if (range?.from) {
      const fromStr = format(range.from, 'yyyy-MM-dd');
      setStartDate(fromStr);
      const toStr = range.to ? format(range.to, 'yyyy-MM-dd') : fromStr;
      setEndDate(toStr);
      setDeselectedPhones(new Set());
      if (range.to) {
        onFetchCrmCalls(fromStr, toStr);
      }
    }
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
    const statusLabel = statusFilter !== 'all' ? ` [${statusFilter.toUpperCase()}]` : '';
    const payload = {
      leads,
      batch_name: `CRM Batch${statusLabel} (${dateRangeStr}) - ${leads.length} calls`,
      source_filter: `CRM Missed Calls (${dateRangeStr})${statusFilter !== 'all' ? ` - ${statusFilter}` : ''}`,
      template_id: selectedTemplateId,
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

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 h-full">
      {/* Official shadcn Data Table Toolbar */}
      <div className="space-y-2 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Left: Date Range, Fetch & Status Dropdown */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Official shadcn Date Range Picker */}
            <DateRangePicker
              date={dateRange}
              onDateChange={handleDateRangeChange}
            />

            {/* Fetch Button */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onFetchCrmCalls(startDate, endDate)}
              disabled={isLoadingCrm}
              className="h-8 px-2.5 gap-1.5 text-xs font-medium"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCrm ? 'animate-spin text-[#008792]' : ''}`} />
              <span>{isLoadingCrm ? 'Fetching...' : 'Fetch'}</span>
            </Button>

            {/* Single Unified Status Dropdown Filter */}
            <StatusFacetedFilter
              title="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={statusOptions}
            />

            {/* Reset Filters Button */}
            {(statusFilter !== 'all' || searchText) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatusFilter('all');
                  setSearchText('');
                }}
                className="h-8 px-2 text-xs font-normal"
              >
                Reset
                <X className="ml-1 w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          {/* Right: Script & Queue Action */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground text-xs hidden sm:inline">Script:</span>
              <select
                value={selectedTemplateId}
                onChange={(e) => onSelectTemplate?.(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground outline-none cursor-pointer max-w-[180px] truncate"
              >
                {templates.map((t) => (
                  <option key={t.template_id} value={t.template_id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <Button
              size="sm"
              onClick={handleQueueSelected}
              disabled={isQueueing || selectedCalls.length === 0}
              className="h-8 gap-1.5 bg-[#008792] hover:bg-[#007680] text-white text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {isQueueing
                  ? 'Queueing...'
                  : `Queue to Dialer (${selectedCalls.length})`}
              </span>
            </Button>
          </div>
        </div>

        {/* Selection & Counts Sub-bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-muted-foreground border border-border/80 bg-muted/30 rounded-md">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">
              {selectedCalls.length} of {filteredCalls.length} selected
            </span>
            <Separator orientation="vertical" className="h-3.5" />
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant={allSelected ? 'secondary' : 'ghost'}
                onClick={() => selectTopN(filteredCalls.length)}
                className="h-6 px-2 text-xs font-medium"
              >
                All
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setRangeFrom('');
                  setRangeTo('');
                  selectRange(0, 0);
                }}
                className="h-6 px-2 text-xs text-muted-foreground"
              >
                Clear
              </Button>
            </div>

            <div className="hidden sm:flex items-center gap-1 pl-1">
              <span className="text-[11px] text-muted-foreground">Range:</span>
              <Input
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
                className="w-12 h-6 px-1 text-center text-xs bg-background"
              />
              <span className="text-[11px] text-muted-foreground">to</span>
              <Input
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
                className="w-12 h-6 px-1 text-center text-xs bg-background"
              />
              <Button
                size="xs"
                variant="outline"
                type="button"
                onClick={() => selectRange(rangeFrom, rangeTo)}
                disabled={!rangeFrom && !rangeTo}
                className="h-6 px-1.5 text-xs font-normal"
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Pending Calls Table using shadcn Table */}
      <div className="flex-1 min-h-0 overflow-auto border border-border rounded-lg bg-card shadow-xs">
        <Table>
          <TableHeader className="bg-muted/80 sticky top-0 z-10 backdrop-blur-xs">
            <TableRow className="hover:bg-transparent border-b">
              <TableHead className="w-8 px-2 py-1">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 rounded border-input text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                />
              </TableHead>
              <TableHead className="w-7 px-1.5 py-1 text-muted-foreground font-mono text-[10px]">#</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">Customer Number</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">Customer Name</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">Marketing Source</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">Missed Agent</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">Missed Time</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">Ring</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">CRM Status</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">CRM Disposition</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">AI Disposition</TableHead>
              <TableHead className="px-2.5 py-1 text-right whitespace-nowrap text-xs">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoadingCrm ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-12">
                  <RefreshCw className="w-6 h-6 animate-spin text-[#008792] mx-auto mb-2" />
                  <span className="font-medium text-xs">Querying MongoDB CRM for inbound missed leads...</span>
                </TableCell>
              </TableRow>
            ) : crmError ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-rose-600 py-8 bg-rose-50/40">
                  <span className="font-semibold text-xs">Failed to load calls from CRM: {crmError}</span>
                </TableCell>
              </TableRow>
            ) : filteredCalls.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-12">
                  <span className="text-xs font-medium">
                    {crmCalls.length === 0
                      ? "Click 'Fetch Calls' above to load pending leads from CRM."
                      : 'No calls match the current search or AI disposition filter.'}
                  </span>
                </TableCell>
              </TableRow>
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
                  <TableRow
                    key={c.id || idx}
                    className={isChecked ? 'bg-[#008792]/5' : ''}
                  >
                    <TableCell className="w-8 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePhone(c.phone_number)}
                        className="w-3.5 h-3.5 rounded border-input text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                      />
                    </TableCell>
                    <TableCell className="w-7 px-1.5 py-1.5 font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="px-2.5 py-1.5 font-mono text-xs font-semibold text-foreground whitespace-nowrap">
                      {c.phone_number}
                    </TableCell>
                    <TableCell className="px-2.5 py-1.5 font-medium text-foreground whitespace-nowrap text-xs">
                      {c.customer_name || '--'}
                    </TableCell>
                    <TableCell className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {c.source || c.campaign || '--'}
                      </span>
                    </TableCell>
                    <TableCell className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap text-xs">
                      {(c.missedAgents && c.missedAgents[0]) || 'Queue'}
                    </TableCell>
                    <TableCell className="px-2.5 py-1.5 font-mono text-muted-foreground whitespace-nowrap text-xs">
                      {timeStr}
                    </TableCell>
                    <TableCell className="px-2.5 py-1.5 font-mono text-muted-foreground whitespace-nowrap text-xs">
                      {c.duration || 0}s
                    </TableCell>
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap">
                      <span
                        className={cn(
                          "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border",
                          c.status === 'resolved' || c.status === 'called'
                            ? 'border-border bg-muted/40 text-muted-foreground'
                            : c.status === 'attempted'
                            ? 'border-amber-500/30 bg-amber-50 text-amber-700'
                            : 'border-emerald-500/30 bg-emerald-50 text-emerald-700'
                        )}
                      >
                        {c.status === 'resolved' || c.status === 'called' ? 'Resolved' : c.status === 'attempted' ? 'Attempted' : 'Pending'}
                      </span>
                    </TableCell>
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap">
                      {c.crm_disposition ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-foreground">
                            {c.crm_disposition}
                          </span>
                          {c.crm_callback_agent && (
                            <span className="text-[9px] text-muted-foreground font-mono">
                              ({c.crm_callback_agent})
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">--</span>
                      )}
                    </TableCell>
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap">
                      {renderAiBadge(c)}
                    </TableCell>
                    <TableCell className="px-2.5 py-1.5 text-right whitespace-nowrap">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onTriggerManualDial(c.phone_number, c.customer_name || '')}
                        disabled={isDialingManual}
                        className="h-6 gap-1 px-2 text-xs font-semibold text-[#008792]"
                      >
                        <PhoneCall className="w-3 h-3" />
                        <span>Dial</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>
          Showing <strong className="text-foreground">{filteredCalls.length}</strong> of{' '}
          <strong className="text-foreground">{sourceCalls.length}</strong> unique leads
          {statusFilter !== 'all' && (
            <span className="text-foreground font-semibold ml-1.5">
              (Status: {statusFilter})
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Database className="w-3.5 h-3.5" />
          <span>MongoDB CRM: <strong className="font-mono text-foreground">telephony_calls</strong></span>
        </div>
      </div>
    </div>
  );
}