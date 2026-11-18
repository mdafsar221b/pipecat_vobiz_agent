import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Check,
  Save,
  RotateCcw,
  RefreshCw,
  AlertCircle,
  Plus,
  Copy,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '@/utils/auth';

// Default prompt template used when authoring a new strategy from scratch
const DEFAULT_NEW_PROMPT = `You are Ananya (అనన్య), an outbound telecalling AI assistant for Swargaseema Sandalwood & Open Plots.
Goal: Connect with customers and secure callback appointments for our prime Shadnagar and Bangalore Highway open plots.

### OPERATING RULES
1. Natural, warm, and respectful tone. Strictly 1 single concise sentence per turn. Keep call under 45-60 seconds.
2. ZERO code/function leakage: never speak parameter names or tool syntax aloud. All tools execute silently.
3. Strict Language Mirroring: If caller responds in Hindi, switch immediately 100% to natural conversational Hindi.

### CONVERSATION FLOW
1. Permission Check: Acknowledge the context and ask if speaking for 1 minute is convenient.
2. Executive Value Bridge: Mention DTCP and RERA approved open plots along prime corridors, and state our senior property executive will explain layout and pricing details.
3. Secure Appointment:
   - Clarify slot: "మీకు ఈరోజు సాయంత్రం కాల్ చేయడం సౌకర్యంగా ఉంటుందా, లేక రేపు ఉదయం బాగుంటుందా?"
   - Confirm Name: "మీ పేరు తెలుసుకోవచ్చా అండి?"
   - Confirm Callback & WhatsApp: Repeat confirmed slot, ask WhatsApp permission, say polite goodbye, and invoke end_call with disposition='interested'.

### OBJECTION HANDLING
- Busy / Call later: "పర్లేదండి, మీకు ఈరోజు సాయంత్రమా లేక రేపు ఉదయమా ఎప్పుడు కాల్ చేయమంటారు?"
- What is price: "ప్లాట్ సైజు మరియు లొకేషన్ బట్టి ధర మారుతుందండి. ఎగ్జిక్యూటివ్ ప్రస్తుత ప్రైస్ లిస్ట్ తో వివరిస్తారు. ఎప్పుడు కాల్ చేయమంటారు?"
- Send on WhatsApp: "తప్పకుండా అండి, వివరాలు పంపిస్తాము. వాటిని వివరించడానికి ఎప్పుడు మాట్లాడటం వీలవుతుంది?"
- Not interested: "పర్లేదండి, మీ సమయానికి ధన్యవాదాలు. Have a nice day." and invoke end_call with disposition='not_interested'.`;

