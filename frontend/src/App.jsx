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
import LoginView from './components/LoginView';

// Main Swargaseema AI Telephony Console Application with full-width Left Sidebar Layout
export default function App() {
  const [activeNav, setActiveNav] = useState('live');
  const [alertMessage, setAlertMessage] = useState('');
  const [headerSearch, setHeaderSearch] = useState('');

  // Authentication State
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('swargaseema_token') || '');
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('swargaseema_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isAuthValidating, setIsAuthValidating] = useState(true);

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

  // Authenticated fetch wrapper injecting Bearer token & handling session expiration
  const authFetch = useCallback(
    async (url, options = {}) => {
      const token = authToken || localStorage.getItem('swargaseema_token');
      const headers = {
        ...(options.headers || {}),
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(url, { ...options, headers });
      if (response.status === 401) {
        localStorage.removeItem('swargaseema_token');
        localStorage.removeItem('swargaseema_user');
        setAuthToken('');
        setCurrentUser(null);
      }
      return response;
    },
    [authToken]
  );

  // Validate existing token on initial mount
  useEffect(() => {
    const token = localStorage.getItem('swargaseema_token');
    if (!token) {
      setIsAuthValidating(false);
      return;
    }
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Unauthorized');
      })
      .then((data) => {
        if (data.ok && data.user) {
          setCurrentUser(data.user);
          setAuthToken(token);
        } else {
          throw new Error('Invalid user payload');
        }
      })
      .catch(() => {
        localStorage.removeItem('swargaseema_token');
        localStorage.removeItem('swargaseema_user');
        setAuthToken('');
        setCurrentUser(null);
      })
      .finally(() => {
        setIsAuthValidating(false);
      });
  }, []);

  // Handle Logout
  const handleLogout = useCallback(async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignored
    }
    localStorage.removeItem('swargaseema_token');
    localStorage.removeItem('swargaseema_user');
    setAuthToken('');
    setCurrentUser(null);
  }, [authFetch]);

  // Handle Login Success
  const handleLoginSuccess = useCallback((user, token) => {
    setCurrentUser(user);
    setAuthToken(token);
  }, []);

  // Fetch Completed Call Logs with optional date range
  const fetchCompletedLogs = useCallback(
    async (startDate, endDate) => {
      if (!authToken && !localStorage.getItem('swargaseema_token')) return;
      setIsLoadingLogs(true);
      try {
        let url = '/calls?limit=500';
        if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`;
        if (endDate) url += `&end_date=${encodeURIComponent(endDate)}`;
        const res = await authFetch(url);
        if (!res.ok) return;
        const list = await res.json();
        setCompletedCalls(list || []);
      } catch (err) {
        setAlertMessage(`Failed to load call logs: ${err.message}`);
      } finally {
        setIsLoadingLogs(false);
      }
    },
    [authFetch, authToken]
  );

  // Poll Campaign Status
  const fetchCampaignStatus = useCallback(async () => {
    if (!authToken && !localStorage.getItem('swargaseema_token')) return;
    try {
      const res = await authFetch('/api/campaign/status');
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
  }, [authFetch, authToken, fetchCompletedLogs]);

  // Fetch CRM Pending Calls
  const fetchCrmPendingCalls = useCallback(
    async (startDate, endDate) => {
      if (!authToken && !localStorage.getItem('swargaseema_token')) return;
      const today = new Date().toISOString().slice(0, 10);
      const start = startDate || today;
      const end = endDate || today;

      setIsLoadingCrm(true);
      setCrmError('');
      try {
        const res = await authFetch(`/api/crm/pending-calls?start_date=${start}&end_date=${end}&status=all`);
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
    },
    [authFetch, authToken]
  );

  // Fetch Batches
  const fetchBatches = useCallback(async () => {
    if (!authToken && !localStorage.getItem('swargaseema_token')) return;
    setIsLoadingBatches(true);
    try {
      const res = await authFetch('/api/campaign/batches');
      if (!res.ok) return;
      const data = await res.json();
      setBatches(data.batches || []);
    } catch (err) {
      setAlertMessage(`Failed to load batches: ${err.message}`);
    } finally {
      setIsLoadingBatches(false);
    }
  }, [authFetch, authToken]);

  // Fetch Campaign Strategy Templates
  const fetchCampaignTemplates = useCallback(async () => {
    if (!authToken && !localStorage.getItem('swargaseema_token')) return;
    try {
      const res = await authFetch('/api/campaign/templates');
      if (!res.ok) return;
      const data = await res.json();
      setTemplates(data.templates || []);
      if (data.selected_template_id) {
        setSelectedTemplateId(data.selected_template_id);
      }
    } catch (err) {
      console.error('Failed to load campaign templates:', err);
    }
  }, [authFetch, authToken]);

  // Select Active Template for Dialer and New Batches
  const handleSelectTemplate = async (templateId) => {
    setSelectedTemplateId(templateId);
    try {
      await authFetch('/api/campaign/select-template', {
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
    if (!currentUser || !authToken) return;

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
  }, [
    currentUser,
    authToken,
    fetchCampaignTemplates,
    fetchCampaignStatus,
    fetchCrmPendingCalls,
    fetchCompletedLogs,
    fetchBatches,
    campaignData?.status,
    (campaignData?.active_calls || []).length,
  ]);

  // Campaign Actions
  const handleStartCampaign = async () => {
    try {
      const res = await authFetch('/api/campaign/start', { method: 'POST' });
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
      await authFetch('/api/campaign/pause', { method: 'POST' });
      fetchCampaignStatus();
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handleResumeCampaign = async () => {
    try {
      await authFetch('/api/campaign/resume', { method: 'POST' });
      fetchCampaignStatus();
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handleStopCampaign = async () => {
    try {
      await authFetch('/api/campaign/stop', { method: 'POST' });
      fetchCampaignStatus();
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handleResetQueue = async () => {
    if (!window.confirm('Clear active queue and reset counters to start a fresh batch?')) return;
    try {
      const res = await authFetch('/api/campaign/reset', { method: 'POST' });
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
      await authFetch('/api/campaign/reset', { method: 'POST' });
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
      const res = await authFetch('/api/dial', {
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
      const res = await authFetch('/api/campaign/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        setAlertMessage('');
        fetchCampaignStatus();
        fetchBatches();
        setActiveNav('live');
      } else {
        setAlertMessage(`Failed to queue leads: ${data.error}`);
      }
    } catch (err) {
      setAlertMessage(`Network error: ${err.message}`);
    }
  };

  // If session is validating on page load, show clean loader
  if (isAuthValidating) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 border-2 border-[#008792] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-muted-foreground font-mono">Initializing Swargaseema Voice Session...</span>
        </div>
      </div>
    );
  }

  // If not authenticated, show modern login view
  if (!currentUser || !authToken) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

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
          completedCount={completedCalls.length}
          currentUser={currentUser}
          onLogout={handleLogout}
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
                    templates={templates}
                    selectedTemplateId={selectedTemplateId}
                    onSelectTemplate={handleSelectTemplate}
                    isLoadingCrm={isLoadingCrm}
                    crmError={crmError}
                    onFetchCrmCalls={fetchCrmPendingCalls}
                    onQueueLeads={handleQueueLeads}
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
                    isLoadingBatches={isLoadingBatches}
                    onRefreshBatches={fetchBatches}
                    onRefreshCampaign={fetchCampaignStatus}
                    onQueueLeads={handleQueueLeads}
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
    </TooltipProvider>
  );
}
