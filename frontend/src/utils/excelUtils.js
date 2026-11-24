import * as XLSX from 'xlsx';

/**
 * Clean and normalize phone numbers from various spreadsheet formats.
 * Handles scientific notation strings, float artifacts (.0), spaces, dashes, country code prefix.
 */
export function normalizePhoneNumber(raw) {
  if (raw === null || raw === undefined) return '';
  let str = String(raw).trim();
  // Strip float artifact from excel (e.g., "9876543210.0")
  str = str.replace(/\.0+$/, '');
  // If scientific notation like "9.87654e+09"
  if (/^[\d.]+[eE][+-]?\d+$/.test(str)) {
    try {
      const num = Number(str);
      if (!isNaN(num)) str = num.toLocaleString('fullwide', { useGrouping: false });
    } catch {
      // fallback
    }
  }
  // Remove non-digit except leading +
  const hasPlus = str.startsWith('+');
  const digits = str.replace(/\D/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Export data array to an Excel (.xlsx) file with auto-sized column widths.
 * @param {Array<Object>} data - Array of row objects where keys are column headers
 * @param {string} fileName - Destination file name (without or with .xlsx)
 * @param {string} sheetName - Name of worksheet tab
 */
export function exportToExcel(data, fileName = 'export', sheetName = 'Sheet1') {
  if (!data || data.length === 0) {
    alert('No data to export.');
    return;
  }

  // Create worksheet from JSON data
  const ws = XLSX.utils.json_to_sheet(data);

  // Auto-fit column widths based on content length
  const keys = Object.keys(data[0] || {});
  const colWidths = keys.map((key) => {
    let maxLen = key.length;
    for (const row of data) {
      const valStr = row[key] !== null && row[key] !== undefined ? String(row[key]) : '';
      if (valStr.length > maxLen) {
        maxLen = valStr.length;
      }
    }
    return { wch: Math.min(Math.max(maxLen + 3, 10), 65) };
  });
  ws['!cols'] = colWidths;

  // Create workbook and append sheet
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Excel limits sheet names to 31 chars

  // Clean filename and trigger browser download
  const cleanName = fileName.replace(/\.xlsx$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, `${cleanName}.xlsx`);
}

/**
 * Detect column mappings from a list of header strings using regex heuristics.
 */
export function detectColumnMapping(headers = []) {
  const mapping = {
    phone: '',
    name: '',
    source: '',
    status: '',
    notes: '',
    date: '',
  };

  const cleanHeaders = headers.map((h) => String(h || '').trim());

  // Detect Phone
  mapping.phone =
    cleanHeaders.find((h) =>
      /^(phone|mobile|cell|contact|number|telephony|caller_number|customer_phone|phone_number|ph|mobile_no|phone_no|contact_no|mobile_number)$/i.test(h)
    ) ||
    cleanHeaders.find((h) => /phone|mobile|cell|contact/i.test(h)) ||
    cleanHeaders.find((h) => /number|no\b/i.test(h)) ||
    '';

  // Detect Name
  mapping.name =
    cleanHeaders.find((h) =>
      /^(name|customer|customer_name|contact_name|lead_name|full_name|caller|caller_name|client|lead)$/i.test(h)
    ) ||
    cleanHeaders.find((h) => /customer_name|client_name|full_name/i.test(h)) ||
    cleanHeaders.find((h) => /^name$|customer/i.test(h)) ||
    '';

  // Detect Source
  mapping.source =
    cleanHeaders.find((h) =>
      /^(source|lead_source|campaign|channel|channel_name|origin|source_filter|platform)$/i.test(h)
    ) ||
    cleanHeaders.find((h) => /channel|source|campaign/i.test(h)) ||
    '';

  // Detect Status
  mapping.status =
    cleanHeaders.find((h) =>
      /^(status|state|lead_status|crm_status|dispo_status)$/i.test(h)
    ) ||
    cleanHeaders.find((h) => /status|state/i.test(h)) ||
    '';

  // Detect Notes / Disposition / Remarks
  mapping.notes =
    cleanHeaders.find((h) =>
      /^(call_disposition|disposition|crm_disposition|outcome|result|notes|remark|remarks|reason|comment|comments|message)$/i.test(h)
    ) ||
    cleanHeaders.find((h) => /call_disposition|disposition|outcome|remark|note|reason/i.test(h)) ||
    '';

  // Detect Date / Time
  mapping.date =
    cleanHeaders.find((h) =>
      /^(date|time|call_time|created_at|timestamp|lead_date|datetime|date_time)$/i.test(h)
    ) ||
    cleanHeaders.find((h) => /date|time|created/i.test(h)) ||
    '';

  return mapping;
}

/**
 * Parse an Excel/CSV file object into raw json rows, headers, and detected mappings.
 * @param {File} file
 * @returns {Promise<{ sheetNames: string[], headers: string[], rows: Array<Object>, mapping: Object }>}
 */
export async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target.result;
        const wb = XLSX.read(buffer, { type: 'array' });
        if (!wb.SheetNames || wb.SheetNames.length === 0) {
          throw new Error('The uploaded Excel file contains no sheets.');
        }

        const firstSheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[firstSheetName];

        // Parse rows as raw JSON objects
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
        if (!rows || rows.length === 0) {
          throw new Error('The uploaded worksheet contains no data rows.');
        }

        // Get headers from first row
        const headers = Object.keys(rows[0] || {});
        const mapping = detectColumnMapping(headers);

        resolve({
          sheetNames: wb.SheetNames,
          headers,
          rows,
          mapping,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file from disk'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Normalize and validate rows according to column mapping.
 * @param {Array<Object>} rows
 * @param {Object} mapping - { phone, name, source, status, notes, date }
 * @returns {{ validLeads: Array<Object>, invalidLeads: Array<Object>, totalCount: number }}
 */
export function normalizeLeadRows(rows = [], mapping = {}) {
  const validLeads = [];
  const invalidLeads = [];

  rows.forEach((row, index) => {
    const rawPhone = mapping.phone ? row[mapping.phone] : '';
    const phone = normalizePhoneNumber(rawPhone);
    const name = mapping.name && row[mapping.name] ? String(row[mapping.name]).trim() : '';
    const source = mapping.source && row[mapping.source] ? String(row[mapping.source]).trim() : 'Excel Import';
    const status = mapping.status && row[mapping.status] ? String(row[mapping.status]).trim().toLowerCase() : 'pending';
    const notes = mapping.notes && row[mapping.notes] ? String(row[mapping.notes]).trim() : '';
    const date = mapping.date && row[mapping.date] ? String(row[mapping.date]).trim() : '';

    const digitsOnly = phone.replace(/\D/g, '');
    const isValid = digitsOnly.length >= 7 && digitsOnly.length <= 15;

    const leadObj = {
      _rowIndex: index + 1,
      phone_number: phone,
      customer_name: name || `Lead #${index + 1}`,
      source: source || 'Excel Import',
      status: ['pending', 'attempted', 'resolved', 'called'].includes(status) ? status : 'pending',
      crm_disposition: notes,
      notes,
      call_time: date || new Date().toISOString(),
      rawRow: row,
    };

    if (isValid) {
      validLeads.push(leadObj);
    } else {
      invalidLeads.push({
        ...leadObj,
        error: !phone ? 'Empty phone number' : `Invalid phone digits (${digitsOnly.length} digits)`,
      });
    }
  });

  return {
    validLeads,
    invalidLeads,
    totalCount: rows.length,
  };
}

/**
 * Generate and trigger download for a sample Excel template for lead uploads.
 */
export function downloadSampleExcelTemplate(_templateType = 'leads') {
  const sampleData = [
    {
      'Phone Number': '+919876543210',
      'Customer Name': 'Rajesh Kumar',
      'Source': 'CRM Inbound Web Lead',
      'Status': 'pending',
      'Notes': 'Inquired about open plots & villa options',
    },
    {
      'Phone Number': '9812345678',
      'Customer Name': 'Sneha Rao',
      'Source': 'IVR Missed Call',
      'Status': 'pending',
      'Notes': 'Callback requested for pricing brochure',
    },
    {
      'Phone Number': '+919988776655',
      'Customer Name': 'Amit Patel',
      'Source': 'Property Expo Visit',
      'Status': 'pending',
      'Notes': 'High intent, preferred weekend site visit',
    },
    {
      'Phone Number': '9176543210',
      'Customer Name': 'Kavita Reddy',
      'Source': 'WhatsApp Campaign',
      'Status': 'pending',
      'Notes': 'Follow-up regarding layout approval & registration',
    },
  ];

  exportToExcel(sampleData, 'Sample_Lead_Import_Template', 'Sample Leads');
}
