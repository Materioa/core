import { json } from '@sveltejs/kit';
import Fuse from 'fuse.js';
import fs from 'fs';
import path from 'path';
import { env } from '$env/dynamic/private';
import { corsHeaders } from '$lib/server/cors-origins.js';

export const prerender = false;

function getConfig() {
  const apiKey =
    env.OPENROUTER_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    env.NETLIFY_OPENROUTER_API_KEY ||
    process.env.NETLIFY_OPENROUTER_API_KEY ||
    '';
  const mcpBaseUrl = env.MCP_BASE_URL || process.env.MCP_BASE_URL || 'https://mcp.getmaterio.app';
  const mcpSnapSearchPath = env.MCP_SNAP_SEARCH_PATH || process.env.MCP_SNAP_SEARCH_PATH;
  const mcpJsonrpcPath =
    env.MCP_JSONRPC_PATH || process.env.MCP_JSONRPC_PATH || mcpSnapSearchPath || '/mcp';
  const mcpAiSearchOnly =
    (env.MCP_AI_SEARCH_ONLY || process.env.MCP_AI_SEARCH_ONLY) === 'true';
  const mcpTimeoutMs = Number(env.MCP_TIMEOUT_MS || process.env.MCP_TIMEOUT_MS || 8000);

  const hfToken = env.HF_TOKEN || process.env.HF_TOKEN || '';
  const hfLlmUrl = env.HF_LLM_URL || process.env.HF_LLM_URL || '';
  const hfRerankerUrl = env.HF_RERANKER_URL || process.env.HF_RERANKER_URL || '';

  // TypeSafe Jev (System One decision model) — typed relevance judging.
  const typesafeKey = env.TYPESAFE_API_KEY || process.env.TYPESAFE_API_KEY || '';
  const jevUrl =
    env.JEV_URL || process.env.JEV_URL || 'https://api.typesafe.ai/v1/systemone';
  const jevModel = env.JEV_MODEL || process.env.JEV_MODEL || 'jev-latest';

  return {
    API_KEY: apiKey,
    MCP_BASE_URL: mcpBaseUrl,
    MCP_SNAP_SEARCH_PATH: mcpSnapSearchPath,
    MCP_JSONRPC_PATH: mcpJsonrpcPath,
    MCP_AI_SEARCH_ONLY: mcpAiSearchOnly,
    MCP_TIMEOUT_MS: mcpTimeoutMs,
    HF_TOKEN: hfToken,
    HF_LLM_URL: hfLlmUrl,
    HF_RERANKER_URL: hfRerankerUrl,
    TYPESAFE_API_KEY: typesafeKey,
    JEV_URL: jevUrl,
    JEV_MODEL: jevModel
  };
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

// ============= CONTENT SAFETY FILTER =============

function isInappropriateContent(text) {
  if (!text || typeof text !== 'string') return false;

  const normalized = text.toLowerCase().trim();

  const gibberishPattern = /(.)\1{4,}|[^a-z0-9\s]{5,}|^[bcdfghjklmnpqrstvwxyz]{8,}$/i;
  if (gibberishPattern.test(normalized)) {
    return true;
  }

  const words = normalized.split(/\s+/).filter((w) => w.length > 3);
  for (const word of words) {
    if (word.length > 6) {
      const vowelCount = (word.match(/[aeiou]/g) || []).length;
      if (vowelCount === 0) return true;
    }
  }

  const suspiciousPatterns = [
    /\bf+[uo]+c*k+\b/i,
    /\bf+c+k+\b/i,
    /\bs+[h!1]+[i!1]+t+\b/i,
    /\bb+[i!1]+t+c+h+\b/i,
    /\bd+[a@]+m+n+\b/i,
    /\bs+[e3]+x+[yu]/i,
    /\bp+[o0]+r+n+/i,
    /\bn+[i!1]+g+[a@e]+r+/i,
    /\bf+[a@]+g+[go0]+t+/i,
    /\br+[a@]+p+[e3]+\b/i,
    /\bk+[i!1]+l+l+\s*(you|yourself|me|him|her)/i,
    /\bd+[i!1]+e+\s*(you|yourself|bitch|motherfucker)/i,
    /\bs+t+u+p+[i!1]+d+\s+(bitch|ass|fuck|person|people)/i,
    /\b[i!1]+d+[i!1]+[o0]+t+\s+(bitch|ass|fuck|person|people)/i,
    /\bm+[o0]+r+[o0]+n+\b/i,
    /\bl+[o0]+s+[e3]+r+\s+(bitch|ass|fuck|you)/i,
    /\ba+s+s+h+[o0]+l+e+/i,
    /\bc+u+n+t+\b/i,
    /\bp+u+s+s+y+\b/i
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  const specialCharCount = (normalized.match(/[!@#$%^&*()_+=\[\]{};:'",.<>?\/\\|`~]/g) || []).length;
  if (specialCharCount > normalized.length * 0.3) {
    return true;
  }

  return false;
}

function validateSearchQuery(query) {
  if (!query || typeof query !== 'string') {
    return { valid: false, reason: 'invalid' };
  }

  const trimmed = query.trim();

  if (trimmed.length < 1) {
    return { valid: false, reason: 'too_short' };
  }

  if (trimmed.length > 200) {
    return { valid: false, reason: 'too_long' };
  }

  if (isInappropriateContent(trimmed)) {
    return { valid: false, reason: 'inappropriate' };
  }

  return { valid: true };
}

const GENERAL_MODELS = [
  'openai/gpt-oss-120b:free',
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'z-ai/glm-4.5-air:free',
  'deepseek/deepseek-v4-flash:free',
  'minimax/minimax-m2.5:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'openrouter/free'
];

const RESOURCE_LIB_URLS = {
  production: 'https://cdn.getmaterio.app/databases/beta/resource.lib.json',
  local: 'http://localhost:8080/databases/beta/resource.lib.json'
};

let resourceLibCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function fetchResourceLibrary() {
  if (resourceLibCache && Date.now() - lastFetchTime < CACHE_DURATION) {
    return resourceLibCache;
  }

  const useLocalResources =
    (env.USE_LOCAL_RESOURCES || process.env.USE_LOCAL_RESOURCES) === 'true';
  const url = useLocalResources ? RESOURCE_LIB_URLS.local : RESOURCE_LIB_URLS.production;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) {
      throw new Error(`Failed to fetch resource library: ${response.status}`);
    }

    resourceLibCache = await response.json();
    lastFetchTime = Date.now();
    return resourceLibCache;
  } catch (error) {
    console.error('Error fetching resource library from CDN:', error.message);

    const candidates = [
      path.join(process.cwd(), 'static', 'assets', 'data', 'resource.lib.json'),
      path.join(process.cwd(), 'assets', 'data', 'resource.lib.json'),
      path.join(process.cwd(), '..', 'assets', 'data', 'resource.lib.json'),
      path.resolve('static/assets/data/resource.lib.json'),
      path.resolve('assets/data/resource.lib.json')
    ];

    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          resourceLibCache = JSON.parse(fs.readFileSync(p, 'utf8'));
          lastFetchTime = Date.now();
          return resourceLibCache;
        }
      } catch {}
    }

    if (resourceLibCache) {
      console.warn('Using stale cache due to fetch failure');
      return resourceLibCache;
    }

    throw new Error('Unable to load resource library from any source');
  }
}

