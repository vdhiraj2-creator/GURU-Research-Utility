// src/providers/openai.js
import { SK_OPENAI_KEY } from '../constants.js';
import { _callBrainOpenAI } from './shared.js';

export async function callBrainOpenAI(e,t=[]){const n=localStorage.getItem(SK_OPENAI_KEY);return n?_callBrainOpenAI("https://api.openai.com/v1",{Authorization:`Bearer ${n}`},getModelForMode("chat"),e,t):{text:"No OpenAI API key configured. Add it in the Config tab.",thought:null,socratic:null}}
