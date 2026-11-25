import React, { useState, useMemo } from 'react';
import {
  ArrowLeft,
  Trash2,
  RefreshCw,
  Layers,
  Clock,
  Volume2,
  Activity,
  Bot,
  User,
  Search,
  X,
  RotateCcw,
  ArrowRight,
  Download,
  Phone,
  PhoneCall,
  ThumbsUp,
  FileSpreadsheet,
  Upload,
} from 'lucide-react';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from './ui/table';
import CallsTable from './CallsTable';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { Card } from './ui/card';
import {
  formatBytes,
  formatDuration,
  formatTime,
  getDispositionConfig,
  getDiagnosticConfig,
} from '../utils/formatters';
import { exportToExcel } from '../utils/excelUtils';
import ExcelImportModal from './ExcelImportModal';

// Helper to format batch launch timestamps safely
const formatLaunchTimestamp = (b) => {
  try {
    if (b?.created_at) {
      const clean = String(b.created_at).replace(' ', 'T');
      const dt = new Date(clean);
      if (!isNaN(dt.getTime())) {
        return `${dt.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
    }
    if (b?.started_at) {
      const ms = typeof b.started_at === 'number' && b.started_at < 1e11 ? b.started_at * 1000 : b.started_at;
      const dt = new Date(ms);
      if (!isNaN(dt.getTime())) {
        return `${dt.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
    }
  } catch {
    // fallback
  }
  return b?.created_at || '--';
};

// Helper to extract lead CRM date from batch
const getBatchLeadDate = (b) => {
  const text = `${b?.source_filter || ''} ${b?.name || ''}`;
  const rangeMatch = text.match(/\d{4}-\d{2}-\d{2}\s*(?:to|-)\s*\d{4}-\d{2}-\d{2}/);
  if (rangeMatch) return rangeMatch[0];
  const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (dateMatch) return dateMatch[0];
  if (b?.created_at) {
    const clean = String(b.created_at).split(' ')[0].split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  }
  return '--';
};

// Helper to identify test batches created from predefined test contacts
const isTestBatch = (b) => {
  const name = String(b?.name || '').toLowerCase();
  const source = String(b?.source_filter || '').toLowerCase();
  return (
    name.startsWith('test batch') ||
    source.includes('predefined test') ||
    source.includes('test contact')
  );
};

// Helper to clean batch title by stripping redundant counts and dates
const getCleanBatchName = (b) => {
  let name = b?.name || b?.batch_id || 'Campaign Batch';
  const isRerun = /^Re-run/i.test(name);
  name = name.replace(/\s*-\s*\d+\s*calls/gi, '');
  name = name.replace(/\(\s*\d{4}-\d{2}-\d{2}(?:\s*(?:to|-)\s*\d{4}-\d{2}-\d{2})?\s*\)/gi, '');
  if (isRerun) {
    name = name.replace(/^Re-run\s*\(/i, '').replace(/\)$/, '');
    name = `Re-run: ${name.trim()}`;
  }
  name = name.replace(/\s{2,}/g, ' ').trim();
  return name || b?.batch_id;
};

// Campaign batches history and per-batch drilldown view with interactive KPI card filters
export default function BatchesTab({
  batches = [],
  campaignData = {},
  isLoadingBatches = false,
  onRefreshBatches,
  onRefreshCampaign,
  onQueueLeads,
  templates = [],
  selectedTemplateId = 'production_callback_conversion',
}) {
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [batchDetail, setBatchDetail] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Batch Detail Filters
  const [batchKpiFilter, setBatchKpiFilter] = useState('all');
  const [batchSearchQuery, setBatchSearchQuery] = useState('');
  const [batchListSearch, setBatchListSearch] = useState('');

  // Batch Detail Selection State
  const [selectedBatchUuids, setSelectedBatchUuids] = useState(new Set());
  const [isQueueingBatchCalls, setIsQueueingBatchCalls] = useState(false);
  const [isResumingBatch, setIsResumingBatch] = useState(false);
  const [isRerunningBatch, setIsRerunningBatch] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Export summary of production campaign batches to Excel
  const handleExportBatchesExcel = () => {
    const listToExport = filteredBatches.length > 0 ? filteredBatches : productionBatches;
    if (!listToExport || listToExport.length === 0) {
      alert('No campaign batches available to export.');
      return;
    }

    const data = listToExport.map((b, idx) => {
      const m = b.metrics || {};
      const totalLeads = b.total_leads || 0;
      const dialed = m.dialed || 0;
      const interested = m.interested || 0;
      const notInterested = (m.declined || 0) + (m.not_interested || 0);
      const noAnswer = (m.no_answer || 0) + (m.busy || 0);
      const notTalking = m.not_talking || 0;
      const wrongNumber = m.wrong_number || 0;
      const dropped = m.dropped || 0;
      const dialedRate = totalLeads > 0 ? `${Math.round((dialed / totalLeads) * 100)}%` : '0%';
      const conversionRate = dialed > 0 ? `${Math.round((interested / dialed) * 100)}%` : '0%';

      return {
        'S.No': idx + 1,
        'Campaign Batch Name': getCleanBatchName(b),
        'Batch ID': b.batch_id || '',
        'Lead Date': getBatchLeadDate(b),
        'Status': (b.status || 'active').toUpperCase(),
        'Launch Date': formatLaunchTimestamp(b),
        'Total Calls': totalLeads,
        'Dialed Calls': dialed,
        'Dialed Rate': dialedRate,
        'Interested': interested,
        'Not Interested': notInterested,
        'No Answer / Busy': noAnswer,
        'Silent / Not Talking': notTalking,
        'Wrong Number': wrongNumber,
        'Dropped': dropped,
        'Conversion Rate': conversionRate,
        'Source / Filter': b.source_filter || '',
      };
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    exportToExcel(data, `Campaign_Batches_Summary_${dateStr}`, 'Campaign Batches');
  };

  // Export calls from active batch to Excel
  const handleExportBatchCallsExcel = () => {
    const calls = batchDetail?.calls || [];
    const callsToExport =
      selectedBatchUuids.size > 0 && selectedBatchUuids.size < filteredBatchCalls.length
        ? filteredBatchCalls.filter((c) => selectedBatchUuids.has(c.call_uuid))
        : filteredBatchCalls;

    if (!callsToExport || callsToExport.length === 0) {
      alert('No calls in this batch to export.');
      return;
    }

    const b = batchDetail?.batch || {};
    const data = callsToExport.map((c, idx) => {
      const disp = c.disposition || 'completed';
      const duration = c.duration || 0;
      const startTime = c.started || c.created_at || '';
      return {
        'S.No': idx + 1,
        'Phone Number': c.phone_number || (c.events || []).find((e) => e.to || e.params?.To)?.to || '',
        'Customer Name': c.customer_name || c.contact_name || 'Customer',
        'Call Status': (c.status || '').toUpperCase(),
        'AI Disposition': disp.replace(/_/g, ' ').toUpperCase(),
        'Duration (s)': Math.round(duration),
        'Call Time': startTime ? new Date(startTime).toLocaleString() : '--',
        'Diagnostic Root Cause': c.diagnostic?.root_cause_summary || '--',
        'Reason / Notes': c.reason || '--',
        'Call UUID': c.call_uuid || '',
        'Batch ID': b.batch_id || activeBatchId,
      };
    });

    const batchNameClean = (b.name || activeBatchId).replace(/[^\w-]/g, '_');
    exportToExcel(data, `Batch_${batchNameClean}_Calls`, 'Batch Calls');
  };

  // Resume the same batch directly: loads remaining pending leads into dialer without creating a new batch
  const handleResumeBatch = async (batchIdToResume) => {
    const targetId = batchIdToResume || activeBatchId;
    if (!targetId) return;

    setIsResumingBatch(true);
    try {
      const res = await fetch(`/api/campaign/batches/${encodeURIComponent(targetId)}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.ok) {
        alert(`Resumed batch! ${data.resumed} pending leads loaded and dialing resumed.`);
        onRefreshCampaign?.();
        onRefreshBatches?.();
        if (targetId) openBatchDetail(targetId);
      } else {
        alert(data.error || 'Failed to resume batch.');
      }
    } catch (err) {
      alert(`Network error while resuming batch: ${err.message}`);
    } finally {
      setIsResumingBatch(false);
    }
  };

  const handleRerunBatch = async (batchIdToRerun, batchNameToRerun) => {
    const targetId = batchIdToRerun || activeBatchId;
    if (!targetId) return;

    setIsRerunningBatch(true);
    try {
      const res = await fetch(`/api/campaign/batches/${encodeURIComponent(targetId)}/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'unreached' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          onRefreshCampaign?.();
          onRefreshBatches?.();
          if (data.batch_id) openBatchDetail(data.batch_id);
          return;
        }
      }

      // Fallback: Queue directly using existing leads endpoint if running server does not have rerun route
      let callsToQueue = batchDetail?.batch?.batch_id === targetId || batchDetail?.batch_id === targetId ? batchDetail.calls : null;
      if (!callsToQueue) {
        const detailRes = await fetch(`/api/campaign/batches/${encodeURIComponent(targetId)}`);
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          callsToQueue = detailData.calls;
        }
      }
      if (callsToQueue && callsToQueue.length > 0 && onQueueLeads) {
        // Filter for pending or unreached
        const unreached = callsToQueue.filter(
          (c) => c.status === 'pending' || !['interested', 'whatsup', 'jad'].includes((c.disposition || '').toLowerCase())
        );
        const leads = (unreached.length > 0 ? unreached : callsToQueue).map((c) => ({
          phone_number: c.phone_number,
          customer_name: c.customer_name || c.contact_name || '',
        })).filter((l) => l.phone_number);
        const displayName = batchNameToRerun || batchDetail?.batch?.name || targetId;
        const newBatchName = `${displayName} (Pending)`;
        await onQueueLeads({ leads, batch_name: newBatchName, source_filter: `Pending of ${targetId}`, start_immediately: true });
        onRefreshCampaign?.();
        onRefreshBatches?.();
        return;
      }
      throw new Error(`Server returned ${res.status} ${res.statusText}`);
    } catch (err) {
      alert(`Failed to start pending leads: ${err.message}`);
    } finally {
      setIsRerunningBatch(false);
    }
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

  const handleCallUpdated = (callUuid, updates) => {
    setBatchDetail((prev) => {
      if (!prev || !prev.calls) return prev;
      const nextCalls = prev.calls.map((c) => {
        const id = c.call_uuid || c.lead_id;
        return id === callUuid ? { ...c, ...updates } : c;
      });

      const counts = { dialed: nextCalls.length };
      for (const call of nextCalls) {
        const d = (call.disposition || '').toLowerCase();
        if (d) counts[d] = (counts[d] || 0) + 1;
      }

      return {
        ...prev,
        calls: nextCalls,
        batch: {
          ...prev.batch,
          metrics: {
            ...prev.batch?.metrics,
            ...counts,
          },
        },
      };
    });
    onRefreshBatches?.();
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
        if (batchKpiFilter === 'pending') {
          return c.status === 'pending' || disp === 'pending';
        }
        if (batchKpiFilter === 'dialed') {
          return (
            (c.status !== 'pending' && disp !== 'pending') &&
            (c.status === 'in_call' ||
              c.status === 'hung_up' ||
              (c.duration || 0) > 0 ||
              (c.events && c.events.length > 0) ||
              c.call_uuid)
          );
        }
        if (batchKpiFilter === 'interested') return disp === 'interested';
        if (batchKpiFilter === 'declined') return disp === 'not_interested' || disp === 'declined';
        if (batchKpiFilter === 'wrong') return disp === 'wrong_number';
        if (batchKpiFilter === 'silent') return disp === 'not_talking';
        if (batchKpiFilter === 'no_answer') return disp === 'no_answer' || disp === 'busy' || disp === 'na';
        if (batchKpiFilter === 'dropped') return disp === 'dropped';
        if (batchKpiFilter === 'whatsup') return disp === 'whatsup' || disp === 'whatsapp';
        if (batchKpiFilter === 'jad') return disp === 'jad';
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

  // Production campaign batches excluding test batches
  const productionBatches = useMemo(() => {
    return (batches || []).filter((b) => !isTestBatch(b));
  }, [batches]);

  // Filter batches list by search query
  const filteredBatches = useMemo(() => {
    if (!batchListSearch.trim()) return productionBatches;
    const q = batchListSearch.trim().toLowerCase();
    return productionBatches.filter(
      (b) =>
        (b.name || '').toLowerCase().includes(q) ||
        (b.batch_id || '').toLowerCase().includes(q) ||
        (b.source_filter || '').toLowerCase().includes(q) ||
        (b.status || '').toLowerCase().includes(q)
    );
  }, [productionBatches, batchListSearch]);

  // Aggregate KPIs across all production campaign batches
  const overallKpi = useMemo(() => {
    let totalBatches = productionBatches.length;
    let activeBatches = 0;
    let completedBatches = 0;
    let totalLeads = 0;
    let totalDialed = 0;
    let totalInterested = 0;

    for (const b of productionBatches) {
      if (b.status === 'completed') {
        completedBatches += 1;
      } else {
        activeBatches += 1;
      }
      totalLeads += b.total_leads || 0;
      const m = b.metrics || {};
      totalDialed += m.dialed || 0;
      totalInterested += m.interested || 0;
    }

    const dialedRate = totalLeads > 0 ? Math.round((totalDialed / totalLeads) * 100) : 0;
    const conversionRate = totalDialed > 0 ? Math.round((totalInterested / totalDialed) * 100) : 0;

    return {
      totalBatches,
      activeBatches,
      completedBatches,
      totalLeads,
      totalDialed,
      totalInterested,
      dialedRate,
      conversionRate,
    };
  }, [productionBatches]);

  // View B: Detail View
  if (activeBatchId) {
    const b = batchDetail?.batch || {};
    const calls = batchDetail?.calls || [];
    const m = b.metrics || {};
    const isCompleted = b.status === 'completed';

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
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
                {b.created_by && (
                  <span className="ml-2 pl-2 border-l border-slate-200">
                    Created by: <span className="font-medium text-slate-700">{b.created_by}</span>
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider border ${isCompleted
                ? 'bg-slate-100 text-slate-600 border-slate-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}
            >
              <span className={`w-1.5 h-1.5 ${isCompleted ? 'bg-slate-400' : 'bg-emerald-500 animate-pulse'}`} />
              {(b.status || 'ACTIVE').toUpperCase()}
            </span>
            <Button
              size="xs"
              variant="outline"
              onClick={handleExportBatchCallsExcel}
              disabled={filteredBatchCalls.length === 0}
              className="h-7 px-2 gap-1.5 text-xs font-medium border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
              title="Export calls in this batch to Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                Export Calls{selectedBatchCalls.length > 0 && selectedBatchCalls.length < filteredBatchCalls.length ? ` (${selectedBatchCalls.length})` : ''}
              </span>
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => setIsImportModalOpen(true)}
              className="h-7 px-2 gap-1.5 text-xs font-medium border-slate-200 text-[#008792] hover:bg-[#008792]/5 cursor-pointer"
              title="Import leads from Excel spreadsheet"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import Leads</span>
            </Button>
            {selectedBatchCalls.length > 0 && (
              <Button
                size="xs"
                onClick={handleQueueSelectedBatchCalls}
                disabled={isQueueingBatchCalls}
                className="h-7 gap-1.5 bg-[#008792] hover:bg-[#007680] text-white text-xs font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isQueueingBatchCalls ? 'Queueing...' : `Queue Selected (${selectedBatchCalls.length})`}</span>
              </Button>
            )}
            {/* Direct Resume Pending Leads Button: Continues current batch without creating a new one */}
            <button
              onClick={() => handleResumeBatch()}
              disabled={isResumingBatch || Math.max(0, (b.total_leads || 0) - (m.dialed || 0)) === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50 cursor-pointer shadow-sm"
              title="Resume calling the remaining pending leads inside this exact same batch"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isResumingBatch ? 'animate-spin' : ''}`} />
              <span>
                {isResumingBatch
                  ? 'Resuming...'
                  : `Resume Batch (${Math.max(0, (b.total_leads || 0) - (m.dialed || 0))} pending)`}
              </span>
            </button>
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
        {/* Interactive KPI Breakdown - shadcn Cards */}
        <div>
          <div className="flex items-center justify-between mb-2 px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground select-none">
              Interactive KPI Breakdown (Click Card to Filter)
            </span>
            {batchKpiFilter !== 'all' && (
              <Button
                variant="link"
                size="xs"
                onClick={() => setBatchKpiFilter('all')}
                className="h-auto p-0 text-[11px] font-semibold text-[#008792]"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                <span>Show All ({calls.length})</span>
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-11 gap-1.5">
            {/* Total Card */}
            <Card
              onClick={() => handleKpiCardClick('all')}
              className={cn(
                'py-1.5 px-2 text-center cursor-pointer transition-all select-none shadow-none',
                batchKpiFilter === 'all'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card border-border hover:bg-muted/50'
              )}
            >
              <span className="block text-sm font-bold font-mono leading-none mb-0.5">
                {b.total_leads || 0}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider opacity-75">Total</span>
            </Card>

            {/* Pending Card */}
            <Card
              onClick={() => handleKpiCardClick('pending')}
              className={cn(
                'py-1.5 px-2 text-center cursor-pointer transition-all select-none shadow-none',
                batchKpiFilter === 'pending'
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-card border-border hover:bg-muted/50'
              )}
            >
              <span className={cn('block text-sm font-bold font-mono leading-none mb-0.5', batchKpiFilter === 'pending' ? 'text-white' : 'text-sky-600')}>
                {Math.max(0, (b.total_leads || 0) - (m.dialed || 0))}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider opacity-75">Pending</span>
            </Card>

            {/* Dialed Card */}
            <Card
              onClick={() => handleKpiCardClick('dialed')}
              className={cn(
                'py-1.5 px-2 text-center cursor-pointer transition-all select-none shadow-none',
                batchKpiFilter === 'dialed'
                  ? 'bg-[#008792] text-white border-[#008792]'
                  : 'bg-card border-border hover:bg-muted/50'
              )}
            >
              <span className={cn('block text-sm font-bold font-mono leading-none mb-0.5', batchKpiFilter === 'dialed' ? 'text-white' : 'text-[#008792]')}>
                {m.dialed || 0}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider opacity-75">Dialed</span>
            </Card>

            {/* Interested Card */}
            <Card
              onClick={() => handleKpiCardClick('interested')}
              className={cn(
                'py-1.5 px-2 text-center cursor-pointer transition-all select-none shadow-none',
                batchKpiFilter === 'interested'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-card border-border hover:bg-muted/50'
              )}
            >
              <span className={cn('block text-sm font-bold font-mono leading-none mb-0.5', batchKpiFilter === 'interested' ? 'text-white' : 'text-emerald-600')}>
                {m.interested || 0}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider opacity-75">Interested</span>
            </Card>

            {/* WhatsApp Card */}
            <Card
              onClick={() => handleKpiCardClick('whatsup')}
              className={cn(
                'py-1.5 px-2 text-center cursor-pointer transition-all select-none shadow-none',
                batchKpiFilter === 'whatsup'
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-card border-border hover:bg-muted/50'
              )}
            >
              <span className={cn('block text-sm font-bold font-mono leading-none mb-0.5', batchKpiFilter === 'whatsup' ? 'text-white' : 'text-emerald-700')}>
                {m.whatsup || 0}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider opacity-75">WhatsApp</span>
            </Card>

            {/* JAD Card */}
            <Card
              onClick={() => handleKpiCardClick('jad')}
              className={cn(
                'py-1.5 px-2 text-center cursor-pointer transition-all select-none shadow-none',
                batchKpiFilter === 'jad'
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-card border-border hover:bg-muted/50'
              )}
            >
              <span className={cn('block text-sm font-bold font-mono leading-none mb-0.5', batchKpiFilter === 'jad' ? 'text-white' : 'text-sky-600')}>
                {m.jad || 0}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider opacity-75">JAD</span>
            </Card>

            {/* Not Interested Card */}
            <Card
              onClick={() => handleKpiCardClick('declined')}
              className={cn(
                'py-1.5 px-2 text-center cursor-pointer transition-all select-none shadow-none',
                batchKpiFilter === 'declined'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-card border-border hover:bg-muted/50'
              )}
            >
              <span className={cn('block text-sm font-bold font-mono leading-none mb-0.5', batchKpiFilter === 'declined' ? 'text-white' : 'text-rose-600')}>
                {m.not_interested || 0}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider opacity-75">Not Int.</span>
            </Card>

            {/* Wrong Card */}
            <Card
              onClick={() => handleKpiCardClick('wrong')}
              className={cn(
                'py-1.5 px-2 text-center cursor-pointer transition-all select-none shadow-none',
                batchKpiFilter === 'wrong'
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-card border-border hover:bg-muted/50'
              )}
            >
              <span className={cn('block text-sm font-bold font-mono leading-none mb-0.5', batchKpiFilter === 'wrong' ? 'text-white' : 'text-purple-600')}>
                {m.wrong_number || 0}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider opacity-75">Wrong</span>
            </Card>

            {/* Silent Card */}
            <Card
              onClick={() => handleKpiCardClick('silent')}
              className={cn(
                'py-1.5 px-2 text-center cursor-pointer transition-all select-none shadow-none',
                batchKpiFilter === 'silent'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-card border-border hover:bg-muted/50'
              )}
            >
              <span className={cn('block text-sm font-bold font-mono leading-none mb-0.5', batchKpiFilter === 'silent' ? 'text-white' : 'text-amber-600')}>
                {m.not_talking || 0}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider opacity-75">Silent</span>
            </Card>

            {/* No Answer Card */}
            <Card
              onClick={() => handleKpiCardClick('no_answer')}
              className={cn(
                'py-1.5 px-2 text-center cursor-pointer transition-all select-none shadow-none',
                batchKpiFilter === 'no_answer'
                  ? 'bg-slate-700 text-white border-slate-700'
                  : 'bg-card border-border hover:bg-muted/50'
              )}
            >
              <span className={cn('block text-sm font-bold font-mono leading-none mb-0.5', batchKpiFilter === 'no_answer' ? 'text-white' : 'text-foreground')}>
                {m.no_answer || 0}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider opacity-75">No Answer</span>
            </Card>

            {/* Dropped Card */}
            <Card
              onClick={() => handleKpiCardClick('dropped')}
              className={cn(
                'py-1.5 px-2 text-center cursor-pointer transition-all select-none shadow-none',
                batchKpiFilter === 'dropped'
                  ? 'bg-red-700 text-white border-red-700'
                  : 'bg-card border-border hover:bg-muted/50'
              )}
            >
              <span className={cn('block text-sm font-bold font-mono leading-none mb-0.5', batchKpiFilter === 'dropped' ? 'text-white' : 'text-red-600')}>
                {m.dropped || 0}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider opacity-75">Dropped</span>
            </Card>
          </div>
        </div>

        {/* Calls in this batch - Reusable CallsTable */}
        <CallsTable
          calls={filteredBatchCalls}
          isLoading={isLoadingDetail}
          emptyTitle="No calls match the selected KPI filter"
          emptyDescription={`Click 'Show All' above or click the Total card to view all ${calls.length} calls in this batch.`}
          onResetFilters={batchKpiFilter !== 'all' ? () => setBatchKpiFilter('all') : undefined}
          selectedUuids={selectedBatchUuids}
          onToggleSelect={toggleSelectBatchCall}
          onToggleSelectAll={toggleSelectAllBatchCalls}
          onCallUpdated={handleCallUpdated}
          containerClassName="max-h-[calc(100vh-220px)]"
        />

        {/* Reusable Excel Lead Import Modal */}
        <ExcelImportModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          mode="batch"
          campaignData={campaignData}
          templates={templates}
          selectedTemplateId={selectedTemplateId}
          currentBatchId={activeBatchId}
          onQueueLeads={async (payload) => {
            await onQueueLeads?.(payload);
            onRefreshBatches?.();
            onRefreshCampaign?.();
          }}
        />
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
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportBatchesExcel}
            disabled={productionBatches.length === 0}
            className="h-8 px-2.5 gap-1.5 text-xs font-medium cursor-pointer"
            title="Export all campaign batches summary to Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Export Batches</span>
          </Button>

          <Button
            size="sm"
            onClick={() => setIsImportModalOpen(true)}
            className="h-8 px-2.5 gap-1.5 text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white cursor-pointer"
            title="Import leads from Excel spreadsheet to create a new campaign batch"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Excel Batch</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={onRefreshBatches}
            disabled={isLoadingBatches}
            className="h-8 px-2.5 gap-1.5 text-xs font-medium cursor-pointer disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBatches ? 'animate-spin text-[#008792]' : ''}`} />
            <span>{isLoadingBatches ? 'Refreshing...' : 'Refresh'}</span>
          </Button>
        </div>
      </div>

      {/* High-Level Overview KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* 1. Total Batches */}
        <Card className="p-3 bg-card border-border shadow-none flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
              Campaign Batches
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold font-mono text-foreground">
                {overallKpi.totalBatches}
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">
                ({overallKpi.activeBatches} active &bull; {overallKpi.completedBatches} completed)
              </span>
            </div>
          </div>
          <div className="w-8 h-8 rounded-md bg-[#008792]/10 flex items-center justify-center shrink-0">
            <Layers className="w-4 h-4 text-[#008792]" />
          </div>
        </Card>

        {/* 2. Customers Called */}
        <Card className="p-3 bg-card border-border shadow-none flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
              Customers Called
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold font-mono text-foreground">
                {overallKpi.totalDialed.toLocaleString()}
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">
                / {overallKpi.totalLeads.toLocaleString()} leads ({overallKpi.dialedRate}%)
              </span>
            </div>
          </div>
          <div className="w-8 h-8 rounded-md bg-blue-500/10 flex items-center justify-center shrink-0">
            <PhoneCall className="w-4 h-4 text-blue-600" />
          </div>
        </Card>

        {/* 3. Interested Customers */}
        <Card className="p-3 bg-card border-border shadow-none flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
              Interested Customers
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold font-mono text-emerald-700">
                {overallKpi.totalInterested.toLocaleString()}
              </span>
              <span className="text-[11px] text-emerald-600 font-mono font-semibold">
                ({overallKpi.conversionRate}% conversion)
              </span>
            </div>
          </div>
          <div className="w-8 h-8 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0">
            <ThumbsUp className="w-4 h-4 text-emerald-600" />
          </div>
        </Card>
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
            Showing <span className="font-bold text-slate-900">{filteredBatches.length}</span> of {productionBatches.length} batches
          </div>
        </div>
      )}

      <div className="rounded-md border border-border overflow-x-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableHead className="px-2.5 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap">Campaign Batch</TableHead>
              <TableHead className="px-2.5 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap">Created By</TableHead>
              <TableHead className="px-2.5 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap">Lead Date</TableHead>
              <TableHead className="px-2.5 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap">Total Calls</TableHead>
              <TableHead className="px-2.5 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap">Dialed</TableHead>
              <TableHead className="px-2.5 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap">Status</TableHead>
              <TableHead className="px-2.5 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap">Launch Date</TableHead>
              <TableHead className="px-2.5 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap">Outcome Breakdown</TableHead>
              <TableHead className="px-2.5 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBatches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-14 bg-muted/20">
                  <Layers className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                  <p className="text-xs font-semibold text-foreground">
                    {batchListSearch ? 'No batches match your search filter' : 'No campaign batches recorded yet'}
                  </p>
                  {batchListSearch ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => setBatchListSearch('')}
                      className="mt-2 text-xs font-semibold text-[#008792]"
                    >
                      Clear Search
                    </Button>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Select leads from the CRM Pending Queue and click 'Queue Selected to Dialer' to launch a batch.
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filteredBatches.map((b) => {
                const m = b.metrics || {};
                const isCompleted = b.status === 'completed';
                const launchTimestamp = formatLaunchTimestamp(b);
                const total = b.total_leads || 0;
                const dialed = m.dialed || 0;
                const uncalledCount = Math.max(0, total - dialed);
                const pct = total > 0 ? Math.min(100, Math.round((dialed / total) * 100)) : 0;

                return (
                  <TableRow
                    key={b.batch_id}
                    onClick={() => openBatchDetail(b.batch_id)}
                    className="cursor-pointer hover:bg-muted/40 transition-colors group border-b border-border/60"
                  >
                    {/* Clean Campaign Batch Name */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap">
                      <span
                        className="font-medium text-xs text-foreground group-hover:text-[#008792] transition-colors"
                        title={`Batch ID: ${b.batch_id}`}
                      >
                        {getCleanBatchName(b)}
                      </span>
                    </TableCell>

                    {/* Created By */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap">
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border/40"
                        title={b.created_by || 'system'}
                      >
                        <User className="size-2.5 text-muted-foreground shrink-0" />
                        <span className="max-w-[120px] truncate">{b.created_by ? b.created_by.split('@')[0] : 'System'}</span>
                      </span>
                    </TableCell>

                    {/* Lead Date */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {getBatchLeadDate(b)}
                    </TableCell>

                    {/* Total Calls */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap font-mono text-xs font-semibold text-foreground">
                      {total}
                    </TableCell>

                    {/* Dialed & Percentage */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap font-mono text-xs">
                      <span className="text-foreground font-medium">{dialed}</span>
                      <span className="text-muted-foreground text-[11px] ml-1">({pct}%)</span>
                    </TableCell>

                    {/* Status */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] font-semibold px-2 py-0.5',
                          isCompleted
                            ? 'border-border bg-muted/40 text-muted-foreground'
                            : 'border-emerald-500/30 bg-emerald-50 text-emerald-700'
                        )}
                      >
                        <span className={cn('w-1.5 h-1.5 rounded-full mr-1.5 inline-block', isCompleted ? 'bg-muted-foreground' : 'bg-emerald-500 animate-pulse')} />
                        {(b.status || 'ACTIVE').toUpperCase()}
                      </Badge>
                    </TableCell>

                    {/* Launch Date */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap text-xs text-muted-foreground font-mono">
                      {launchTimestamp}
                    </TableCell>

                    {/* Outcome Breakdown - Strict Single Row */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap">
                      <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-50 text-emerald-700 border border-emerald-500/20" title="Interested">
                          Int: {m.interested || 0}
                        </span>
                        {m.whatsup > 0 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-100/60 text-emerald-800 border border-emerald-500/30" title="WhatsApp">
                            WA: {m.whatsup}
                          </span>
                        )}
                        {m.jad > 0 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-sky-50 text-sky-700 border border-sky-500/20" title="JAD">
                            JAD: {m.jad}
                          </span>
                        )}
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-rose-50 text-rose-700 border border-rose-500/20" title="Not Interested">
                          Decl: {m.not_interested || 0}
                        </span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-purple-50 text-purple-700 border border-purple-500/20" title="Wrong Number">
                          Wrong: {m.wrong_number || 0}
                        </span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-50 text-amber-700 border border-amber-500/20" title="Silent / Not Talking">
                          Silent: {m.not_talking || 0}
                        </span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 text-slate-600 border border-slate-200" title="No Answer">
                          No Ans: {m.no_answer || 0}
                        </span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-red-50 text-red-700 border border-red-500/20" title="Dropped">
                          Drop: {m.dropped || 0}
                        </span>
                      </div>
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {uncalledCount > 0 ? (
                          <Button
                            size="xs"
                            onClick={() => handleResumeBatch(b.batch_id)}
                            disabled={isResumingBatch}
                            className="h-6 gap-1 px-2 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs"
                            title={`Resume dialing remaining ${uncalledCount} pending leads in this batch`}
                          >
                            <RotateCcw className={`w-3 h-3 ${isResumingBatch ? 'animate-spin' : ''}`} />
                            <span>Resume ({uncalledCount})</span>
                          </Button>
                        ) : null}
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => openBatchDetail(b.batch_id)}
                          className="h-6 w-6 p-0 text-muted-foreground group-hover:text-[#008792] cursor-pointer"
                          title="View Call Recordings & Transcripts"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Reusable Excel Lead Import Modal */}
      <ExcelImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        mode="batch"
        campaignData={campaignData}
        templates={templates}
        selectedTemplateId={selectedTemplateId}
        onQueueLeads={async (payload) => {
          await onQueueLeads?.(payload);
          onRefreshBatches?.();
          onRefreshCampaign?.();
        }}
      />
    </div>
  );
}
