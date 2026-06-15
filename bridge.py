#!/usr/bin/env python3

import os
import json
import socket
import subprocess
import sqlite3
import uuid
import tempfile
import time
import wave
from pathlib import Path
from datetime import datetime

# ── Auto-install dependencies ─────────────────────────────────────────────────

def pip_install(pkg):
    subprocess.run(["pip", "install", pkg, "--break-system-packages", "-q"], check=False)

try:
    import psutil
except ImportError:
    pip_install("psutil"); import psutil

try:
    import litellm
except ImportError:
    pip_install("litellm"); import litellm

try:
    from duckduckgo_search import DDGS
    DDGS_AVAILABLE = True
except ImportError:
    pip_install("duckduckgo-search")
    try:
        from duckduckgo_search import DDGS
        DDGS_AVAILABLE = True
    except ImportError:
        DDGS_AVAILABLE = False

try:
    import pyaudio
    PYAUDIO_AVAILABLE = True
except ImportError:
    PYAUDIO_AVAILABLE = False

try:
    from faster_whisper import WhisperModel
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False

# ── Config ────────────────────────────────────────────────────────────────────

CONFIG_DIR  = Path.home() / ".config" / "admiralty"
CONFIG_FILE = CONFIG_DIR / "bridge.conf"

def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {}

def save_config(config):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)

# ── Network ───────────────────────────────────────────────────────────────────

def check_online():
    try:
        socket.setdefaulttimeout(3)
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect(("8.8.8.8", 53))
        return True
    except:
        return False

# ── System status ─────────────────────────────────────────────────────────────

def get_ship_status():
    cpu  = psutil.cpu_percent(interval=0.5)
    ram  = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    try:
        zram_used = psutil.swap_memory().used / (1024**3)
    except:
        zram_used = 0
    ollama_running = any('ollama' in p.name().lower()
                         for p in psutil.process_iter(['name']))
    return {
        "cpu":    f"{cpu}%",
        "ram":    f"{ram.used/(1024**3):.1f}GB/{ram.total/(1024**3):.1f}GB",
        "disk":   f"{disk.used/(1024**3):.1f}GB/{disk.total/(1024**3):.1f}GB",
        "zram":   f"{zram_used:.1f}GB",
        "ollama": "active" if ollama_running else "inactive",
    }

# ── Memory (SQLite) ───────────────────────────────────────────────────────────

