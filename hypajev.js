//@name hypajev
//@display-name HypaJev
//@api 3.0
//@version 0.0.3
//@update-url https://raw.githubusercontent.com/happydesk213124/HypaJev/main/hypajev.js
//@arg jev_api_key string (선택) Jev API 키. 🧠 HypaJev 화면의 설정에서 넣어도 됩니다.

// ============================================================================
// HypaJev — 원문을 그대로 두고, 필요할 때 찾아서 넣는 장기기억 (글 쓰는 모델 없이)
//
//  저장 (보낼 때, Risu 요청에서 빠진 메시지만)
//    원문을 문장 2~4개 조각으로 자르고 임베딩만 한다. Jev는 부르지 않는다.
//    원문은 Risu 채팅에 이미 있으니 저장하지 않는다. 기기 저장소에는 조각마다 1비트 벡터(32바이트)만.
//
//  회상 (보낼 때)
//    ① 임베딩 + 글자(두 글자 조각) 검색을 섞어 후보 몇 개
//    ② Jev 1번: 조각마다 "지금 답하거나 이어 쓰는 데 필요한가" 0~3점 + 빠진 근거 → 있으면 한 번 더 찾기
//    ③ 고른 조각의 앞뒤 조각을 같이 (앞뒤 맥락)
//    ④ 방금 빠진 대화 꼬리(최근 흐름)를 조금
//    ⑤ 원래 순서대로 이어 붙여 최신 입력 앞에 넣는다
// ============================================================================