// Campaign Scripts & System Prompts Management Component
export default function TemplatesTab({
  templates = [],
  selectedTemplateId = 'production_callback_conversion',
  onSelectTemplate,
  onRefreshTemplates,
}) {
  const [activeTplId, setActiveTplId] = useState(selectedTemplateId || 'production_callback_conversion');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newTemplateId, setNewTemplateId] = useState('');
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    target_disposition: '',
    greeting_telugu: '',
    greeting_hindi: '',
    system_prompt: '',
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  // Sync active template into form fields when not in creation mode
  useEffect(() => {
    if (isCreatingNew) return;
    if (!templates || templates.length === 0) return;

    const target = templates.find((t) => t.template_id === activeTplId) || templates[0];
    if (target) {
      setActiveTplId(target.template_id);
      setFormData({
        name: target.name || '',
        description: target.description || '',
        target_disposition: target.target_disposition || '',
        greeting_telugu: target.greeting_telugu || '',
        greeting_hindi: target.greeting_hindi || '',
        system_prompt: target.system_prompt || '',
      });
      setFeedback({ type: '', text: '' });
    }
  }, [activeTplId, templates, isCreatingNew]);

  // Generate safe slug for template ID from strategy name
  const slugify = (text) => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36);
  };

  const handleNameChange = (name) => {
    setFormData((prev) => ({ ...prev, name }));
    if (isCreatingNew && !idManuallyEdited) {
      setNewTemplateId(slugify(name));
    }
  };

  // Start fresh template creation
  const handleStartCreateNew = () => {
    setIsCreatingNew(true);
    setIdManuallyEdited(false);
    setNewTemplateId('');
    setFormData({
      name: '',
      description: '',
      target_disposition: '',
      greeting_telugu: '',
      greeting_hindi: '',
      system_prompt: DEFAULT_NEW_PROMPT,
    });
    setFeedback({ type: '', text: '' });
  };

  // Clone current template into new template creation
  const handleCloneCurrent = () => {
    const cur = templates.find((t) => t.template_id === activeTplId);
    if (!cur) return;
    setIsCreatingNew(true);
    setIdManuallyEdited(true);
    const cloneId = `${cur.template_id}_copy`.slice(0, 36);
    setNewTemplateId(cloneId);
    setFormData({
      name: `${cur.name} (Copy)`,
      description: cur.description || '',
      target_disposition: cur.target_disposition || '',
      greeting_telugu: cur.greeting_telugu || '',
      greeting_hindi: cur.greeting_hindi || '',
      system_prompt: cur.system_prompt || '',
    });
    setFeedback({
      type: 'success',
      text: `Cloned "${cur.name}". Adjust the Template ID and greetings, then click Create Strategy.`,
    });
  };

  const handleCancelCreate = () => {
    setIsCreatingNew(false);
    setFeedback({ type: '', text: '' });
  };

  // Set active script on the dialer engine
  const handleSelectActive = async (tplId) => {
    try {
      await onSelectTemplate?.(tplId);
      setFeedback({
        type: 'success',
        text: `Active script updated to "${templates.find((t) => t.template_id === tplId)?.name}". New batches and single dials will use this script.`,
      });
      setTimeout(() => setFeedback({ type: '', text: '' }), 4000);
    } catch (err) {
      setFeedback({ type: 'error', text: `Failed to set active script: ${err.message}` });
    }
  };

  // Save changes or create new template
  const handleSave = async (e) => {
    e?.preventDefault();

    const targetId = isCreatingNew ? slugify(newTemplateId.trim()) : activeTplId;
    if (!targetId) {
      setFeedback({ type: 'error', text: 'Template ID cannot be empty and must contain alphanumeric characters.' });
      return;
    }

    if (isCreatingNew && templates.some((t) => t.template_id === targetId)) {
      setFeedback({ type: 'error', text: `Template ID "${targetId}" already exists. Please choose a unique ID.` });
      return;
    }

    if (!formData.name.trim() || !formData.greeting_telugu.trim()) {
      setFeedback({ type: 'error', text: 'Strategy Name and Telugu Opening Greeting are required.' });
      return;
    }

    setIsSaving(true);
    setFeedback({ type: '', text: '' });

    const payload = {
      template_id: targetId,
      name: formData.name.trim(),
      description: formData.description.trim(),
      target_disposition: formData.target_disposition.trim(),
      greeting_telugu: formData.greeting_telugu.trim(),
      greeting_hindi: formData.greeting_hindi.trim(),
      system_prompt: formData.system_prompt.trim(),
      is_active: true,
    };

    try {
      const url = isCreatingNew ? '/api/campaign/templates' : `/api/campaign/templates/${encodeURIComponent(targetId)}`;
      const method = isCreatingNew ? 'POST' : 'PUT';

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to save template');
      }

      setFeedback({
        type: 'success',
        text: `Template "${payload.name}" successfully ${isCreatingNew ? 'created' : 'updated'} in database. Zero code changes required!`,
      });

      setIsCreatingNew(false);
      setActiveTplId(targetId);
      await onRefreshTemplates?.();
      setTimeout(() => setFeedback({ type: '', text: '' }), 5000);
    } catch (err) {
      setFeedback({ type: 'error', text: `Save error: ${err.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete a custom template
  const handleDelete = async () => {
    if (activeTplId === 'missed_calls') {
      alert('The core default missed_calls template cannot be deleted.');
      return;
    }
    const currentName = templates.find((t) => t.template_id === activeTplId)?.name || activeTplId;
    if (!window.confirm(`Are you sure you want to permanently delete the template "${currentName}"?`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const res = await apiFetch(`/api/campaign/templates/${encodeURIComponent(activeTplId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to delete template');
      }
      setFeedback({
        type: 'success',
        text: `Template "${currentName}" deleted successfully.`,
      });
      await onRefreshTemplates?.();
      setActiveTplId('missed_calls');
      setTimeout(() => setFeedback({ type: '', text: '' }), 4000);
    } catch (err) {
      setFeedback({ type: 'error', text: `Delete error: ${err.message}` });
    } finally {
      setIsDeleting(false);
    }
  };

  const currentTemplate = templates.find((t) => t.template_id === activeTplId);

  return (
    <div className="bg-white p-4 flex-1 min-h-0 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-4 border-b border-slate-200 gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              Campaign Scripts &amp; System Prompts
            </h2>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase bg-[#008792]/10 text-[#008792] border border-[#008792]/20">
              <Sparkles className="w-3 h-3" />
              Dynamic Strategy Engine
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleStartCreateNew}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Strategy</span>
          </button>

          <button
            type="button"
            onClick={onRefreshTemplates}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback.text && (
        <div
          className={`p-3 mb-4 text-xs font-semibold flex items-center gap-2 border ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* 2-Column Layout: Template Picker Sidebar + Form Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0">
        {/* Left Column: Template Cards List (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Available Script Templates ({templates.length})
            </span>
            <button
              type="button"
              onClick={handleStartCreateNew}
              className="text-[11px] font-semibold text-[#008792] hover:underline flex items-center gap-0.5 cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>Add New</span>
            </button>
          </div>

          {templates.map((tpl) => {
            const isSelected = !isCreatingNew && tpl.template_id === activeTplId;
            const isDialerActive = tpl.template_id === selectedTemplateId;

            return (
              <div
                key={tpl.template_id}
                onClick={() => {
                  setIsCreatingNew(false);
                  setActiveTplId(tpl.template_id);
                }}
                className={`p-3.5 border transition cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-white border-[#008792] shadow-sm ring-1 ring-[#008792]'
                    : 'bg-slate-50 hover:bg-white border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="font-bold text-xs text-slate-900 leading-tight">
                      {tpl.name}
                    </span>
                    {isDialerActive && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 flex-shrink-0">
                        Active Dialer
                      </span>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-[11px]">
                  <span className="font-mono text-slate-400 text-[10px]">
                    ID: {tpl.template_id}
                  </span>
                  {!isDialerActive && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectActive(tpl.template_id);
                      }}
                      className="text-[10px] font-semibold text-[#008792] hover:underline cursor-pointer"
                    >
                      Make Active
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Template Detail & Live Editor (8 cols) */}
        <div className="lg:col-span-8 bg-slate-50/60 border border-slate-200 p-4 flex flex-col">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200 gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                {isCreatingNew ? 'Create New Campaign Strategy' : (formData.name || activeTplId)}
              </h3>
            </div>

            <div className="flex items-center gap-2">
              {!isCreatingNew && (
                <>
                  <button
                    type="button"
                    onClick={handleCloneCurrent}
                    title="Duplicate this strategy into a new template"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-200 hover:bg-slate-300 text-slate-700 transition cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Clone</span>
                  </button>

                  {activeTplId !== 'missed_calls' && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isDeleting}
                      title="Permanently delete this strategy"
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
                    </button>
                  )}

                  {selectedTemplateId !== activeTplId && (
                    <button
                      type="button"
                      onClick={() => handleSelectActive(activeTplId)}
                      className="px-2.5 py-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition cursor-pointer"
                    >
                      Set as Active Script
                    </button>
                  )}
                </>
              )}

              {isCreatingNew && (
                <button
                  type="button"
                  onClick={handleCancelCreate}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-200 hover:bg-slate-300 text-slate-700 transition cursor-pointer"
                >
                  <X className="w-3 h-3" />
                  <span>Cancel</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-1 text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white transition disabled:opacity-40 cursor-pointer shadow-sm"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving...' : isCreatingNew ? 'Create Strategy' : 'Save Changes'}</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-3.5 flex-1 flex flex-col">
            {/* Slug / Template ID Input (visible during creation) */}
            {isCreatingNew && (
              <div className="bg-amber-50/70 border border-amber-200 p-2.5">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-900 mb-1">
                  Unique Template ID / Slug (lowercase letters, numbers, underscores)
                </label>
                <input
                  type="text"
                  value={newTemplateId}
                  onChange={(e) => {
                    setIdManuallyEdited(true);
                    setNewTemplateId(slugify(e.target.value));
                  }}
                  placeholder="e.g. low_budget_followup"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-amber-300 focus:border-[#008792] focus:outline-none font-mono"
                  required
                />
                <p className="text-[10px] text-amber-700 mt-1">
                  This identifier binds calls and batches to this exact script in the database.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Strategy Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Low Budget Re-engagement"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 focus:border-[#008792] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Target Disposition / Purpose
                </label>
                <input
                  type="text"
                  value={formData.target_disposition}
                  onChange={(e) => setFormData({ ...formData, target_disposition: e.target.value })}
                  placeholder="e.g. Low Budget, Not Answering, Wrong Numbers"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 focus:border-[#008792] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                Description / Strategic Intent
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief summary of the hook and goal"
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 focus:border-[#008792] focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  Opening Greeting (Telugu Spoken Audio)
                </label>
                <span className="text-[10px] text-slate-400 font-mono">
                  {formData.greeting_telugu.length} chars
                </span>
              </div>
              <textarea
                rows={3}
                value={formData.greeting_telugu}
                onChange={(e) => setFormData({ ...formData, greeting_telugu: e.target.value })}
                placeholder="నమస్తే అండి! నేను అనన్య, స్వర్గసీమ నుంచి మాట్లాడుతున్నానండి..."
                className="w-full p-2 text-xs bg-white border border-slate-300 focus:border-[#008792] focus:outline-none leading-relaxed"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  Opening Greeting (Hindi Mirror Translation)
                </label>
                <span className="text-[10px] text-slate-400 font-mono">
                  {formData.greeting_hindi.length} chars
                </span>
              </div>
              <textarea
                rows={2}
                value={formData.greeting_hindi}
                onChange={(e) => setFormData({ ...formData, greeting_hindi: e.target.value })}
                placeholder="नमस्ते जी! मैं अनन्या, स्वर्गसीमा से बात कर रही हूँ..."
                className="w-full p-2 text-xs bg-white border border-slate-300 focus:border-[#008792] focus:outline-none leading-relaxed"
              />
            </div>

            <div className="flex-1 flex flex-col min-h-[220px]">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  Full System Prompt &amp; Objection Handling Rules
                </label>
                <span className="text-[10px] text-slate-400 font-mono">
                  Injected into Gemini Live runtime
                </span>
              </div>
              <textarea
                rows={11}
                value={formData.system_prompt}
                onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                className="w-full p-2.5 font-mono text-[11px] bg-white border border-slate-300 focus:border-[#008792] focus:outline-none leading-relaxed flex-1"
                required
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
