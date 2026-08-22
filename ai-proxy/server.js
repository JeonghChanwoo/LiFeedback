// AI 계획 생성 프록시 서버 (GitHub Copilot SDK 사용)
// 실행: node server.js  → http://localhost:8787 (Azure에서는 PORT/HOST 환경변수 사용)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { CopilotClient } = require('@github/copilot-sdk');

function envInteger(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

const PORT = envInteger('PORT', 8787, 1, 65535);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY_BYTES = envInteger('MAX_BODY_BYTES', 128 * 1024, 1024, 1024 * 1024);
const AI_TIMEOUT_MS = envInteger('AI_TIMEOUT_MS', 120000, 1000, 300000);
const MAX_CONCURRENT_REQUESTS = envInteger('MAX_CONCURRENT_REQUESTS', 2, 1, 20);
const RATE_LIMIT_MAX = envInteger('RATE_LIMIT_MAX', 20, 1, 1000);
const RATE_LIMIT_WINDOW_MS = envInteger('RATE_LIMIT_WINDOW_MS', 5 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
const PROXY_ROUTES = new Set(['/generate', '/longplan', '/feedback', '/updateplan']);
const STATIC_ROOT = path.resolve(__dirname, '..');
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const allowNullOrigin = process.env.ALLOW_NULL_ORIGIN === 'true'
  || (!process.env.ALLOWED_ORIGINS && process.env.NODE_ENV !== 'production');

let client = null;
let clientPromise = null;
let activeRequests = 0;
const rateBuckets = new Map();

async function getClient() {
  if (client) return client;
  if (!clientPromise) {
    clientPromise = (async () => {
      const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      if (!githubToken) {
        throw new Error('GITHUB_TOKEN is not configured');
      }
      const nextClient = new CopilotClient({ githubToken });
      await nextClient.start();
      client = nextClient;
      return client;
    })();
  }
  try {
    return await clientPromise;
  } finally {
    clientPromise = null;
  }
}

async function askAI(prompt) {
  const c = await getClient();
  const session = await c.createSession({
    model: 'claude-sonnet-4.5',
  });
  try {
    const response = await session.sendAndWait({ prompt }, AI_TIMEOUT_MS);
    return (response && response.data && response.data.content) || '';
  } finally {
    try {
      if (typeof session.destroy === 'function') await session.destroy();
      else if (typeof session.disconnect === 'function') await session.disconnect();
    } catch (_) {}
  }
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 응답에서 JSON을 찾을 수 없음: ' + text.slice(0, 200));
  return JSON.parse(match[0]);
}

async function generatePlans(input) {
  const { profile = {}, situation = '', date = '', dayOfWeek = '', presets = [] } = input;
  const prompt = `당신은 현실적인 하루 계획을 세워주는 전문가입니다. 아래 정보를 바탕으로 ${date} (${dayOfWeek})의 대략적인 하루 계획을 세워주세요.

[프로필]
- 이름: ${profile['이름'] || '미입력'}
- 생년월일: ${profile['생년월일'] || '미입력'}
- 직업: ${profile['직업'] || '미입력'}
- 목표: ${profile['목표'] || '미입력'}
- 평소 계획: ${profile['계획'] || '미입력'}

[현재 상황]
${situation || '미입력'}

${presets.length ? `[자주 하는 일과]\n${presets.join(', ')}\n` : ''}
규칙:
- 수면, 식사 등 기본 활동을 포함해 현실적으로 계획할 것
- 총 시간이 24시간을 넘지 않을 것
- 목표와 현재 상황을 최대한 반영할 것
- 4~8개 항목으로 구성할 것

반드시 아래 JSON 형식만 출력하세요 (다른 텍스트, 마크다운 코드 블록 없이 순수 JSON만):
{"plans":[{"name":"일과 이름","hours":시간(숫자)}]}`;

  const parsed = extractJson(await askAI(prompt));
  if (!Array.isArray(parsed.plans)) throw new Error('plans 배열 없음');
  return parsed.plans;
}

async function generateLongPlan(input) {
  const { profile = {}, presets = [] } = input;
  const prompt = `당신은 장기적인 생활 계획을 세워주는 전문가입니다. 아래 프로필을 바탕으로 규칙적이고 장기적이며 주기적인 생활 계획을 세워주세요.

[프로필]
- 이름: ${profile['이름'] || '미입력'}
- 생년월일: ${profile['생년월일'] || '미입력'}
- 직업: ${profile['직업'] || '미입력'}
- 목표: ${profile['목표'] || '미입력'}
- 현재 상황: ${profile['현재상황'] || '미입력'}
${presets.length ? `- 자주 하는 일과: ${presets.join(', ')}` : ''}

규칙:
- 단편적인 계획이 아닌 매일/매주 반복 가능한 규칙적·주기적 계획일 것
- 목표 달성을 위한 장기적 방향을 담을 것
- "매일 ~", "주 N회 ~", "매주 ~요일 ~" 같은 형식으로 구체적일 것
- 4~7줄로 간결하게, 현실적으로 지속 가능하게 작성할 것

반드시 아래 JSON 형식만 출력하세요 (순수 JSON만):
{"plan":"계획 내용 (줄바꿈은 \\n)","weekly":{"매일":[{"name":"일과","hours":시간}],"월":[{"name":"일과","hours":시간}],"화":[],"수":[],"목":[],"금":[],"토":[],"일":[]}}
- weekly의 "매일"에는 매일 반복하는 일과, 각 요일 키에는 그 요일에만 하는 일과를 넣으세요 (해당 없는 요일은 빈 배열)`;

  const parsed = extractJson(await askAI(prompt));
  if (typeof parsed.plan !== 'string') throw new Error('plan 문자열 없음');
  return { plan: parsed.plan, weekly: parsed.weekly || {} };
}

async function updatePlan(input) {
  const { profile = {}, history = [], presets = [] } = input;
  const historyText = history.length
    ? history.map(h => {
        const acts = (h.activities || []).map(a => `${a.name} ${a.hours}시간`).join(', ') || '기록 없음';
        return `- ${h.date} (${h.dayOfWeek}): ${acts}${typeof h.score === 'number' ? ` [계획 일치도 ${h.score}점]` : ''}`;
      }).join('\n')
    : '기록 없음';
  const prompt = `당신은 생활 습관 코치입니다. 사용자의 기존 장기 계획과 실제 행동 기록을 비교 분석하여, 더 현실적이고 지속 가능한 계획으로 수정해주세요.

[프로필]
- 직업: ${profile['직업'] || '미입력'}
- 목표: ${profile['목표'] || '미입력'}
- 현재 상황: ${profile['현재상황'] || '미입력'}
${presets.length ? `- 자주 하는 일과: ${presets.join(', ')}` : ''}

[기존 장기 계획]
${profile['계획'] || '미입력'}

[최근 실제 행동 기록]
${historyText}

임무:
1. 실제 행동 패턴(잘 지킨 것, 못 지킨 것, 시간대 습관)을 분석할 것
2. 무리했던 부분은 현실적으로 줄이고, 잘 지킨 부분은 유지·강화할 것
3. 목표 달성 방향은 유지하되 지속 가능하게 수정할 것
4. 규칙적·주기적 형식("매일 ~", "주 N회 ~", "매주 ~요일 ~")을 유지할 것
5. 4~7줄로 작성할 것

반드시 아래 JSON 형식만 출력하세요 (순수 JSON만):
{"analysis":"행동 패턴 분석 요약 (2~3문장)","plan":"수정된 계획 (줄바꿈은 \\n)","weekly":{"매일":[{"name":"일과","hours":시간}],"월":[],"화":[],"수":[],"목":[],"금":[],"토":[],"일":[]}}`;

  const parsed = extractJson(await askAI(prompt));
  if (typeof parsed.plan !== 'string') throw new Error('plan 문자열 없음');
  return { analysis: parsed.analysis || '', plan: parsed.plan, weekly: parsed.weekly || {} };
}

async function generateFeedback(input) {
  const { profile = {}, schedule = [], date = '', comments = {} } = input;
  const scheduleText = schedule.length
    ? schedule.map(s => `- ${s.name}: ${s.times.join(', ')} (총 ${Math.floor(s.totalMinutes/60)}시간 ${s.totalMinutes%60}분)`).join('\n')
    : '기록 없음';
  const commentText = Object.entries(comments).filter(([,v]) => v).map(([k,v]) => `- ${k}: ${v}`).join('\n') || '없음';
  const prompt = `당신은 생활 습관 코치입니다. 사용자의 장기 계획과 실제 하루 일과를 비교하여 피드백해주세요.

[프로필]
- 직업: ${profile['직업'] || '미입력'}
- 목표: ${profile['목표'] || '미입력'}
- 현재 상황: ${profile['현재상황'] || '미입력'}

[장기 계획 (프로필에 등록된 계획)]
${profile['계획'] || '미입력'}

[${date} 실제 일과 기록]
${scheduleText}

[사용자의 하루 소감]
${commentText}

임무:
1. 실제 일과가 장기 계획과 얼마나 일치하는지 0~100점으로 평가
2. 한 줄 총평
3. 괴리가 크다면(70점 미만) 실패 원인을 구체적으로 분석하여 정리
4. 개선 방안 2~4가지 도출 (실행 가능하고 구체적으로)
5. 비판단적이고 격려하는 어조로 작성

반드시 아래 JSON 형식만 출력하세요 (순수 JSON만):
{"score":숫자,"summary":"한 줄 총평","causes":["실패 원인1","원인2"],"improvements":["개선 방안1","방안2"]}
(일치도가 높아 원인 분석이 불필요하면 causes는 빈 배열)`;

  const parsed = extractJson(await askAI(prompt));
  if (typeof parsed.score !== 'number') throw new Error('score 없음');
  return parsed;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function requestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${forwardedProto}://${req.headers.host}`;
}

function isAllowedOrigin(req, origin) {
  if (!origin) return true;
  if (origin === requestOrigin(req)) return true;
  if (origin === 'null') return allowNullOrigin;
  if (configuredOrigins.includes('*')) return true;
  return configuredOrigins.includes(origin);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  if (origin && isAllowedOrigin(req, origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  return !origin || isAllowedOrigin(req, origin);
}

function getClientAddress(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) return String(forwardedFor).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function rateLimitStatus(address) {
  const now = Date.now();
  const bucket = rateBuckets.get(address);
  if (!bucket || now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(address, { startedAt: now, count: 1 });
    if (rateBuckets.size > 10000) {
      for (const [key, value] of rateBuckets) {
        if (now - value.startedAt >= RATE_LIMIT_WINDOW_MS) rateBuckets.delete(key);
      }
    }
    return null;
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - bucket.startedAt)) / 1000));
  }
  bucket.count += 1;
  return null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let rejected = false;

    req.on('data', chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        req.resume();
        const error = new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          const error = new Error('JSON body must be an object');
          error.statusCode = 400;
          throw error;
        }
        resolve(input);
      } catch (error) {
        if (!error.statusCode) error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Request aborted')));
  });
}

