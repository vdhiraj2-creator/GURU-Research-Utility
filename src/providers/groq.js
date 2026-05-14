// src/providers/groq.js
import { SK_GROQ_KEY } from '../constants.js';
import { _callBrainOpenAI } from './shared.js';

export async function callBrainGroq(e,t=[]){const n=localStorage.getItem(SK_GROQ_KEY);return n?_callBrainOpenAI("https://api.groq.com/openai/v1",{Authorization:`Bearer ${n}`},getModelForMode("chat"),e,t):{text:"No Groq API key configured. Get one free at console.groq.com then add it in the Config tab.",thought:null,socratic:null}}
