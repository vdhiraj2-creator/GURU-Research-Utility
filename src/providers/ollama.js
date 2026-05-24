// src/providers/ollama.js
import { SK_OLLAMA_URL, SK_MODEL_OLLAMA } from '../constants.js';
import { _callBrainOpenAI } from './shared.js';

export async function callBrainOllama(e,t=[]){return _callBrainOpenAI(`${(localStorage.getItem(SK_OLLAMA_URL)||"http://localhost:11434").replace(/\/$/,"")}/v1`,{},localStorage.getItem(SK_MODEL_OLLAMA)||"phi4-mini",e,t)}

export async function fetchOllamaModels(){const e=document.getElementById("cfg-ollama-url"),t=(e?.value.trim()||localStorage.getItem(SK_OLLAMA_URL)||"http://localhost:11434").replace(/\/$/,""),n=document.getElementById("cfg-ollama-model");if(n)try{window.setStatus("Detecting Ollama models…");const e=await fetch(`${t}/api/tags`);if(!e.ok)throw new Error(`HTTP ${e.status}`);const a=(await e.json()).models||[];if(!a.length)return n.innerHTML='<option value="">No models found — run: ollama pull phi4-mini</option>',void window.setStatus("");const o=localStorage.getItem(SK_MODEL_OLLAMA)||"";n.innerHTML=a.map(e=>`<option value="${e.name}"${e.name===o?" selected":""}>${e.name}</option>`).join(""),window.setStatus(""),window.addBubble("system",`Ollama: found ${a.length} model${1!==a.length?"s":""} — ${a.map(e=>e.name).join(", ")}`)}catch(e){window.setStatus(""),window.addBubble("system",`Could not reach Ollama at ${t}. Ensure Ollama is running and OLLAMA_ORIGINS is set, or use the desktop build for offline access.`)}}
