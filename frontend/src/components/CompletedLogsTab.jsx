import React, { useState, useMemo } from 'react';
import {
  RefreshCw,
  Calendar,
  Volume2,
  Search,
  X,
  RotateCcw,
  Download,
} from 'lucide-react';
import CallsTable from './CallsTable';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { DateRangePicker } from './ui/date-range-picker';
import { StatusFacetedFilter } from './ui/faceted-filter';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatTime } from '../utils/formatters';

// Completed calls inspection table with date filtering, server-side pagination and batch re-queueing
export default function CompletedLogsTab({
  completedCalls = [],
  pagination = { total: 0, page: 1, limit: 50, pages: 1 },
  isLoadingLogs = false,
  onRefreshLogs,
  onQueueLeads,
  searchText: externalSearchText = '',
}) {
  // Date Filter State
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dateRange, setDateRange] = useState(null);
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
  const [currentPage, setCurrentPage] = useState(1);

  // Trigger server fetch with current filter parameters
  const triggerFetch = (page = 1, overrideFilters = {}) => {
    setCurrentPage(page);
    if (!onRefreshLogs) return;
    onRefreshLogs({
      page,
      limit: 50,
      startDate: overrideFilters.startDate !== undefined ? overrideFilters.startDate : startDate,
      endDate: overrideFilters.endDate !== undefined ? overrideFilters.endDate : endDate,
      search: overrideFilters.search !== undefined ? overrideFilters.search : (externalSearchText || searchQuery),
      disposition: overrideFilters.disposition !== undefined ? overrideFilters.disposition : dispositionFilter,
      recordingOnly: overrideFilters.recordingOnly !== undefined ? overrideFilters.recordingOnly : recordingOnly,
      callbackOnly: overrideFilters.callbackOnly !== undefined ? overrideFilters.callbackOnly : callbackOnly,
    });
  };

  // Lead Selection State for Batch Creation
  const [selectedUuids, setSelectedUuids] = useState(new Set());
  const [isQueueing, setIsQueueing] = useState(false);

  const handleDateRangeChange = (range) => {
    setDateRange(range);
    if (range?.from) {
      const fromStr = format(range.from, 'yyyy-MM-dd');
      setStartDate(fromStr);
      const toStr = range.to ? format(range.to, 'yyyy-MM-dd') : fromStr;
      setEndDate(toStr);
      setDateFilterActive(true);
      if (range.to) {
        triggerFetch(1, { startDate: fromStr, endDate: toStr });
        fetchGlobalStats(fromStr, toStr);
      }
    }
  };

  const handleFetchCalls = () => {
    setDateFilterActive(Boolean(startDate && endDate));
    triggerFetch(1);
    fetchGlobalStats(startDate, endDate);
  };

  const resetAllFilters = () => {
    setStartDate('');
    setEndDate('');
    setDateRange(null);
    setDateFilterActive(false);
    setSearchQuery('');
    setDispositionFilter('all');
    setHealthFilter('all');
    setRecordingOnly(false);
    setCallbackOnly(false);
    setDurationFilter('all');
    setSortBy('newest');
    setUniqueOnly(true);
    fetchGlobalStats('', '');
    triggerFetch(1, {
      startDate: '',
      endDate: '',
      search: '',
      disposition: 'all',
      recordingOnly: false,
      callbackOnly: false,
    });
  };

  // Global disposition statistics from server
  const [globalStats, setGlobalStats] = useState({ total: 0, dispositions: {} });

  const fetchGlobalStats = async (start = startDate, end = endDate) => {
    try {
      let url = '/api/calls/stats';
      const params = [];
      if (start) params.push(`start_date=${encodeURIComponent(start)}`);
      if (end) params.push(`end_date=${encodeURIComponent(end)}`);
      if (params.length) url += `?${params.join('&')}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setGlobalStats(data);
      }
    } catch (err) {
      console.error('Failed to load global call stats:', err);
    }
  };

  React.useEffect(() => {
    fetchGlobalStats();
  }, []);

  // Compute counts across full database collection
  const dispositionCounts = useMemo(() => {
    return globalStats.dispositions || {};
  }, [globalStats]);

  const notAnsweringCount = useMemo(() => {
    const d = dispositionCounts;
    return (d.no_answer || 0) + (d.busy || 0) + (d.not_talking || 0) + (d.dropped || 0);
  }, [dispositionCounts]);

  const dispositionOptions = useMemo(
    () => [
      { value: 'all', label: 'All Dispositions', count: globalStats.total || pagination.total || completedCalls.length },
      { value: 'interested', label: 'Interested', count: dispositionCounts.interested || 0 },
      { value: 'not_interested', label: 'Declined', count: (dispositionCounts.not_interested || 0) + (dispositionCounts.declined || 0) },
      { value: 'not_answering_busy', label: 'Retry (Busy / No Answer)', count: notAnsweringCount },
      { value: 'no_answer', label: 'No Answer', count: (dispositionCounts.no_answer || 0) + (dispositionCounts.busy || 0) },
      { value: 'wrong_number', label: 'Wrong Number', count: dispositionCounts.wrong_number || 0 },
      { value: 'not_talking', label: 'Not Talking', count: dispositionCounts.not_talking || 0 },
      { value: 'dropped', label: 'Dropped', count: dispositionCounts.dropped || 0 },
    ],
    [globalStats.total, pagination.total, completedCalls.length, dispositionCounts, notAnsweringCount]
  );

  // Filter and sort calls
  const filteredCalls = useMemo(() => {
    let result = [...completedCalls];

    // 1. Date Range Filter
    if (dateFilterActive && startDate && endDate) {
      result = result.filter((entry) => {
        const rawTime = entry.started || entry.created_at;
        if (!rawTime) return true;
        const callDate = new Date(rawTime).toISOString().slice(0, 10);
        return callDate >= startDate && callDate <= endDate;
      });
    }

    // 2. Text Search
    const effectiveSearch = externalSearchText || searchQuery;
    if (effectiveSearch.trim()) {
      const q = effectiveSearch.trim().toLowerCase();
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
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

  const selectAllFiltered = () => {
    setSelectedUuids(new Set(filteredCalls.map((c) => c.call_uuid)));
  };

  const deselectAll = () => {
    setSelectedUuids(new Set());
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 h-full">
      {/* Official shadcn Data Table Toolbar */}
      <div className="space-y-2 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Left: Date Range, Fetch, Faceted Filter & Quick Filters */}
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
              onClick={handleFetchCalls}
              disabled={isLoadingLogs}
              className="h-8 px-2.5 gap-1.5 text-xs font-medium"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin text-[#008792]' : ''}`} />
              <span>{isLoadingLogs ? 'Querying...' : 'Fetch'}</span>
            </Button>

            {/* Disposition Faceted Filter */}
            <StatusFacetedFilter
              title="Disposition"
              value={dispositionFilter}
              onChange={(val) => {
                setDispositionFilter(val);
                triggerFetch(1, { disposition: val });
              }}
              options={dispositionOptions}
            />

            {/* Audio Recording Toggle */}
            <Button
              size="sm"
              variant={recordingOnly ? 'secondary' : 'outline'}
              onClick={() => {
                const nextVal = !recordingOnly;
                setRecordingOnly(nextVal);
                triggerFetch(1, { recordingOnly: nextVal });
              }}
              className={cn(
                "h-8 gap-1.5 text-xs font-normal border-dashed",
                recordingOnly && "border-solid bg-accent text-accent-foreground font-medium"
              )}
            >
              <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Audio</span>
            </Button>

            {/* Callback Scheduled Toggle */}
            <Button
              size="sm"
              variant={callbackOnly ? 'secondary' : 'outline'}
              onClick={() => {
                const nextVal = !callbackOnly;
                setCallbackOnly(nextVal);
                triggerFetch(1, { callbackOnly: nextVal });
              }}
              className={cn(
                "h-8 gap-1.5 text-xs font-normal border-dashed",
                callbackOnly && "border-solid bg-accent text-accent-foreground font-medium"
              )}
            >
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Callback</span>
            </Button>

            {/* Reset Filters */}
            {(dispositionFilter !== 'all' || recordingOnly || callbackOnly || durationFilter !== 'all' || sortBy !== 'newest' || Boolean(externalSearchText || searchQuery)) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetAllFilters}
                className="h-8 px-2 text-xs font-normal"
              >
                Reset
                <X className="ml-1 w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          {/* Right: Queue Selected to Dialer */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleQueueSelected}
              disabled={isQueueing || selectedCalls.length === 0}
              className="h-8 gap-1.5 bg-[#008792] hover:bg-[#007680] text-white text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {isQueueing
                  ? 'Queueing to Dialer...'
                  : `Queue Selected to Dialer (${selectedCalls.length})`}
              </span>
            </Button>
          </div>
        </div>

        {/* Selection & Counts Sub-bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-muted-foreground border border-border/80 bg-muted/30 rounded-md shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">
              {selectedCalls.length} selected
              <span className="text-muted-foreground font-normal ml-1">
                ({filteredCalls.length} on this page · {(pagination?.total || 0).toLocaleString()} total)
              </span>
            </span>
            <Separator orientation="vertical" className="h-3.5" />
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant={allSelected ? 'secondary' : 'ghost'}
                onClick={toggleSelectAll}
                className="h-6 px-2 text-xs font-medium"
              >
                All
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={deselectAll}
                className="h-6 px-2 text-xs text-muted-foreground"
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2.5 text-xs">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={uniqueOnly}
                onChange={(e) => setUniqueOnly(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-input text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
              />
              <span>Unique callers</span>
            </label>
            <Separator orientation="vertical" className="h-3.5" />
            <select
              value={durationFilter}
              onChange={(e) => setDurationFilter(e.target.value)}
              className="h-6 rounded border border-input bg-background px-1 text-[11px] text-foreground cursor-pointer outline-none"
            >
              <option value="all">Any Duration</option>
              <option value="under15">&lt; 15s</option>
              <option value="15to30">15s - 30s</option>
              <option value="30to60">30s - 60s</option>
              <option value="over60">&gt; 60s</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="h-6 rounded border border-input bg-background px-1 text-[11px] text-foreground cursor-pointer outline-none"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="duration_desc">Longest Duration</option>
              <option value="turns_desc">Most Turns</option>
            </select>
          </div>
        </div>
      </div>

      {/* Unified Reusable Calls Table */}
      <CallsTable
        calls={filteredCalls}
        isLoading={isLoadingLogs}
        emptyTitle="No calls match the selected filters"
        emptyDescription="Try clearing search terms or selecting 'All Dispositions' to view all completed telephony sessions."
        onResetFilters={activeFiltersCount > 0 ? resetAllFilters : undefined}
        selectedUuids={selectedUuids}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onCallUpdated={() => {
          triggerFetch(currentPage);
        }}
        containerClassName="flex-1 min-h-0 overflow-auto"
      />

      {/* Pagination Footer Controls */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-2 pt-1 border-t border-border shrink-0">
        <div>
          Showing page <strong className="text-foreground">{pagination.page}</strong> of{' '}
          <strong className="text-foreground">{pagination.pages || 1}</strong> (
          <strong className="text-foreground">{pagination.total.toLocaleString()}</strong> total calls)
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant="outline"
            disabled={pagination.page <= 1 || isLoadingLogs}
            onClick={() => triggerFetch(pagination.page - 1)}
            className="h-6 px-2 text-xs"
          >
            Previous
          </Button>
          <span className="text-[11px] px-1 text-foreground font-mono">
            {pagination.page} / {pagination.pages || 1}
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={pagination.page >= pagination.pages || isLoadingLogs}
            onClick={() => triggerFetch(pagination.page + 1)}
            className="h-6 px-2 text-xs"
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