def init_memory():
    db_path = CONFIG_DIR / "memory.db"
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            timestamp  TEXT,
            role       TEXT,
            content    TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS agent_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            timestamp  TEXT,
            task       TEXT,
            actions    TEXT,
            outcome    TEXT
        )
    """)
    conn.commit()
    return conn

def save_message(conn, session_id, role, content):
    conn.execute(
        "INSERT INTO history (session_id, timestamp, role, content) VALUES (?, ?, ?, ?)",
        (session_id, datetime.now().isoformat(), role, content)
    )
    conn.commit()

def save_agent_log(conn, session_id, task, actions, outcome):
    conn.execute(
        "INSERT INTO agent_log (session_id, timestamp, task, actions, outcome) VALUES (?, ?, ?, ?, ?)",
        (session_id, datetime.now().isoformat(), task, json.dumps(actions), outcome)
    )
    conn.commit()

def search_memory(conn, query, limit=5):
    cursor = conn.execute(
        "SELECT timestamp, role, content FROM history WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?",
        (f"%{query}%", limit)
    )
    return cursor.fetchall()

# ── Voice input ───────────────────────────────────────────────────────────────

def listen_and_transcribe():
    if not PYAUDIO_AVAILABLE or not WHISPER_AVAILABLE:
        print("  [Voice] pyaudio or faster-whisper not available\n")
        return None

    print("  \033[36m🎤 Recording for 5 seconds... speak now\033[0m")
    audio  = pyaudio.PyAudio()
    frames = []

    try:
        stream = audio.open(
            format=pyaudio.paInt16, channels=1, rate=16000,
            input=True, input_device_index=9, frames_per_buffer=1024
        )
        start = time.time()
        while time.time() - start < 5:
            frames.append(stream.read(1024, exception_on_overflow=False))
        stream.stop_stream()
        stream.close()
    except Exception as e:
        print(f"  [Voice Error] Recording failed: {e}\n")
        audio.terminate()
        return None
    finally:
        audio.terminate()

    print("  \033[34mTranscribing...\033[0m")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wf = wave.open(f.name, 'wb')
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(16000)
        wf.writeframes(b''.join(frames)); wf.close()
        tmp_path = f.name

    try:
        model    = WhisperModel("tiny", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(tmp_path)
        text     = " ".join([s.text for s in segments]).strip()
        os.unlink(tmp_path)
        if text:
            print(f"  \033[36mHeard: {text}\033[0m\n")
            return text
        print("  [Voice] Nothing heard\n")
        return None
    except Exception as e:
        print(f"  [Voice Error] Transcription failed: {e}\n")
        return None

# ── Web search abstraction ────────────────────────────────────────────────────
# To swap provider: set config["search_provider"] = "brave" | "serper" | "tavily"
# and add the corresponding API key to bridge.conf.

def web_search(query, config, max_results=5):
    provider = config.get("search_provider", "duckduckgo")

    if provider == "brave":
        import urllib.request, urllib.parse
        key = config.get("brave_api_key", "")
        url = f"https://api.search.brave.com/res/v1/web/search?q={urllib.parse.quote(query)}&count={max_results}"
        req = urllib.request.Request(url, headers={"Accept": "application/json", "X-Subscription-Token": key})
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read())
        return [{"title": i["title"], "body": i.get("description",""), "href": i["url"]}
                for i in data.get("web", {}).get("results", [])]

    elif provider == "serper":
        import urllib.request, urllib.parse
        key     = config.get("serper_api_key", "")
        payload = json.dumps({"q": query, "num": max_results}).encode()
        req = urllib.request.Request(
            "https://google.serper.dev/search", data=payload,
            headers={"X-API-KEY": key, "Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read())
        return [{"title": i["title"], "body": i.get("snippet",""), "href": i["link"]}
                for i in data.get("organic", [])]

    elif provider == "tavily":
        import urllib.request
        key     = config.get("tavily_api_key", "")
        payload = json.dumps({"api_key": key, "query": query, "max_results": max_results}).encode()
        req = urllib.request.Request(
            "https://api.tavily.com/search", data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read())
        return [{"title": i["title"], "body": i.get("content",""), "href": i["url"]}
                for i in data.get("results", [])]

    else:  # duckduckgo — default, free, no key required
        if not DDGS_AVAILABLE:
            return [{"title": "Search unavailable", "body": "duckduckgo-search not installed", "href": ""}]
        with DDGS() as ddgs:
            return list(ddgs.text(query, max_results=max_results))

# ── Trust tier definitions ────────────────────────────────────────────────────

TIER = {
    # tool_name -> tier
    "shell_read":       "READ",
    "read_file":        "READ",
    "search_web":       "READ",
    "search_memory":    "READ",
    "systemctl_action": "SAFE",
    "write_file":       "SAFE",
    "flatpak_update":   "SAFE",
    "apt_update":       "DESTRUCT",
    "apt_install":      "DESTRUCT",
    "apt_remove":       "DESTRUCT",
    "shell_write":      "DESTRUCT",
    "reboot":           "DESTRUCT",
}

TIER_COLOUR = {
    "READ":     "\033[32m",
    "SAFE":     "\033[33m",
    "DESTRUCT": "\033[31m",
}
RESET = "\033[0m"

# ── Native tool schemas (OpenAI function-calling format) ──────────────────────
# LiteLLM passes these to Ollama's /api/chat tools parameter natively.

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "shell_read",
            "description": "Run a read-only shell command and return its output. Use for inspection: df, free, journalctl, uname, systemctl status, ls, cat, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The shell command to run"}
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a file on disk.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute or ~ path to the file"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Search the web for information, error messages, package info, CVEs, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query":       {"type": "string", "description": "Search query"},
                    "max_results": {"type": "integer", "description": "Number of results (default 5)", "default": 5}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_memory",
            "description": "Search past conversation history stored in local SQLite memory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Term to search for"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "systemctl_action",
            "description": "Manage a systemd service: start, stop, restart, reload, or get status.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action":  {"type": "string", "enum": ["status", "start", "stop", "restart", "reload"]},
                    "service": {"type": "string", "description": "Service name e.g. ollama, NetworkManager"}
                },
                "required": ["action", "service"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write or append content to a file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path":    {"type": "string", "description": "File path"},
                    "content": {"type": "string", "description": "Content to write"},
                    "mode":    {"type": "string", "enum": ["w", "a"], "description": "w=overwrite, a=append", "default": "w"}
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "flatpak_update",
            "description": "Update all installed Flatpak applications.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "apt_update",
            "description": "Run apt package management operations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["update", "upgrade", "full"],
                        "description": "update=refresh package lists only, upgrade=install upgrades, full=update then upgrade"
                    }
                },
                "required": ["mode"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "apt_install",
            "description": "Install a package via apt.",
            "parameters": {
                "type": "object",
                "properties": {
                    "package": {"type": "string", "description": "Package name to install"}
                },
                "required": ["package"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "apt_remove",
            "description": "Remove a package via apt.",
            "parameters": {
                "type": "object",
                "properties": {
                    "package": {"type": "string", "description": "Package name to remove"}
                },
                "required": ["package"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "shell_write",
            "description": "Run a shell command that modifies system state. Use only when no specific tool covers the action.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The shell command to run"}
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "reboot",
            "description": "Reboot the system.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
]

# ── Tool executor ─────────────────────────────────────────────────────────────

def confirm_action(tool_name, params):
    tier   = TIER.get(tool_name, "DESTRUCT")
    colour = TIER_COLOUR[tier]
    print(f"\n  {colour}[{tier}] {tool_name}{RESET}: {json.dumps(params)}")
    ans = input("  Confirm? [y/N] > ").strip().lower()
    return ans == "y"

def execute_tool(tool_name, params, config, conn, session_id):
    """Execute a tool. Returns (success: bool, output: str)."""
    tier = TIER.get(tool_name, "DESTRUCT")

    if tier == "SAFE":
        colour = TIER_COLOUR["SAFE"]
        print(f"  {colour}[SAFE]{RESET} {tool_name}: {json.dumps(params)}")
    elif tier == "DESTRUCT":
        if not confirm_action(tool_name, params):
            return False, "Action cancelled by user."

    try:
        if tool_name == "shell_read":
            r = subprocess.run(params["command"], shell=True, capture_output=True, text=True, timeout=30)
            return True, (r.stdout + r.stderr) or "(no output)"

        elif tool_name == "read_file":
            path = Path(params["path"]).expanduser()
            return True, path.read_text(errors="replace")

        elif tool_name == "search_web":
            results = web_search(params["query"], config, max_results=params.get("max_results", 5))
            formatted = "\n\n".join(
                f"Title: {r.get('title','')}\nURL: {r.get('href','')}\nSummary: {r.get('body','')}"
                for r in results
            )
            return True, formatted or "No results found."

        elif tool_name == "search_memory":
            results = search_memory(conn, params["query"])
            if not results:
                return True, "No memories found."
            return True, "\n".join(f"[{ts[:10]}] {role}: {content[:200]}"
                                   for ts, role, content in results)

        elif tool_name == "systemctl_action":
            action, service = params["action"], params["service"]
            cmd = f"systemctl status {service} --no-pager -l" if action == "status" \
                  else f"sudo systemctl {action} {service}"
            r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
            return True, r.stdout + r.stderr

        elif tool_name == "write_file":
            path = Path(params["path"]).expanduser()
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, params.get("mode", "w")) as f:
                f.write(params["content"])
            return True, f"Written to {path}"

        elif tool_name == "flatpak_update":
            r = subprocess.run(["flatpak", "update", "-y"], capture_output=True, text=True, timeout=300)
            return True, r.stdout + r.stderr

        elif tool_name == "apt_update":
            mode = params["mode"]
            if mode == "full":
                r1 = subprocess.run(["sudo", "apt", "update"], capture_output=True, text=True, timeout=120)
                r2 = subprocess.run(["sudo", "apt", "upgrade", "-y"], capture_output=True, text=True, timeout=600)
                return True, r1.stdout + r1.stderr + "\n" + r2.stdout + r2.stderr
            elif mode == "upgrade":
                r = subprocess.run(["sudo", "apt", "upgrade", "-y"], capture_output=True, text=True, timeout=600)
            else:
                r = subprocess.run(["sudo", "apt", "update"], capture_output=True, text=True, timeout=120)
            return True, r.stdout + r.stderr

        elif tool_name == "apt_install":
            r = subprocess.run(["sudo", "apt", "install", "-y", params["package"]],
                                capture_output=True, text=True, timeout=300)
            return True, r.stdout + r.stderr

        elif tool_name == "apt_remove":
            r = subprocess.run(["sudo", "apt", "remove", "-y", params["package"]],
                                capture_output=True, text=True, timeout=120)
            return True, r.stdout + r.stderr

        elif tool_name == "shell_write":
            r = subprocess.run(params["command"], shell=True, capture_output=True, text=True, timeout=120)
            return True, r.stdout + r.stderr

        elif tool_name == "reboot":
            subprocess.run(["sudo", "reboot"])
            return True, "Rebooting..."

        else:
            return False, f"Unknown tool: {tool_name}"

    except subprocess.TimeoutExpired:
        return False, "Command timed out."
    except Exception as e:
        return False, f"Tool error: {e}"

# ── Agentic mode ──────────────────────────────────────────────────────────────

AGENT_SYSTEM = """You are Admiral's Bridge, an autonomous Linux sysadmin agent running on AdmiraltyOS (Kubuntu-based, ThinkPad L16, Ryzen 5 Pro 7535U, CachyOS kernel).

