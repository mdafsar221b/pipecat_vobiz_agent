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

  // Check if a queue is currently running or has pending calls
  const isDialerRunning = Boolean(campaignData?.is_running);
  const pendingCount = campaignData?.pending_count || campaignData?.counts?.pending || 0;
  const hasRunningQueue = isDialerRunning || pendingCount > 0;
  const [queueStrategy, setQueueStrategy] = useState('append'); // 'append' | 'replace'

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

  // Handle Mapping Field Change
  const updateMapping = (field, colName) => {
    setMapping((prev) => ({
      ...prev,
      [field]: colName,
    }));
  };

  // Execute Import
  const handleConfirmImport = async () => {
    if (!normalized.validLeads.length) {
      alert('No valid phone numbers found in the file with the current mapping.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'crm' && importAction === 'add_to_list') {
        // Add directly to current CRM list
        const crmRecords = normalized.validLeads.map((l) => ({
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
        const leads = normalized.validLeads.map((l) => ({
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
          source_filter: `Excel Import: ${file?.name || 'Upload'}`,
          template_id: templateId,
          append: shouldAppend,
        });

        alert(
          shouldAppend
            ? `Successfully appended ${leads.length} leads to the running queue without interruption!`
            : `Successfully queued ${leads.length} leads into campaign batch "${finalBatchName}"!`
        );
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
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
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

        <DialogFooter className="gap-2 sm:gap-0 pt-3 border-t border-border/70">
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
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmImport}
              disabled={isSubmitting || normalized.validLeads.length === 0}
              className="text-xs h-8 gap-1.5 bg-[#008792] hover:bg-[#007680] text-white font-semibold cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {mode === 'crm' && importAction === 'add_to_list'
                      ? `Add ${normalized.validLeads.length} Leads to CRM`
                      : hasRunningQueue && queueStrategy === 'append'
                      ? `Append ${normalized.validLeads.length} Leads to Queue`
                      : `Launch Batch (${normalized.validLeads.length} Calls)`}
                  </span>
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
