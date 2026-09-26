import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { corsHeaders } from '$lib/server/cors-origins.js';

const API_KEY =
  env.OPENROUTER_API_KEY ||
  process.env.OPENROUTER_API_KEY ||
  env.NETLIFY_OPENROUTER_API_KEY ||
  process.env.NETLIFY_OPENROUTER_API_KEY;

export const MODELS = {
  reasoning: [
    'deepseek/deepseek-chat-v3-0324:free',
    'qwen/qwen3-235b-a22b:free',
    'meta-llama/llama-4-scout:free',
    'moonshotai/kimi-k2:free',
    'meta-llama/llama-4-maverick:free',
    'mistralai/mistral-small-3.1-24b-instruct:free'
  ],
  code: [
    'deepseek/deepseek-chat-v3-0324:free',
    'qwen/qwen3-coder:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemma-3-27b-it:free',
    'openai/gpt-oss-120b:free',
    'mistralai/mistral-small-3.1-24b-instruct:free'
  ],
  general: [
    'minimax/minimax-m2:free',
    'z-ai/glm-4.5-air:free',
    'meta-llama/llama-4-maverick:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemini-2.0-flash-exp:free',
    'google/gemma-3-27b-it:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'openai/gpt-oss-120b:free',
    'moonshotai/kimi-k2:free',
    'deepseek/deepseek-chat-v3-0324:free',
    'qwen/qwen3-235b-a22b:free',
    'qwen/qwen3-coder:free',
    'meta-llama/llama-4-scout:free',
    'minimax/minimax-m2:free',
    'microsoft/mai-ds-r1:free'
  ],
  image: [
    'nvidia/nemotron-nano-12b-v2-vl:free',
    'meta-llama/llama-4-maverick:free',
    'google/gemini-2.0-flash-exp:free'
  ]
};

export const MODEL_DISPLAY_NAMES = {
  'google/gemini-2.0-flash-exp:free': 'Gemini 2.0 Flash',
  'google/gemma-3-27b-it:free': 'Gemma 3 27B',
  'mistralai/mistral-small-3.1-24b-instruct:free': 'Mistral Small 3.1',
  'mistralai/mistral-small-3.2-24b-instruct:free': 'Mistral Small 3.2',
  'meta-llama/llama-4-maverick:free': 'Llama 4 Maverick',
  'meta-llama/llama-4-scout:free': 'Llama 4 Scout',
  'meta-llama/llama-3.3-70b-instruct:free': 'Llama 3.3 70B Instruct',
  'deepseek/deepseek-chat-v3-0324:free': 'DeepSeek Chat v3',
  'deepseek/deepseek-r1-0528:free': 'DeepSeek R1',
  'qwen/qwen3-235b-a22b:free': 'Qwen3 235B',
  'qwen/qwen3-coder:free': 'Qwen3 Coder',
  'qwen/qwen-2.5-coder-32b-instruct:free': 'Qwen 2.5 Coder',
  'openai/gpt-oss-20b:free': 'GPT-OSS 120B',
  'minimax/minimax-m2:free': 'Minimax M2',
  'z-ai/glm-4.5-air:free': 'GLM-4.5 Air',
  'moonshotai/kimi-k2:free': 'Kimi K2',
  'nvidia/nemotron-nano-12b-v2-vl:free': 'Nemotron Nano 12B VL',
  'microsoft/mai-ds-r1:free': 'Microsoft MAI-DS R1'
};

export const SYSTEM_PROMPTS = {
  general:
    'You are Materio, a helpful and knowledgeable AI made by Materio. Always be accurate, helpful, and respectful. Format your responses clearly using markdown when appropriate. When generating LaTeX expressions, always wrap inline math with single dollar signs $...$ and display math with double dollar signs $$...$$, so that they render properly using KaTeX. Provide clear, accurate, and helpful responses. Be conversational and friendly while maintaining professionalism.',
  reasoning:
    'You are Materio, a helpful and knowledgeable AI made by Materio. Always be accurate, helpful, and respectful. Format your responses clearly using markdown when appropriate. When generating LaTeX expressions, always wrap inline math with single dollar signs $...$ and display math with double dollar signs $$...$$, so that they render properly using KaTeX. You specialize in reasoning and problem-solving. Think step by step and provide detailed analysis. Break down complex problems into smaller parts and explain your reasoning process clearly.',
  code:
    'You are Materio, a helpful and knowledgeable AI made by Materio. Always be accurate, helpful, and respectful. Format your responses clearly using markdown when appropriate. When generating LaTeX expressions, always wrap inline math with single dollar signs $...$ and display math with double dollar signs $$...$$, so that they render properly using KaTeX. You specialize in coding and programming. Provide clear, well-commented code solutions and explain technical concepts. Always include explanations for your code and suggest best practices.'
};

function getPreferredModel(mode) {
  const modeModels = MODELS[mode] || MODELS.general;
  return modeModels[0];
}

function resolvePath(url, params) {
  const sub = params?.path || url.searchParams.get('path') || '';
  const pathname = url.pathname;
  if (sub === 'models' || pathname.endsWith('/models') || pathname.includes('/models')) return 'models';
  if (sub === 'health' || pathname.endsWith('/health') || pathname.includes('/health')) return 'health';
  return '';
}

export async function handleChatGet({ url, params }) {
  const path = resolvePath(url, params);

  if (path === 'models') {
    const allModels = [
      ...new Set([
        ...(MODELS.general || []),
        ...(MODELS.reasoning || []),
        ...(MODELS.code || []),
        ...(MODELS.image || [])
      ])
    ];
    const modelsWithNames = allModels.map((model) => ({
      id: model,
      name: MODEL_DISPLAY_NAMES[model] || model
    }));

    return json({
      success: true,
      models: modelsWithNames,
      modelsByMode: MODELS
    });
  }

  if (path === 'health') {
    return json({
      success: true,
      message: 'Chat API is running',
      timestamp: new Date().toISOString(),
      apiConfigured: !!API_KEY
    });
  }

  return json({ success: false, error: 'Endpoint not found' }, { status: 404 });
}

export async function handleChatPost({ request, url, params }) {
  const path = resolvePath(url, params);

  if (path !== '') {
    return json({ success: false, error: 'Endpoint not found' }, { status: 404 });
  }

  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const { message, mode = 'general', model, messages = [] } = body;

    if (!message) {
      return json({ success: false, error: 'Message is required' }, { status: 400 });
    }

    if (!API_KEY) {
      return json({ success: false, error: 'API key not configured' }, { status: 500 });
    }

    const selectedModel = model || getPreferredModel(mode);
    const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.general;

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((msg) => ({ role: msg.role, content: msg.content })),
      { role: 'user', content: message }
    ];

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': request.headers.get('referer') || 'https://materioa.vercel.app',
        'X-Title': 'Materio AI Chat'
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();

    return json({
      success: true,
      response: data.choices[0].message.content,
      model: selectedModel,
      modelName: MODEL_DISPLAY_NAMES[selectedModel] || selectedModel
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return json({ success: false, error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export function handleChatOptions({ request }) {
  const origin = request.headers.get('origin');
  return new Response(null, {
    status: 200,
    headers: corsHeaders(origin)
  });
}