You have tools available. Use them to complete the user's task step by step.
Rules:
1. Always gather information before taking action — use shell_read first.
2. Prefer the most specific tool available over shell_write.
3. Never guess at system state — check it.
4. When the task is complete, summarise what you did in plain text.
5. If you cannot complete a task safely, explain why and stop.
"""

def llm_call(provider, model, config, messages, use_tools=False):
    """Single LLM call. Returns the raw response object."""
    kwargs = {
        "messages": messages,
    }
    if use_tools:
        kwargs["tools"] = TOOL_SCHEMAS
        kwargs["tool_choice"] = "auto"

    if provider == "ollama":
        kwargs["model"]    = f"ollama/{model}"
        kwargs["api_base"] = "http://localhost:11434"
    else:
        os.environ["ANTHROPIC_API_KEY"] = config.get("api_key", "")
        kwargs["model"] = model

    return litellm.completion(**kwargs)

def run_agent(task, config, provider, model, conn, session_id):
    print(f"\n  \033[36m⚙  Agent engaged — task: {task}\033[0m\n")

    system_msg  = {"role": "system", "content": AGENT_SYSTEM}
    user_msg    = {
        "role": "user",
        "content": f"Task: {task}\n\nCurrent system snapshot:\n{json.dumps(get_ship_status(), indent=2)}"
    }
    messages    = [system_msg, user_msg]
    actions_log = []
    max_steps   = 15

    for step in range(max_steps):
        try:
            response = llm_call(provider, model, config, messages, use_tools=True)
        except Exception as e:
            print(f"  [Agent LLM Error] {e}\n")
            # Fallback: if model doesn't support native tools, surface the error clearly
            print("  [Agent] Note: if using Ollama, ensure your model supports tool calling.\n"
                  "  Recommended: ollama pull qwen2.5:7b\n")
            break

        choice  = response.choices[0]
        message = choice.message

        # Check for native tool calls
        if message.tool_calls:
            # Append assistant message with tool_calls to history
            messages.append({"role": "assistant", "content": message.content or "", "tool_calls": [
                {
                    "id":       tc.id,
                    "type":     "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments}
                } for tc in message.tool_calls
            ]})

            # Execute each tool call
            for tc in message.tool_calls:
                tool_name = tc.function.name
                try:
                    params = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    params = {}

                tier   = TIER.get(tool_name, "DESTRUCT")
                colour = TIER_COLOUR[tier]
                print(f"  {colour}[{tier}]{RESET} {tool_name}({json.dumps(params)})")

                success, output = execute_tool(tool_name, params, config, conn, session_id)
                actions_log.append({"tool": tool_name, "params": params, "success": success})

                if not success and "cancelled" in output.lower():
                    print(f"\n  \033[33mAgent stopped — action cancelled by user.\033[0m\n")
                    save_agent_log(conn, session_id, task, actions_log, "cancelled")
                    return

                # Feed tool result back
                result_text = output[:3000] if len(output) > 3000 else output
                messages.append({
                    "role":         "tool",
                    "tool_call_id": tc.id,
                    "content":      f"success={success}\n{result_text}"
                })

                print(f"  \033[34m└─ {'OK' if success else 'FAIL'}: {result_text[:120].strip()}\033[0m")

        else:
            # No tool calls — agent is finished, surface its summary
            summary = (message.content or "").strip()
            print(f"\n  \033[36m⚓ Agent complete:\033[0m\n  {summary}\n")
            save_agent_log(conn, session_id, task, actions_log, summary)
            return

    print(f"\n  \033[33m[Agent] Reached step limit ({max_steps}).\033[0m\n")
    save_agent_log(conn, session_id, task, actions_log, "incomplete")

# ── Engine selection ──────────────────────────────────────────────────────────

def get_engine(config, online):
    if online and config.get("api_key") and config.get("provider", "ollama") != "ollama":
        return config["provider"], config.get("model", "claude-3-haiku-20240307"), "online"
    return "ollama", config.get("ollama_model", "llama3.2"), "offline"

# ── Header ────────────────────────────────────────────────────────────────────

def show_header(ship_name, provider, model, engine_status, config):
    status = get_ship_status()
    search = config.get("search_provider", "duckduckgo")
    print(f"\n\033[36m  ⚓  ADMIRAL'S BRIDGE  ||  {ship_name.upper()}  ||  DREADNOUGHT CLASS\033[0m")
    print(f"\033[34m  Engine : {provider} | Model: {model} | {engine_status}\033[0m")
    print(f"\033[34m  CPU    : {status['cpu']} | RAM: {status['ram']} | ZRAM: {status['zram']} | Ollama: {status['ollama']}\033[0m")
    print(f"\033[34m  Search : {search} | /help for commands\033[0m\n")

# ── Ship name setup ───────────────────────────────────────────────────────────

def get_ship_name(config):
    if "ship_name" not in config:
        print("\n\033[36m⚓ Welcome to Admiral's Bridge\033[0m\n")
        name = input("What is the name of your vessel? > ").strip()
        config["ship_name"] = name or "UnknownVessel"
        save_config(config)
    return config["ship_name"]

# ── Main chat loop ────────────────────────────────────────────────────────────

def chat(ship_name, provider, model, engine_status, config, history, conn, session_id):
    prompt     = f"\nBridge@{ship_name} ~ {provider} [{engine_status}] » "
    user_input = input(prompt).strip()

    if not user_input:
        return history

    low = user_input.lower()

    if low in ["/bye", "/exit", "/quit"]:
        print(f"\n\033[36m⚓ Signing off from {ship_name}. Fair winds.\033[0m\n")
        exit(0)

    if low == "/listen":
        transcribed = listen_and_transcribe()
        if transcribed:
            user_input = transcribed
        else:
            return history

    if low == "/status":
        s = get_ship_status()
        print(f"\n  \033[36mShip Status — {ship_name}\033[0m")
        for k, v in s.items():
            print(f"  {k.upper():<8}: {v}")
        print(f"  KERNEL  : {os.uname().release}\n")
        return history

    if low.startswith("/recall "):
        query   = user_input[8:]
        results = search_memory(conn, query)
        if results:
            print(f"\n  \033[36mMemory: '{query}'\033[0m")
            for ts, role, content in results:
                print(f"  [{ts[:10]}] {role}: {content[:120]}")
            print()
        else:
            print(f"\n  No memories found for '{query}'\n")
        return history

    if low.startswith("/agent "):
        task = user_input[7:].strip()
        if task:
            run_agent(task, config, provider, model, conn, session_id)
        else:
            print("  Usage: /agent <task description>\n")
        return history

    if low == "/tools":
        print("\n  \033[36mAvailable agent tools:\033[0m")
        for name, tier in TIER.items():
            colour = TIER_COLOUR[tier]
            schema = next((t for t in TOOL_SCHEMAS if t["function"]["name"] == name), None)
            desc   = schema["function"]["description"].split(".")[0] if schema else ""
            print(f"  {colour}[{tier:<8}]{RESET} {name:<22} {desc}")
        print()
        return history

    if low == "/help":
        print("""
  \033[36mCommands:\033[0m
  /status              live system status
  /listen              voice input via microphone
  /recall <term>       search conversation memory
  /agent  <task>       engage agentic mode for a task
  /tools               list agent tools and trust tiers
  /clear               clear conversation history
  /bye                 exit

  \033[36mAgent trust tiers:\033[0m
  \033[32m[READ    ]\033[0m  executes silently
  \033[33m[SAFE    ]\033[0m  executes with a notice
  \033[31m[DESTRUCT]\033[0m  requires explicit confirmation
        """)
        return history

    if low == "/clear":
        print("  Conversation cleared.\n")
        return []

    # ── Normal chat (no tools) ────────────────────────────────────────────────
    history.append({"role": "user", "content": user_input})
    save_message(conn, session_id, "user", user_input)

    try:
        response = llm_call(provider, model, config, history, use_tools=False)
        reply    = response.choices[0].message.content
        print(f"\n  {reply}\n")
        history.append({"role": "assistant", "content": reply})
        save_message(conn, session_id, "assistant", reply)
    except Exception as e:
        print(f"\n  [Error] {e}\n")

    return history

# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    config                         = load_config()
    ship_name                      = get_ship_name(config)
    online                         = check_online()
    provider, model, engine_status = get_engine(config, online)
    conn                           = init_memory()
    session_id                     = str(uuid.uuid4())[:8]
    show_header(ship_name, provider, model, engine_status, config)
    history = []
    while True:
        history = chat(ship_name, provider, model, engine_status, config, history, conn, session_id)

if __name__ == "__main__":
    main()