(async () => {
  'use strict';

  const R = globalThis.risuai ?? globalThis.Risuai;
  const LOG = '[HypaJev]';
  const KEY = 'hypajev_';
  const SETTINGS_KEY = 'hypajev_settings';
  const PLACEHOLDER = /\[hypajev\]/gi;

  // ── 프로바이더 ──
  const JEV_PRESETS = {
    openrouter: {
      label: 'OpenRouter', badge: '추천', desc: 'OpenRouter 키 하나로 Jev와 임베딩을 같이 써요.', endpoint: 'https://openrouter.ai/api/v1/systemone', model: 'typesafe/jev-1.14', keyHint: 'sk-or-v1-…', keyUrl: 'https://openrouter.ai/keys',
      models: [
        { id: 'typesafe/jev-1.14', label: 'Jev 1.14' },
        { id: '~typesafe/jev-latest', label: 'Jev 최신 (새 버전 나오면 자동으로 바뀜)' },
        { id: 'typesafe/jev-1.13', label: 'Jev 1.13 (이전 버전)' },
      ],
    },
    typesafe: {
      label: 'TypeSafe 직결', desc: 'TypeSafe 콘솔에서 받은 키를 써요.', endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest', keyHint: 'TypeSafe API 키', keyUrl: 'https://console.typesafe.ai',
      models: [
        { id: 'jev-latest', label: 'Jev 최신 (새 버전 나오면 자동으로 바뀜)' },
        { id: 'jev-1.14.0', label: 'Jev 1.14' },
        { id: 'jev-1.13.0', label: 'Jev 1.13 (이전 버전)' },
        { id: 'jev-preview', label: 'Jev 미리보기 (실험용)' },
      ],
    },
    custom: { label: '직접 입력', desc: 'System One 형식을 받는 다른 주소.', endpoint: '', model: '', keyHint: 'API 키', models: [] },
  };

  const EMBED_PRESETS = {
    openrouter: { label: 'OpenRouter', badge: 'Jev와 같은 키', desc: '키를 따로 넣을 필요가 없어요. 아주 싸요.', format: 'openai', endpoint: 'https://openrouter.ai/api/v1/embeddings', model: 'openai/text-embedding-3-small', models: ['openai/text-embedding-3-small', 'openai/text-embedding-3-large', 'qwen/qwen3-embedding-0.6b'], key: 'jev', mrl: true },
    local: { label: '무료 · API 없음', badge: '설정 없음', desc: '글자 조각으로 비슷한 정도를 계산해요. 표현이 많이 다르면 놓쳐요.', format: 'local', key: 'none' },
    openai: { label: 'OpenAI', desc: 'OpenAI 키를 써요.', format: 'openai', endpoint: 'https://api.openai.com/v1/embeddings', model: 'text-embedding-3-small', models: ['text-embedding-3-small', 'text-embedding-3-large'], key: 'own', mrl: true, keyUrl: 'https://platform.openai.com/api-keys' },
    gemini: { label: 'Google Gemini', desc: '무료 한도가 넉넉해요.', format: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-embedding-001', models: ['gemini-embedding-001'], key: 'own', mrl: true, keyUrl: 'https://aistudio.google.com/apikey' },
    voyage: { label: 'Voyage AI', desc: '검색 품질이 좋은 편이에요.', format: 'openai', endpoint: 'https://api.voyageai.com/v1/embeddings', model: 'voyage-4-lite', models: ['voyage-4-lite', 'voyage-4', 'voyage-4-large'], key: 'own', keyUrl: 'https://dashboard.voyageai.com' },
    jina: { label: 'Jina AI', desc: '다국어에 강해요.', format: 'openai', endpoint: 'https://api.jina.ai/v1/embeddings', model: 'jina-embeddings-v3', models: ['jina-embeddings-v3'], key: 'own', keyUrl: 'https://jina.ai/api-dashboard' },
    ollama: { label: 'Ollama', badge: '내 컴퓨터', desc: '내 컴퓨터에서 돌려요. 무료.', format: 'ollama', endpoint: 'http://localhost:11434', model: 'bge-m3', models: ['bge-m3', 'nomic-embed-text', 'mxbai-embed-large'], key: 'none' },
    lmstudio: { label: 'LM Studio', badge: '내 컴퓨터', desc: '내 컴퓨터에서 돌려요. 무료.', format: 'openai', endpoint: 'http://localhost:1234/v1/embeddings', model: 'text-embedding-bge-m3', key: 'none' },
    custom: { label: '직접 입력', desc: 'OpenAI 형식(/embeddings)을 받는 주소.', format: 'openai', endpoint: '', model: '', key: 'own' },
  };


  const RANK_LEVELS = ['unrelated', 'background only', 'useful context', 'answers or explains the latest message'];
  const SEARCH_NEEDS = {
    none: 'nothing important is missing',
    fact: 'a specific earlier fact the latest message asks about (name, number, place, wording)',
    cause: 'the earlier promise, instruction, or motive behind the current action',
    change: 'a later update or correction to a recorded state or plan',
    knowledge: 'who learned, heard, or believes the information',
  };
  const NEED_QUERY = { fact: 'earlier record of', cause: 'earlier reason or promise behind', change: 'latest update or correction about', knowledge: 'who knows or told about' };
  const DEFAULT_NOTE = 'Earlier chat excerpts in original wording, oldest first. Later excerpts may update earlier ones; the current chat wins.';

  const VEC_BITS = 256;           // 조각마다 256칸의 부호만 저장 (32바이트). V7에서 실수 벡터와 점수 같음
  const KEEP_LEVEL = 1.5;         // Jev 점수(0~3)가 이 이상이면 넣는다
  const EMBED_BATCH = 64;
  const JEV_TIMEOUT_MS = 20000;
  const EMBED_TIMEOUT_MS = 20000;
  const LOCAL_DIMS = 384;
  const SHARDS = 16;              // 채팅마다 벡터를 16조각으로 나눠 저장 (바뀐 조각만 쓴다)
  const SAVE_DELAY = 1500;

  const DEFAULT_SETTINGS = {
    enabled: true, onboarded: false,
    jevPreset: 'openrouter', jevKey: '', jevEndpoint: '', jevModel: '',
    embedPreset: 'openrouter', embedKey: '', embedEndpoint: '', embedModel: '',
    budget: 600, candidates: 16, neighbor: 1, tailTokens: 120, indexPerSend: 100,
    injectMode: 'last_user', note: DEFAULT_NOTE, showButton: true,
  };

  const stats = { jevCalls: 0, embedCalls: 0, lastError: '', lastErrorAt: 0 };

  // ── 유틸 ──
  function hashText(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function estimateTokens(text) {
    let t = 0;
    for (const ch of text) { const c = ch.charCodeAt(0); t += c >= 0xac00 && c <= 0xd7af ? 0.8 : c >= 0x3040 && c <= 0x9fff ? 0.9 : 0.25; }
    return Math.ceil(t);
  }
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const nowMs = () => (globalThis.performance?.now?.() ?? Date.now());
  function contentOf(message) {
    const c = message?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : p?.text ?? '')).join('\n');
    return '';
  }
  function cleanText(text) {
    return String(text ?? '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\{\{[^}]*\}\}/g, ' ')
      // 삽화 · 에셋 태그([[@inray::…::그림.webp::1024::1024]] 같은 [[…::…]])와 마크다운 그림은 기억에서 뺀다 (Risu는 화면에서만 그림으로 바꾼다)
      .replace(/\[\[[^[\]\n]{0,400}?::[^[\]\n]{0,1000}?\]\]/g, ' ')
      .replace(/!\[[^\]\n]{0,200}\]\([^)\n]{0,1000}\)/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }
  // 모델의 생각 블록 · OOC 같은 건 기억에서 뺀다
  const META_BLOCK = /<(thinking|think|thoughts?|reasoning|scratchpad|plan|planning|ooc|analysis|reflection)\b[^>]*>[\s\S]*?<\/\1>/gi;
  const stripMeta = (t) => String(t ?? '').replace(META_BLOCK, ' ').replace(/\[(?:OOC|ooc|System|SYSTEM|Note|NOTE)[^\]]*\]/g, ' ').replace(/\((?:OOC|ooc)[^)]*\)/g, ' ');
  // 코드 블록(```) 안의 글도 원문이라 남긴다 (상태창 등). 울타리 표시만 뗀다.
  const memText = (t) => cleanText(stripMeta(String(t ?? '').replace(/```[a-zA-Z0-9_-]*/g, ' ')));
  function clampNum(v, fallback, min, max) { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback; }
  function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `${s}초 전`;
    if (s < 3600) return `${Math.round(s / 60)}분 전`;
    if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
    return `${Math.round(s / 86400)}일 전`;
  }
  function setError(where, error) {
    stats.lastError = `${where}: ${String(error?.message ?? error)}`;
    stats.lastErrorAt = Date.now();
    console.error(LOG, where, error);
  }
  function cleanKey(k) {
    return String(k ?? '').replace(/[\s​-‍⁠﻿]/g, ' ').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/^bearer\s+/i, '').replace(/\s+/g, '');
  }
  function keyProblem(k, label) {
    if (!k) return `${label} 키가 비어 있어요.`;
    if (/[^\x21-\x7e]/.test(k)) return `${label} 키에 영문·숫자가 아닌 글자가 섞여 있어요. 키를 다시 복사해 붙여넣어 주세요.`;
    return '';
  }
  function friendlyHttpError(label, status, body) {
    const raw = String(body ?? '').slice(0, 160);
    if (status === 401) return `${label}: 키가 맞지 않아요. (${raw})`;
    if (status === 402) return `${label}: 크레딧이 부족해요. (${raw})`;
    if (status === 403) return `${label}: 이 키로는 쓸 수 없는 모델이거나 권한이 없어요. (${raw})`;
    if (status === 404) return `${label}: 주소나 모델 이름을 찾을 수 없어요. (${raw})`;
    if (status === 429) return `${label}: 요청이 너무 많아요. 잠시 뒤 다시 해 주세요. (${raw})`;
    if (status >= 500) return `${label}: 서버 쪽 문제예요. (${status} ${raw})`;
    return `${label} ${status}: ${raw}`;
  }

  // ══ 설정 ══
  let settings = { ...DEFAULT_SETTINGS };
  function sanitizeSettings(raw) {
    const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const out = {
      enabled: s.enabled !== false,
      // 키를 이미 넣어 둔 사람은 시작 안내를 다시 띄우지 않는다
      onboarded: s.onboarded === true || !!cleanKey(s.jevKey),
      jevPreset: JEV_PRESETS[s.jevPreset] ? s.jevPreset : 'openrouter',
      jevKey: cleanKey(s.jevKey), jevEndpoint: str(s.jevEndpoint), jevModel: str(s.jevModel),
      embedPreset: EMBED_PRESETS[s.embedPreset] ? s.embedPreset : 'openrouter',
      embedKey: cleanKey(s.embedKey), embedEndpoint: str(s.embedEndpoint), embedModel: str(s.embedModel),
      budget: clampNum(s.budget, 600, 0, 20000),
      candidates: clampNum(s.candidates, 16, 4, 80),
      neighbor: clampNum(s.neighbor, 1, 0, 3),
      tailTokens: clampNum(s.tailTokens, 120, 0, 2000),
      indexPerSend: clampNum(s.indexPerSend, 100, 1, 5000),
      injectMode: s.injectMode === 'system' ? 'system' : 'last_user',
      note: typeof s.note === 'string' ? s.note.trim() : DEFAULT_NOTE,
      showButton: s.showButton !== false,
    };
    if (out.jevPreset !== 'custom') { out.jevEndpoint ||= JEV_PRESETS[out.jevPreset].endpoint; out.jevModel ||= JEV_PRESETS[out.jevPreset].model; }
    const ep = EMBED_PRESETS[out.embedPreset];
    if (out.embedPreset !== 'custom' && ep.format !== 'local') { out.embedEndpoint ||= ep.endpoint; out.embedModel ||= ep.model; }
    return out;
  }
  async function loadSettings() {
    let stored = null;
    try { stored = await R.pluginStorage.getItem(SETTINGS_KEY); } catch { }
    if (typeof stored === 'string') { try { stored = JSON.parse(stored); } catch { stored = null; } }
    settings = sanitizeSettings(stored);
    if (!settings.jevKey) {
      try { const arg = await R.getArgument('jev_api_key'); if (typeof arg === 'string' && arg.trim()) settings.jevKey = cleanKey(arg); } catch { }
    }
  }
  async function saveSettings(next) {
    const before = embedProfile();
    settings = sanitizeSettings(next);
    await R.pluginStorage.setItem(SETTINGS_KEY, { ...settings });
    try { await R.setArgument?.('jev_api_key', settings.jevKey); } catch { }
    if (embedProfile() !== before) { queryCache.clear(); await reloadVectors(); }
    await syncButton();
  }
  const ready = () => settings.enabled && !!settings.jevKey;

  // ══ Jev · 임베딩 호출 ══
  const doFetch = R.nativeFetch ? (url, init) => R.nativeFetch(url, init) : (url, init) => fetch(url, init);
  async function fetchJson(url, init, timeoutMs, label) {
    let timer;
    try {
      const resp = await Promise.race([doFetch(url, init), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 응답 시간 초과`)), timeoutMs); })]);
      if (!resp.ok) { const text = await resp.text().catch(() => ''); const err = new Error(friendlyHttpError(label, resp.status, text)); err.status = resp.status; throw err; }
      try { return await resp.json(); } catch { throw new Error(`${label} 응답을 읽지 못했어요. 주소나 형식을 확인해 주세요.`); }
    } finally { clearTimeout(timer); }
  }

  async function callJev(state, questions, cfg = settings) {
    const key = cleanKey(cfg.jevKey);
    const kp = keyProblem(key, 'Jev');
    if (kp) throw new Error(kp);
    if (!cfg.jevEndpoint || !cfg.jevModel) throw new Error('Jev 주소나 모델이 비어 있어요.');
    const t = nowMs();
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: cfg.jevModel, state, questions }) };
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 800));
      try {
        const data = await fetchJson(cfg.jevEndpoint, init, JEV_TIMEOUT_MS, 'Jev');
        const answers = data?.answers ?? data;
        if (!answers || typeof answers !== 'object') throw new Error('Jev 응답 형식이 이상해요.');
        stats.jevCalls++;
        recordCall('jev', nowMs() - t, Object.keys(questions).length);
        return answers;
      } catch (error) {
        lastError = error;
        if (!(error.status === 429 || error.status >= 500 || /시간 초과|fetch|network/i.test(String(error?.message)))) break;
      }
    }
    recordCall('jev', nowMs() - t, Object.keys(questions).length, false);
    throw lastError;
  }

  function embedConfig(cfg = settings) {
    const p = EMBED_PRESETS[cfg.embedPreset] ?? EMBED_PRESETS.local;
    const key = cleanKey(p.key === 'jev' ? (cfg.embedKey || cfg.jevKey) : cfg.embedKey);
    return { format: p.format, endpoint: cfg.embedEndpoint || p.endpoint, model: cfg.embedModel || p.model, key, needsKey: p.key === 'own' };
  }
  function embedProfile(cfg = settings) {
    const e = embedConfig(cfg);
    return e.format === 'local' ? `local:${LOCAL_DIMS}` : `${e.format}:${e.endpoint}:${e.model}`;
  }
  function normalize(v) {
    let n = 0;
    for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
    return out;
  }
  function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
  const PARTICLE = /(에서|으로|에게|까지|부터|이고|이며|이었|였|은|는|이|가|을|를|의|에|로|와|과|도|야|이야)$/u;
  function hashEmbed(text) {
    const v = new Float32Array(LOCAL_DIMS);
    const add = (feat, w) => { const h = fnv(feat); v[h % LOCAL_DIMS] += (h & 0x80000000 ? -1 : 1) * w; };
    const lower = cleanText(text).toLowerCase();
    for (const raw of lower.split(/[^0-9a-z぀-鿿가-힯]+/).filter(Boolean)) { const w = raw.replace(PARTICLE, ''); if (w.length >= 2) add(`w:${w}`, 1); }
    const g = lower.replace(/[^0-9a-z぀-鿿가-힯]/g, '');
    for (let i = 0; i < g.length - 1; i++) add(`g:${g.slice(i, i + 2)}`, 0.5);
    return normalize(v);
  }
  async function embedTexts(texts, purpose, cfg = settings) {
    const e = embedConfig(cfg);
    if (e.format === 'local') return texts.map(hashEmbed);
    if (e.needsKey || e.key) { const kp = keyProblem(e.key, '임베딩'); if (kp) throw new Error(kp); }
    if (!e.endpoint || !e.model) throw new Error('임베딩 주소나 모델이 비어 있어요.');
    const out = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const part = texts.slice(i, i + EMBED_BATCH).map(t => clip(t, 2000));
      const t0 = nowMs();
      let vectors;
      try {
        if (e.format === 'gemini') {
          const url = `${e.endpoint.replace(/\/$/, '')}/models/${encodeURIComponent(e.model)}:batchEmbedContents?key=${encodeURIComponent(e.key)}`;
          const data = await fetchJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: part.map(t => ({ model: `models/${e.model}`, content: { parts: [{ text: t }] }, outputDimensionality: VEC_BITS })) }) }, EMBED_TIMEOUT_MS, '임베딩');
          vectors = (data?.embeddings ?? []).map(x => x?.values);
        } else if (e.format === 'ollama') {
          const data = await fetchJson(`${e.endpoint.replace(/\/$/, '')}/api/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: e.model, input: part }) }, EMBED_TIMEOUT_MS, '임베딩');
          vectors = data?.embeddings ?? [];
        } else {
          const headers = { 'Content-Type': 'application/json' };
          if (e.key) headers.Authorization = `Bearer ${e.key}`;
          const data = await fetchJson(e.endpoint, { method: 'POST', headers, body: JSON.stringify({ model: e.model, input: part }) }, EMBED_TIMEOUT_MS, '임베딩');
          vectors = (data?.data ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(x => x?.embedding);
        }
        if (vectors.length !== part.length || vectors.some(v => !Array.isArray(v) || !v.length)) throw new Error('임베딩 응답 개수나 형식이 맞지 않아요.');
      } catch (error) { recordCall('embed', nowMs() - t0, part.length, false, purpose); throw error; }
      stats.embedCalls++;
      recordCall('embed', nowMs() - t0, part.length, true, purpose);
      for (const v of vectors) out.push(normalize(v));
    }
    return out;
  }

  // 벡터는 앞 512칸의 부호(1비트)만 남긴다. 질문 쪽은 실수 그대로 비교한다(비대칭).
  // MRL(앞부분만 잘라 써도 되는) 임베딩이 아니면 정확도가 조금 떨어질 수 있다.
  const qShrink = (v) => normalize(v.length > VEC_BITS ? v.subarray(0, VEC_BITS) : v);
  function toSigns(v) {
    const s = v.length > VEC_BITS ? v.subarray(0, VEC_BITS) : v;
    const o = new Int8Array(s.length);
    for (let i = 0; i < s.length; i++) o[i] = s[i] >= 0 ? 1 : -1;
    return o;
  }
  function packSigns(signs) {
    const bytes = new Uint8Array(Math.ceil(signs.length / 8));
    for (let i = 0; i < signs.length; i++) if (signs[i] > 0) bytes[i >> 3] |= 1 << (i & 7);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function unpackSigns(b64, n) {
    const bin = atob(b64);
    const o = new Int8Array(n);
    for (let i = 0; i < n; i++) o[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1 ? 1 : -1;
    return o;
  }
  function simSigns(q, s) {
    let t = 0;
    const n = Math.min(q.length, s.length);
    for (let i = 0; i < n; i++) t += q[i] * s[i];
    return t / Math.sqrt(n || 1);
  }

  // ══ 디버그: 단계별 시간 (메모리에만) ══
  const debugLog = [];
  const DEBUG_MAX = 40;
  let curTrace = null;
  function beginTrace(kind) { curTrace = { kind, at: Date.now(), t0: nowMs(), steps: [], calls: [], ms: 0, note: '' }; return curTrace; }
  async function timed(tr, name, fn, detail) {
    const t = nowMs();
    try { return await fn(); } finally { tr?.steps.push({ name, ms: Math.round(nowMs() - t), detail: typeof detail === 'function' ? detail() : (detail ?? '') }); }
  }
  function endTrace(tr) {
    if (!tr) return;
    tr.ms = Math.round(nowMs() - tr.t0);
    if (curTrace === tr) curTrace = null;
    debugLog.unshift(tr);
    if (debugLog.length > DEBUG_MAX) debugLog.pop();
    if (ui.tab === 'debug' && ui.open) render();
  }
  function recordCall(kind, ms, size, ok = true, purpose = '') {
    curTrace?.calls.push({ kind, purpose: purpose || (kind === 'jev' ? 'Jev 채점' : '임베딩'), ms: Math.round(ms), size, ok });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  채팅 · 조각 · 색인
  // ══════════════════════════════════════════════════════════════════════
  //
  // timeline: 채팅 메시지를 순서대로 { key, role, text } — 채팅을 열 때 원본을 한 번 읽고, 그 뒤로는 요청에 실린 것을 이어 붙인다.
  // chunks:   timeline을 조각낸 것 { mi(메시지 번호), pos, text, len, vec(Int8Array|null) } — 원래 순서 그대로
  // 벡터는 메시지 글의 지문(hash)으로 저장한다. 같은 글이면 같은 벡터, 글이 바뀌면 새로 계산.

  let chatKey = '';
  let chatLabel = { char: '', chat: '' };
  let timeline = [];
  let chunks = [];
  let msgStart = [];              // 메시지 번호 → 첫 조각 번호
  const postings = new Map();     // 두 글자 조각 → 조각 번호 목록
  let vecStore = new Map();       // 메시지 지문 → { n, b64: [] } (기기 저장소에서 읽은 것 + 새로 만든 것)
  let dirtyShards = new Set();
  let localStore = null;
  let saveTimer = null;
  let saveChain = Promise.resolve();
  const characterCache = { index: -1, chaId: '', name: '', firstMessage: '', alternateGreetings: [] };
  let personaCache = '';
  let identityCache = null;
  const queryCache = new Map();
  let lastRecall = null;
  let lastWindowLen = 0;
  let backlogWarned = '';
  let busy = false;
  let job = null;

  const msgKey = (role, text) => `h:${hashText(role + '\u0000' + text)}`;
  const looseKey = (role, text) => `l:${hashText(role + '\u0000' + memText(text).replace(/[\s\p{P}\p{S}]/gu, '').slice(0, 400))}`;
  const shardOf = (k) => fnv(k) % SHARDS;

  /** 문장으로 자르고 2~4문장씩 묶는다 (짧으면 더 묶고, 길면 끊는다) */
  function chunkText(text, { minChars = 120, maxChars = 360, maxSentences = 4 } = {}) {
    const sentences = String(text).split(/(?<=[.!?。…~][”"’']?)\s+|\n+/u).map(s => s.trim()).filter(Boolean);
    const out = [];
    let cur = [], len = 0;
    for (const s of sentences) {
      if (cur.length && (len + s.length > maxChars || cur.length >= maxSentences)) { out.push(cur.join(' ')); cur = []; len = 0; }
      // 문장 하나가 너무 길면 쪼갠다
      if (s.length > maxChars * 1.5) { for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars)); continue; }
      cur.push(s);
      len += s.length;
      if (len >= minChars && cur.length >= 2) { out.push(cur.join(' ')); cur = []; len = 0; }
    }
    if (cur.length) {
      const rest = cur.join(' ');
      if (out.length && rest.length < 40) out[out.length - 1] += ' ' + rest;
      else out.push(rest);
    }
    return out;
  }

  function gramsOf(text) {
    const g = new Set();
    for (const raw of String(text).toLowerCase().replace(/[^0-9a-z가-힯぀-鿿]+/g, ' ').split(' ')) {
      const w = raw.replace(PARTICLE, '');
      if (!w) continue;
      if (w.length === 1) { if (/[0-9]/.test(w)) g.add(w); continue; }
      for (let i = 0; i < w.length - 1; i++) g.add(w.slice(i, i + 2));
    }
    return g;
  }

  /** 메시지 하나를 조각내서 끝에 붙인다 */
  function appendMessage(m) {
    const mi = timeline.length;
    timeline.push(m);
    msgStart.push(chunks.length);
    const parts = chunkText(memText(m.text));
    const stored = vecStore.get(m.key);
    const fits = stored && stored.n === parts.length && stored.p === embedProfile();
    parts.forEach((text, pos) => {
      const id = chunks.length;
      const grams = gramsOf(text);
      chunks.push({ id, mi, pos, text, len: grams.size, vec: fits ? unpackSigns(stored.b64[pos], VEC_BITS) : null });
      for (const g of grams) { let p = postings.get(g); if (!p) postings.set(g, p = []); p.push(id); }
    });
  }

  function rebuildChunks() {
    const tl = timeline;
    timeline = []; chunks = []; msgStart = []; postings.clear();
    for (const m of tl) appendMessage(m);
  }

  /** 마지막 요청 이후 timeline 끝을 이번 요청과 맞춘다. 겹치는 부분은 이번 요청 글로 바꾸고(고친 메시지), 새 것은 붙인다. */
  function syncWindow(entries) {
    const TAIL = 60;
    const from = Math.max(0, timeline.length - TAIL);
    const prev = timeline.slice(from);
    const s = overlapStart(prev, entries);
    const keep = from + s;   // 여기까지는 그대로, 그 뒤는 이번 요청으로 바꾼다
    const replaced = timeline.length - keep;
    const same = replaced <= entries.length && timeline.slice(keep).every((m, i) => m.key === entries[i].key);
    if (same) { for (const e of entries.slice(replaced)) appendMessage(e); return; }
    timeline = timeline.slice(0, keep).concat(entries);
    rebuildChunks();
  }

  /**
   * 지난 목록(prev)의 뒷부분이 이번 요청(cur)의 앞부분과 겹치기 시작하는 prev 번호.
   * 꼭 맞는 곳이 먼저, 그다음 고치거나 지운 메시지가 섞인 곳(순서대로 절반 넘게 그대로), 없으면 prev.length.
   * 보낼 때마다 맨 끝은 새 메시지라 그건 겹침으로 보지 않는다(같은 요청을 다시 보내는 리롤은 꼭 맞음으로 잡힌다).
   */
  function overlapStart(prev, cur) {
    const same = (p, c) => p.key === c.key || (!!p.loose && p.loose === c.loose);
    for (let i = 0; i < prev.length; i++) {
      const L = prev.length - i;
      if (L > cur.length) continue;
      let ok = true;
      for (let k = 0; k < L && ok; k++) ok = same(prev[i + k], cur[k]);
      if (ok) return i;
    }
    const head = cur.slice(0, -1);
    for (let i = 0; i < prev.length; i++) {
      const L = prev.length - i;
      if (L < 2) break;
      if (!head.some(c => same(prev[i], c))) continue; // 겹침은 이번 요청에 있는 메시지에서 시작해야 한다
      let j = 0, hit = 0;
      for (let k = i; k < prev.length; k++) { const at = head.findIndex((c, x) => x >= j && same(prev[k], c)); if (at >= 0) { hit++; j = at + 1; } }
      if (hit >= Math.max(2, Math.ceil(L / 2))) return i;
    }
    return prev.length;
  }

  function chatEntries(messages) {
    const out = [];
    for (const m of messages) {
      if (!m || m.removable !== true || (m.role !== 'user' && m.role !== 'assistant')) continue;
      const text = contentOf(m);
      if (!text.trim()) continue;
      out.push({ role: m.role, text, key: msgKey(m.role, text), loose: looseKey(m.role, text) });
    }
    return out;
  }

  function resolveNames(text) {
    const c = characterCache.name || 'char';
    const u = personaCache || 'user';
    return String(text ?? '').replace(/\{\{\s*char\s*\}\}|<char>/gi, c).replace(/\{\{\s*user\s*\}\}|<user>/gi, u);
  }

  /** 채팅 원본(첫 인사말 + 메시지 전부)을 timeline 형태로 */
  function rawTimeline(chat) {
    if (!chat || !Array.isArray(chat.message)) return [];
    const out = [];
    const fm = Number(chat.fmIndex ?? -1);
    const greet = fm >= 0 && characterCache.alternateGreetings?.[fm] != null ? characterCache.alternateGreetings[fm] : characterCache.firstMessage;
    const push = (role, raw) => { const text = resolveNames(raw); if (text.trim()) out.push({ role, text, key: msgKey(role, text), loose: looseKey(role, text) }); };
    if (greet && String(greet).trim()) push('assistant', greet);
    for (const m of chat.message) push(m?.role === 'user' ? 'user' : 'assistant', String(m?.data ?? ''));
    return out;
  }

  async function readChatIdentity() {
    const charIndex = await R.getCurrentCharacterIndex();
    if (charIndex == null || charIndex < 0) return null;
    const chatIndex = await R.getCurrentChatIndex();
    if (identityCache && identityCache.charIndex === charIndex && identityCache.chatIndex === chatIndex) return { ...identityCache.id, cached: true };
    if (characterCache.index !== charIndex) {
      let character = null;
      try { character = R.getCharacterFromIndex ? await R.getCharacterFromIndex(charIndex) : await R.getCharacter(); } catch { }
      characterCache.index = charIndex;
      characterCache.chaId = character?.chaId ?? `idx${charIndex}`;
      characterCache.name = character?.name ?? '';
      characterCache.firstMessage = character?.firstMessage ?? '';
      characterCache.alternateGreetings = character?.alternateGreetings ?? [];
    }
    let chat = null;
    try { chat = await R.getChatFromIndex(charIndex, chatIndex); } catch { }
    const id = { key: `${characterCache.chaId}_${chat?.id || `idx${chatIndex}`}`, char: characterCache.name, chat: chat?.name ?? '' };
    identityCache = { charIndex, chatIndex, id };
    return { ...id, chatObj: chat };
  }

  async function personaName(chat) {
    try {
      const db = await R.getDatabase?.(['personas', 'selectedPersona']);
      const personas = db?.personas ?? [];
      const bound = chat?.bindedPersona ? personas.find(p => p.id === chat.bindedPersona) : null;
      return bound?.name ?? personas[db?.selectedPersona]?.name ?? '';
    } catch { return ''; }
  }

  /** 채팅이 바뀌었으면 원본을 한 번 읽고, 저장해 둔 벡터를 붙인다. 같은 채팅이면 아무것도 안 읽는다. */
  async function ensureChat() {
    const id = await readChatIdentity();
    if (!id) return false;
    chatLabel = { char: id.char, chat: id.chat };
    if (id.key === chatKey) return true;
    if (chatKey) void flushVectors();
    chatKey = id.key;
    const persona = await personaName(id.chatObj);
    personaCache = persona && persona !== 'User' ? persona : '';
    vecStore = new Map();
    dirtyShards = new Set();
    await saveChain.catch(() => {});
    await loadVectors(chatKey);
    timeline = rawTimeline(id.chatObj);
    rebuildChunks();
    lastRecall = null;
    lastWindowLen = 0;
    return true;
  }

  // ── 벡터 저장 (기기 저장소, 채팅마다 16조각) ──
  const shardKey = (key, s) => `${KEY}${key}~${s}`;
  async function initLocalStore() {
    try { localStore = R.getLocalPluginStorage ? await R.getLocalPluginStorage() : null; } catch { localStore = null; }
  }
  async function loadVectors(key) {
    if (!localStore) return;
    const parts = await Promise.all(Array.from({ length: SHARDS }, (_, s) => Promise.resolve().then(() => localStore.getItem(shardKey(key, s))).catch(() => null)));
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      for (const [k, v] of Object.entries(part)) if (v && Array.isArray(v.b64)) vecStore.set(k, v);
    }
  }
  async function reloadVectors() {
    // 임베딩 설정이 바뀌면 옛 벡터는 쓰지 않는다 (지문은 같아도 프로필이 다르다)
    for (const c of chunks) c.vec = null;
    rebuildChunks();
  }
  function scheduleSave() {
    if (!localStore || saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; void flushVectors(); }, SAVE_DELAY);
  }
  function flushVectors() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!localStore || !chatKey || !dirtyShards.size) return saveChain;
    const key = chatKey;
    const shards = [...dirtyShards];
    dirtyShards = new Set();
    const data = shards.map(s => {
      const obj = {};
      for (const [k, v] of vecStore) if (shardOf(k) === s) obj[k] = v;
      return [s, obj];
    });
    saveChain = saveChain.catch(() => {}).then(async () => {
      for (const [s, obj] of data) await localStore.setItem(shardKey(key, s), obj);
    }).catch(error => setError('벡터 저장', error));
    return saveChain;
  }
  async function clearVectors() {
    if (localStore && chatKey) for (let s = 0; s < SHARDS; s++) await Promise.resolve().then(() => localStore.removeItem?.(shardKey(chatKey, s))).catch(() => {});
    vecStore = new Map();
    for (const c of chunks) c.vec = null;
  }

  /** 메시지들을 임베딩한다 (조각 단위). 같은 글은 한 번만. */
  async function indexMessages(mis, purpose = '색인') {
    const prof = embedProfile();
    const todo = [];
    const seen = new Set();
    for (const mi of mis) {
      const m = timeline[mi];
      if (!m || seen.has(m.key)) continue;
      seen.add(m.key);
      const ids = msgChunkIds(mi);
      if (ids.every(id => chunks[id].vec)) continue;
      todo.push({ m, ids });
    }
    if (!todo.length) return 0;
    const flat = todo.flatMap(t => t.ids);
    const vecs = await embedTexts(flat.map(id => chunks[id].text), `${purpose} (조각 ${flat.length}개)`);
    let k = 0;
    for (const t of todo) {
      const signs = t.ids.map(() => toSigns(vecs[k++]));
      vecStore.set(t.m.key, { n: t.ids.length, p: prof, b64: signs.map(packSigns) });
      dirtyShards.add(shardOf(t.m.key));
    }
    // 같은 글의 다른 메시지(복사본)에도 붙인다
    for (const c of chunks) {
      if (c.vec) continue;
      const st = vecStore.get(timeline[c.mi].key);
      if (st && st.n === msgChunkIds(c.mi).length && st.p === prof) c.vec = unpackSigns(st.b64[c.pos], VEC_BITS);
    }
    scheduleSave();
    return todo.length;
  }
  const msgChunkIds = (mi) => { const a = msgStart[mi], b = mi + 1 < msgStart.length ? msgStart[mi + 1] : chunks.length; return Array.from({ length: b - a }, (_, i) => a + i); };
  const unindexed = (upto) => { const out = []; for (let mi = 0; mi < upto; mi++) if (msgChunkIds(mi).some(id => !chunks[id].vec)) out.push(mi); return out; };

  // ══════════════════════════════════════════════════════════════════════
  //  회상
  // ══════════════════════════════════════════════════════════════════════

  function lexScores(query, limit) {
    const q = gramsOf(query);
    const N = limit || 1;
    const acc = new Map();
    for (const g of q) {
      const p = postings.get(g);
      if (!p) continue;
      let df = 0;
      for (const id of p) if (id < limit) df++;
      if (!df) continue;
      const w = Math.log(1 + N / df);
      for (const id of p) if (id < limit) acc.set(id, (acc.get(id) ?? 0) + w);
    }
    for (const [id, s] of acc) acc.set(id, s / Math.sqrt(1 + chunks[id].len / 40));
    return acc;
  }

  /** 임베딩 · 글자 검색 순위를 RRF로 합친다. limit: 이 조각 번호 앞까지만 (Risu가 보내는 것은 빼고) */
  function retrieve(qvecs, query, exclude, k, limit) {
    const sem = [];
    if (qvecs.length) for (let id = 0; id < limit; id++) {
      const c = chunks[id];
      if (!c.vec || exclude.has(id)) continue;
      let s = -Infinity;
      qvecs.forEach((q, i) => { const v = simSigns(q, c.vec) * (i === 0 ? 1 : 0.85); if (v > s) s = v; });
      sem.push([id, s]);
    }
    sem.sort((a, b) => b[1] - a[1]);
    const lex = [...lexScores(query, limit)].filter(([id]) => !exclude.has(id)).sort((a, b) => b[1] - a[1]);
    const rrf = new Map();
    sem.slice(0, 80).forEach(([id], r) => rrf.set(id, (rrf.get(id) ?? 0) + 1 / (60 + r)));
    lex.slice(0, 80).forEach(([id], r) => rrf.set(id, (rrf.get(id) ?? 0) + 1 / (60 + r)));
    return [...rrf].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => chunks[id]);
  }

  function rankOf(a) {
    const pr = a?.probabilities;
    if (pr && Object.keys(pr).length) {
      let sum = 0, tot = 0;
      for (const [k, v] of Object.entries(pr)) { const lv = Number.isFinite(Number(k)) ? Number(k) : RANK_LEVELS.indexOf(k); if (lv >= 0) { sum += lv * Number(v); tot += Number(v); } }
      if (tot > 0) return sum / tot;
    }
    const sc = Number(a?.score);
    return Number.isFinite(sc) ? sc : 0;
  }

  async function judge(cands, state, askNeed) {
    const q = {};
    for (const c of cands) q[`r${c.id}`] = { type: 'score', instructions: `How useful for replying to the latest message? «${c.text}»`, criteria: RANK_LEVELS };
    if (askNeed) q.need = { type: 'choice', instructions: 'Which earlier record, if any, is still missing to answer the latest message?', criteria: SEARCH_NEEDS };
    const answers = await callJev(state, q);
    const levels = new Map(cands.map(c => [c.id, rankOf(answers[`r${c.id}`])]));
    let need = 'none';
    const na = answers.need;
    if (na) {
      const pr = na.probabilities ?? {};
      need = Object.keys(pr).length ? Object.entries(pr).sort((a, b) => b[1] - a[1])[0][0] : (na.choice ?? 'none');
      if (Object.keys(pr).length && (pr[need] ?? 0) < 0.5) need = 'none';
      if (!SEARCH_NEEDS[need]) need = 'none';
    }
    return { levels, need };
  }

  async function queryVecs(texts) {
    const miss = texts.filter(t => !queryCache.has(t));
    if (miss.length) {
      const vs = await embedTexts(miss, '임베딩 (질문)');
      miss.forEach((t, i) => queryCache.set(t, qShrink(vs[i])));
      if (queryCache.size > 200) queryCache.delete(queryCache.keys().next().value);
    }
    return texts.map(t => queryCache.get(t));
  }

  /**
   * window: 이번 요청에 실린 메시지 (timeline 끝 window.length개). 그보다 앞의 조각에서만 찾는다.
   */
  async function recall(windowEntries, tr) {
    const cfg = settings;
    const limit = msgStart[timeline.length - windowEntries.length] ?? chunks.length;   // 이 조각 앞까지가 Risu가 안 보낸 것
    if (!limit || cfg.budget <= 0) return { block: '', picked: [], trace: { cands: 0 } };
    const latest = memText(windowEntries[windowEntries.length - 1]?.text ?? '');
    const ctx = windowEntries.slice(-3).map(m => memText(m.text)).join('\n').slice(-1500);
    const state = windowEntries.slice(-4).map(m => `[${m.role === 'user' ? 'USER' : 'STORY'}]\n${memText(m.text).slice(-1200)}`).join('\n\n');
    let qv = [];
    try { qv = await timed(tr, '질문 임베딩', () => queryVecs([latest.slice(0, 2000) || ctx, ctx || latest])); } catch (error) { setError('임베딩', error); }

    const first = await timed(tr, '후보 찾기', async () => retrieve(qv, latest, new Set(), cfg.candidates, limit), () => '');
    let levels = new Map(), need = 'none', jevOk = true;
    try {
      ({ levels, need } = await timed(tr, 'Jev 채점', () => judge(first, state, true), () => `후보 ${first.length}개`));
      if (need !== 'none') {
        let qn = [];
        try { qn = await queryVecs([`${NEED_QUERY[need] ?? ''} ${latest}`.slice(0, 2000)]); } catch { }
        const more = retrieve([...qn, ...qv.slice(0, 1)], latest, new Set(first.map(c => c.id)), Math.ceil(cfg.candidates / 2), limit);
        if (more.length) {
          const r2 = await timed(tr, '2차 검색', () => judge(more, state, false), () => `${need} · ${more.length}개`);
          for (const [id, lv] of r2.levels) levels.set(id, lv);
        }
      }
    } catch (error) {
      // Jev가 실패하면 검색 순위 상위 몇 개로 대신한다 (보내기는 멈추지 않는다)
      jevOk = false;
      setError('Jev 채점', error);
      first.slice(0, 5).forEach((c, i) => levels.set(c.id, 2 - i * 0.01));
    }
    const scored = [...levels].map(([id, lv]) => ({ c: chunks[id], lv })).filter(x => x.lv >= KEEP_LEVEL).sort((a, b) => b.lv - a.lv || b.c.id - a.c.id);

    const take = new Map();
    let used = 0;
    const cost = (c) => estimateTokens(c.text) + 4;
    const add = (c, pri) => { if (!c || c.id >= limit || take.has(c.id)) return false; const k = cost(c); if (used + k > cfg.budget) return false; take.set(c.id, pri); used += k; return true; };
    // 최근 흐름: Risu가 막 안 보낸 대화의 끝부분
    let tail = 0;
    for (let id = limit - 1; id >= 0 && tail < cfg.tailTokens; id--) { const k = cost(chunks[id]); if (tail + k > cfg.tailTokens && tail > 0) break; if (add(chunks[id], 0)) tail += k; }
    for (const x of scored) add(x.c, x.lv);
    if (cfg.neighbor > 0) for (const x of scored.filter(y => y.lv >= 2)) for (let d = 1; d <= cfg.neighbor; d++) { add(chunks[x.c.id - d], 0.5); add(chunks[x.c.id + d], 0.5); }

    const picked = [...take.keys()].sort((a, b) => a - b).map(id => chunks[id]);
    const lines = [];
    let prev = null;
    for (const c of picked) {
      const role = timeline[c.mi]?.role === 'user' ? 'user' : 'char';
      if (prev && prev.mi === c.mi && prev.id === c.id - 1) lines[lines.length - 1] += ' ' + c.text;
      else lines.push(`<#${c.mi + 1} ${role}${prev && prev.mi === c.mi ? ' …' : ''}> ${c.text}`);
      prev = c;
    }
    const note = cfg.note ? `${cfg.note}\n` : '';
    const block = lines.length ? `[Memory]\n${note}${lines.join('\n')}\n[/Memory]` : '';
    return {
      block, picked,
      trace: { cands: first.length, kept: scored.length, need, jevOk, levels: [...levels].map(([id, lv]) => ({ id, lv: Math.round(lv * 100) / 100, text: clip(chunks[id].text, 140), mi: chunks[id].mi + 1 })).sort((a, b) => b.lv - a.lv) },
    };
  }

  function inject(messages, block) {
    const out = messages.map(m => ({ ...m }));
    let placed = false;
    for (const m of out) if (typeof m.content === 'string' && m.content.search(PLACEHOLDER) >= 0) m.content = m.content.replace(PLACEHOLDER, () => (placed ? '' : (placed = true, block)));
    if (placed || !block) return out;
    let last = -1;
    for (let i = out.length - 1; i >= 0; i--) if (out[i].removable === true && (out[i].role === 'user' || out[i].role === 'assistant')) { last = i; break; }
    if (settings.injectMode === 'last_user' && last >= 0 && out[last].role === 'user' && typeof out[last].content === 'string') out[last].content = `${block}\n\n${out[last].content}`;
    else if (last >= 0) out.splice(last, 0, { role: 'system', content: block });
    else out.push({ role: 'system', content: block });
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  훅
  // ══════════════════════════════════════════════════════════════════════

  async function beforeRequestHandler(messages, type) {
    if ((type !== 'model' && type !== 'main') || busy) return messages;
    busy = true;
    let tr = null;
    try {
      if (!ready() || !await ensureChat()) return messages;
      tr = beginTrace('send');
      const entries = chatEntries(messages);
      if (!entries.length) return messages;
      syncWindow(entries);
      lastWindowLen = entries.length;
      // 색인: Risu가 안 보낸 메시지 중 벡터가 없는 것. 많으면 최근 것부터 정해진 개수만 하고, 나머지는 다음에 (또는 도구 › 지금 전부 색인)
      const upto = timeline.length - entries.length;
      const todo = unindexed(upto);
      if (todo.length && !job) {
        const n = settings.indexPerSend;
        const batch = todo.length <= n ? todo : todo.slice(-n);
        if (todo.length > n && backlogWarned !== chatKey) {
          backlogWarned = chatKey;
          void Promise.resolve().then(() => R.alert?.(`HypaJev: 아직 색인 안 된 메시지가 ${todo.length}개예요.\n보낼 때마다 최근 것부터 ${n}개씩 색인할게요.\n🧠 HypaJev › 🧰 도구 › "지금 전부 색인"으로 한 번에 할 수 있어요.`)).catch(() => {});
        }
        try { await timed(tr, '색인', () => indexMessages(batch), `메시지 ${batch.length}개${todo.length > batch.length ? ` · 남은 ${todo.length - batch.length}개` : ''}`); } catch (error) { setError('색인', error); }
      }
      const r = await recall(entries, tr);
      const tokens = r.block ? estimateTokens(r.block) : 0;
      tr.note = `넣은 기억 ~${tokens}토큰`;
      lastRecall = { at: Date.now(), tokens, block: r.block, ...r.trace, picked: r.picked.length, window: entries.length };
      return inject(messages, r.block);
    } catch (error) {
      setError('요청 처리', error);
      if (tr) tr.note = `오류: ${String(error?.message ?? error).slice(0, 80)}`;
      return messages;
    } finally {
      busy = false;
      endTrace(tr);
    }
  }

  // 답장이 와도 할 일이 없다 (저장은 보낼 때, 빠진 것만)
  async function afterRequestHandler(content) { return content; }

  /** 지금 전부 색인: Risu가 안 보낸 메시지 전부 (보낸 적 없어도 채팅에 있는 것은 전부) */
  let processing = null;
  function indexAll(onProgress) {
    if (processing) return Promise.reject(Object.assign(new Error('이미 색인 중이에요.'), { code: 'BUSY' }));
    const run = processing = (async () => {
      if (!await ensureChat()) throw new Error('채팅방을 먼저 열어 주세요.');
      while (job && job !== run) await job.catch(() => {});
      job = run;
      const tr = beginTrace('index');
      try {
        const upto = Math.max(0, timeline.length - (lastWindowLen || 0));
        const todo = unindexed(upto);
        let done = 0;
        await timed(tr, '지금 전부 색인', async () => {
          for (let i = 0; i < todo.length; i += 50) { await indexMessages(todo.slice(i, i + 50)); done = Math.min(todo.length, i + 50); onProgress?.(done, todo.length); }
        }, () => `메시지 ${done}/${todo.length}개`);
        await flushVectors();
        return todo.length;
      } finally { endTrace(tr); }
    })().finally(() => { if (job === run) job = null; processing = null; });
    return run;
  }

  /** 채팅을 새로 읽는다 (화면을 열 때 · 도구). 다른 채팅으로 바뀌었을 수도 있으니. */
  async function refreshChat() {
    identityCache = null;
    const id = await readChatIdentity();
    if (!id) return false;
    // 다른 채팅이면 처음부터 연다. 방금 읽은 신원 캐시에는 채팅 본문이 없어서 지워야 원본을 다시 읽는다
    if (id.key !== chatKey) { chatKey = ''; identityCache = null; return ensureChat(); }
    chatLabel = { char: id.char, chat: id.chat };
    const fresh = rawTimeline(id.chatObj);
    if (fresh.length && (fresh.length !== timeline.length || fresh.some((m, i) => m.key !== timeline[i]?.key))) { timeline = fresh; rebuildChunks(); }
    return true;
  }

  function storageStats() {
    let vecs = 0, bytes = 0;
    for (const v of vecStore.values()) { vecs += v.n; bytes += v.b64.reduce((a, s) => a + s.length, 0) + 40; }
    const upto = Math.max(0, timeline.length - (lastWindowLen || 0));
    return { messages: timeline.length, chunks: chunks.length, indexedMsgs: upto - unindexed(upto).length, sendable: upto, vecs, kb: Math.round(bytes / 1024) };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  화면
  // ══════════════════════════════════════════════════════════════════════

  const ui = { open: false, tab: 'home', progress: '', test: {}, bound: false, draft: null, wiz: null, keepOpen: new Map(), saveTimer: null };
  const CSS = `
    :root{--a:#5b7cfa;--ok:#3fae7a;--warn:#e0a03a;--bad:#e0605a}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bgcolor,#121317);color:var(--textcolor,#e6e6ea);font:14px/1.55 system-ui,-apple-system,'Segoe UI','Apple SD Gothic Neo',sans-serif}
    button,input,select,textarea{font:inherit;color:inherit}
    a{color:var(--a)}
    .w{display:flex;flex-direction:column;height:100vh}
    .hd{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--borderc,#2c2e36)}
    .hd b{font-size:16px;white-space:nowrap}
    .sub{color:var(--textcolor2,#8d909a);font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .x{background:none;border:none;font-size:20px;cursor:pointer;color:var(--textcolor2,#8d909a);padding:2px 8px}
    .tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--borderc,#2c2e36);overflow-x:auto}
    .tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--textcolor2,#8d909a);padding:10px 11px;cursor:pointer;white-space:nowrap}
    .tab.on{color:var(--a);border-bottom-color:var(--a);font-weight:600}
    .bd{flex:1;overflow-y:auto;padding:16px}
    .in{max-width:880px;margin:0 auto}
    .card{background:var(--darkbg,#1b1c22);border:1px solid var(--borderc,#2c2e36);border-radius:12px;padding:14px;margin-bottom:12px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:12px}
    .kpi{font-size:22px;font-weight:700}
    .muted{color:var(--textcolor2,#8d909a)}
    .small{font-size:12px}
    .sec{font-size:13px;font-weight:700;color:var(--textcolor2,#8d909a);margin:18px 0 8px}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .btn{background:var(--darkbg,#24262e);border:1px solid var(--borderc,#383b46);border-radius:8px;padding:7px 12px;cursor:pointer;white-space:nowrap}
    .btn:hover{border-color:var(--a)}
    .btn.p{background:var(--a);border-color:var(--a);color:#fff}
    .btn.d{color:var(--bad)}
    .btn.sm{padding:4px 9px;font-size:12px}
    .btn:disabled{opacity:.5;cursor:default}
    .inp,.sel,.ta{background:var(--bgcolor,#121317);border:1px solid var(--borderc,#383b46);border-radius:8px;padding:8px 10px;width:100%}
    .inp:focus,.sel:focus,.ta:focus{outline:none;border-color:var(--a)}
    .ta{min-height:80px;resize:vertical}
    .banner{border-radius:12px;padding:12px 14px;margin-bottom:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .banner .g{flex:1;min-width:180px}
    .banner.ok{background:rgba(63,174,122,.12);border:1px solid rgba(63,174,122,.4)}
    .banner.warn{background:rgba(224,160,58,.12);border:1px solid rgba(224,160,58,.4)}
    .banner.bad{background:rgba(224,96,90,.12);border:1px solid rgba(224,96,90,.4)}
    .opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}
    .opt{border:1px solid var(--borderc,#383b46);border-radius:10px;padding:10px 12px;cursor:pointer;background:none;text-align:left}
    .opt:hover{border-color:var(--a)}
    .opt.on{border-color:var(--a);background:rgba(91,124,250,.1)}
    .opt b{display:block}
    .badge{display:inline-block;border-radius:5px;padding:0 6px;font-size:11px;font-weight:600;background:rgba(91,124,250,.18);color:#9fb3ff;margin-left:4px;vertical-align:1px}
    .relmap svg{display:block;max-width:420px;margin:0 auto}
    .relmap .node{fill:var(--darkbg,#1b1c22);stroke:#8d909a;stroke-width:1.5}
    .relmap .node.on{stroke:#9f7cf2;stroke-width:3}
    .relmap .nlab{fill:var(--textcolor,#e6e6ea);font-size:11px;text-anchor:middle;pointer-events:none}
    .relmap .elab{fill:var(--textcolor2,#c3c5cc);font-size:10px;text-anchor:middle;pointer-events:none;paint-order:stroke;stroke:var(--darkbg,#1b1c22);stroke-width:4px;stroke-linejoin:round}
    .legend{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
    .legend i{display:inline-block;width:12px;height:4px;border-radius:2px;margin-right:4px;vertical-align:middle}
    .bond .dir{margin-top:8px;padding-top:8px;border-top:1px dashed var(--borderc,#2c2e36)}
    .bond .axes{display:flex;gap:14px;flex-wrap:wrap;margin-top:4px}
    .bond .ax{display:inline-flex;align-items:center;gap:4px}
    .bond.pinned{border-color:#9f7cf2}
    .toggle-card{display:flex;align-items:center;gap:12px}
    .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
    .tile{aspect-ratio:1/1;display:flex;flex-direction:column;gap:6px;justify-content:flex-start;text-align:left;padding:12px;border-radius:12px;border:1px solid var(--borderc,#2c2e36);background:var(--darkbg,#1b1c22);color:inherit;cursor:pointer;min-width:0;overflow:hidden;transition:border-color .15s,transform .1s}
    .tile:hover{border-color:#5b5e6a}
    .tile:active{transform:scale(.98)}
    .tile:focus-visible{outline:2px solid var(--a);outline-offset:2px}
    .tile.on{border-color:var(--a)}
    .tile.pinned{border-color:#9f7cf2}
    .tile.off{opacity:.45;filter:grayscale(1);border-style:dashed}
    .tnames{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 5px;font-size:14px;line-height:1.3}
    .tnames b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
    .tx{color:var(--textcolor2,#8d909a);font-size:12px}
    .ttype{font-size:12px;padding:2px 8px;border-radius:999px;background:rgba(139,141,151,.16);align-self:flex-start;white-space:nowrap}
    .tdir{display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap}
    .tfrom{color:var(--textcolor2,#8d909a);overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
    .tval{font-weight:600}
    .tval.pos{color:#e8739d}
    .tval.neg{color:#6b9be8}
    .tval.zero{color:var(--textcolor2,#8d909a);font-weight:400}
    .tval.t.pos{color:#5fc28f}
    .tbadges{margin-top:auto;display:flex;gap:6px;align-items:center;min-height:18px}
    .tint{font-size:12px;font-weight:600;color:#e8739d}
    .drow{display:grid;grid-template-columns:minmax(90px,140px) 1fr 56px;gap:8px;align-items:center;padding:3px 0}
    .drow .dd{grid-column:1 / -1;margin:-2px 0 2px}
    .dtrack{height:8px;border-radius:4px;background:rgba(139,141,151,.15);overflow:hidden}
    .dbar{display:block;height:100%;border-radius:4px;background:#6b8cff}
    .dcard .num{text-align:right}
    .sheet-bg{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}
    .sheet{width:100%;max-width:480px;max-height:86vh;overflow:auto;background:var(--bgcolor,#121317);border:1px solid var(--borderc,#2c2e36);border-radius:14px;padding:12px}
    .sheet .card{margin-bottom:0}
    .sheet-h{margin-bottom:8px}
    @media (max-width:520px){.sheet-bg{align-items:flex-end;padding:0}.sheet{max-width:none;border-radius:14px 14px 0 0;max-height:88vh}}
    .state-pill{display:inline-block;font-size:11px;font-weight:500;padding:1px 8px;border-radius:999px;margin-left:4px;vertical-align:middle;white-space:nowrap}
    .state-pill.on{background:rgba(63,174,122,.18);color:#86d9ad}
    .state-pill.off{background:rgba(139,141,151,.2);color:#9a9da6}
    .off-zone{opacity:.42;filter:grayscale(1);pointer-events:none;user-select:none;transition:opacity .2s,filter .2s}
    .bond.is-off{border-style:dashed;background:transparent}
    .bond.is-off .bond-body{opacity:.42;filter:grayscale(1);pointer-events:none;user-select:none}
    .bond.is-off b{color:var(--textcolor2,#9a9da6)}
    .sw.sm{width:36px;height:20px;flex:0 0 auto}
    .sw.sm span:before{width:14px;height:14px}
    .sw.sm input:checked+span:before{transform:translateX(16px)}
    .sw input:focus-visible+span{outline:2px solid var(--a);outline-offset:2px}
    .btn.ic{min-width:34px;min-height:34px;padding:2px 8px}
    .gauge{position:relative;display:inline-block;width:76px;height:8px;border-radius:4px;background:rgba(139,141,151,.2);overflow:hidden}
    .gauge::after{content:'';position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.35)}
    .gauge .pos{position:absolute;left:50%;top:0;bottom:0;background:#e8739d}
    .gauge.t .pos{background:#5fc28f}
    .gauge .neg{position:absolute;right:50%;top:0;bottom:0;background:#6b9be8}
    .gv{min-width:24px;text-align:right;font-size:12px}
    .hist{padding:3px 0}
    .chip{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12px;border:1px solid var(--borderc,#383b46);margin:2px 3px 2px 0;cursor:pointer;background:none}
    .chip.k{background:rgba(160,120,240,.15);color:#c6adff;border-color:transparent;cursor:default}
    .chip.t{background:rgba(139,141,151,.14);color:var(--textcolor2,#a6a9b3);border-color:transparent;cursor:default}
    .chip.h{background:rgba(63,174,122,.16);color:#86d9ad;border-color:transparent;cursor:default}
    .chip.o{background:rgba(139,141,151,.2);color:#9a9da6;border-color:transparent;cursor:default}
    .arc{border:1px solid var(--borderc,#2c2e36);border-radius:12px;margin-bottom:10px;overflow:hidden}
    .arch{display:flex;gap:10px;align-items:center;padding:12px 14px;cursor:pointer;background:var(--darkbg,#1b1c22);flex-wrap:wrap}
    .arch .t{font-weight:700;flex:1;min-width:160px}
    .scene{padding:10px 14px;border-top:1px solid var(--borderc,#2c2e36)}
    .day{border-top:1px solid var(--borderc,#2c2e36)}
    .dayh{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;min-height:40px;background:none;border:none;color:inherit;padding:8px 14px;cursor:pointer;font-size:13px;font-weight:500;text-align:left}
    .dayh:hover{background:rgba(139,141,151,.08)}
    .dayh:focus-visible{outline:2px solid var(--a);outline-offset:-2px}
    .sceneh{font-size:12px;color:var(--textcolor2,#8d909a);margin-bottom:6px}
    .ev{padding:7px 0 7px 10px;border-left:2px solid var(--borderc,#383b46);margin:4px 0}
    .ev.old{opacity:.55}
    .ev.pin{border-left-color:var(--a)}
    .ev .l{white-space:pre-wrap;word-break:break-word}
    .ev .orig{font-size:12px;color:var(--textcolor2,#8d909a);margin-top:3px;white-space:pre-wrap}
    .ev .act{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap}
    .bar{height:6px;background:var(--borderc,#2c2e36);border-radius:4px;overflow:hidden}
    .bar>i{display:block;height:100%;background:var(--a)}
    .pre{white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:12px;background:var(--bgcolor,#121317);border:1px solid var(--borderc,#2c2e36);border-radius:8px;padding:10px;max-height:340px;overflow:auto}
    table{width:100%;border-collapse:collapse;font-size:13px}
    td,th{padding:6px 8px;border-bottom:1px solid var(--borderc,#2c2e36);text-align:left;vertical-align:top}
    th{color:var(--textcolor2,#8d909a);font-weight:600;font-size:12px}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .f{display:grid;grid-template-columns:minmax(150px,210px) 1fr;gap:6px 16px;padding:10px 0;border-bottom:1px solid var(--borderc,#2c2e36)}
    .f:last-child{border-bottom:none}
    .f label{font-weight:600}
    .help{font-size:12px;color:var(--textcolor2,#8d909a);margin-top:2px}
    .sw{position:relative;display:inline-block;width:42px;height:24px}
    .sw input{opacity:0;width:0;height:0}
    .sw span{position:absolute;inset:0;background:#555;border-radius:24px;cursor:pointer;transition:.15s}
    .sw span:before{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.15s}
    .sw input:checked+span{background:var(--a)}
    .sw input:checked+span:before{transform:translateX(18px)}
    .foot{position:sticky;bottom:-16px;background:var(--bgcolor,#121317);padding:12px 0;border-top:1px solid var(--borderc,#2c2e36);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
    .steps{display:flex;gap:6px;margin-bottom:14px}
    .steps i{flex:1;height:4px;border-radius:3px;background:var(--borderc,#383b46)}
    .steps i.on{background:var(--a)}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}
    .dlg{background:var(--bgcolor,#17181d);border:1px solid var(--borderc,#383b46);border-radius:12px;padding:18px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto}
    .toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#2b2e38;color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;z-index:60;box-shadow:0 4px 18px rgba(0,0,0,.4)}
    .ok{color:var(--ok)} .err{color:var(--bad)}
    details summary{cursor:pointer;color:var(--textcolor2,#8d909a);font-size:13px;margin:8px 0}
    @media (max-width:560px){.f{grid-template-columns:1fr}.bd{padding:12px}.tab{padding:10px 8px}}
  `;

  async function openPanel(tab) {
    await R.showContainer('fullscreen');
    ui.open = true;
    if (tab) ui.tab = tab;
    ui.draft = null;
    if (!settings.onboarded || !settings.jevKey) ui.wiz = ui.wiz ?? { step: 1, d: { ...settings } };
    else if (!ui.wiz?.manual) ui.wiz = null;
    try { await refreshChat(); } catch (error) { setError('채팅 확인', error); }
    render();
  }

  function render() {
    const body = document.getElementById('bd');
    const where = ui.wiz ? 'wiz' : ui.tab;
    const keep = body && body.dataset.tab === where;
    const scroll = body ? body.scrollTop : 0;
    const tabs = [['home', '🏠 홈'], ['trace', '🔍 회상 기록'], ['settings', '⚙️ 설정'], ['tools', '🧰 도구'], ['debug', '🐞 디버그']];
    const view = ui.wiz ? renderWizard : ({ home: renderHome, trace: renderTrace, settings: renderSettings, tools: renderTools, debug: renderDebug }[ui.tab] ?? renderHome);
    document.body.innerHTML = `<style>${CSS}</style>
      <div class="w">
        <div class="hd"><b>🧠 HypaJev</b><span class="sub">${escapeHtml([chatLabel.char, chatLabel.chat].filter(Boolean).join(' · ') || '채팅방을 열면 기억이 보여요')}</span><button class="x" data-act="close" aria-label="닫기">✕</button></div>
        ${ui.wiz ? '' : `<div class="tabs">${tabs.map(([id, l]) => `<button class="tab${ui.tab === id ? ' on' : ''}" data-act="tab" data-tab="${id}">${l}</button>`).join('')}</div>`}
        <div class="bd" id="bd" data-tab="${where}"><div class="in">${view()}</div></div>
      </div>`;
    const nb = document.getElementById('bd');
    if (nb && keep) nb.scrollTop = scroll;
    bindOnce();
  }

  function toast(msg) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  function confirmDialog(msg, yes = '확인') {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'ov';
      ov.innerHTML = `<div class="dlg" style="max-width:420px;text-align:center"><p style="white-space:pre-wrap;margin:6px 0 16px">${escapeHtml(msg)}</p><div class="row" style="justify-content:center"><button class="btn" data-c="0">취소</button><button class="btn p" data-c="1">${escapeHtml(yes)}</button></div></div>`;
      ov.addEventListener('click', (e) => {
        const c = e.target.closest?.('[data-c]')?.dataset.c;
        if (c == null && e.target !== ov) return;
        e.stopPropagation();
        ov.remove();
        resolve(c === '1');
      });
      document.body.appendChild(ov);
    });
  }

  const kpi = (v, label) => `<div class="card" style="margin:0"><div class="kpi">${v}</div><div class="small muted">${label}</div></div>`;
  const secs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}초` : `${ms}ms`);

  // ── 설정 부품 (JevHypa와 같은 모양) ──

  const opt = (field, value, cur, title, desc, badge) =>
    `<button class="opt${cur === value ? ' on' : ''}" data-act="pick" data-field="${field}" data-value="${value}"><b>${escapeHtml(title)}${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ''}</b><span class="small muted">${escapeHtml(desc ?? '')}</span></button>`;
  const sw = (field, on) => `<label class="sw"><input type="checkbox" data-field="${field}"${on ? ' checked' : ''}><span></span></label>`;
  const field = (label, help, input) => `<div class="f"><div><label>${label}</label>${help ? `<div class="help">${help}</div>` : ''}</div><div>${input}</div></div>`;

  /** 키 모양 확인. OpenRouter 키는 sk-or- 로 시작한다. */
  function keyHint(d) {
    const k = cleanKey(d.jevKey);
    if (!k) return '';
    const bad = keyProblem(k, 'Jev');
    if (bad) return `<div class="help err">${escapeHtml(bad)}</div>`;
    if (d.jevPreset === 'openrouter' && !/^sk-or-/.test(k)) return '<div class="help" style="color:var(--warn)">OpenRouter 키는 보통 sk-or- 로 시작해요. 다른 키를 넣은 건 아닌지 확인해 주세요.</div>';
    return `<div class="help">${escapeHtml(k.slice(0, 8))}…${escapeHtml(k.slice(-4))} (${k.length}자)</div>`;
  }

  /** 모델 고르기: 프리셋의 모델 목록 + "직접 입력…". 실제 값은 아래 입력칸(data-field)에 있다. */
  function modelPicker(fieldName, preset, value) {
    const items = (preset.models ?? []).map(m => (typeof m === 'string' ? { id: m, label: m } : m));
    const known = items.some(m => m.id === value);
    const custom = !known || !items.length;
    const options = items.map(m => `<option value="${escapeHtml(m.id)}"${m.id === value ? ' selected' : ''}>${escapeHtml(m.label)}${m.id === preset.model ? ' · 기본' : ''}${m.label !== m.id ? ` — ${escapeHtml(m.id)}` : ''}</option>`).join('');
    return `${items.length ? `<select class="sel" data-model-for="${fieldName}">${options}<option value="__custom"${custom ? ' selected' : ''}>직접 입력…</option></select>` : ''}
      <input class="inp" data-field="${fieldName}" placeholder="모델 이름 (예: ${escapeHtml(preset.model || 'vendor/model')})" value="${escapeHtml(value)}" style="${custom ? '' : 'display:none;'}${items.length ? 'margin-top:6px' : ''}">`;
  }

  /** 접는 칸: 펼치거나 접은 상태를 기억해서 다시 그려도 유지 */
  const keepOpen = (key, def) => ` data-keep="${escapeHtml(key)}"${(ui.keepOpen.get(key) ?? def) ? ' open' : ''}`;

  function jevFields(d) {
    const p = JEV_PRESETS[d.jevPreset];
    return `<div class="opts">${Object.entries(JEV_PRESETS).map(([k, v]) => opt('jevPreset', k, d.jevPreset, v.label, v.desc, v.badge)).join('')}</div>
      <div class="f" style="border:none"><div><label>API 키</label>${p.keyUrl ? `<div class="help"><a href="${p.keyUrl}" target="_blank" rel="noopener">키 받는 곳 ↗</a></div>` : ''}</div>
        <div><input class="inp" type="password" autocomplete="off" data-field="jevKey" placeholder="${escapeHtml(p.keyHint ?? 'API 키')}" value="${escapeHtml(d.jevKey)}">${keyHint(d)}</div></div>
      <div class="f" style="border:none"><div><label>모델</label><div class="help">모르겠으면 기본 그대로 두세요.</div></div><div>${modelPicker('jevModel', p, d.jevModel)}</div></div>
      <details${keepOpen('jev-addr', d.jevPreset === 'custom')}><summary>주소 (보통은 안 바꿔도 돼요)</summary>
        <div class="f"><label>주소</label><input class="inp" data-field="jevEndpoint" value="${escapeHtml(d.jevEndpoint)}"></div>
      </details>
      <div class="row"><button class="btn" data-act="test-jev">연결 테스트</button>${testLine('jev')}</div>`;
  }

  function embedFields(d) {
    const p = EMBED_PRESETS[d.embedPreset];
    return `<div class="opts">${Object.entries(EMBED_PRESETS).map(([k, v]) => opt('embedPreset', k, d.embedPreset, v.label, v.desc, v.badge)).join('')}</div>
      ${p.key === 'own' ? `<div class="f" style="border:none"><div><label>임베딩 API 키</label>${p.keyUrl ? `<div class="help"><a href="${p.keyUrl}" target="_blank" rel="noopener">키 받는 곳 ↗</a></div>` : ''}</div><input class="inp" type="password" autocomplete="off" data-field="embedKey" value="${escapeHtml(d.embedKey)}"></div>` : ''}
      ${p.key === 'jev' ? '<div class="help" style="margin:8px 0">Jev에 넣은 OpenRouter 키를 같이 써요.</div>' : ''}
      ${p.format !== 'local' ? `<div class="f" style="border:none"><div><label>모델</label><div class="help">모르겠으면 기본 그대로 두세요. 바꾸면 이 기기 색인을 다시 해요.</div></div><div>${modelPicker('embedModel', p, d.embedModel)}</div></div>` : ''}
      ${p.format !== 'local' ? `<details${keepOpen('embed-addr', d.embedPreset === 'custom')}><summary>주소 (보통은 안 바꿔도 돼요)</summary>
        <div class="f"><label>주소</label><input class="inp" data-field="embedEndpoint" value="${escapeHtml(d.embedEndpoint)}"></div>
      </details>` : ''}
      <div class="row"><button class="btn" data-act="test-embed">연결 테스트</button>${testLine('embed')}</div>`;
  }

  function testLine(which) {
    const t = ui.test[which];
    if (!t) return '';
    if (t.running) return '<span class="muted small">확인 중…</span>';
    if (t.warn) return `<span class="small" style="color:var(--warn)">⚠️ ${escapeHtml(t.msg)}</span>`;
    return t.ok ? `<span class="ok small">✅ ${escapeHtml(t.msg)}</span>` : `<span class="err small">❌ ${escapeHtml(t.msg)}</span>`;
  }

  // ── 시작 안내 (3단계) ──
  function renderWizard() {
    const w = ui.wiz;
    const d = w.d;
    const steps = `<div class="steps">${[1, 2, 3].map(n => `<i class="${n <= w.step ? 'on' : ''}"></i>`).join('')}</div>`;
    const nav = (back, next, label = '다음') => `<div class="row" style="justify-content:space-between;margin-top:16px">${back ? '<button class="btn" data-act="wiz-back">이전</button>' : '<span></span>'}<button class="btn p" data-act="${next}">${label}</button></div>`;
    if (w.step === 1) {
      return `${steps}<h3 style="margin:0 0 4px">1. Jev 연결</h3><p class="muted small" style="margin:0 0 12px">Jev는 글을 쓰지 않고 "이 대화 조각이 지금 필요해?"만 판단하는 아주 싼 모델이에요. 넣을 기억을 고르는 데 써요.</p>
        <div class="card">${jevFields(d)}</div>${nav(false, 'wiz-next')}`;
    }
    if (w.step === 2) {
      return `${steps}<h3 style="margin:0 0 4px">2. 임베딩 고르기</h3><p class="muted small" style="margin:0 0 12px">임베딩은 "뜻이 비슷한 대화"를 빠르게 찾는 데 써요. 단어가 달라도 같은 얘기면 찾아요. 모르겠으면 첫 번째를 고르세요.</p>
        <div class="card">${embedFields(d)}</div>${nav(true, 'wiz-next')}`;
    }
    return `${steps}<h3 style="margin:0 0 4px">3. 이렇게 써요</h3><p class="muted small" style="margin:0 0 12px">HypaJev는 Risu가 보낸 원문은 건드리지 않고, 보내지 않은 이전 대화에서 필요한 부분만 찾아 넣어요.</p>
      <div class="card small">토큰을 아끼려면 Risu 설정에서 <b>최대 컨텍스트</b>를 줄이거나, 프롬프트 템플릿의 <b>채팅 범위</b>를 최근 몇 개로 두세요. Risu 자체 메모리(하이파 · 수파)는 꺼 두세요.</div>
      <div class="card small muted">이렇게 동작해요<br>· 최근 대화는 Risu가 원문 그대로 보내요.<br>· 그보다 오래된 대화는 보낼 때 조각내서 색인만 해요 (버리는 것 없음).<br>· 보낼 때마다 지금 필요한 조각을 Jev가 골라 원문 그대로 넣어요.<br>· 이미 긴 채팅이면 🧰 도구 › 지금 전부 색인을 한 번 누르세요.</div>
      ${nav(true, 'wiz-finish', '시작하기')}`;
  }

  // ── 홈 · 회상 기록 ──
  function statusBanner(st) {
    if (!settings.jevKey) return '<div class="banner bad"><div class="g"><b>Jev 키가 없어요</b><div class="small muted">시작 안내에서 키를 넣으면 바로 동작해요.</div></div><button class="btn p" data-act="wizard">시작 안내 열기</button></div>';
    if (!settings.enabled) return '<div class="banner warn"><div class="g"><b>전체 꺼짐</b><div class="small muted">요청을 건드리지 않아요.</div></div><button class="btn" data-act="toggle-enabled">켜기</button></div>';
    if (!chatKey) return '<div class="banner warn"><div class="g"><b>채팅방을 열어 주세요</b></div></div>';
    if (stats.lastError && Date.now() - stats.lastErrorAt < 10 * 60 * 1000) return `<div class="banner bad"><div class="g"><b>최근 오류</b> <span class="small muted">${timeAgo(stats.lastErrorAt)}</span><div class="small err">${escapeHtml(stats.lastError)}</div><div class="small muted">오류가 나도 보내기는 멈추지 않아요.</div></div><button class="btn" data-act="tab" data-tab="settings">연결 확인</button></div>`;
    const left = st.sendable - st.indexedMsgs;
    if (left > 0) return `<div class="banner warn"><div class="g"><b>아직 색인 안 된 메시지 ${left}개</b><div class="small muted">보낼 때마다 최근 것부터 ${settings.indexPerSend}개씩 색인돼요. 지금 바로 하려면 '지금 전부 색인'을 누르세요.</div></div><button class="btn" data-act="index-all"${processing ? ' disabled' : ''}>지금 전부 색인</button></div>`;
    return '<div class="banner ok"><div class="g"><b>작동 중</b><div class="small muted">Risu가 보낸 원문은 그대로 두고, 보내지 않은 이전 대화에서 필요한 부분만 찾아 넣어요.</div></div></div>';
  }

  function renderHome() {
    const st = storageStats();
    const lr = lastRecall;
    return `${statusBanner(st)}
      ${ui.progress ? `<div class="card small">${escapeHtml(ui.progress)}</div>` : ''}
      <div class="grid">${kpi(st.messages, '채팅 메시지')}${kpi(`${st.indexedMsgs}/${st.sendable}`, '색인된 이전 메시지')}${kpi(st.chunks, '조각')}${kpi(`${st.kb}KB`, '이 기기 벡터')}</div>
      <div class="sec">마지막 회상</div>
      ${lr ? `<div class="card"><div class="row"><b>${lr.tokens}토큰</b><span class="small muted">${timeAgo(lr.at)} · 후보 ${lr.cands}개 → 고름 ${lr.kept}개${lr.need && lr.need !== 'none' ? ` · 2차 검색(${lr.need})` : ''}${lr.jevOk === false ? ' · Jev 실패(검색 순위로 대신)' : ''}</span></div>
        <div class="row" style="margin-top:8px"><button class="btn sm" data-act="tab" data-tab="trace">자세히 보기</button></div></div>`
        : '<div class="card muted small">메시지를 보내면 여기에 어떤 기억을 넣었는지 보여요.</div>'}`;
  }

  function renderTrace() {
    const lr = lastRecall;
    if (!lr) return '<div class="card muted small">아직 회상한 적이 없어요. 메시지를 보내면 보여요.</div>';
    const rows = (lr.levels ?? []).map(x => `<div class="drow"><span class="num small" style="min-width:42px">${x.lv.toFixed(2)}</span><span class="small" style="flex:1">${x.lv >= KEEP_LEVEL ? '✅' : '·'} <span class="muted">#${x.mi}</span> ${escapeHtml(x.text)}</span></div>`).join('');
    return `<div class="sec">실제로 들어간 내용 (${lr.tokens}토큰)</div>
      <div class="card"><pre class="pre" style="white-space:pre-wrap;margin:0">${escapeHtml(lr.block || '(넣은 것 없음)')}</pre></div>
      <div class="sec">Jev 채점 (0~3, ${KEEP_LEVEL} 이상만 넣음)</div>
      <div class="card">${rows || '<span class="muted small">없음</span>'}</div>`;
  }

  // ── 설정 ──
  function renderSettings() {
    const d = ui.draft ?? (ui.draft = { ...settings });
    const num = (k, min, max) => `<input class="inp" type="number" inputmode="numeric" min="${min}" max="${max}" data-field="${k}" value="${escapeHtml(d[k])}">`;
    return `<div class="sec">Jev 연결</div><div class="card">${jevFields(d)}</div>
      <div class="sec">임베딩</div><div class="card">${embedFields(d)}</div>
      <div class="sec">기억 넣기</div><div class="card">
        <div class="help" style="margin-bottom:8px">Risu가 보낸 대화는 그대로 두고, 그보다 옛날 대화에서 찾아 넣어요.</div>
        ${field('기억 예산 (토큰)', '한 번에 넣는 기억의 최대 크기. 크면 많이 기억, 작으면 토큰 절약. 0이면 안 넣어요.', num('budget', 0, 20000))}
        ${field('Jev 후보 수', 'Jev가 매번 읽고 채점할 조각 수. 많으면 덜 놓치지만 Jev 비용이 늘어요.', num('candidates', 4, 80))}
        ${field('앞뒤 조각', '고른 조각의 앞뒤를 몇 개씩 같이 넣을지. 맥락이 같이 와요.', num('neighbor', 0, 3))}
        ${field('최근 흐름 (토큰)', 'Risu가 막 안 보낸 대화의 끝부분을 이만큼 늘 넣어요.', num('tailTokens', 0, 2000))}
        ${field('보낼 때 색인 개수', '색인 안 된 메시지가 이보다 많으면 최근 것부터 이만큼만 하고 나머지는 다음에.', num('indexPerSend', 1, 5000))}
      </div>
      <div class="sec">넣는 방식</div><div class="card">
        ${field('넣는 위치', '프롬프트에 [hypajev]를 써 두면 그 자리에 들어가요.', `<select class="sel" data-field="injectMode"><option value="last_user"${d.injectMode === 'last_user' ? ' selected' : ''}>최신 입력 앞</option><option value="system"${d.injectMode === 'system' ? ' selected' : ''}>시스템 메시지로</option></select>`)}
        ${field('메인 모델에게 하는 안내', '기억 블록 맨 위에 붙는 한 줄. 비우면 안 넣어요.', `<textarea class="inp ta" data-field="note" rows="2">${escapeHtml(d.note)}</textarea>`)}
      </div>
      <div class="sec">화면</div><div class="card">
        ${field('우측 상단 바로가기', '채팅 화면에 🧠 버튼을 띄워요.', sw('showButton', d.showButton))}
        ${field('전체 사용', '끄면 요청을 건드리지 않아요.', sw('enabled', d.enabled))}
      </div>
      <div class="foot"><span id="save-state" class="small muted" style="margin-right:auto;align-self:center">바꾸면 바로 저장돼요</span><button class="btn" data-act="settings-reset">기본값으로</button><button class="btn" data-act="wizard">시작 안내 다시 보기</button></div>`;
  }

  // ── 설정 자동 저장 ──
  //  설정 탭에서 무엇이든 바꾸면 잠깐 뒤(입력 중이면 멈춘 뒤) 화면 전체를 읽어 저장한다. 탭을 옮기거나 창을 닫으면 바로 저장한다.
  function setSaveState(text) {
    const el = document.getElementById('save-state');
    if (el) el.textContent = text;
  }
  function scheduleSettingsSave(delay = 500) {
    if (ui.wiz || ui.tab !== 'settings') return;
    ui.draft = readForm(ui.draft ?? settings);
    setSaveState('저장 중…');
    clearTimeout(ui.saveTimer);
    ui.saveTimer = setTimeout(() => { void flushSettingsSave(); }, delay);
  }
  async function flushSettingsSave() {
    clearTimeout(ui.saveTimer);
    ui.saveTimer = null;
    if (!ui.draft) return;
    const before = embedProfile();
    const draft = ui.draft;
    try { await saveSettings(draft); } catch (error) { setSaveState('저장 실패'); toast(String(error?.message ?? error)); return; }
    if (ui.draft === draft) ui.draft = { ...settings };
    setSaveState('저장됨 ✓');
    if (embedProfile() !== before) toast('임베딩 설정이 바뀌었어요. 다음에 보낼 때(또는 지금 전부 색인) 다시 색인해요.');
  }
  /** 화면에 있는 입력값을 초안에 반영한다. */
  function readForm(base) {
    const d = { ...base };
    for (const el of document.querySelectorAll('[data-field]')) {
      if (el.tagName === 'BUTTON') continue;
      const k = el.dataset.field;
      if (el.type === 'checkbox') d[k] = el.checked;
      else if (el.type === 'number') d[k] = el.value === '' ? base[k] : Number(el.value);
      else d[k] = el.value;
    }
    return d;
  }
  function currentDraft() {
    if (ui.wiz) return (ui.wiz.d = readForm(ui.wiz.d));
    if (ui.tab === 'settings') return (ui.draft = readForm(ui.draft ?? settings));
    return settings;
  }
  function pickPreset(d, f, value) {
    if (f === 'jevPreset') { const p = JEV_PRESETS[value]; return { ...d, jevPreset: value, jevEndpoint: p.endpoint, jevModel: p.model }; }
    if (f === 'embedPreset') { const p = EMBED_PRESETS[value]; return { ...d, embedPreset: value, embedEndpoint: p.endpoint ?? '', embedModel: p.model ?? '' }; }
    return { ...d, [f]: value };
  }

  /** 연결 테스트: 지금 화면의 값으로 확인한다. 저장된 설정은 건드리지 않는다. */
  async function runTest(which) {
    const d = sanitizeSettings(currentDraft());
    ui.test[which] = { running: true };
    render();
    const started = Date.now();
    try {
      if (which === 'jev') {
        const a = await callJev('[STORY]\n서진은 민우에게 토요일에 바다에 가자고 약속했다.', { t: { type: 'noul', instructions: 'Did 서진 make a promise about going to the sea?' } }, d);
        const p = Number(a?.t?.noul ?? 0);
        ui.test.jev = p > 0.5 ? { ok: true, msg: `연결됨 · ${Date.now() - started}ms · ${d.jevModel}` } : { warn: true, msg: `연결은 됐지만 판단이 이상해요 (${Math.round(p * 100)}%). 모델 이름을 확인해 보세요.` };
      } else {
        const [a, b, c] = await embedTexts(['토요일에 바다에 가기로 약속했다', '주말에 해변 가자고 했다', '검은 성의 기사단'], '연결 테스트', d);
        const dt = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * y[i]; return s; };
        const near = dt(a, b), far = dt(a, c);
        ui.test.embed = near > far
          ? { ok: true, msg: `연결됨 · ${Date.now() - started}ms · ${a.length}차원 · 비슷한 말 ${near.toFixed(2)} > 다른 말 ${far.toFixed(2)}` }
          : { warn: true, msg: `연결은 됐지만 뜻 구분이 약해요 (비슷한 말 ${near.toFixed(2)}, 다른 말 ${far.toFixed(2)}). 다른 모델을 써 보세요.` };
      }
    } catch (error) { ui.test[which] = { ok: false, msg: String(error?.message ?? error) }; }
    render();
  }

  // ── 도구 · 디버그 ──
  function renderTools() {
    const st = storageStats();
    const tool = (title, desc, act, label, danger) => `<div class="card row" style="justify-content:space-between"><div style="flex:1;min-width:200px"><b>${title}</b><div class="help">${desc}</div></div><button class="btn${danger ? ' d' : ''}" data-act="${act}"${act === 'index-all' && processing ? ' disabled' : ''}>${label}</button></div>`;
    return `${ui.progress ? `<div class="card small">${escapeHtml(ui.progress)}</div>` : ''}
      ${tool('지금 전부 색인', `Risu가 안 보낸 이전 메시지 ${st.sendable}개 중 ${st.indexedMsgs}개 색인됨. 남은 것을 지금 한 번에 해요. (임베딩만, Jev 안 씀)`, 'index-all', '색인')}
      ${tool('채팅 다시 읽기', '채팅을 고치거나 지웠는데 반영이 안 된 것 같으면 눌러요.', 'reread', '다시 읽기')}
      ${tool('이 채팅 색인 지우기', '이 기기의 벡터를 지워요. 원문(Risu 채팅)은 그대로고, 다음에 다시 색인돼요.', 'clear', '지우기', true)}`;
  }

  function renderDebug() {
    if (!debugLog.length) return '<div class="card empty"><b>아직 기록이 없어요</b><div class="small muted" style="margin-top:6px">메시지를 보내면 단계마다 몇 초 걸렸는지 여기에 쌓여요.</div></div>';
    const sends = debugLog.filter(t => t.kind === 'send');
    const card = (t) => {
      const max = Math.max(1, ...t.steps.map(s => s.ms));
      const rows = t.steps.map(x => `<div class="drow"><span class="small">${escapeHtml(x.name)}</span><span class="dtrack"><span class="dbar" style="width:${Math.max(2, Math.round(x.ms / max * 100))}%"></span></span><span class="num small">${secs(x.ms)}</span>${x.detail ? `<span class="small muted">${escapeHtml(x.detail)}</span>` : ''}</div>`).join('');
      const calls = t.calls.length ? `<div class="small muted" style="margin-top:6px">호출 ${t.calls.length}번 · ${t.calls.map(c => `${escapeHtml(c.purpose)} ${secs(c.ms)}${c.ok ? '' : ' ✗'}`).join(' · ')}</div>` : '';
      return `<div class="card dcard"><div class="row" style="flex-wrap:nowrap"><b style="flex:1">${t.kind === 'send' ? '📤 보낼 때' : '🧰 색인'}</b><span class="small muted">${timeAgo(t.at)}</span><b class="num">${secs(t.ms)}</b></div>${t.note ? `<div class="small muted">${escapeHtml(t.note)}</div>` : ''}<div style="margin-top:8px">${rows || '<span class="small muted">할 일이 없었어요.</span>'}</div>${calls}</div>`;
    };
    const avg = sends.length ? Math.round(sends.slice(0, 10).reduce((a, t) => a + t.ms, 0) / Math.min(10, sends.length)) : 0;
    return `<div class="grid">${kpi(sends.length ? secs(sends[0].ms) : '-', '마지막 보낼 때 지연')}${kpi(sends.length ? secs(avg) : '-', '보낼 때 평균 (최근 10번)')}</div>
      <div class="row" style="margin:10px 0"><span class="small muted" style="flex:1">"보낼 때"만 응답을 늦춰요. 답장 뒤에는 아무것도 안 해요.</span><button class="btn sm" data-act="debug-clear">기록 지우기</button></div>
      ${debugLog.map(card).join('')}`;
  }

  // ── 이벤트 ──
  function bindOnce() {
    if (ui.bound) return;
    ui.bound = true;
    document.body.addEventListener('click', (e) => { void onClick(e); });
    document.body.addEventListener('change', (e) => { void onChange(e); });
    // details의 toggle은 거품이 안 올라와서 잡는 단계에서 듣는다
    document.body.addEventListener('toggle', (e) => { const k = e.target?.dataset?.keep; if (k) ui.keepOpen.set(k, e.target.open); }, true);
    document.body.addEventListener('input', (e) => { if (e.target.dataset?.field && ui.tab === 'settings' && !ui.wiz) scheduleSettingsSave(800); });
  }

  async function onChange(e) {
    const el = e.target;
    if (el.dataset?.modelFor) {
      // 목록에서 고르면 입력칸을 채우고 숨긴다. "직접 입력…"이면 입력칸을 보여 준다.
      const input = el.parentElement?.querySelector(`[data-field="${el.dataset.modelFor}"]`);
      if (!input) return;
      if (el.value === '__custom') { input.style.display = ''; input.focus(); input.select?.(); }
      else { input.value = el.value; input.style.display = 'none'; }
      ui.test[el.dataset.modelFor === 'jevModel' ? 'jev' : 'embed'] = null;
      if (ui.wiz) currentDraft(); else scheduleSettingsSave();
      return;
    }
    if (el.dataset?.field) { if (ui.wiz) currentDraft(); else scheduleSettingsSave(); }
  }

  async function onClick(e) {
    const el = e.target.closest?.('[data-act]');
    if (!el) return;
    switch (el.dataset.act) {
      case 'close':
        if (ui.tab === 'settings' && !ui.wiz) { ui.draft = readForm(ui.draft ?? settings); await flushSettingsSave(); }
        ui.open = false;
        await R.hideContainer();
        return;
      case 'tab':
        if (ui.tab === 'settings' && el.dataset.tab !== 'settings' && !ui.wiz) { ui.draft = readForm(ui.draft ?? settings); await flushSettingsSave(); ui.draft = null; }
        ui.tab = el.dataset.tab;
        render();
        return;
      case 'pick': {
        const next = pickPreset(currentDraft(), el.dataset.field, el.dataset.value);
        if (ui.wiz) ui.wiz.d = next; else ui.draft = next;
        ui.test[el.dataset.field === 'jevPreset' ? 'jev' : 'embed'] = null;
        render();
        if (!ui.wiz && ui.tab === 'settings') { setSaveState('저장 중…'); await flushSettingsSave(); }
        return;
      }
      case 'test-jev': await runTest('jev'); return;
      case 'test-embed': await runTest('embed'); return;
      case 'wizard': ui.wiz = { step: 1, d: { ...settings }, manual: true }; render(); return;
      case 'wiz-back': currentDraft(); ui.wiz.step--; render(); return;
      case 'wiz-next': {
        const d = currentDraft();
        if (ui.wiz.step === 1 && !cleanKey(d.jevKey)) { toast('Jev API 키를 넣어 주세요.'); return; }
        if (ui.wiz.step === 2 && EMBED_PRESETS[d.embedPreset]?.key === 'own' && !cleanKey(d.embedKey)) { toast('임베딩 API 키를 넣거나 다른 걸 골라 주세요.'); return; }
        ui.wiz.step++;
        render();
        return;
      }
      case 'wiz-finish': {
        const d = currentDraft();
        await saveSettings({ ...d, onboarded: true });
        ui.wiz = null;
        ui.tab = 'home';
        render();
        toast('준비됐어요. 이미 긴 채팅이면 🧰 도구 › 지금 전부 색인을 눌러 주세요.');
        return;
      }
      case 'settings-reset':
        if (await confirmDialog('키는 그대로 두고 나머지 설정을 기본값으로 돌릴까요?', '돌리기')) {
          const d = currentDraft();
          ui.draft = { ...DEFAULT_SETTINGS, jevKey: d.jevKey, embedKey: d.embedKey, onboarded: true };
          render();
          await flushSettingsSave();
        }
        return;
      case 'toggle-enabled': await saveSettings({ ...settings, enabled: !settings.enabled }); render(); return;
      case 'debug-clear': debugLog.length = 0; render(); return;
      case 'reread': try { await refreshChat(); toast('다시 읽었어요.'); } catch (error) { toast(String(error?.message ?? error)); } render(); return;
      case 'index-all': {
        if (processing) { toast('이미 색인 중이에요.'); return; }
        ui.progress = '색인 중…';
        render();
        try {
          const n = await indexAll((done, all) => { ui.progress = `색인 중… ${done}/${all}`; render(); });
          ui.progress = '';
          render();
          toast(n ? `메시지 ${n}개를 색인했어요.` : '이미 다 색인돼 있어요.');
        } catch (error) { ui.progress = ''; render(); toast(String(error?.message ?? error)); }
        return;
      }
      case 'clear':
        if (!await confirmDialog('이 채팅의 벡터를 이 기기에서 지울까요?\n원문은 그대로고, 다음에 다시 색인돼요.', '지우기')) return;
        await clearVectors();
        render();
        toast('지웠어요.');
        return;
    }
  }

  // ── 바로가기 버튼 ──
  let buttonPartId = null;
  async function syncButton() {
    try {
      if (settings.showButton && !buttonPartId && R.registerButton) {
        const part = await R.registerButton({ name: 'HypaJev', icon: '🧠', iconType: 'html', location: 'action', id: 'hypajev-gui' }, async () => { await openPanel('home'); });
        buttonPartId = part?.id ?? 'hypajev-gui';
      } else if (!settings.showButton && buttonPartId && R.unregisterUIPart) {
        await R.unregisterUIPart(buttonPartId);
        buttonPartId = null;
      }
    } catch (error) { console.error(LOG, '바로가기 버튼 등록 실패', error); }
  }

  // ── 시작 ──
  await loadSettings();
  await initLocalStore();
  await R.registerSetting('HypaJev', () => openPanel(), '🧠', 'html', 'hypajev-settings');
  await R.addRisuReplacer('beforeRequest', beforeRequestHandler);
  await R.addRisuReplacer('afterRequest', afterRequestHandler);
  if (R.onUnload) {
    await R.onUnload(async () => {
      await Promise.allSettled([
        R.removeRisuReplacer('beforeRequest', beforeRequestHandler),
        R.removeRisuReplacer('afterRequest', afterRequestHandler),
        buttonPartId && R.unregisterUIPart ? R.unregisterUIPart(buttonPartId) : null,
        flushVectors(),
      ]);
    });
  }
  try { globalThis.addEventListener?.('pagehide', () => { void flushVectors(); }); } catch { }
  await syncButton();
  try { await ensureChat(); } catch { }
  console.log(LOG, '준비 완료');

  if (globalThis.__HYPAJEV_TEST__) {
    globalThis.__HYPAJEV_TEST__.x = {
      beforeRequestHandler, afterRequestHandler, indexAll, ensureChat, refreshChat, flushVectors, saveSettings,
      chunkText, overlapStart, chatEntries, storageStats, recall, readForm, renderWizard, runTest, toSigns, packSigns, unpackSigns, simSigns, renderHome, renderTrace, renderSettings, renderTools, renderDebug,
      getSettings: () => settings, getTimeline: () => timeline, getChunks: () => chunks, getLastRecall: () => lastRecall, debugLog: () => debugLog, ui,
      waitJob: () => job ?? Promise.resolve(),
    };
  }
})();