const SUBJECT_ABBR_MAP = {
  os: 'Operating System',
  cn: 'Computer Networks',
  cnip: 'Computer Networks and Internet Protocol',
  se: 'Software Engineering',
  de: 'Digital Electronics',
  bee: 'Basic Electrical Engineering',
  eee: 'Electrical and Electronic Engineering',
  gcf: 'Global Cloud Fundamentals',
  ctsd: 'Computational Thinking and Structure Design',
  pp: 'Principles of Programming',
  dm: 'Discrete Mathematics',
  be: 'Business Economics',
  dwdm: 'Distributed and Wide Area Network',
  ppfsd: 'Programming in Python with Full Stack',
  ml: 'Machine Learning',
  dl: 'Deep Learning',
  daa: 'Design and Analysis of Algorithms',
  dsa: 'Data Structures and Algorithms',
  ds: 'Data Structures',
  da: 'Data Analytics',
  dadv: 'Data Analytics and Data Visualization',
  dbms: 'Database Management System',
  db: 'Database',
  ai: 'Artificial Intelligence',
  nlp: 'Natural Language Processing',
  iot: 'Internet of Things',
  epj: 'Enterprise Java Programming',
  toc: 'Theory of Computation',
  cd: 'Compiler Design',
  ppl: 'Principles of Programming Languages',
  flat: 'Formal Languages and Automata Theory',
  cg: 'Computer Graphics',
  is: 'Information Security',
  cc: 'Cloud Computing',
  hpc: 'High Performance Computing',
  mswd: 'MEAN Stack Web Development',
  cs: 'Cyber Security'
};

const CATEGORY_ABBR_MAP = {
  qb: 'Question Bank',
  qp: 'Previous Year Questions',
  pyq: 'Previous Year Questions',
  lab: 'Lab Manual',
  ppt: 'Presentations',
  ch: 'Chapters',
  chap: 'Chapters',
  unit: 'Chapters',
  asgn: 'Assignments',
  asn: 'Assignments',
  assign: 'Assignments',
  notes: 'Chapters'
};

const DISCOVERY_PHRASES = [
  'random',
  'suggest',
  'surprise me',
  'anything',
  'where do i start',
  'where to start',
  'get started',
  'what should i',
  'what to study',
  'what next',
  'recommend',
  'pick for me',
  "don't know",
  'dont know',
  "i don't know",
  'no idea',
  'help me choose',
  'something new'
];

function isDiscoveryQuery(query) {
  if (!query) return false;
  const q = query.toLowerCase().trim();
  return DISCOVERY_PHRASES.some((phrase) => q.includes(phrase));
}

function pickDiscoveryResult(resourceLib, preferredSemester) {
  if (!resourceLib || typeof resourceLib !== 'object') return null;

  const semKeys = Object.keys(resourceLib);
  if (semKeys.length === 0) return null;

  const semester =
    preferredSemester && resourceLib[preferredSemester] ? preferredSemester : semKeys[0];

  const subjects = resourceLib[semester];
  const subjectNames = Object.keys(subjects || {});
  if (subjectNames.length === 0) return null;

  const shuffled = [...subjectNames].sort(() => Math.random() - 0.5);

  for (const subjectName of shuffled) {
    const categories = subjects[subjectName];
    if (!Array.isArray(categories)) continue;

    const preferred = categories.find(
      (c) =>
        c &&
        c.type &&
        /chapter|unit|module/i.test(c.type) &&
        Array.isArray(c.content) &&
        c.content.length > 0
    );
    const fallback = categories.find((c) => c && Array.isArray(c.content) && c.content.length > 0);

    const category = preferred || fallback;
    if (!category) continue;

    const items = category.content.filter(Boolean);
    if (items.length === 0) continue;

    const topic = items[Math.floor(Math.random() * items.length)];

    return {
      semester,
      subject: subjectName,
      category: category.type,
      topic,
      score: 100,
      matchType: 'discovery',
      isDiscovery: true
    };
  }

  return null;
}

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function buildBm25Corpus(searchIndex) {
  const N = searchIndex.length;
  const df = {};
  let totalLen = 0;

  const docs = searchIndex.map((item) => {
    const text = [
      item.subject,
      item.subject,
      item.subject,
      item.subjectAbbr,
      item.subjectAbbr,
      item.category,
      item.category,
      item.item,
      item.item,
      item.item,
      item.itemAbbr,
      item.searchText
    ].join(' ');

    const tokens = tokenize(text);
    const termFreq = {};
    for (const t of tokens) {
      termFreq[t] = (termFreq[t] || 0) + 1;
    }
    totalLen += tokens.length;

    for (const t of Object.keys(termFreq)) {
      df[t] = (df[t] || 0) + 1;
    }

    return { item, termFreq, length: tokens.length };
  });

  const avgLen = N > 0 ? totalLen / N : 1;
  return { docs, df, N, avgLen };
}

function bm25Score(queryTokens, doc, corpus, k1 = 1.5, b = 0.75) {
  let score = 0;
  for (const term of queryTokens) {
    const tf = doc.termFreq[term] || 0;
    if (tf === 0) continue;
    const df = corpus.df[term] || 0;
    const idf = Math.log((corpus.N - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / corpus.avgLen));
    score += idf * tfNorm;
  }
  return score;
}

function searchBm25(queryTokens, corpus, expandedSubject, expandedCategory, limit = 20) {
  if (queryTokens.length === 0) return [];

  const scored = corpus.docs.map((doc) => {
    let score = bm25Score(queryTokens, doc, corpus);

    if (expandedSubject) {
      const subjectLower = doc.item.subject?.toLowerCase() || '';
      const expandedLower = expandedSubject.toLowerCase();
      if (subjectLower.includes(expandedLower) || expandedLower.includes(subjectLower)) {
        score *= 3.5;
      }
    }

    if (expandedCategory) {
      const catLower = doc.item.category?.toLowerCase() || '';
      const expCatLower = expandedCategory.toLowerCase();
      if (catLower.includes(expCatLower) || expCatLower.includes(catLower)) {
        score *= 2.5;
      }
    }

    return { item: doc.item, rawScore: score };
  });

  scored.sort((a, b) => b.rawScore - a.rawScore);

  const maxScore = scored[0]?.rawScore || 1;
  if (maxScore <= 0) return [];

  return scored
    .filter((r) => r.rawScore > 0)
    .slice(0, limit)
    .map((r) => ({
      semester: r.item.semester,
      subject: r.item.subject,
      category: r.item.category,
      topic: r.item.item,
      score: Math.min(100, Math.round((r.rawScore / maxScore) * 100)),
      matchType: 'bm25'
    }));
}