function serveStatic(pathname, res) {
  const files = {
    '/': 'daily-planner.html',
    '/daily-planner.html': 'daily-planner.html',
    '/planner-config.js': 'planner-config.js',
  };
  const filename = files[pathname];
  if (!filename) return false;

  const filePath = path.join(STATIC_ROOT, filename);
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') sendJson(res, 404, { error: 'Not found' });
      else sendJson(res, 500, { error: 'Unable to read static file' });
      return;
    }
    const contentType = filename.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
  return true;
}

async function handleProxyRequest(req, res, pathname) {
  if (!applyCors(req, res)) {
    sendJson(res, 403, { error: 'Origin is not allowed' });
    return;
  }
  const retryAfter = rateLimitStatus(getClientAddress(req));
  if (retryAfter) {
    res.setHeader('Retry-After', String(retryAfter));
    sendJson(res, 429, { error: 'Too many requests' });
    return;
  }
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    sendJson(res, 503, { error: 'AI proxy is busy; try again shortly' });
    return;
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    sendJson(res, 415, { error: 'Content-Type must be application/json' });
    return;
  }

  activeRequests += 1;
  try {
    const input = await readJsonBody(req);
    let result;
    if (pathname === '/generate') result = { plans: await generatePlans(input) };
    else if (pathname === '/longplan') result = await generateLongPlan(input);
    else if (pathname === '/updateplan') result = await updatePlan(input);
    else result = await generateFeedback(input);
    sendJson(res, 200, result);
  } catch (error) {
    const statusCode = error.statusCode || (error.message === 'GITHUB_TOKEN is not configured' ? 503 : 500);
    if (statusCode >= 500) console.error('Proxy request failed:', statusCode, pathname);
    else console.warn('Proxy request rejected:', statusCode, pathname);
    sendJson(res, statusCode, {
      error: statusCode >= 500 ? 'AI proxy request failed' : error.message,
    });
  } finally {
    activeRequests -= 1;
  }
}

const server = http.createServer((req, res) => {
  setSecurityHeaders(res);
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    if (!applyCors(req, res)) {
      sendJson(res, 403, { error: 'Origin is not allowed' });
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && PROXY_ROUTES.has(pathname)) {
    handleProxyRequest(req, res, pathname);
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { ok: true, ready: Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN) });
    return;
  }

  if (req.method === 'GET' && pathname === '/ready') {
    if (!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN)) {
      sendJson(res, 503, { ok: false, ready: false });
      return;
    }
    sendJson(res, 200, { ok: true, ready: true });
    return;
  }

  if (req.method === 'GET' && serveStatic(pathname, res)) {
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`AI proxy listening on ${HOST}:${PORT}`);
});
server.requestTimeout = AI_TIMEOUT_MS + 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;

function shutdown(signal) {
  server.close(async error => {
    if (error) {
      console.error(`Failed to close server on ${signal}:`, error.message);
      process.exitCode = 1;
      return;
    }
    if (client && typeof client.stop === 'function') {
      try {
        await client.stop();
      } catch (stopError) {
        console.error(`Failed to stop Copilot client on ${signal}:`, stopError.message);
        process.exitCode = 1;
      }
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
