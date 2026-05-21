import './style.css'
import { callBrain, getProviderForMode, getModelForMode, _modelKey, fetchOllamaModels } from './providers/index.js'
import { isPro, getSettings, saveSettings, _refreshProviderUI, onModeProviderChange, loadSettingsUI } from './settings.js'
import './app.js'
import './brain-ui.js'

// Expose to global scope so app.js can call them
window.callBrain = callBrain;
window.getProviderForMode = getProviderForMode;
window.getModelForMode = getModelForMode;
window._modelKey = _modelKey;
window.fetchOllamaModels = fetchOllamaModels;

// Settings
window.isPro = isPro;
window.getSettings = getSettings;
window.saveSettings = saveSettings;
window._refreshProviderUI = _refreshProviderUI;
window.onModeProviderChange = onModeProviderChange;
window.loadSettingsUI = loadSettingsUI;
