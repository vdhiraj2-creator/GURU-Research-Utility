import './style.css'
import { callBrain, getProviderForMode, getModelForMode, _modelKey, fetchOllamaModels } from './providers/index.js'
import './app.js'

// Expose to global scope so app.js can call them
window.callBrain = callBrain;
window.getProviderForMode = getProviderForMode;
window.getModelForMode = getModelForMode;
window._modelKey = _modelKey;
window.fetchOllamaModels = fetchOllamaModels;
