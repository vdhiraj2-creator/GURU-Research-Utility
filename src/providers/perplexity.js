// src/providers/perplexity.js
import { SK_PERPLEXITY_KEY } from '../constants.js';
import { _callBrainOpenAI } from './shared.js';

export async function callBrainPerplexity(e,t=[]){const n=localStorage.getItem(SK_PERPLEXITY_KEY);return n?_callBrainOpenAI("https://api.perplexity.ai",{Authorization:`Bearer ${n}`},getModelForMode("chat"),e,t):{text:"No Perplexity API key configured. Add it in the Config tab.",thought:null,socratic:null}}
