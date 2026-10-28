// Utility functions for formatting telephony data, byte metrics, and call states in Nugget Voice AI theme

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const sec = Math.round(Number(seconds));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export function formatTime(isoOrTimestamp) {
  if (!isoOrTimestamp) return '--';
  const date = new Date(isoOrTimestamp);
  if (isNaN(date.getTime())) return String(isoOrTimestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDate(isoOrTimestamp) {
  if (!isoOrTimestamp) return '--';
  const date = new Date(isoOrTimestamp);
  if (isNaN(date.getTime())) return String(isoOrTimestamp);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function getDispositionConfig(disposition) {
  const disp = (disposition || 'completed').toLowerCase();
  switch (disp) {
    case 'interested':
      return {
        label: 'Interested',
        bg: 'bg-[#f4f9f9]',
        text: 'text-[#008792]',
        border: 'border-[#c3e1e5]',
        dot: 'bg-[#008792]',
      };
    case 'not_interested':
    case 'declined':
      return {
        label: 'Not Interested',
        bg: 'bg-rose-50',
        text: 'text-rose-700',
        border: 'border-rose-200',
        dot: 'bg-rose-500',
      };
    case 'wrong_number':
      return {
        label: 'Wrong Number',
        bg: 'bg-purple-50',
        text: 'text-purple-700',
        border: 'border-purple-200',
        dot: 'bg-purple-500',
      };
    case 'not_talking':
      return {
        label: 'Not Talking',
        bg: 'bg-orange-50',
        text: 'text-orange-700',
        border: 'border-orange-200',
        dot: 'bg-orange-500',
      };
    case 'no_answer':
    case 'busy':
      return {
        label: disp === 'busy' ? 'Busy' : 'No Answer',
        bg: 'bg-amber-50',
        text: 'text-amber-700',
        border: 'border-amber-200',
        dot: 'bg-amber-500',
      };
    case 'dropped':
      return {
        label: 'Dropped',
        bg: 'bg-red-50',
        text: 'text-red-700',
        border: 'border-red-200',
        dot: 'bg-red-500',
      };
    default:
      return {
        label: disp.toUpperCase(),
        bg: 'bg-neutral-100',
        text: 'text-neutral-700',
        border: 'border-neutral-200',
        dot: 'bg-neutral-400',
      };
  }
}

export function getDiagnosticConfig(diagClassification) {
  const code = (diagClassification || 'unknown').toLowerCase();
  switch (code) {
    case 'success':
      return {
        label: 'Bidirectional Stream OK',
        bg: 'bg-[#f4f9f9]',
        text: 'text-[#008792]',
        border: 'border-[#c3e1e5]',
      };
    case 'no_incoming_audio':
      return {
        label: 'No Inbound Audio',
        bg: 'bg-rose-50',
        text: 'text-rose-700',
        border: 'border-rose-200',
      };
    case 'incoming_audio_exists_gemini_missing':
      return {
        label: 'Gemini Output Missing',
        bg: 'bg-amber-50',
        text: 'text-amber-700',
        border: 'border-amber-200',
      };
    case 'gemini_audio_produced_caller_silence':
      return {
        label: 'Caller Silence Detected',
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        border: 'border-blue-200',
      };
    case 'everything_stopped_together':
      return {
        label: 'Early Telephony Disconnect',
        bg: 'bg-neutral-100',
        text: 'text-neutral-600',
        border: 'border-neutral-200',
      };
    default:
      return null;
  }
}
