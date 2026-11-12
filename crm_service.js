// crm_service.js — query missed calls / pending callbacks from realestate_db using workflow logic
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const CANDIDATE_PATHS = [
  process.env.REALESTATE_SERVER_PATH,
  'C:/KPRO/Nitesh/ai voice/realestate/server',
  'C:/KPRO/Nitesh/ai voice new project/realestate/server',
  'C:/KPRO/Nitesh/realestate4/realestate/server',
  'C:/KPRO/Nitesh/realestate/server',
].filter(Boolean);

let serverPath = null;
for (const p of CANDIDATE_PATHS) {
  if (fs.existsSync(path.join(p, 'features/workflows/missedCalls.workflow.js'))) {
    serverPath = p;
    break;
  }
}

if (!serverPath) {
  throw new Error('Could not find realestate server directory');
}

const mongoose = require(path.join(serverPath, 'node_modules/mongoose'));
const { getInboundMissedCallsAnalytics } = require(path.join(serverPath, 'features/workflows/missedCalls.workflow.js'));

const MONGO_URI = process.env.REAL_MONGO_URI || process.env.MONGO_URI || 'mongodb://mongo_admin:Realestate123%24@76.13.242.179:27017/realestate_db?authSource=admin';

let isConnected = false;

async function connect() {
  if (isConnected) return;
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  isConnected = true;
}

export async function fetchPendingCalls(startDate, endDate, statusFilter = 'pending') {
  await connect();

  const isAll = statusFilter === 'all';
  const query = {
    limit: 100,
  };

  if (!isAll) {
    query.callbackStatus = 'pending';
    query.callbackStatusFilter = 'pending';
  } else {
    query.callbackStatusFilter = 'all';
  }

  if (startDate && endDate) {
    query.timeRange = 'custom';
    query.startDate = startDate;
    query.endDate = endDate;
  } else if (startDate) {
    query.timeRange = 'custom';
    query.startDate = startDate;
    query.endDate = startDate;
  } else {
    query.timeRange = 'today';
  }

  let allCalls = [];
  let page = 1;
  let totalReported = 0;
  let lastKpis = {};

  while (true) {
    query.page = page;
    const res = await getInboundMissedCallsAnalytics(null, query);
    lastKpis = res.kpis || lastKpis;
    totalReported = res.pagination?.total || totalReported;
    const batch = res.calls || [];
    if (batch.length === 0) break;
    allCalls.push(...batch);
    if (batch.length < 100 || allCalls.length >= totalReported || page >= 15) break;
    page++;
  }

  const calls = allCalls.map(c => {
    const isPending = !c.callback || c.callback.called === false || c.callback.status === 'none' || c.callback.status === 'pending';
    return {
      id: c.id,
      callId: c.callId,
      phone_number: c.customerNumber,
      customer_name: c.customerName !== 'nt' && c.customerName !== 'Unknown' ? (c.customerName || '') : '',
      source: c.source || '',
      dialedDid: c.dialedDid || '',
      campaign: c.campaign || '',
      missedAgents: c.missedAgents || [],
      duration: c.duration || 0,
      circle: c.circle || '',
      operator: c.operator || '',
      createdAt: c.createdAt,
      startStamp: c.startStamp || '',
      status: isPending ? 'pending' : 'called',
    };
  });

  const seenNumbers = new Set();
  const uniqueCalls = [];
  for (const c of calls) {
    const rawDigits = String(c.phone_number || '').replace(/\D/g, '').slice(-10);
    if (rawDigits && !seenNumbers.has(rawDigits)) {
      seenNumbers.add(rawDigits);
      uniqueCalls.push(c);
    }
  }

  return {
    kpis: lastKpis,
    calls: calls,
    uniqueCalls: uniqueCalls,
    total: calls.length,
    uniqueTotal: uniqueCalls.length,
    totalReported: totalReported,
  };
}
