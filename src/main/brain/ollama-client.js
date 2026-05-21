// brain/ollama-client.js
// Thin wrapper around the Ollama REST API for use in the Electron main process.

const BASE_URL = () => process.env.OLLAMA_HOST || 'http://localhost:11434';

class OllamaClient {
  // Generate a text completion.
  // options.temperature overrides the model default — pass 0.0 for verification tasks.
  async generate(prompt, model = 'llama3.1:8b', options = {}) {
    const res = await fetch(`${BASE_URL()}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.1,
          ...options,
        },
      }),
    });
    if (!res.ok) throw new Error(`Ollama generate failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.response || '';
  }

  // Generate an embedding vector for the given text.
  async embed(text, model = 'nomic-embed-text') {
    const res = await fetch(`${BASE_URL()}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) throw new Error(`Ollama embed failed: HTTP ${res.status}`);
    const data = await res.json();
    if (!data.embedding) throw new Error('Ollama returned no embedding');
    return data.embedding; // Float[]
  }

  // Returns true if Ollama is reachable and running.
  async isRunning() {
    try {
      const res = await fetch(`${BASE_URL()}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  // List all locally available model names.
  async listModels() {
    const res = await fetch(`${BASE_URL()}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map(m => m.name);
  }
}

module.exports = new OllamaClient();
