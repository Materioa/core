// ─────────────────────────────────────────────────────
//  Finder Service — Powered by Materio Search API & TypeSafe AI (Jev)
//  Locates resources in resource.lib.json with System 1 decision ranking
// ─────────────────────────────────────────────────────

export interface MaterioSearchItem {
  semester: string;
  subject: string;
  category: string;
  topic: string;
  score: number;
  matchType?: string;
}

export interface FinderResult {
  success: boolean;
  query: string;
  bestMatch?: MaterioSearchItem;
  candidates?: MaterioSearchItem[];
  totalMatches?: number;
  aiRanked?: boolean;
  jevDecision?: {
    choice: string;
    confidence?: string | number;
  };
  mandatoryNextStep: string;
}

/**
 * Query TypeSafe AI's Jev (System 1 model) to select the best match among candidates.
 */
async function rankWithJev(query: string, candidates: MaterioSearchItem[]): Promise<{ choice: string; confidence?: string } | null> {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey || candidates.length < 2) return null;

  try {
    const criteria: Record<string, string> = {};
    for (const c of candidates.slice(0, 5)) {
      const key = `${c.subject} :: ${c.topic}`;
      criteria[key] = `Semester ${c.semester}, ${c.category}: "${c.topic}" (Score: ${c.score})`;
    }

    const payload = {
      model: "jev-latest",
      state: query,
      questions: {
        best_match: {
          type: "choice",
          instructions: "Which syllabus topic most directly and accurately covers the student's concept query?",
          criteria,
        },
        relevance: {
          type: "score",
          instructions: "How directly relevant is the selected topic to the query?",
          criteria: ["low", "medium", "high"],
        },
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[Finder/Jev] TypeSafe API returned status ${res.status}`);
      return null;
    }

    const data: any = await res.json();
    const bestMatchResult = data?.answers?.best_match?.result;
    const relevanceResult = data?.answers?.relevance?.result;

    if (bestMatchResult && typeof bestMatchResult === "string") {
      return {
        choice: bestMatchResult,
        confidence: relevanceResult || data?.answers?.best_match?.confidence,
      };
    }
    return null;
  } catch (err) {
    console.warn(`[Finder/Jev] Evaluation skipped:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Find the most relevant course resource for a user's natural language concept query.
 * 1. Calls Materio Search API (getmaterio.app/api/v2/search?q=...)
 * 2. Uses TypeSafe AI Jev to evaluate and pick the definitive best match
 * 3. Enforces the contract: Returns locations, NOT full text; prompts LLM to call SnapSearch/DeepThink.
 */
export async function findResources(query: string, semesterFilter?: string): Promise<FinderResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      success: false,
      query,
      mandatoryNextStep: "Provide a valid search query to locate resources.",
    };
  }

  const url = `https://getmaterio.app/api/v2/search?q=${encodeURIComponent(trimmed)}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Materio Search API failed (${res.status} ${res.statusText})`);
  }

  const data: any = await res.json();
  let results: MaterioSearchItem[] = Array.isArray(data?.results) ? data.results : [];

  // If a semester was specified, prioritize or filter
  if (semesterFilter && semesterFilter.trim()) {
    const sem = semesterFilter.trim();
    const semFiltered = results.filter((r) => r.semester === sem);
    if (semFiltered.length > 0) {
      results = semFiltered;
    }
  }

  if (results.length === 0) {
    return {
      success: false,
      query: trimmed,
      mandatoryNextStep: "No matching course resources found in the library. Use ResourceLibrary to browse available subjects or ask user to clarify.",
    };
  }

  // Attempt Jev System 1 ranking if multiple candidates exist
  let bestMatch = results[0];
  let jevDecision: { choice: string; confidence?: string | number } | undefined;
  let aiRanked = false;

  const jevResult = await rankWithJev(trimmed, results);
  if (jevResult) {
    // Find the candidate matching Jev's chosen key
    const matchedCandidate = results.find((c) => `${c.subject} :: ${c.topic}` === jevResult.choice);
    if (matchedCandidate) {
      bestMatch = matchedCandidate;
      jevDecision = jevResult;
      aiRanked = true;
    }
  }

  return {
    success: true,
    query: trimmed,
    bestMatch,
    candidates: results.slice(0, 5),
    totalMatches: results.length,
    aiRanked,
    jevDecision,
    mandatoryNextStep: `LOCATION FOUND: ${bestMatch.subject} (Sem ${bestMatch.semester}) -> ${bestMatch.category}: "${bestMatch.topic}". You DO NOT have the textbook content yet. You MUST call SnapSearch(query="${bestMatch.topic}", semester="${bestMatch.semester}", subject="${bestMatch.subject}") to retrieve actual text before answering the user.`,
  };
}