function expandQueryWithAbbr(queryTokens) {
  const expandedTokens = [];
  let expandedSubject = null;
  let expandedCategory = null;

  for (const token of queryTokens) {
    const subjectExpansion = SUBJECT_ABBR_MAP[token];
    const categoryExpansion = CATEGORY_ABBR_MAP[token];

    if (subjectExpansion) {
      expandedSubject = subjectExpansion;
      expandedTokens.push(...tokenize(subjectExpansion));
    } else if (categoryExpansion) {
      expandedCategory = categoryExpansion;
      expandedTokens.push(...tokenize(categoryExpansion));
    } else {
      expandedTokens.push(token);
    }
  }

  return {
    expandedTokens: [...new Set(expandedTokens)],
    expandedSubject,
    expandedCategory
  };
}

function generateAbbreviations(text) {
  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  const abbreviations = [];

  if (words.length > 1) {
    abbreviations.push(words.map((w) => w[0]).join(''));
  }
  if (words.length >= 2) {
    abbreviations.push(words.slice(0, 2).map((w) => w[0]).join(''));
  }
  if (words.length >= 3) {
    abbreviations.push(words.slice(0, 3).map((w) => w[0]).join(''));
  }
  if (words.length >= 4) {
    abbreviations.push(words.slice(0, 4).map((w) => w[0]).join(''));
  }

  return abbreviations;
}

function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;

  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(len1, len2, 4); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

function generateVariations(text) {
  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  const variations = [text.toLowerCase(), ...words, ...generateAbbreviations(text)];
  return variations.join(' ');
}

function buildSearchIndex(resourceLib) {
  const index = [];
  if (!resourceLib || typeof resourceLib !== 'object') return index;

  Object.entries(resourceLib).forEach(([semester, subjects]) => {
    if (!subjects || typeof subjects !== 'object') return;

    Object.entries(subjects).forEach(([subjectName, categories]) => {
      if (!Array.isArray(categories)) return;

      const subjectAbbr = generateAbbreviations(subjectName);

      categories.forEach((category) => {
        if (!category || !category.type || !Array.isArray(category.content)) return;

        const categoryType = category.type;
        const categoryAbbr = generateAbbreviations(categoryType);

        category.content.forEach((contentItem) => {
          if (!contentItem) return;

          const itemAbbr = generateAbbreviations(contentItem);

          index.push({
            semester,
            subject: subjectName,
            subjectLower: subjectName.toLowerCase(),
            subjectAbbr: subjectAbbr.join(' '),
            subjectVariations: generateVariations(subjectName),
            category: categoryType,
            categoryLower: categoryType.toLowerCase(),
            categoryAbbr: categoryAbbr.join(' '),
            item: contentItem,
            itemLower: contentItem.toLowerCase(),
            itemAbbr: itemAbbr.join(' '),
            itemVariations: generateVariations(contentItem),
            searchText: `${subjectName} ${generateVariations(subjectName)} ${categoryType} ${generateVariations(categoryType)} ${contentItem} ${generateVariations(contentItem)}`
          });
        });
      });
    });
  });

  return index;
}

function handleDirectNavigation(query, resourceLib) {
  if (!query || typeof query !== 'string') return null;

  const normalized = query.toLowerCase().trim();
  const navMatch = normalized.match(
    /\b(?:ch|chapter|unit|module|lab|qp|pyq|qb|question|paper)\s*(\d+)\b/i
  );

  if (!navMatch) return null;

  const targetNum = parseInt(navMatch[1]);
  if (isNaN(targetNum) || targetNum < 1) return null;

  const subjectPart = normalized.replace(navMatch[0], '').trim();
  if (subjectPart.length < 1) return null;

  let bestMatch = null;

  Object.entries(resourceLib).forEach(([semester, subjects]) => {
    if (!subjects) return;

    Object.entries(subjects).forEach(([subjectName, categories]) => {
      if (!Array.isArray(categories)) return;

      const subjectLower = subjectName.toLowerCase();
      const abbrs = generateAbbreviations(subjectName);

      const isAbbrMatch = abbrs.includes(subjectPart);
      const isExactMatch = subjectLower === subjectPart;
      const isPartialMatch = subjectLower.includes(subjectPart);

      if (isAbbrMatch || isExactMatch || isPartialMatch) {
        let targetCategoryType = 'chapter';
        const lowerNav = navMatch[0].toLowerCase();

        if (lowerNav.includes('unit')) targetCategoryType = 'unit';
        else if (lowerNav.includes('module')) targetCategoryType = 'module';
        else if (lowerNav.includes('lab')) targetCategoryType = 'lab';
        else if (['qp', 'pyq', 'qb', 'question', 'paper'].some((s) => lowerNav.includes(s)))
          targetCategoryType = 'question';

        const category = categories.find((c) => {
          const type = c.type.toLowerCase();
          if (targetCategoryType === 'chapter') {
            return type.includes('chapter') || type.includes('unit');
          }
          return type.includes(targetCategoryType);
        });

        if (category && Array.isArray(category.content)) {
          const itemIndex = targetNum - 1;
          if (itemIndex >= 0 && itemIndex < category.content.length) {
            const topic = category.content[itemIndex];
            const priority = isAbbrMatch ? 3 : isExactMatch ? 2 : 1;

            if (!bestMatch || priority > bestMatch.priority) {
              bestMatch = {
                priority,
                semester,
                subject: subjectName,
                category: category.type,
                topic: topic,
                score: 100,
                matchType: 'direct_nav',
                directMatch: true
              };
            }
          }
        }
      }
    });
  });

  if (bestMatch) {
    const { priority, ...result } = bestMatch;
    return result;
  }
  return null;
}

