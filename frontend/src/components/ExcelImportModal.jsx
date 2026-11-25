import React, { useState, useRef, useMemo } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import {
  parseExcelFile,
  normalizeLeadRows,
  downloadSampleExcelTemplate,
} from '../utils/excelUtils';

/**
 * Reusable Excel Lead Import Modal for CRM Missed Calls and Campaign Batches.
 *
 * @param {boolean} isOpen
 * @param {Function} onClose
 * @param {'crm'|'batch'} mode - 'crm' or 'batch'
 * @param {Array} templates - Available AI voice templates
 * @param {string} selectedTemplateId - Default template id
 * @param {Function} onImportToCrm - Callback when leads are added to CRM list: (leads) => void
 * @param {Function} onQueueLeads - Callback when leads are queued as a campaign batch: (payload) => Promise<void>
 * @param {string} _currentBatchId - Optional, if inside batch detail
 */
export default function ExcelImportModal({
  isOpen,
  onClose,
  mode = 'crm', // 'crm' | 'batch'
  campaignData = {},
  templates = [],
  selectedTemplateId = 'production_callback_conversion',
  onImportToCrm,
  onQueueLeads,
  _currentBatchId = null,
}) {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [parsedData, setParsedData] = useState(null); // { headers, rows, mapping }
  const [mapping, setMapping] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states
  const [importAction, setImportAction] = useState(mode === 'crm' ? 'add_to_list' : 'queue_batch');
  const [batchName, setBatchName] = useState('');
  const [templateId, setTemplateId] = useState(selectedTemplateId);

  // Disposition filter & Slicing states
  const [selectedDispositions, setSelectedDispositions] = useState([]);
  const [dispSearch, setDispSearch] = useState('');
  const [excludeCalled, setExcludeCalled] = useState(true);
  const [dialedNumbersSet, setDialedNumbersSet] = useState(new Set());
  const [isLoadingDialed, setIsLoadingDialed] = useState(false);
  const [sliceMode, setSliceMode] = useState('range'); // 'range' | 'count' | 'all'
  const [sliceCount, setSliceCount] = useState(150);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(150);
  const [runImmediately, setRunImmediately] = useState(false);

  // Check if a queue is currently running or has pending calls
  const isDialerRunning = Boolean(campaignData?.is_running);
  const pendingCount = campaignData?.pending_count || campaignData?.counts?.pending || 0;
  const hasRunningQueue = isDialerRunning || pendingCount > 0;
  const [queueStrategy, setQueueStrategy] = useState('append'); // 'append' | 'replace'

  // Fetch dialed numbers when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setIsLoadingDialed(true);
      fetch('/api/campaign/dialed-numbers')
        .then((res) => res.json())
        .then((data) => {
          if (data && data.numbers) {
            setDialedNumbersSet(new Set(data.numbers));
          }
        })
        .catch((err) => {
          console.warn('Could not load dialed numbers for deduplication:', err);
        })
        .finally(() => {
          setIsLoadingDialed(false);
        });
    }
  }, [isOpen]);

  // Reset when dialog opens/closes
  const handleOpenChange = (open) => {
    if (!open) {
      handleReset();
      onClose?.();
    }
  };

  const handleReset = () => {
    setFile(null);
    setParseError('');
    setParsedData(null);
    setMapping({});
    setIsSubmitting(false);
    setBatchName('');
    setSelectedDispositions([]);
    setDispSearch('');
    setSliceMode('range');
    setSliceCount(150);
    setRangeStart(1);
    setRangeEnd(150);
    setRunImmediately(false);
    setQueueStrategy('append');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Process selected file
  const handleFileChange = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    await processFile(selectedFile);
  };

  const processFile = async (selectedFile) => {
    setIsParsing(true);
    setParseError('');
    try {
      const data = await parseExcelFile(selectedFile);
      setFile(selectedFile);
      setParsedData(data);
      setMapping(data.mapping);

      // Prepopulate default batch name
      const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setBatchName(`${mode === 'batch' ? 'Campaign Batch' : 'Excel CRM'}: ${baseName} (${timeStr})`);
    } catch (err) {
      setParseError(err.message || 'Failed to parse Excel file.');
      setFile(null);
      setParsedData(null);
    } finally {
      setIsParsing(false);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      await processFile(droppedFile);
    }
  };

  // Normalized validation results based on current column mapping
  const normalized = useMemo(() => {
    if (!parsedData?.rows) return { validLeads: [], invalidLeads: [], totalCount: 0 };
    return normalizeLeadRows(parsedData.rows, mapping);
  }, [parsedData, mapping]);

  // Extract distinct dispositions from mapped disposition column
  const availableDispositions = useMemo(() => {
    if (!parsedData?.rows || !mapping.notes) return [];
    const counts = {};
    for (const row of parsedData.rows) {
      const val = String(row[mapping.notes] || '').trim();
      if (val) {
        counts[val] = (counts[val] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [parsedData, mapping.notes]);

  // Apply disposition filtering, duplicate exclusion, and slicing
  const filteredLeads = useMemo(() => {
    let list = [...normalized.validLeads];

    // Exclude leads already dialed or in campaign batches
    if (excludeCalled && dialedNumbersSet.size > 0) {
      list = list.filter((l) => {
        const digits = String(l.phone_number || '').replace(/\D/g, '').slice(-10);
        return !dialedNumbersSet.has(digits);
      });
    }

    // Filter by selected dispositions (if any selected)
    if (selectedDispositions.length > 0) {
      const selSet = new Set(selectedDispositions);
      list = list.filter((l) => {
        const rawDisp = String(l.rawRow?.[mapping.notes] || l.crm_disposition || '').trim();
        return selSet.has(rawDisp);
      });
    }

    // Apply slice or range
    if (sliceMode === 'count' && sliceCount > 0) {
      list = list.slice(0, Number(sliceCount));
    } else if (sliceMode === 'range') {
      const start = Math.max(0, Number(rangeStart) - 1);
      const end = Math.max(start, Number(rangeEnd));
      list = list.slice(start, end);
    }

    return list;
  }, [normalized.validLeads, selectedDispositions, sliceMode, sliceCount, rangeStart, rangeEnd, mapping.notes]);

  // Toggle single disposition filter
  const toggleDisposition = (disp) => {
    setSelectedDispositions((prev) =>
      prev.includes(disp) ? prev.filter((d) => d !== disp) : [...prev, disp]
    );
  };

  // Toggle select all dispositions
  const toggleSelectAllDispositions = () => {
    if (selectedDispositions.length === availableDispositions.length) {
      setSelectedDispositions([]);
    } else {
      setSelectedDispositions(availableDispositions.map((d) => d.name));
    }
  };

  // Filtered available dispositions for search
  const visibleDispositions = useMemo(() => {
    if (!dispSearch.trim()) return availableDispositions;
    const q = dispSearch.trim().toLowerCase();
    return availableDispositions.filter((d) => d.name.toLowerCase().includes(q));
  }, [availableDispositions, dispSearch]);

  // Handle Mapping Field Change
  const updateMapping = (field, colName) => {
    setMapping((prev) => ({
      ...prev,
      [field]: colName,
    }));
  };

  // Execute Import
  const handleConfirmImport = async (shouldStartImmediately = false) => {
    if (!filteredLeads.length) {
      alert('No matching valid leads found with current filters and slice range.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'crm' && importAction === 'add_to_list') {
        // Add directly to current CRM list
        const crmRecords = filteredLeads.map((l) => ({
          phone_number: l.phone_number,
          customer_name: l.customer_name,
          source: l.source || `Excel: ${file?.name || 'Import'}`,
          status: l.status || 'pending',
          crm_disposition: l.crm_disposition || 'Imported lead',
          call_time: l.call_time || new Date().toISOString(),
          is_imported: true,
        }));

        onImportToCrm?.(crmRecords);
        alert(`Successfully imported ${crmRecords.length} leads into CRM Missed Calls list!`);
        handleOpenChange(false);
      } else {
        // Queue as Campaign Batch to Outbound Dialer
        const leads = filteredLeads.map((l) => ({
          phone_number: l.phone_number,
          customer_name: l.customer_name,
          source: l.source || `Excel: ${file?.name || 'Batch'}`,
        }));

        const finalBatchName =
          batchName.trim() ||
          `Excel Batch (${file?.name || 'Upload'}) - ${leads.length} calls`;

        if (!onQueueLeads) {
          throw new Error('Queue leads handler not available.');
        }

        const shouldAppend = hasRunningQueue && queueStrategy === 'append';

        await onQueueLeads({
          leads,
          batch_name: finalBatchName,
          source_filter: `Excel Import: ${file?.name || 'Upload'}${selectedDispositions.length ? ` (${selectedDispositions.join(', ')})` : ''}`,
          template_id: templateId,
          append: shouldAppend,
          start_immediately: Boolean(shouldStartImmediately),
        });

        handleOpenChange(false);
      }
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const previewRows = normalized.validLeads.slice(0, 5);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-5 overflow-hidden">
        <DialogHeader className="space-y-1 pb-2 border-b border-border/70">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-foreground">
                  {mode === 'crm' ? 'Import Leads from Excel' : 'Create Campaign Batch from Excel'}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Upload an Excel (.xlsx, .xls) or CSV spreadsheet to parse and map contacts.
                </DialogDescription>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => downloadSampleExcelTemplate('leads')}
              className="text-xs h-7 gap-1.5 border-dashed border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              title="Download pre-formatted sample Excel file"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Sample Template</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {/* Step 1: Upload Dropzone if no file selected */}
          {!parsedData ? (
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border hover:border-[#008792] bg-muted/20 hover:bg-muted/40 transition-colors rounded-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer min-h-[200px]"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-12 h-12 rounded-full bg-[#008792]/10 flex items-center justify-center mb-3">
                <Upload className="w-6 h-6 text-[#008792]" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">
                Click to browse or drag & drop spreadsheet
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Supports Excel (.xlsx, .xls) and CSV files with phone numbers & names
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                  .xlsx
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                  .xls
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                  .csv
                </span>
              </div>

              {isParsing && (
                <div className="mt-4 flex items-center gap-2 text-xs text-[#008792]">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Parsing spreadsheet...</span>
                </div>
              )}

              {parseError && (
                <div className="mt-4 p-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-md flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* File details bar */}
              <div className="flex items-center justify-between p-2.5 bg-muted/40 border border-border rounded-lg text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-semibold text-foreground truncate max-w-[280px]">
                    {file?.name}
                  </span>
                  <span className="text-muted-foreground font-mono">
                    ({(file?.size ? file.size / 1024 : 0).toFixed(1)} KB)
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={handleReset}
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  <span>Change File</span>
                </Button>
              </div>

              {/* Parsing Metrics Banner */}
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2 border border-border rounded-md bg-card">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block">Total Rows</span>
                  <span className="text-base font-bold font-mono text-foreground">
                    {normalized.totalCount}
                  </span>
                </div>
                <div className="p-2 border border-emerald-200 rounded-md bg-emerald-50/60 text-emerald-800">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 block">Valid Leads</span>
                  <span className="text-base font-bold font-mono text-emerald-700">
                    {normalized.validLeads.length}
                  </span>
                </div>
                <div className="p-2 border border-sky-200 rounded-md bg-sky-50/60 text-sky-800">
                  <span className="text-[10px] uppercase font-bold text-sky-700 block">Previously Called</span>
                  <span className="text-base font-bold font-mono text-sky-700">
                    {normalized.validLeads.filter((l) => dialedNumbersSet.has(String(l.phone_number || '').replace(/\D/g, '').slice(-10))).length}
                  </span>
                </div>
                <div className="p-2 border border-border rounded-md bg-card">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block">Skipped / Invalid</span>
                  <span className={`text-base font-bold font-mono ${normalized.invalidLeads.length > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                    {normalized.invalidLeads.length}
                  </span>
                </div>
              </div>

              {/* Column Mapping Section */}
              <div className="p-3 bg-muted/20 border border-border rounded-lg space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">
                    Column Mapping
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Ensure the phone number column matches your file
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {/* Phone Column (Required) */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-foreground flex items-center gap-1">
                      <span>Phone Number Column</span>
                      <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={mapping.phone || ''}
                      onChange={(e) => updateMapping('phone', e.target.value)}
                      className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 font-medium"
                    >
                      <option value="">-- Select Column --</option>
                      {parsedData.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Customer Name Column */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-foreground">
                      Customer Name Column
                    </label>
                    <select
                      value={mapping.name || ''}
                      onChange={(e) => updateMapping('name', e.target.value)}
                      className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 font-medium"
                    >
                      <option value="">-- Optional / None --</option>
                      {parsedData.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Source Column */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-foreground">
                      Source / Channel Column
                    </label>
                    <select
                      value={mapping.source || ''}
                      onChange={(e) => updateMapping('source', e.target.value)}
                      className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 font-medium"
                    >
                      <option value="">-- Optional / None --</option>
                      {parsedData.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Notes / Reason Column */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-foreground">
                      Notes / Reason Column
                    </label>
                    <select
                      value={mapping.notes || ''}
                      onChange={(e) => updateMapping('notes', e.target.value)}
                      className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 font-medium"
                    >
                      <option value="">-- Optional / None --</option>
                      {parsedData.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Disposition Filter & Lead Slicing Section */}
              <div className="p-3 bg-muted/20 border border-border rounded-lg space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-foreground block">
                      Lead Filters & Batch Sizing
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Filter by disposition or select slice range
                    </span>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs text-[#008792] border-[#008792]/30 bg-[#008792]/5">
                    {filteredLeads.length} leads selected
                  </Badge>
                </div>

                {/* Exclusion Toggle for Previously Called Contacts */}
                <div className="flex items-center justify-between p-2.5 bg-background border border-border rounded-md text-xs">
                  <div className="space-y-0.5">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <span>Exclude Contacts Already Called / In Batches</span>
                      {isLoadingDialed && (
                        <RefreshCw className="w-3 h-3 text-[#008792] animate-spin" />
                      )}
                    </span>
                    <span className="text-[11px] text-muted-foreground block">
                      Cross-checks against all {dialedNumbersSet.size} previous calls in the database to prevent duplicate dialing.
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={excludeCalled}
                      onChange={(e) => setExcludeCalled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#008792]" />
                  </label>
                </div>

                {/* Disposition Checkboxes */}
                {availableDispositions.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-foreground">
                          Disposition Filters ({availableDispositions.length})
                        </span>
                        {selectedDispositions.length > 0 && (
                          <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-[#008792]/10 text-[#008792]">
                            {selectedDispositions.length} selected
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="text"
                          placeholder="Search disposition..."
                          value={dispSearch}
                          onChange={(e) => setDispSearch(e.target.value)}
                          className="h-5 w-32 px-1.5 text-[10px] rounded border border-input bg-background outline-none"
                        />
                        <button
                          type="button"
                          onClick={toggleSelectAllDispositions}
                          className="text-[11px] font-medium text-[#008792] hover:underline cursor-pointer"
                        >
                          {selectedDispositions.length === availableDispositions.length ? 'Clear All' : 'Select All'}
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1.5 bg-background border border-border rounded-md">
                      {visibleDispositions.map((d) => {
                        const isSelected = selectedDispositions.includes(d.name);
                        return (
                          <button
                            type="button"
                            key={d.name}
                            onClick={() => toggleDisposition(d.name)}
                            className={cn(
                              'px-2 py-0.5 rounded text-[11px] font-medium border transition-colors flex items-center gap-1 select-none cursor-pointer',
                              isSelected
                                ? 'bg-[#008792] text-white border-[#008792]'
                                : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted/70'
                            )}
                          >
                            <span>{d.name}</span>
                            <span className={cn('text-[10px] font-mono opacity-80', isSelected ? 'text-white' : 'text-muted-foreground')}>
                              ({d.count})
                            </span>
                          </button>
                        );
                      })}
                      {visibleDispositions.length === 0 && (
                        <span className="text-[11px] text-muted-foreground p-1">No matching dispositions found.</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Lead Slicing / Count Selector */}
                <div className="space-y-2 pt-1 border-t border-border/60">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-foreground block">
                      Lead Range & Slicing
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Select custom range (e.g. 151 to 300) or take by count
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label
                      onClick={() => setSliceMode('range')}
                      className={cn(
                        'p-2 rounded border cursor-pointer flex items-center gap-1.5 text-xs transition',
                        sliceMode === 'range'
                          ? 'border-[#008792] bg-[#008792]/5 font-semibold text-foreground'
                          : 'border-border bg-card text-muted-foreground'
                      )}
                    >
                      <input
                        type="radio"
                        name="sliceMode"
                        checked={sliceMode === 'range'}
                        onChange={() => setSliceMode('range')}
                      />
                      <span>From - To Range</span>
                    </label>

                    <label
                      onClick={() => setSliceMode('count')}
                      className={cn(
                        'p-2 rounded border cursor-pointer flex items-center gap-1.5 text-xs transition',
                        sliceMode === 'count'
                          ? 'border-[#008792] bg-[#008792]/5 font-semibold text-foreground'
                          : 'border-border bg-card text-muted-foreground'
                      )}
                    >
                      <input
                        type="radio"
                        name="sliceMode"
                        checked={sliceMode === 'count'}
                        onChange={() => setSliceMode('count')}
                      />
                      <span>First N Leads</span>
                    </label>

                    <label
                      onClick={() => setSliceMode('all')}
                      className={cn(
                        'p-2 rounded border cursor-pointer flex items-center gap-1.5 text-xs transition',
                        sliceMode === 'all'
                          ? 'border-[#008792] bg-[#008792]/5 font-semibold text-foreground'
                          : 'border-border bg-card text-muted-foreground'
                      )}
                    >
                      <input
                        type="radio"
                        name="sliceMode"
                        checked={sliceMode === 'all'}
                        onChange={() => setSliceMode('all')}
                      />
                      <span>All Matching ({normalized.validLeads.length})</span>
                    </label>
                  </div>

                  {/* Slicing Controls */}
                  {sliceMode === 'range' && (
                    <div className="space-y-2 p-2 bg-background border border-border rounded-md">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-[11px] font-semibold text-foreground">From lead #</span>
                        <input
                          type="number"
                          min="1"
                          value={rangeStart}
                          onChange={(e) => setRangeStart(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-20 h-7 px-2 text-xs font-mono border border-input rounded bg-background font-semibold"
                        />
                        <span className="text-[11px] font-semibold text-foreground">to lead #</span>
                        <input
                          type="number"
                          min={rangeStart}
                          value={rangeEnd}
                          onChange={(e) => setRangeEnd(Math.max(rangeStart, parseInt(e.target.value) || rangeStart))}
                          className="w-20 h-7 px-2 text-xs font-mono border border-input rounded bg-background font-semibold"
                        />
                        <span className="text-[11px] font-mono text-[#008792] font-semibold">
                          = {Math.max(0, Number(rangeEnd) - Number(rangeStart) + 1)} leads in this batch
                        </span>
                      </div>

                      {/* Quick Next Presets */}
                      <div className="flex items-center gap-1.5 pt-1 border-t border-border/50 text-[11px]">
                        <span className="text-muted-foreground">Quick jumps:</span>
                        {[
                          { label: '1 - 150', start: 1, end: 150 },
                          { label: '151 - 300', start: 151, end: 300 },
                          { label: '301 - 450', start: 301, end: 450 },
                          { label: '451 - 600', start: 451, end: 600 },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => {
                              setRangeStart(preset.start);
                              setRangeEnd(preset.end);
                            }}
                            className={cn(
                              'px-2 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition',
                              rangeStart === preset.start && rangeEnd === preset.end
                                ? 'bg-[#008792] text-white border-[#008792]'
                                : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted/70'
                            )}
                          >
                            {preset.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            const curSpan = Math.max(1, rangeEnd - rangeStart + 1);
                            setRangeStart(rangeEnd + 1);
                            setRangeEnd(rangeEnd + curSpan);
                          }}
                          className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#008792]/10 text-[#008792] border border-[#008792]/30 hover:bg-[#008792]/20 cursor-pointer"
                        >
                          + Next {Math.max(1, rangeEnd - rangeStart + 1)}
                        </button>
                      </div>
                    </div>
                  )}

                  {sliceMode === 'count' && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[11px] text-muted-foreground">Take first:</span>
                      {[25, 50, 100, 150, 200].map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          size="xs"
                          variant={sliceCount === preset ? 'default' : 'outline'}
                          onClick={() => setSliceCount(preset)}
                          className={cn('h-6 px-2 text-xs', sliceCount === preset && 'bg-[#008792] text-white')}
                        >
                          {preset}
                        </Button>
                      ))}
                      <input
                        type="number"
                        min="1"
                        value={sliceCount}
                        onChange={(e) => setSliceCount(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-20 h-6 px-2 text-xs font-mono border border-input rounded bg-background"
                      />
                      <span className="text-[11px] text-muted-foreground">leads</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Data Preview Table */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
                  Preview (First {previewRows.length} Rows)
                </span>
                <div className="border border-border rounded-md overflow-x-auto text-xs bg-card">
                  <table className="w-full text-left">
                    <thead className="bg-muted/50 border-b border-border text-[11px] text-muted-foreground font-semibold">
                      <tr>
                        <th className="px-2.5 py-1.5">#</th>
                        <th className="px-2.5 py-1.5">Phone Number</th>
                        <th className="px-2.5 py-1.5">Customer Name</th>
                        <th className="px-2.5 py-1.5">Source</th>
                        <th className="px-2.5 py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {previewRows.map((r, i) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="px-2.5 py-1.5 font-mono text-muted-foreground text-[11px]">{r._rowIndex}</td>
                          <td className="px-2.5 py-1.5 font-mono font-semibold text-foreground">{r.phone_number}</td>
                          <td className="px-2.5 py-1.5 text-foreground">{r.customer_name}</td>
                          <td className="px-2.5 py-1.5 text-muted-foreground truncate max-w-[150px]">{r.source}</td>
                          <td className="px-2.5 py-1.5">
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Valid</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                      {previewRows.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-2.5 py-4 text-center text-muted-foreground">
                            No valid records detected. Please select the correct Phone Number column above.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mode-specific Action Settings */}
              {mode === 'crm' && (
                <div className="p-3 bg-muted/20 border border-border rounded-lg space-y-2">
                  <span className="text-xs font-bold text-foreground block">
                    Choose Import Destination
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <label
                      onClick={() => setImportAction('add_to_list')}
                      className={`p-2.5 rounded-md border cursor-pointer flex items-start gap-2 transition ${
                        importAction === 'add_to_list'
                          ? 'bg-[#008792]/5 border-[#008792] text-foreground'
                          : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                      }`}
                    >
                      <input
                        type="radio"
                        name="crmImportAction"
                        checked={importAction === 'add_to_list'}
                        onChange={() => setImportAction('add_to_list')}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="font-bold block text-foreground">Add to Missed Calls List</span>
                        <span className="text-[11px] text-muted-foreground block">
                          Review, filter, and manually trigger or batch dial later
                        </span>
                      </div>
                    </label>

                    <label
                      onClick={() => setImportAction('queue_batch')}
                      className={`p-2.5 rounded-md border cursor-pointer flex items-start gap-2 transition ${
                        importAction === 'queue_batch'
                          ? 'bg-[#008792]/5 border-[#008792] text-foreground'
                          : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                      }`}
                    >
                      <input
                        type="radio"
                        name="crmImportAction"
                        checked={importAction === 'queue_batch'}
                        onChange={() => setImportAction('queue_batch')}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="font-bold block text-foreground">Queue Directly as Batch</span>
                        <span className="text-[11px] text-muted-foreground block">
                          Create an outbound dialing batch immediately
                        </span>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* If Queueing to Dialer (in either mode) */}
              {(mode === 'batch' || importAction === 'queue_batch') && (
                <div className="space-y-3 p-3 bg-muted/20 border border-border rounded-lg text-xs">
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-foreground">
                      Campaign Batch Name
                    </label>
                    <input
                      type="text"
                      value={batchName}
                      onChange={(e) => setBatchName(e.target.value)}
                      placeholder="e.g. Weekend Villa Buyers Batch"
                      className="w-full h-8 text-xs rounded-md border border-input bg-background px-2.5 font-medium outline-none"
                    />
                  </div>

                  {templates.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-foreground">
                        Voice Prompt Script / Template
                      </label>
                      <select
                        value={templateId}
                        onChange={(e) => setTemplateId(e.target.value)}
                        className="w-full h-8 text-xs rounded-md border border-input bg-background px-2.5 font-medium cursor-pointer"
                      >
                        {templates.map((t) => (
                          <option key={t.template_id} value={t.template_id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Active Queue Strategy: Append vs Replace */}
                  {hasRunningQueue && (
                    <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-md space-y-2 mt-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>
                          {isDialerRunning ? 'Dialer Is Currently Dialing' : 'Active Queue Has Pending Leads'} ({pendingCount} pending)
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        How would you like to handle the current running queue?
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <label
                          onClick={() => setQueueStrategy('append')}
                          className={`p-2 rounded-md border cursor-pointer flex items-start gap-2 transition ${
                            queueStrategy === 'append'
                              ? 'bg-emerald-500/10 border-emerald-600 text-foreground'
                              : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                          }`}
                        >
                          <input
                            type="radio"
                            name="queueStrategy"
                            checked={queueStrategy === 'append'}
                            onChange={() => setQueueStrategy('append')}
                            className="mt-0.5"
                          />
                          <div>
                            <span className="font-bold block text-foreground">Append to Running Queue</span>
                            <span className="text-[10px] text-muted-foreground block">
                              Safe: Keeps all {pendingCount} current pending calls. Adds new leads to the end. Zero interruption.
                            </span>
                          </div>
                        </label>

                        <label
                          onClick={() => setQueueStrategy('replace')}
                          className={`p-2 rounded-md border cursor-pointer flex items-start gap-2 transition ${
                            queueStrategy === 'replace'
                              ? 'bg-rose-500/10 border-rose-600 text-foreground'
                              : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                          }`}
                        >
                          <input
                            type="radio"
                            name="queueStrategy"
                            checked={queueStrategy === 'replace'}
                            onChange={() => setQueueStrategy('replace')}
                            className="mt-0.5"
                          />
                          <div>
                            <span className="font-bold block text-foreground">Replace Queue (Fresh Batch)</span>
                            <span className="text-[10px] text-rose-600 block">
                              Warning: Clears the {pendingCount} pending leads from current batch and starts fresh.
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-wrap items-center justify-between gap-2 pt-3 border-t border-border/70">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
            className="text-xs h-8 cursor-pointer"
          >
            Cancel
          </Button>

          {parsedData && (
            <div className="flex items-center gap-2">
              {/* Option 1: Save batch only without redirecting to dialer */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleConfirmImport(false)}
                disabled={isSubmitting || filteredLeads.length === 0}
                className="text-xs h-8 gap-1.5 border-[#008792] text-[#008792] hover:bg-[#008792]/10 font-semibold cursor-pointer"
                title="Save batch to Campaign Batches without redirecting to live dialer"
              >
                {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Save Batch ({filteredLeads.length})</span>
              </Button>

              {/* Option 2: Queue and run immediately */}
              <Button
                type="button"
                size="sm"
                onClick={() => handleConfirmImport(true)}
                disabled={isSubmitting || filteredLeads.length === 0}
                className="text-xs h-8 gap-1.5 bg-[#008792] hover:bg-[#007680] text-white font-semibold cursor-pointer shadow-sm"
                title="Queue leads and open Live Dialer to begin calling immediately"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <span>Queue & Start Now ({filteredLeads.length})</span>
                )}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
