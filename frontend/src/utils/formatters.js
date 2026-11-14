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

export function formatTime(isoOrTimestamp, options = {}) {
  if (!isoOrTimestamp) return '--';

  const defaultOpts = {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    ...options,
  };

  if (typeof isoOrTimestamp === 'number') {
    const ms = isoOrTimestamp < 1e11 ? isoOrTimestamp * 1000 : isoOrTimestamp;
    const d = new Date(ms);
    return isNaN(d.getTime())
      ? String(isoOrTimestamp)
      : d.toLocaleTimeString('en-US', defaultOpts).replace(/\u202f/g, ' ');
  }

  let str = String(isoOrTimestamp).trim();

  // If already contains AM/PM and doesn't look like an ISO string
  if (/(am|pm)/i.test(str) && !str.includes('T') && !/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str;
  }

  // Check if it's purely a time string like "14:00:03" or "14:00"
  const timeOnly = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeOnly) {
    let [_, h, m, s] = timeOnly;
    let hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    const sec = s !== undefined && defaultOpts.second !== undefined ? ':' + s.padStart(2, '0') : '';
    return `${hour}:${m.padStart(2, '0')}${sec} ${ampm}`;
  }

  // Parse ISO or Date string
  let d = new Date(str);
  if (isNaN(d.getTime()) && str.includes(' ')) {
    d = new Date(str.replace(' ', 'T'));
  }

  if (!isNaN(d.getTime())) {
    return d.toLocaleTimeString('en-US', defaultOpts).replace(/\u202f/g, ' ');
  }

  return str;
}

export function formatDate(isoOrTimestamp) {
  if (!isoOrTimestamp) return '--';
  const ms = typeof isoOrTimestamp === 'number' && isoOrTimestamp < 1e11 ? isoOrTimestamp * 1000 : isoOrTimestamp;
  const d = new Date(ms);
  if (isNaN(d.getTime())) {
    const d2 = new Date(String(isoOrTimestamp).replace(' ', 'T'));
    if (!isNaN(d2.getTime())) {
      return d2.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    return String(isoOrTimestamp);
  }
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatCallbackTime(cbStr) {
  if (!cbStr) return '';
  let str = String(cbStr).trim();

  // If it's an ISO timestamp like "2026-11-15T14:30:00Z"
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const clean = str.includes(' ') && !str.includes('T') ? str.replace(' ', 'T') : str;
    const d = new Date(clean);
    if (!isNaN(d.getTime())) {
      const dtPart = d.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        month: 'short',
        day: 'numeric',
      });
      const tmPart = d.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).replace(/\u202f/g, ' ');
      return `${dtPart}, ${tmPart}`;
    }
  }

  // If it contains a 24h pattern like "14:00" or "14:00:00" without AM/PM
  if (!/(am|pm)/i.test(str)) {
    str = str.replace(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/g, (match, h, m) => {
      let hour = parseInt(h, 10);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      hour = hour % 12 || 12;
      return `${hour}:${m} ${ampm}`;
    });
  }

  return str;
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
    case 'inquiry_drop':
      return {
        label: 'Inquiry Drop',
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        border: 'border-blue-200',
        dot: 'bg-blue-500',
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