async function searchResources(query, threshold = 0.4, limit = 20) {
  try {
    const resourceLib = await fetchResourceLibrary();

    if (!resourceLib || Object.keys(resourceLib).length === 0) {
      return [];
    }

    const directResult = handleDirectNavigation(query, resourceLib);
    const searchIndex = buildSearchIndex(resourceLib);
    if (searchIndex.length === 0) {
      return directResult ? [directResult] : [];
    }

    const rawTokens = tokenize(query);
    const { expandedTokens, expandedSubject, expandedCategory } =
      expandQueryWithAbbr(rawTokens);

    const corpus = buildBm25Corpus(searchIndex);
    const bm25Results = searchBm25(
      expandedTokens,
      corpus,
      expandedSubject,
      expandedCategory,
      limit * 2
    );

    const bm25Confident = bm25Results.length > 0 && bm25Results[0].score >= 60;

    let fuseResults = [];
    if (!bm25Confident) {
      const fuseOptions = {
        keys: [
          { name: 'subjectLower', weight: 0.25 },
          { name: 'subjectAbbr', weight: 0.35 },
          { name: 'subjectVariations', weight: 0.2 },
          { name: 'itemLower', weight: 0.25 },
          { name: 'itemAbbr', weight: 0.2 },
          { name: 'itemVariations', weight: 0.15 },
          { name: 'categoryLower', weight: 0.1 },
          { name: 'categoryAbbr', weight: 0.05 },
          { name: 'searchText', weight: 0.1 }
        ],
        threshold: threshold || 0.5,
        distance: 100,
        minMatchCharLength: 2,
        ignoreLocation: true,
        includeScore: true,
        useExtendedSearch: true,
        shouldSort: true,
        findAllMatches: true
      };

      const fuse = new Fuse(searchIndex, fuseOptions);
      const raw = fuse.search(query);

      fuseResults = raw.map((result) => {
        const item = result.item;
        const score = Math.round((1 - result.score) * 70);
        return {
          semester: item.semester,
          subject: item.subject,
          category: item.category,
          topic: item.item,
          score: Math.min(70, score),
          matchType: 'fuzzy'
        };
      });
    }

    const seen = new Set();
    const merged = [];

    for (const r of [...bm25Results, ...fuseResults]) {
      const key = `${r.semester}|${r.subject}|${r.category}|${r.topic}`;
      if (seen.has(key)) continue;
      seen.add(key);

      merged.push({
        ...r,
        matchType:
          r.score >= 90 ? 'exact' : r.score >= 75 ? 'high' : r.score >= 60 ? 'medium' : 'low'
      });
    }

    merged.sort((a, b) => b.score - a.score);

    if (directResult) {
      const dedupedMerged = merged.filter(
        (r) =>
          !(
            r.subject === directResult.subject &&
            r.topic === directResult.topic &&
            r.category === directResult.category
          )
      );
      dedupedMerged.unshift(directResult);
      return dedupedMerged.slice(0, limit);
    }

    return merged.slice(0, limit);
  } catch (error) {
    console.error('Error in searchResources:', error);
    throw error;
  }
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function topicMatches(a, b) {
  const left = normalizeSearchText(a);
  const right = normalizeSearchText(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function relevanceFromSimilarity(similarity) {
  if (typeof similarity !== 'number' || Number.isNaN(similarity)) return 'low';
  if (similarity >= 0.75) return 'high';
  if (similarity >= 0.6) return 'medium';
  return 'low';
}

// ============= TYPESAFE JEV (SYSTEM ONE) SEMANTIC JUDGE =============
// Jev returns typed decisions (no text generation): we batch one Score
// question per candidate in a single evaluate call, then map scores to
// the same {relevance, explanation} ranking shape the pipeline uses.
// Anything unexpected (auth/rate-limit/network/shape) throws so callers
// fall through to MCP/LLM — a down judge must never break search.

function jevRelevance(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

async function callJevEvaluate(state, questions, timeoutMs = 10000) {
  const cfg = getConfig();
  if (!cfg.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY not configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(cfg.JEV_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.TYPESAFE_API_KEY}`
      },
      body: JSON.stringify({ model: cfg.JEV_MODEL, state, questions }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (response.status === 401 || response.status === 403) {
      throw new Error('Jev auth failed (check TYPESAFE_API_KEY)');
    }
    if (response.status === 429) throw new Error('Jev rate limit');
    if (!response.ok) throw new Error(`Jev error: ${response.status}`);

    const data = await response.json();
    if (!data || typeof data.answers !== 'object' || data.answers === null) {
      throw new Error('Jev returned no answers');
    }
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

function jevScoreOf(answer) {
  if (typeof answer === 'number') return answer;
  if (answer && typeof answer.score === 'number') return answer.score;
  if (answer && typeof answer.value === 'number') return answer.value;
  return NaN;
}

async function judgeWithJev(query, candidates, limit = 10) {
  const pool = (Array.isArray(candidates) ? candidates : []).slice(0, limit);
  if (pool.length === 0) return [];

  const questions = {};
  pool.forEach((c, i) => {
    questions[`c${i}`] = {
      type: 'score',
      instructions: `How relevant is this library item to the student's query? 1 means exactly what they asked for, 0 means unrelated. Query: "${query}". Item: ${c.subject} > ${c.category} > ${c.topic}.`
    };
  });

  const data = await callJevEvaluate({ query }, questions);
  const answers = data.answers || {};

  const scored = [];
  pool.forEach((c, i) => {
    const score = jevScoreOf(answers[`c${i}`]);
    const relevance = jevRelevance(score);
    if (!relevance || relevance === 'low') return;
    scored.push({
      semester: c.semester,
      subject: c.subject,
      category: c.category,
      topic: c.topic,
      relevance,
      explanation: `Jev score: ${(score * 100).toFixed(0)}%`,
      _jevScore: score
    });
  });

  scored.sort((a, b) => b._jevScore - a._jevScore);
  return scored.map(({ _jevScore, ...rest }) => rest);
}

function topicScoreFromContent(content, topic) {
  const contentText = normalizeSearchText(content);
  const topicText = normalizeSearchText(topic);
  if (!contentText || !topicText) return 0;

  const topicTokens = topicText.split(' ').filter((token) => token.length >= 3);
  if (topicTokens.length === 0) return 0;

  let matched = 0;
  for (const token of topicTokens) {
    if (contentText.includes(token)) matched += 1;
  }

  return matched / topicTokens.length;
}

async function queryMcpSnapSearch(query, semester, subject) {
  const cfg = getConfig();
  if (!cfg.MCP_BASE_URL) throw new Error('MCP base URL not configured');

  const base = cfg.MCP_BASE_URL.replace(/\/$/, '');
  const url = new URL(`${base}${cfg.MCP_JSONRPC_PATH}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), cfg.MCP_TIMEOUT_MS);

  try {
    const payload = {
      jsonrpc: '2.0',
      id: `snapsearch-${Date.now()}`,
      method: 'tools/call',
      params: {
        name: 'SnapSearch',
        arguments: {
          query,
          ...(semester ? { semester } : {}),
          ...(subject ? { subject } : {}),
          results_per_page: 20
        }
      }
    };

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`MCP JSON-RPC error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    if (data?.error) {
      const code = data.error.code ?? 'unknown';
      const message = data.error.message ?? 'Unknown error';
      throw new Error(`MCP JSON-RPC error: ${code} ${message}`);
    }

    const text =
      data?.result?.content?.find((item) => item?.type === 'text')?.text ??
      data?.result?.content?.[0]?.text;
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid MCP snap-search response');
    }

    if (/vectorless search error|error code:|error:/i.test(text)) {
      console.warn('MCP reported backend error:', text);
      return [];
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      if (/no results found/i.test(text)) return [];
      console.warn('Unparseable MCP snap-search text:', text.slice(0, 100));
      return [];
    }

    const items = Array.isArray(parsed?.items)
      ? parsed.items
      : Array.isArray(parsed?.results)
        ? parsed.results
        : Array.isArray(parsed)
          ? parsed
          : null;

    if (!items) return [];

    return items.map((item) => ({
      topic: item.topic,
      subject: item.subject,
      similarity: item.similarity,
      content: item.content ?? item.excerpt ?? ''
    }));
  } finally {
    clearTimeout(timeoutId);
  }
}

function flattenResourceLibrary(resourceLib) {
  if (!resourceLib || typeof resourceLib !== 'object') return [];

  const items = [];
  Object.entries(resourceLib).forEach(([semester, subjects]) => {
    if (!subjects || typeof subjects !== 'object') return;

    Object.entries(subjects).forEach(([subjectName, categories]) => {
      if (!Array.isArray(categories)) return;

      categories.forEach((category) => {
        if (!category || !category.type || !Array.isArray(category.content)) return;

        category.content.forEach((topic) => {
          if (!topic) return;

          items.push({
            semester,
            subject: subjectName,
            category: category.type,
            topic
          });
        });
      });
    });
  });

  return items;
}

function buildMcpRankings(query, searchResults, snapResults, resourceLib, limit = 10) {
  if (!Array.isArray(snapResults)) return [];

  const baseResults =
    Array.isArray(searchResults) && searchResults.length > 0
      ? searchResults
      : flattenResourceLibrary(resourceLib);

  if (!Array.isArray(baseResults) || baseResults.length === 0) return [];

  const ranked = [];
  const seen = new Set();
  const sortedSnap = [...snapResults].sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

  for (const snap of sortedSnap) {
    if (!snap || !snap.subject || !snap.topic) continue;

    let matches = baseResults.filter(
      (result) => topicMatches(result.subject, snap.subject) && topicMatches(result.topic, snap.topic)
    );

    if (matches.length === 0 && snap.content) {
      const subjectMatches = baseResults.filter((result) => topicMatches(result.subject, snap.subject));
      const scored = subjectMatches
        .map((result) => {
          const contentScore = topicScoreFromContent(snap.content, result.topic);
          const topicScore = snap.topic
            ? jaroWinkler(normalizeSearchText(snap.topic), normalizeSearchText(result.topic))
            : 0;
          return {
            result,
            score: Math.max(contentScore, topicScore)
          };
        })
        .filter((item) => item.score >= 0.35)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map((item) => item.result);

      matches = scored;
    }

    for (const match of matches) {
      const key = `${match.semester}|${match.subject}|${match.category}|${match.topic}`;
      if (seen.has(key)) continue;
      seen.add(key);

      ranked.push({
        semester: match.semester,
        subject: match.subject,
        category: match.category,
        topic: match.topic,
        relevance: relevanceFromSimilarity(snap.similarity),
        explanation: `Text match for "${query}" in ${match.subject} -> ${match.topic}`
      });

      if (ranked.length >= limit) return ranked;
    }
  }

  return ranked;
}

function extractIntent(query) {
  if (!query) return { keywords: [query], subject: null, category: null, isVague: false };

  const lower = query.toLowerCase().trim();

  let cleaned = lower
    .replace(
      /\b(that one|this one|the one|that pdf|this pdf|the pdf|pdf with|pdf about|content about|content on|notes on|notes about|looking for|i want|i need|can you|please|pls|show me|give me|find me|need help with|help with|tell me about|find)\b/g,
      ' '
    )
    .replace(
      /\b(material|materials|document|file|with|about|for|of|the|a|an|one|that|this|please|pls|show|give|find|help|info|information)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = cleaned.split(' ').filter((t) => t.length >= 2);

  let subject = null;
  let category = null;
  const keywords = [];

  for (const token of tokens) {
    if (SUBJECT_ABBR_MAP[token]) {
      subject = SUBJECT_ABBR_MAP[token];
      keywords.push(token, ...tokenize(SUBJECT_ABBR_MAP[token]));
    } else if (CATEGORY_ABBR_MAP[token]) {
      category = CATEGORY_ABBR_MAP[token];
    } else if (token.length >= 3) {
      keywords.push(token);
    }
  }

  const uniqueKeywords = [...new Set(keywords)];
  const isVague = uniqueKeywords.length === 0 && !subject;

  const mcpKeywords = subject
    ? [subject, ...uniqueKeywords.filter((k) => !tokenize(subject).includes(k))]
    : uniqueKeywords;

  return {
    keywords: mcpKeywords.length > 0 ? mcpKeywords : [query],
    subject,
    category,
    isVague
  };
}

async function callHfLlm(systemPrompt, userMessage, timeoutMs = 18000) {
  const cfg = getConfig();
  if (!cfg.HF_LLM_URL) throw new Error('HF_LLM_URL not configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url =
      cfg.HF_LLM_URL.endsWith('/chat') || cfg.HF_LLM_URL.endsWith('/v1/chat/completions')
        ? cfg.HF_LLM_URL
        : `${cfg.HF_LLM_URL.replace(/\/$/, '')}/v1/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.HF_TOKEN ? { Authorization: `Bearer ${cfg.HF_TOKEN}` } : {})
      },
      body: JSON.stringify({
        model: 'local',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 512,
        temperature: 0.2
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`HF LLM error: ${response.status}`);

    const data = await response.json();
    const rawContent =
      data?.choices?.[0]?.message?.content ??
      data?.response ??
      data?.text ??
      (typeof data === 'string' ? data : null);

    if (!rawContent) throw new Error('Empty HF LLM response');

    let clean = String(rawContent).trim();
    const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) clean = jsonMatch[1].trim();

    const parsed = JSON.parse(clean);
    if (!parsed || typeof parsed !== 'object') throw new Error('HF LLM returned non-object');
    if (!parsed.rankings || !Array.isArray(parsed.rankings)) throw new Error('HF LLM missing rankings');
    return parsed;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenRouterLlm(model, systemPrompt, userMessage, timeoutMs = 20000) {
  const cfg = getConfig();
  if (!cfg.API_KEY) throw new Error('OpenRouter API key not configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://getmaterio.app',
        'X-Title': 'Materio Search'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.status === 429) throw new Error(`Rate limit: ${model}`);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData.error?.message || 'Unknown error';
      throw new Error(`OpenRouter ${response.status}: ${msg}`);
    }

    const data = await response.json();
    if (!data.choices?.[0]?.message) throw new Error('Invalid OpenRouter response structure');

    let content = data.choices[0].message.content;
    if (typeof content === 'string') {
      let clean = content.trim();
      const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) clean = jsonMatch[1].trim();
      content = JSON.parse(clean);
    }

    if (!content || typeof content !== 'object') throw new Error('OpenRouter returned non-object');
    if (!content.rankings || !Array.isArray(content.rankings)) throw new Error('OpenRouter missing rankings');
    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callLlmRace(systemPrompt, userMessage) {
  const cfg = getConfig();
  const promises = [];

  if (cfg.HF_LLM_URL) {
    promises.push(callHfLlm(systemPrompt, userMessage).then((r) => ({ source: 'hf', result: r })));
  }

  if (cfg.API_KEY && GENERAL_MODELS.length > 0) {
    promises.push(
      callOpenRouterLlm(GENERAL_MODELS[0], systemPrompt, userMessage).then((r) => ({
        source: 'openrouter',
        result: r
      }))
    );
  }

  if (promises.length === 0) throw new Error('No LLM providers configured');

  try {
    const { source, result } = await Promise.any(promises);
    return result;
  } catch {
    if (cfg.API_KEY) {
      let lastErr;
      for (const model of GENERAL_MODELS.slice(1)) {
        try {
          return await callOpenRouterLlm(model, systemPrompt, userMessage);
        } catch (e) {
          lastErr = e;
          if (
            !e.message.includes('Rate limit') &&
            !e.message.includes('unavailable') &&
            !e.message.includes('AbortError')
          ) {
            throw e;
          }
        }
      }
      throw lastErr || new Error('All OpenRouter models failed');
    }
    throw new Error('All LLM providers failed');
  }
}

async function callHfReranker(query, documents, topK = 10) {
  const cfg = getConfig();
  if (!cfg.HF_RERANKER_URL) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(cfg.HF_RERANKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.HF_TOKEN ? { Authorization: `Bearer ${cfg.HF_TOKEN}` } : {})
      },
      body: JSON.stringify({ query, documents, top_k: topK }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`Reranker error: ${response.status}`);
    const data = await response.json();
    const list = Array.isArray(data) ? data : (Array.isArray(data?.results) ? data.results : []);
    return list.map((item) => {
      const rawScore = Number(item.score ?? 0);
      const normScore = (rawScore >= 0 && rawScore <= 1) ? rawScore : sigmoid(rawScore);
      return {
        index: item.index,
        score: normScore,
        rawScore,
        document: item.document
      };
    });
  } catch (error) {
    clearTimeout(timeoutId);
    console.warn('Reranker failed:', error.message);
    return null;
  }
}

async function aiSearch(query, searchResults, resourceLib) {
  const cfg = getConfig();
  const intent = extractIntent(query);
  const cleanQuery = intent.keywords.slice(0, 3).join(' ');

  if (cfg.HF_RERANKER_URL && searchResults && searchResults.length > 0) {
    try {
      const docsToRerank = searchResults.slice(0, 20).map((r) => `${r.subject} ${r.category} ${r.topic}`);
      const rerankerQuery = intent.subject ? `${intent.subject} ${cleanQuery}` : query;
      const reranked = await callHfReranker(rerankerQuery, docsToRerank, 10);

      if (reranked && Array.isArray(reranked) && reranked.length > 0) {
        const finalRankings = reranked
          .map((item) => {
            const originalResult = searchResults[item.index];
            if (!originalResult) return null;
            return {
              semester: originalResult.semester,
              subject: originalResult.subject,
              category: originalResult.category,
              topic: originalResult.topic,
              relevance: item.score >= 0.75 ? 'high' : item.score >= 0.35 ? 'medium' : 'low',
              explanation: `Reranker score: ${(item.score * 100).toFixed(1)}%`
            };
          })
          .filter((r) => r && r.relevance !== 'low');

        if (finalRankings.length > 0) {
          return {
            intent: `Reranked semantic match for "${query}"`,
            rankings: finalRankings,
            suggestions: []
          };
        }
      }
    } catch (err) {
      console.warn('Reranker step failed, falling back to MCP/LLM:', err.message);
    }
  }

  // ---- Jev semantic judge: fast typed scoring of the top algorithmic
  // candidates in one batched call. Confident rankings short-circuit the
  // heavier MCP/LLM stages; anything less falls through below.
  if (cfg.TYPESAFE_API_KEY && searchResults && searchResults.length > 0) {
    try {
      const jevRankings = await judgeWithJev(query, searchResults.slice(0, 10));
      if (jevRankings.length > 0) {
        return {
          intent: `Jev semantic match for "${query}"`,
          rankings: jevRankings,
          suggestions: [],
          judge: 'jev'
        };
      }
    } catch (err) {
      console.warn('Jev judge failed, falling back to MCP/LLM:', err.message);
    }
  }

  try {
    let snapQuery = cleanQuery || query;
    let snapResults = await queryMcpSnapSearch(snapQuery, undefined, intent.subject || undefined);

    if ((!snapResults || snapResults.length === 0) && snapQuery !== query) {
      snapQuery = query;
      snapResults = await queryMcpSnapSearch(snapQuery);
    }

    const rankings = buildMcpRankings(snapQuery, searchResults, snapResults, resourceLib);
    if (rankings.length > 0) {
      return {
        intent: intent.subject
          ? `Searching ${intent.subject}${intent.category ? ' → ' + intent.category : ''}`
          : `Semantic match for "${snapQuery}"`,
        rankings,
        suggestions: []
      };
    }
  } catch (error) {
    if (cfg.MCP_AI_SEARCH_ONLY) throw error;
    console.warn('MCP SnapSearch failed, falling back to LLM:', error.message);
  }

  if (!cfg.API_KEY && !cfg.HF_LLM_URL && !cfg.TYPESAFE_API_KEY) {
    throw new Error('No LLM provider configured (set OPENROUTER_API_KEY, HF_LLM_URL or TYPESAFE_API_KEY)');
  }

  const allSubjects = Object.values(resourceLib)
    .flatMap((sem) => Object.keys(sem))
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(', ');

  const systemPrompt = `You are an intelligent, conversational search assistant for an educational resource library. You understand natural language queries, vague descriptions, and can suggest topics.

**Library Structure:**
- Semesters: 1-7
- Subjects: ${allSubjects}
- Categories: Chapters, Question Banks, Assignments, Lab Manual, Presentations, Other
- Each subject has multiple content items (chapters, topics, assignments)

**Your Capabilities:**
1. **Understand conversational queries:**
   - "that one topic that has things about turing machine" → Find Turing Machine content
   - "what should i start with?" → Suggest introductory/Chapter 1 topics
   - "i need help with java" → Find Java/EPJ resources
   - "show me assignments" → Filter Assignment category

2. **Interpret vague descriptions:**
   - Match partial keywords to full subject names
   - Understand context (e.g., "automata stuff" → Theory of Computation)
   - Recognize abbreviations (OS, DADV, EPJ, TOC, DAA, SE, CNIP)

3. **Provide smart suggestions:**
   - If query is too vague: Suggest related subjects/topics
   - If asking "where to start": Prioritize introductory chapters
   - If no good matches: Suggest similar topics from available subjects

4. **Analyze algorithmic results and:**
   - Rank by true relevance (not just keyword match)
   - Explain WHY each result matches the user's intent
   - Filter out irrelevant results
   - Add context to help users understand the content

**Response Format (JSON):**
{
    "intent": "Conversational description of what user wants",
    "rankings": [
        {
            "semester": "semester number",
            "subject": "full subject name",
            "category": "category type",
            "topic": "exact content item name",
            "relevance": "high|medium|low",
            "explanation": "Natural, helpful explanation of why this matches"
        }
    ],
    "suggestions": ["helpful suggestions if results are poor or query is vague"]
}

**Important:** 
- Rankings should ONLY include items from the algorithmic search results provided
- Use exact semester/subject/category/topic values from the search results
- Relevance: "high" = perfect match, "medium" = related/helpful, "low" = tangentially relevant
- If query is vague (e.g., "what to start with"), suggest introductory topics from multiple subjects
- Empty rankings array is OK if no results match the intent`;

  const userMessage = `User Query: "${query}"

${
  searchResults.length > 0
    ? `Algorithmic Search Results (${searchResults.length} found):
${searchResults.slice(0, 10).map((r, i) => `${i + 1}. Semester ${r.semester} | ${r.subject} | ${r.category} | ${r.topic}`).join('\n')}`
    : `Algorithmic Search Results: No matches found

Available subjects to suggest from:
${allSubjects}`
}

**Query Analysis Hints:**
- Vague queries like "what to start with", "where do i begin": Suggest Chapter 1 / Introduction topics from multiple subjects
- Phrases like "that one topic about X": Find all content containing X
- Just subject names: Show all available categories/chapters for that subject
- Category requests ("show assignments", "need question banks"): Filter by category

**Task:**
1. Understand what the user is really asking for (handle vague/conversational language)
2. Rank the most relevant results from the list above
3. Provide helpful explanations for each ranking
4. If query is vague or results are poor, provide suggestions

Remember: Only rank items from the search results above. Use exact values for semester/subject/category/topic.`;

  return await callLlmRace(systemPrompt, userMessage);
}

function mergeAIRankings(algorithmicResults, aiRankings) {
  if (!aiRankings || !Array.isArray(aiRankings)) {
    return algorithmicResults;
  }

  const norm = (str) => String(str || '').toLowerCase().trim();
  const normSem = (sem) => {
    const digits = String(sem || '').match(/\d+/);
    return digits ? digits[0] : norm(sem);
  };

  const aiRankingMap = new Map();
  aiRankings.forEach((ranking, index) => {
    const key = `${normSem(ranking.semester)}|${norm(ranking.subject)}|${norm(ranking.category)}|${norm(ranking.topic)}`;
    aiRankingMap.set(key, {
      relevance: ranking.relevance,
      explanation: ranking.explanation,
      aiRank: index + 1
    });
  });

  const mergedResults = algorithmicResults.map((result) => {
    const key = `${normSem(result.semester)}|${norm(result.subject)}|${norm(result.category)}|${norm(result.topic)}`;
    let aiData = aiRankingMap.get(key);

    if (!aiData) {
      for (const [k, val] of aiRankingMap.entries()) {
        const [, sub, , top] = k.split('|');
        if (sub === norm(result.subject) && top === norm(result.topic)) {
          aiData = val;
          break;
        }
      }
    }

    if (aiData) {
      let aiBoost = 0;
      if (aiData.relevance === 'high') aiBoost = 40;
      else if (aiData.relevance === 'medium') aiBoost = 20;
      else if (aiData.relevance === 'low') aiBoost = 5;

      const positionBoost = Math.max(0, 15 - aiData.aiRank * 2);
      const newScore = Math.min(100, result.score + aiBoost + positionBoost);

      return {
        ...result,
        score: newScore,
        matchType:
          newScore >= 90 ? 'exact' : newScore >= 75 ? 'high' : newScore >= 60 ? 'medium' : 'low',
        aiRelevance: aiData.relevance,
        aiExplanation: aiData.explanation,
        aiRanked: true
      };
    }

    return {
      ...result,
      score: Math.round(result.score * 0.9),
      aiRanked: false
    };
  });

  mergedResults.sort((a, b) => {
    if (a.aiRanked && !b.aiRanked) return -1;
    if (!a.aiRanked && b.aiRanked) return 1;
    return b.score - a.score;
  });

  return mergedResults;
}

export async function GET({ url }) {
  const query = url.searchParams.get('q') || url.searchParams.get('query');
  const useAI = url.searchParams.get('useAI') === 'true';
  const aiMode = url.searchParams.get('aiMode') || 'hybrid';
  const threshold = parseFloat(url.searchParams.get('threshold') || '0.4') || 0.4;
  const semester = url.searchParams.get('semester') || url.searchParams.get('sem') || null;

  if (!query) {
    return json(
      { success: false, error: 'Query parameter "q" or "query" is required' },
      { status: 400 }
    );
  }

  const validation = validateSearchQuery(query);
  if (!validation.valid) {
    if (validation.reason === 'inappropriate') {
      return json({
        success: true,
        query,
        results: [],
        count: 0,
        method: useAI ? 'blocked_ai' : 'blocked_algo',
        blocked: true,
        message: useAI
          ? 'Your search query contains inappropriate content and cannot be processed.'
          : undefined
      });
    } else if (validation.reason === 'too_long') {
      return json({ success: false, error: 'Query is too long (max 200 characters)' }, { status: 400 });
    }
  }

  try {
    if (isDiscoveryQuery(query)) {
      const resourceLib = await fetchResourceLibrary();
      const discoveryResult = pickDiscoveryResult(resourceLib, semester);
      if (discoveryResult) {
        return json({
          success: true,
          query,
          results: [discoveryResult],
          count: 1,
          method: 'discovery',
          aiUsed: false,
          isDiscovery: true
        });
      }
    }

    const searchThreshold = useAI ? 0.6 : threshold;
    const searchLimit = useAI ? 30 : 20;
    let algorithmicResults = await searchResources(query, searchThreshold, searchLimit);

    const cfg = getConfig();
    const hasAiProvider = Boolean(
      cfg.API_KEY ||
        cfg.HF_LLM_URL ||
        cfg.HF_RERANKER_URL ||
        cfg.MCP_BASE_URL ||
        cfg.TYPESAFE_API_KEY
    );

    // If AI mode and no results found, try fallback search for vague queries
    if (useAI && algorithmicResults.length === 0) {
      const vaguePhrases = ['what', 'start', 'begin', 'first', 'intro', 'help', 'need', 'show'];
      const isVagueQuery = vaguePhrases.some((phrase) => query.toLowerCase().includes(phrase));
      if (isVagueQuery) {
        algorithmicResults = await searchResources('introduction chapter', 0.6, 30);
      }
    }

    if (useAI && hasAiProvider) {
      try {
        const resourceLib = await fetchResourceLibrary();
        const aiResults = await aiSearch(query, algorithmicResults, resourceLib);

        if (!aiResults || !aiResults.rankings || !Array.isArray(aiResults.rankings)) {
          throw new Error('Invalid AI response structure');
        }

        if (aiMode === 'pure' && aiResults.rankings.length > 0) {
          const pureAIResults = aiResults.rankings.map((ranking, index) => ({
            semester: ranking.semester,
            subject: ranking.subject,
            category: ranking.category,
            topic: ranking.topic,
            score:
              ranking.relevance === 'high' ? 95 : ranking.relevance === 'medium' ? 75 : 50,
            matchType: ranking.relevance,
            aiExplanation: ranking.explanation,
            aiRank: index + 1
          }));

          return json({
            success: true,
            query,
            results: pureAIResults,
            count: pureAIResults.length,
            ai: aiResults,
            method: 'ai',
            aiUsed: true
          });
        }

        if (aiMode === 'pure' && aiResults.rankings.length === 0) {
          return json({
            success: true,
            query,
            results: [],
            count: 0,
            ai: aiResults,
            method: 'ai',
            aiUsed: true
          });
        }

        if (!aiResults.rankings || aiResults.rankings.length === 0) {
          return json({
            success: true,
            query,
            results: algorithmicResults,
            count: algorithmicResults.length,
            algorithmic: {
              results: algorithmicResults,
              count: algorithmicResults.length
            },
            ai: aiResults,
            method: 'hybrid',
            aiUsed: true
          });
        }

        const mergedResults = mergeAIRankings(algorithmicResults, aiResults.rankings);

        return json({
          success: true,
          query,
          results: mergedResults,
          count: mergedResults.length,
          algorithmic: {
            results: algorithmicResults,
            count: algorithmicResults.length
          },
          ai: aiResults,
          method: 'hybrid',
          aiUsed: true
        });
      } catch (aiError) {
        console.error('AI search failed in GET request:', aiError);
        return json({
          success: true,
          query,
          results: algorithmicResults,
          count: algorithmicResults.length,
          method: 'algorithmic',
          aiUsed: false,
          aiError: aiError.message
        });
      }
    }

    return json({
      success: true,
      query,
      results: algorithmicResults,
      count: algorithmicResults.length,
      method: 'algorithmic',
      aiUsed: false
    });
  } catch (error) {
    console.error('Search Error:', error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST({ request }) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const { query, useAI = false, aiMode = 'hybrid', threshold = 0.4, semester = null } = body || {};

    if (!query) {
      return json({ success: false, error: 'Query is required' }, { status: 400 });
    }

    const validation = validateSearchQuery(query);
    if (!validation.valid) {
      if (validation.reason === 'inappropriate') {
        return json({
          success: true,
          query,
          results: [],
          count: 0,
          method: useAI ? 'blocked_ai' : 'blocked_algo',
          blocked: true,
          message: useAI
            ? 'Your search query contains inappropriate content and cannot be processed.'
            : undefined
        });
      } else if (validation.reason === 'too_long') {
        return json({ success: false, error: 'Query is too long (max 200 characters)' }, { status: 400 });
      }
    }

    if (isDiscoveryQuery(query)) {
      const resourceLib = await fetchResourceLibrary();
      const discoveryResult = pickDiscoveryResult(resourceLib, semester);
      if (discoveryResult) {
        return json({
          success: true,
          query,
          results: [discoveryResult],
          count: 1,
          method: 'discovery',
          aiUsed: false,
          isDiscovery: true
        });
      }
    }

    const searchThreshold = useAI ? 0.6 : threshold;
    const searchLimit = useAI ? 30 : 20;
    let algorithmicResults = await searchResources(query, searchThreshold, searchLimit);

    const cfg = getConfig();
    const hasAiProvider = Boolean(
      cfg.API_KEY ||
        cfg.HF_LLM_URL ||
        cfg.HF_RERANKER_URL ||
        cfg.MCP_BASE_URL ||
        cfg.TYPESAFE_API_KEY
    );

    // If AI mode and no results found, try fallback search for vague queries
    if (useAI && algorithmicResults.length === 0) {
      const vaguePhrases = ['what', 'start', 'begin', 'first', 'intro', 'help', 'need', 'show'];
      const isVagueQuery = vaguePhrases.some((phrase) => query.toLowerCase().includes(phrase));
      if (isVagueQuery) {
        algorithmicResults = await searchResources('introduction chapter', 0.6, 30);
      }
    }

    if (useAI && hasAiProvider) {
      try {
        const resourceLib = await fetchResourceLibrary();
        const aiResults = await aiSearch(query, algorithmicResults, resourceLib);

        if (!aiResults || !aiResults.rankings || !Array.isArray(aiResults.rankings)) {
          throw new Error('Invalid AI response structure');
        }

        if (aiMode === 'pure' && aiResults.rankings.length > 0) {
          const pureAIResults = aiResults.rankings.map((ranking, index) => ({
            semester: ranking.semester,
            subject: ranking.subject,
            category: ranking.category,
            topic: ranking.topic,
            score:
              ranking.relevance === 'high' ? 95 : ranking.relevance === 'medium' ? 75 : 50,
            matchType: ranking.relevance,
            aiExplanation: ranking.explanation,
            aiRank: index + 1
          }));

          return json({
            success: true,
            query,
            results: pureAIResults,
            count: pureAIResults.length,
            ai: aiResults,
            method: 'ai',
            aiUsed: true
          });
        }

        if (aiMode === 'pure' && aiResults.rankings.length === 0) {
          return json({
            success: true,
            query,
            results: [],
            count: 0,
            ai: aiResults,
            method: 'ai',
            aiUsed: true
          });
        }

        if (!aiResults.rankings || aiResults.rankings.length === 0) {
          return json({
            success: true,
            query,
            results: algorithmicResults,
            count: algorithmicResults.length,
            algorithmic: {
              results: algorithmicResults,
              count: algorithmicResults.length
            },
            ai: aiResults,
            method: 'hybrid',
            aiUsed: true
          });
        }

        const mergedResults = mergeAIRankings(algorithmicResults, aiResults.rankings);

        return json({
          success: true,
          query,
          results: mergedResults,
          count: mergedResults.length,
          algorithmic: {
            results: algorithmicResults,
            count: algorithmicResults.length
          },
          ai: aiResults,
          method: 'hybrid',
          aiUsed: true
        });
      } catch (aiError) {
        console.error('AI search failed in POST request:', aiError);
        return json({
          success: true,
          query,
          results: algorithmicResults,
          count: algorithmicResults.length,
          method: 'algorithmic',
          aiUsed: false,
          aiError: aiError.message
        });
      }
    }

    return json({
      success: true,
      query,
      results: algorithmicResults,
      count: algorithmicResults.length,
      method: 'algorithmic',
      aiUsed: false
    });
  } catch (error) {
    console.error('Search Error:', error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
}

export function OPTIONS({ request }) {
  const origin = request.headers.get('origin');
  return new Response(null, {
    status: 200,
    headers: corsHeaders(origin)
  });
}
