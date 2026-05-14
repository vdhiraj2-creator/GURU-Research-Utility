// src/providers/index.js
// Provider router — edit this file to add new providers
import { SK_PROVIDER, SK_MODEL_OLLAMA, SK_MODEL_CHAT, SK_MODEL_VIVA, SK_MODEL_TOOLS, SK_MODEL_REPORT } from '../constants.js';
import { callBrainGemini }     from './gemini.js';
import { callBrainGroq }       from './groq.js';
import { callBrainClaude }     from './claude.js';
import { callBrainOpenAI }     from './openai.js';
import { callBrainPerplexity } from './perplexity.js';
import { callBrainOllama, fetchOllamaModels } from './ollama.js';

export { fetchOllamaModels };

export function _modelKey(e,t){return"gemini"===e?{chat:SK_MODEL_CHAT,viva:SK_MODEL_VIVA,tools:SK_MODEL_TOOLS,report:SK_MODEL_REPORT}[t]||SK_MODEL_CHAT:`horatio_model_${e}_${t}`}

export function getProviderForMode(e){return localStorage.getItem(`horatio_provider_${e}`)||localStorage.getItem(SK_PROVIDER)||"gemini"}

export function getModelForMode(e){const t=getProviderForMode(e);return"ollama"===t?localStorage.getItem(SK_MODEL_OLLAMA)||"phi4-mini":localStorage.getItem(_modelKey(t,e))||{gemini:"gemini-2.5-flash",claude:"claude-sonnet-4-6",groq:"llama-3.3-70b-versatile",openai:"gpt-4o",perplexity:"sonar-pro"}[t]||"gemini-2.5-flash"}

export async function callBrain(e,t=[]){const n=getProviderForMode("chat");if("claude"===n)return callBrainClaude(e,t);if("groq"===n)return callBrainGroq(e,t);if("ollama"===n)return callBrainOllama(e,t);if("openai"===n)return callBrainOpenAI(e,t);if("perplexity"===n)return callBrainPerplexity(e,t);return callBrainGemini(e,t)}
