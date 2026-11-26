import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, X, Search } from 'lucide-react';
import Sidebar from './components/Sidebar';
import { SidebarProvider, SidebarInset, SidebarTrigger } from './components/ui/sidebar';
import { Separator } from './components/ui/separator';
import { Badge } from './components/ui/badge';
import { Input } from './components/ui/input';
import { TooltipProvider } from './components/ui/tooltip';
import AlertBanner from './components/AlertBanner';
import LiveConsoleView from './components/LiveConsoleView';
import PendingCallsTab from './components/PendingCallsTab';
import BatchesTab from './components/BatchesTab';
import CompletedLogsTab from './components/CompletedLogsTab';
import TemplatesTab from './components/TemplatesTab';
import ErrorBoundary from './components/ErrorBoundary';
import LoginModal from './components/LoginModal';
import { LogOut, User as UserIcon } from 'lucide-react';
import { Button } from './components/ui/button';

// Main Swargaseema AI Telephony Console Application with full-width Left Sidebar Layout
export default function App() {
  // Operator Authentication State
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = localStorage.getItem('swargaseema_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // Attach active operator to all API requests
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init = {}) => {
      const op = currentUser?.username;
      if (op) {
        init.headers = {
          ...init.headers,
          'X-Operator': op,
        };
      }
      return originalFetch(input, init);
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [currentUser]);

  const handleLogout = () => {
    localStorage.removeItem('swargaseema_token');
    localStorage.removeItem('swargaseema_user');
    setCurrentUser(null);
  };
  const [activeNav, setActiveNav] = useState('live');
  const [alertMessage, setAlertMessage] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState('');

  // Campaign & Live HUD State
  const [campaignData, setCampaignData] = useState({
    is_running: false,
    is_paused: false,
    stats: {},
    active_calls: [],
    next_call: null,
    last_completed_call: null,
  });

  const [manualPhone, setManualPhone] = useState('+917007173798');
  const [manualDialStatus, setManualDialStatus] = useState('');
  const [manualDialFeedback, setManualDialFeedback] = useState('');
  const [isDialingManual, setIsDialingManual] = useState(false);
  const isDialingRef = useRef(false);

  // Tabs Data State
  const [crmCalls, setCrmCalls] = useState([]);
  const [isLoadingCrm, setIsLoadingCrm] = useState(false);
  const [crmError, setCrmError] = useState('');

  const [batches, setBatches] = useState([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);

  // Campaign Templates State
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('production_callback_conversion');

  const [completedCalls, setCompletedCalls] = useState([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const wasCallActiveRef = useRef(false);

  // Fetch Completed Call Logs with pagination and filters
  const [completedPagination, setCompletedPagination] = useState({ total: 0, page: 1, limit: 50, pages: 1 });

  const fetchCompletedLogs = useCallback(async (filters = {}) => {
    setIsLoadingLogs(true);
    try {
      let url = '/calls';
      const params = [];
      const page = filters.page || 1;
      const limit = filters.limit || 50;
      params.push(`page=${page}`);
      params.push(`limit=${limit}`);

      if (filters.startDate) params.push(`start_date=${encodeURIComponent(filters.startDate)}`);
      if (filters.endDate) params.push(`end_date=${encodeURIComponent(filters.endDate)}`);
      if (filters.search) params.push(`search=${encodeURIComponent(filters.search)}`);
      if (filters.disposition && filters.disposition !== 'all') {
        params.push(`disposition=${encodeURIComponent(filters.disposition)}`);
      }
      if (filters.recordingOnly) params.push(`has_recording=true`);
      if (filters.callbackOnly) params.push(`has_callback=true`);

      url += `?${params.join('&')}`;

      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setCompletedCalls(data);
        setCompletedPagination({ total: data.length, page: 1, limit: data.length, pages: 1 });
      } else {
        setCompletedCalls(data.calls || []);
        setCompletedPagination({
          total: data.total || 0,
          page: data.page || 1,
          limit: data.limit || 50,
          pages: data.pages || 1,
        });
      }
    } catch (err) {
      setAlertMessage(`Failed to load call logs: ${err.message}`);
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  // Poll Campaign Status
  const fetchCampaignStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/campaign/status');
      if (!res.ok) return;
      const data = await res.json();
      setCampaignData(data);

      if (data.error_message) {
        setAlertMessage(data.error_message);
      }

      const hasActive = data.active_calls && data.active_calls.length > 0;
      if (hasActive) {
        wasCallActiveRef.current = true;
        const ac = data.active_calls[0];
        setManualDialStatus(ac.status === 'dialing' ? 'DIALING' : 'IN CALL');
        setManualDialFeedback(
          ac.status === 'dialing'
            ? `Dialing ${ac.phone_number}... Awaiting customer pickup`
            : `Connected with ${ac.phone_number}. AI agent Ananya is in conversation.`
        );
      } else {
        setIsDialingManual(false);
        if (wasCallActiveRef.current) {
          wasCallActiveRef.current = false;
          fetchCompletedLogs();
        }

        if (data.last_completed_call) {
          const lc = data.last_completed_call;
          const disp = (lc.disposition || 'COMPLETED').toUpperCase();
          if (Date.now() / 1000 - lc.ended_at < 12) {
            setManualDialStatus(disp);
            setManualDialFeedback(
              `Call finished (${lc.duration}s). ${
                lc.diagnostic?.root_cause_summary || `Disposition: ${lc.disposition}`
              }`
            );
          }
        }
      }
    } catch {
      // Background poll failure caught cleanly
    }
  }, [fetchCompletedLogs]);

  // Fetch CRM Pending Calls
  const fetchCrmPendingCalls = useCallback(async (startDate, endDate) => {
    const today = new Date().toISOString().slice(0, 10);
    const start = startDate || today;
    const end = endDate || today;

    setIsLoadingCrm(true);
    setCrmError('');
    try {
      const res = await fetch(`/api/crm/pending-calls?start_date=${start}&end_date=${end}&status=pending`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const err = data.error || 'Failed to query CRM';
        setCrmError(err);
        setAlertMessage(`CRM Fetch Error: ${err}`);
        return;
      }
      setAlertMessage('');
      setCrmCalls(data.calls || []);
    } catch (err) {
      setCrmError(err.message);
      setAlertMessage(`Network error connecting to CRM: ${err.message}`);
    } finally {
      setIsLoadingCrm(false);
    }
  }, []);

  // Fetch Batches
  const fetchBatches = useCallback(async () => {
    setIsLoadingBatches(true);
    try {
      const res = await fetch('/api/campaign/batches');
      if (!res.ok) return;
      const data = await res.json();
      setBatches(data.batches || []);
    } catch (err) {
      setAlertMessage(`Failed to load batches: ${err.message}`);
    } finally {
      setIsLoadingBatches(false);
    }
  }, []);

  // Fetch Campaign Strategy Templates
  const fetchCampaignTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/campaign/templates');
      if (!res.ok) return;
      const data = await res.json();
      setTemplates(data.templates || []);
      if (data.selected_template_id) {
        setSelectedTemplateId(data.selected_template_id);
      }
    } catch (err) {
      console.error('Failed to load campaign templates:', err);
    }
  }, []);

  // Select Active Template for Dialer and New Batches
  const handleSelectTemplate = async (templateId) => {
    setSelectedTemplateId(templateId);
    try {
      await fetch('/api/campaign/select-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId }),
      });
      fetchCampaignStatus();
    } catch (err) {
      console.error('Failed to sync active template with backend:', err);
    }
  };

  // Initial Load and Adaptive Polling (1.5s when dialing/in-call, 4s when idle; pauses when tab hidden)
  useEffect(() => {
    fetchCampaignTemplates();
    fetchCrmPendingCalls();
    fetchCampaignStatus();
    fetchCompletedLogs();
    fetchBatches();

    const isBusy = campaignData?.status === 'running' || (campaignData?.active_calls && campaignData.active_calls.length > 0);
    const delay = isBusy ? 1500 : 4000;

    const timer = setInterval(() => {
      if (!document.hidden) {
        fetchCampaignStatus();
      }
    }, delay);

    return () => clearInterval(timer);
  }, [fetchCampaignTemplates, fetchCampaignStatus, fetchCrmPendingCalls, fetchCompletedLogs, fetchBatches, campaignData?.status, (campaignData?.active_calls || []).length]);

  // Campaign Actions
  const handleStartCampaign = async () => {
    try {
      const res = await fetch('/api/campaign/start', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        fetchCampaignStatus();
      }
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handlePauseCampaign = async () => {
    try {
      await fetch('/api/campaign/pause', { method: 'POST' });
      fetchCampaignStatus();
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handleResumeCampaign = async () => {
    try {
      await fetch('/api/campaign/resume', { method: 'POST' });
      fetchCampaignStatus();
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handleStopCampaign = async () => {
    try {
      await fetch('/api/campaign/stop', { method: 'POST' });
      fetchCampaignStatus();
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handleResetQueue = async () => {
    if (!window.confirm('Clear active queue and reset counters to start a fresh batch?')) return;
    try {
      const res = await fetch('/api/campaign/reset', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        await fetchCampaignStatus();
        await fetchBatches();
      }
    } catch (err) {
      setAlertMessage(`Failed to reset queue: ${err.message}`);
    }
  };

  const handleRetryFailed = async () => {
    try {
      await fetch('/api/campaign/reset', { method: 'POST' });
      fetchCampaignStatus();
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handleTriggerManualDial = async (phone, contactName = '') => {
    if (!phone || isDialingRef.current || isDialingManual || (campaignData.active_calls && campaignData.active_calls.length > 0)) {
      return;
    }
    isDialingRef.current = true;
    setIsDialingManual(true);
    setAlertMessage('');
    setManualPhone(phone);
    setManualDialStatus('DIALING');
    setManualDialFeedback(`Call dispatched to ${phone}. Waiting for answer...`);
    setActiveNav('live');

    try {
      const res = await fetch('/api/dial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phone,
          contact_name: contactName,
          template_id: selectedTemplateId,
        }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        const text = await res.text().catch(() => '');
        data = { ok: false, error: text || `HTTP ${res.status}` };
      }
      if (!res.ok || !data.ok) {
        const errMsg = data.error
          ? typeof data.error === 'object'
            ? JSON.stringify(data.error)
            : data.error
          : 'Dial failed';
        setAlertMessage(errMsg);
        setManualDialFeedback(`Error: ${errMsg}`);
        setManualDialStatus('FAILED');
      } else {
        setAlertMessage('');
        fetchCampaignStatus();
      }
    } catch (err) {
      setAlertMessage(err.message);
      setManualDialFeedback(`Network error: ${err.message}`);
      setManualDialStatus('FAILED');
    } finally {
      setIsDialingManual(false);
      isDialingRef.current = false;
    }
  };

  const handleQueueLeads = async (payload) => {
    try {
      const enrichedPayload = {
        ...payload,
        created_by: currentUser?.displayName || currentUser?.username || 'Operator',
      };
      const res = await fetch('/api/campaign/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enrichedPayload),
      });
      const data = await res.json();
      if (data.ok) {
        setAlertMessage('');
        fetchCampaignStatus();
        fetchBatches();
        // Redirect to Live Dialer only when explicit immediate run requested
        if (payload.start_immediately) {
          setActiveNav('live');
          handleStartCampaign();
        }
      } else {
        setAlertMessage(`Failed to queue leads: ${data.error}`);
      }
    } catch (err) {
      setAlertMessage(`Network error: ${err.message}`);
    }
  };

  const handleAddCrmCalls = (newCalls = []) => {
    if (!newCalls.length) return;
    setCrmCalls((prev) => {
      const existingPhones = new Set(
        prev.map((c) => String(c.phone_number || '').replace(/\D/g, '').slice(-10))
      );
      const uniqueNew = newCalls.filter((c) => {
        const num10 = String(c.phone_number || '').replace(/\D/g, '').slice(-10);
        return !num10 || !existingPhones.has(num10);
      });
      return [...uniqueNew, ...prev];
    });
  };

  const activeCall = campaignData.active_calls?.[0] || null;

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={true}>
        <Sidebar
          activeNav={activeNav}
          setActiveNav={setActiveNav}
          campaignData={campaignData}
          crmCount={crmCalls.length}
          batchesCount={
            batches.filter(
              (b) =>
                !b?.name?.toLowerCase().startsWith('test batch') &&
                !b?.source_filter?.toLowerCase().includes('test')
            ).length
          }
          completedCount={completedPagination.total || completedCalls.length}
        />

        <SidebarInset className="flex flex-col h-screen overflow-hidden bg-background">
          {/* Official shadcn Header with SidebarTrigger */}
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4 bg-background z-20">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <div className="text-sm font-semibold tracking-tight text-foreground">
                {activeNav === 'live' && 'Live Monitor & Dialer'}
                {activeNav === 'pending' && 'CRM Missed Calls (Pending Queue)'}
                {activeNav === 'batches' && 'Campaign Batches'}
                {activeNav === 'templates' && 'Campaign Scripts & Prompts'}
                {activeNav === 'completed' && 'Completed Logs & Audio'}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-60 sm:w-72">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  type="text"
                  value={headerSearch}
                  onChange={(e) => setHeaderSearch(e.target.value)}
                  placeholder="Filter calls by phone, name, source..."
                  className="h-8 pl-8 pr-7 text-xs bg-muted/40 border-input focus:bg-background"
                />
                {headerSearch && (
                  <button
                    type="button"
                    onClick={() => setHeaderSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {currentUser && (
                <>
                  <Separator orientation="vertical" className="h-4" />
                  <div className="flex items-center gap-1.5 pl-1">
                    <div className="flex items-center gap-1 text-xs font-medium text-foreground bg-muted/50 px-2 py-1 rounded border border-border">
                      <UserIcon className="w-3 h-3 text-[#008792]" />
                      <span>{currentUser.displayName || currentUser.username}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={handleLogout}
                      title="Logout"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          </header>

          {/* Main Content Workspace */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <AlertBanner alertMessage={alertMessage} />

            {/* View 1: Live Monitor & Campaign Dialer */}
            {activeNav === 'live' && (
              <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
                <LiveConsoleView
                  activeCall={activeCall}
                  lastCompletedCall={campaignData.last_completed_call}
                  nextCall={campaignData.next_call}
                  stats={campaignData.stats}
                  isRunning={campaignData.is_running}
                  isPaused={campaignData.is_paused}
                  activeCalls={campaignData.active_calls || []}
                  templates={templates}
                  selectedTemplateId={selectedTemplateId}
                  onSelectTemplate={handleSelectTemplate}
                  onNavigateToTemplates={() => setActiveNav('templates')}
                  onStartCampaign={handleStartCampaign}
                  onPauseCampaign={handlePauseCampaign}
                  onResumeCampaign={handleResumeCampaign}
                  onStopCampaign={handleStopCampaign}
                  onResetQueue={handleResetQueue}
                  onRetryFailed={handleRetryFailed}
                  onTriggerManualDial={handleTriggerManualDial}
                  manualDialStatus={manualDialStatus}
                  manualDialFeedback={manualDialFeedback}
                  manualPhone={manualPhone}
                  setManualPhone={setManualPhone}
                  isDialingManual={isDialingManual}
                  onRefreshCampaign={fetchCampaignStatus}
                  onRefreshBatches={fetchBatches}
                  completedCalls={completedCalls}
                  onRefreshLogs={fetchCompletedLogs}
                />
              </div>
            )}

            {/* View 2: CRM Missed Calls */}
            {activeNav === 'pending' && (
              <div className="p-4 flex-1 min-h-0 flex flex-col overflow-hidden">
                <ErrorBoundary onReset={fetchCrmPendingCalls}>
                  <PendingCallsTab
                    crmCalls={crmCalls}
                    campaignData={campaignData}
                    templates={templates}
                    selectedTemplateId={selectedTemplateId}
                    onSelectTemplate={handleSelectTemplate}
                    isLoadingCrm={isLoadingCrm}
                    crmError={crmError}
                    onFetchCrmCalls={fetchCrmPendingCalls}
                    onQueueLeads={handleQueueLeads}
                    onImportCrmCalls={handleAddCrmCalls}
                    onTriggerManualDial={handleTriggerManualDial}
                    isDialingManual={isDialingManual}
                    completedCalls={completedCalls}
                    searchText={headerSearch}
                    setSearchText={setHeaderSearch}
                  />
                </ErrorBoundary>
              </div>
            )}

            {/* View 3: Campaign Batches */}
            {activeNav === 'batches' && (
              <div className="p-4 flex-1 min-h-0 flex flex-col overflow-y-auto">
                <ErrorBoundary onReset={fetchBatches}>
                  <BatchesTab
                    batches={batches}
                    campaignData={campaignData}
                    isLoadingBatches={isLoadingBatches}
                    onRefreshBatches={fetchBatches}
                    onRefreshCampaign={fetchCampaignStatus}
                    onQueueLeads={handleQueueLeads}
                    templates={templates}
                    selectedTemplateId={selectedTemplateId}
                    onNavigateToLive={() => setActiveNav('live')}
                  />
                </ErrorBoundary>
              </div>
            )}

            {/* View 4: Campaign Scripts & Prompts */}
            {activeNav === 'templates' && (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <ErrorBoundary onReset={fetchCampaignTemplates}>
                  <TemplatesTab
                    templates={templates}
                    selectedTemplateId={selectedTemplateId}
                    onSelectTemplate={handleSelectTemplate}
                    onRefreshTemplates={fetchCampaignTemplates}
                  />
                </ErrorBoundary>
              </div>
            )}

            {/* View 5: Completed Call Logs & Transcripts */}
            {activeNav === 'completed' && (
              <div className="p-4 flex-1 min-h-0 flex flex-col overflow-hidden">
                <ErrorBoundary onReset={fetchCompletedLogs}>
                  <CompletedLogsTab
                    completedCalls={completedCalls}
                    pagination={completedPagination}
                    isLoadingLogs={isLoadingLogs}
                    onRefreshLogs={fetchCompletedLogs}
                    onQueueLeads={handleQueueLeads}
                    searchText={headerSearch}
                  />
                </ErrorBoundary>
              </div>
            )}
          </div>
        </SidebarInset>
      </SidebarProvider>
      {!currentUser && <LoginModal onLoginSuccess={(u) => setCurrentUser(u)} />}
    </TooltipProvider>
  );
}
