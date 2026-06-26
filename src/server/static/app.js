// ====================================================
// Try Web UI — 前端应用逻辑 (全功能版)
// ====================================================

// ---------- 状态 ----------
const state = {
  currentSessionId: null,
  currentAgentId: "builtin:chat",
  sessions: [],
  messages: [],
  agents: [],
  isStreaming: false,
  isProcessing: false,
  streamingAbort: null,
  userScrolledUp: false,
  sessionCache: {}, // { [sessionId]: { messages, isProcessing, isStreaming, abortController, contentSoFar, aiMsgEl } }
};

// ---------- DOM 引用 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  sidebar: $("#sidebar"),
  sessionList: $("#session-list"),
  sessionTitle: $("#current-session-title"),
  messageList: $("#message-list"),
  chatInput: $("#chat-input"),
  btnSend: $("#btn-send"),
  btnStop: $("#btn-stop"),
  btnNewSession: $("#btn-new-session"),
  btnToggleSidebar: $("#btn-toggle-sidebar"),
  btnClearChat: $("#btn-clear-chat"),
  agentSelect: $("#agent-select"),
  statusDot: $("#status-indicator"),
  statusText: $("#status-text"),
  charCount: $("#char-count"),
  sessionSearch: $("#session-search"),
  btnSettings: $("#btn-settings"),
};

// ---------- 工具函数 ----------
function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  const days = Math.floor(diff / 86400000);
  if (days < 7) return `${days}天前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function truncate(str, maxLen = 50) {
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

function debounce(fn, ms = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ---------- Markdown 渲染 ----------
// 使用 marked 库 (GitHub Flavored Markdown)，自定义代码块以匹配 Try 的 UI 风格
const markedRenderer = new marked.Renderer();
markedRenderer.code = function({ text, lang }) {
  const langLabel = lang ? `<span class="code-lang">${lang}</span>` : "";
  const copyBtn = `<button class="code-copy-btn" onclick="copyCodeBlock(this)" title="复制">📋</button>`;
  return `<div class="code-block">${langLabel}${copyBtn}<pre><code>${text}</code></pre></div>`;
};

markedRenderer.table = function(token) {
  // marked v18 passes the full token: { header: [...], rows: [...], align: [...] }
  // Use the default table renderer to get HTML, then wrap it
  const defaultTable = marked.Renderer.prototype.table.call(this, token);
  const csvBtn = `<button class="csv-dl-btn" onclick="downloadTableCSV(this)" title="下载为 CSV">📥 CSV</button>`;
  return `<div class="table-wrapper">${csvBtn}<div class="table-scroll">${defaultTable}</div></div>`;
};

marked.setOptions({
  renderer: markedRenderer,
  breaks: true,
  gfm: true,
});

function renderMarkdown(text) {
  if (!text) return "";
  return marked.parse(text);
}

window.copyCodeBlock = function(btn) {
  const block = btn.closest(".code-block");
  const code = block?.querySelector("code")?.textContent || "";
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = "✓";
    setTimeout(() => (btn.textContent = "📋"), 2000);
  }).catch(() => {
    btn.textContent = "✗";
    setTimeout(() => (btn.textContent = "📋"), 2000);
  });
};

window.downloadTableCSV = function(btn) {
  const wrapper = btn.closest(".table-wrapper");
  const table = wrapper?.querySelector("table");
  if (!table) return;

  const rows = table.querySelectorAll("tr");
  const csvRows = [];
  for (const row of rows) {
    const cells = row.querySelectorAll("th, td");
    const csvCells = [];
    for (const cell of cells) {
      let val = cell.textContent || "";
      // Escape: wrap in quotes if contains comma, quote, or newline
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = '"' + val.replace(/"/g, '""') + '"';
      }
      csvCells.push(val);
    }
    csvRows.push(csvCells.join(','));
  }

  const bom = '\uFEFF';
  const csv = bom + csvRows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'table.csv';
  a.click();
  URL.revokeObjectURL(url);
};

window.toggleToolCard = function(header) {
  const card = header.closest(".tool-call-card");
  const body = card.querySelector(".tool-call-body");
  const toggle = header.querySelector(".tool-call-toggle");
  const preview = card.querySelector(".tool-call-preview");
  if (body.style.display === "none") {
    body.style.display = "block";
    toggle.textContent = "▼";
    if (preview) preview.style.display = "none";
  } else {
    body.style.display = "none";
    toggle.textContent = "▶";
    if (preview) preview.style.display = "block";
  }
};

window.retryLastMessage = function() {
  const lastUser = [...state.messages].reverse().find(m => m.role === "user");
  if (!lastUser) return;
  dom.messageList.querySelectorAll(".error-card").forEach(e => e.remove());
  const streamingEl = dom.messageList.querySelector(".message.assistant.streaming");
  if (streamingEl) streamingEl.remove();
  state.isProcessing = true;
  state.isStreaming = true;
  setStatus("processing", "重试中…");
  dom.btnSend.style.display = "none";
  dom.btnStop.style.display = "flex";
  const aiMsgEl = appendAssistantPlaceholder();
  sendSSERequest(lastUser.content, aiMsgEl);
};

// ---------- API 调用 ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------- 会话管理 ----------
async function loadSessions() {
  try {
    const res = await api("/api/sessions?limit=200");
    if (res.success) state.sessions = res.data || [];
    renderSessionList();
  } catch (e) { console.error("加载会话失败:", e); }
}

async function createSession() {
  if (state.isProcessing) return;
  try {
    const res = await api("/api/sessions", { method: "POST", body: JSON.stringify({ title: "新会话" }) });
    if (res.success) {
      state.sessions.unshift(res.data);
      state.sessionCache[res.data.id] = {
        messages: [], isProcessing: false, isStreaming: false,
        abortController: null, contentSoFar: "", aiMsgEl: null,
      };
      switchSession(res.data.id);
      renderSessionList();
    }
  } catch (e) { console.error("创建会话失败:", e); }
}

async function deleteSession(id) {
  // 终止该会话的后台任务
  const bg = state.sessionCache[id];
  if (bg && bg.abortController) { bg.abortController.abort(); }
  delete state.sessionCache[id];
  try {
    await api(`/api/sessions/${id}`, { method: "DELETE" });
    state.sessions = state.sessions.filter(s => s.id !== id);
    if (state.currentSessionId === id) {
      state.currentSessionId = null;
      state.messages = [];
      state.isProcessing = false; state.isStreaming = false; state.streamingAbort = null;
      if (state.sessions.length > 0) switchSession(state.sessions[0].id);
      else { renderMessages(); dom.sessionTitle.textContent = "新会话"; updateStreamingUI(); }
    }
    renderSessionList();
  } catch (e) { console.error("删除会话失败:", e); }
}

async function clearSession() {
  if (!state.currentSessionId) return;
  try {
    await api(`/api/sessions/${state.currentSessionId}/clear`, { method: "POST" });
    state.messages = [];
    const bg = state.sessionCache[state.currentSessionId];
    if (bg) bg.messages = state.messages;
    renderMessages();
  } catch (e) { console.error("清空会话失败:", e); }
}

async function renameSession(id, title) {
  try {
    await api(`/api/sessions/${id}/rename`, { method: "PUT", body: JSON.stringify({ title }) });
    const s = state.sessions.find(x => x.id === id);
    if (s) s.title = title;
    if (id === state.currentSessionId) dom.sessionTitle.textContent = title;
    renderSessionList();
  } catch (e) { console.error("重命名失败:", e); }
}

async function switchSession(id) {
  if (id === state.currentSessionId) return;

  state.currentSessionId = id;

  // 从缓存或服务器加载
  const cached = state.sessionCache[id];
  if (cached && cached.messages) {
    state.messages = cached.messages;
    state.isProcessing = !!cached.isProcessing;
    state.isStreaming = !!cached.isStreaming;
    state.streamingAbort = cached.abortController || null;
  } else {
    state.sessionCache[id] = {
      messages: [], isProcessing: false, isStreaming: false,
      abortController: null, contentSoFar: "", aiMsgEl: null,
    };
    state.messages = state.sessionCache[id].messages;
    state.isProcessing = false;
    state.isStreaming = false;
    state.streamingAbort = null;
    try {
      const res = await api(`/api/sessions/${id}`);
      if (res.success) {
        const msgs = res.data.messages || [];
        state.sessionCache[id].messages = msgs;
        state.messages = msgs;
        dom.sessionTitle.textContent = res.data.title || "会话";
      }
    } catch (e) { console.error("加载会话消息失败:", e); }
  }

  updateStreamingUI();
  renderMessages();

  // 如果目标会话有后台任务，从 segments 重建流式 DOM（保留工具卡片交错顺序）
  if (state.isStreaming && cached && cached.segments && cached.segments.length > 0) {
    const aiMsgEl = appendAssistantPlaceholder();
    const cd = aiMsgEl.querySelector(".message-content");
    const cursor = cd.querySelector(".streaming-cursor");
    cached.segments.forEach(seg => {
      if (seg.type === "text") {
        cd.insertBefore(document.createTextNode(seg.content), cursor);
      } else if (seg.type === "tool") {
        cd.insertBefore(buildToolCard(seg.payload), cursor);
      }
    });
    state.sessionCache[id].aiMsgEl = aiMsgEl;
    scrollToBottom(true);
  } else if (state.isStreaming && cached && cached.contentSoFar) {
    const aiMsgEl = appendAssistantPlaceholder();
    const cd = aiMsgEl.querySelector(".message-content");
    const cursor = cd.querySelector(".streaming-cursor");
    if (cursor) cd.insertBefore(document.createTextNode(cached.contentSoFar), cursor);
    state.sessionCache[id].aiMsgEl = aiMsgEl;
    scrollToBottom(true);
  }

  const s = state.sessions.find(x => x.id === id);
  if (s) dom.sessionTitle.textContent = s.title || "会话";

  renderSessionList();
  dom.chatInput.focus();
}

// ---------- Agent 管理 ----------
async function loadAgents() {
  try {
    const res = await api("/api/agents");
    if (res.success) {
      state.agents = res.data || [];
      const select = dom.agentSelect;
      const cv = select.value;
      select.innerHTML = state.agents.filter(a =>
        a.enabled !== false &&
        (a.id === "builtin:chat" || a.id === "builtin:builder")
      )
        .map(a => `<option value="${a.id}">${a.name}</option>`).join("");
      if (cv) select.value = cv;
    }
  } catch (e) { console.error("加载Agent失败:", e); }
}

async function setSessionAgent(agentId) {
  state.currentAgentId = agentId;
  if (state.currentSessionId) {
    try { await api(`/api/sessions/${state.currentSessionId}/agent`, { method: "PUT", body: JSON.stringify({ agentId }) }); }
    catch (e) { console.error("设置Agent失败:", e); }
  }
}

// Tab 键切换 Agent（Chat ↔ Builder，与 REPL 一致）
function cycleAgent() {
  const next = state.currentAgentId === "builtin:chat" ? "builtin:builder" : "builtin:chat";
  state.currentAgentId = next;
  dom.agentSelect.value = next;
  if (state.currentSessionId) {
    api(`/api/sessions/${state.currentSessionId}/agent`, { method: "PUT", body: JSON.stringify({ agentId: next }) }).catch(() => {});
  }
  const label = next === "builtin:chat" ? "Chat" : "Builder";
  showToast(`已切换到 ${label} Agent`);
}

// Toast 提示
function showToast(msg) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("toast-show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("toast-show"), 2000);
}

// ============================================
// 设置面板
// ============================================
// 设置面板 — Provider → 常用模型建议列表（供 datalist 使用）
const PROVIDER_MODELS = {
  openai: [
    "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo",
    "o3-mini", "o1", "o1-mini", "o1-pro",
  ],
  anthropic: [
    "claude-sonnet-4-20250514", "claude-3.5-sonnet", "claude-3.5-haiku",
    "claude-3-opus", "claude-3-haiku",
  ],
  deepseek: [
    "deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash",
  ],
  ollama: [
    "qwen2.5-0.5b-instruct", "qwen2.5-7b-instruct", "qwen2.5-32b-instruct",
    "llama3.2-3b-instruct", "llama3.2-11b-vision", "codellama-7b-instruct",
    "deepseek-r1-8b", "deepseek-r1-32b", "mistral-7b-instruct",
    "phi-4-mini", "gemma-3-4b-it",
  ],
};

function getProviderLabel(p) {
  const labels = { openai: "OpenAI", anthropic: "Anthropic", deepseek: "DeepSeek", ollama: "Ollama (本地)" };
  return labels[p] || p;
}

function updateModelDropdown(provider) {
  const suggestions = PROVIDER_MODELS[provider] || [];
  const dd = document.getElementById("model-dropdown");
  dd.innerHTML = suggestions.map(m =>
    `<div class="model-dropdown-item" data-model="${m}">${escapeHtml(m)}</div>`
  ).join("");
  // 绑定点击事件
  dd.querySelectorAll(".model-dropdown-item").forEach(item => {
    item.addEventListener("click", () => {
      document.getElementById("settings-model").value = item.dataset.model;
      dd.style.display = "none";
    });
  });
}

async function loadSettingsIntoPanel() {
  try {
    const res = await api("/api/config");
    if (!res.success) throw new Error("加载配置失败");
    const data = res.data;

    // 填充模型配置
    const m = data.model;
    const provider = m.provider || "openai";
    const selProvider = document.getElementById("settings-provider");
    selProvider.value = provider;
    document.getElementById("settings-model").value = m.model || "";
    updateModelDropdown(provider);

    document.getElementById("settings-temperature").value = m.temperature ?? 0.7;
    document.getElementById("settings-temp-val").textContent = (m.temperature ?? 0.7).toFixed(2);
    document.getElementById("settings-max-tokens").value = m.maxTokens ?? 4096;

    // 填充 Provider API Keys
    const container = document.getElementById("settings-providers-keys");
    const providers = data.providers || {};
    container.innerHTML = Object.entries(providers).map(([pName, pVal]) => {
      const hasKey = pVal.hasKey;
      return `<div class="settings-provider-row">
        <div class="settings-provider-name">
          <span class="${hasKey ? 'has-key-dot' : 'no-key-dot'}"></span>
          ${getProviderLabel(pName)}
          ${hasKey ? '<span style="font-size:10px;color:var(--text-muted);font-weight:400">已配置</span>' : '<span style="font-size:10px;color:var(--error);font-weight:400">未配置</span>'}
        </div>
        ${pName !== "ollama" ? `
        <label class="settings-label" style="margin-top:0">API Key</label>
        <div style="position:relative">
          <input type="password" class="settings-input key-input" data-provider="${pName}" data-field="apiKey"
            value="${escapeHtml(pVal.apiKey||'')}" placeholder="${hasKey?'已配置（脱敏显示）':'输入 API Key…'}"
            style="padding-right:36px;font-family:monospace;font-size:12px">
          <button class="settings-eye-btn" onclick="toggleKeyVisibility(this)" title="显示/隐藏">👁️</button>
        </div>
        ` : ''}
        <label class="settings-label">Base URL</label>
        <input type="text" class="settings-input" data-provider="${pName}" data-field="baseUrl"
          value="${escapeHtml(pVal.baseUrl||'')}" placeholder="${pName === 'ollama' ? 'http://localhost:11434' : '默认'}"
          style="font-size:12px">
      </div>`;
    }).join("");
  } catch (e) {
    showToast("加载设置失败: " + e.message);
  }
}

function showSettingsPanel() {
  const overlay = document.getElementById("settings-overlay");
  const panel = document.getElementById("settings-panel");
  loadSettingsIntoPanel();
  overlay.style.display = "block";
  // 触发 reflow 再添加 class 以启动动画
  overlay.offsetHeight;
  overlay.classList.add("open");
  panel.classList.add("open");
}

function hideSettingsPanel() {
  const overlay = document.getElementById("settings-overlay");
  const panel = document.getElementById("settings-panel");
  overlay.classList.remove("open");
  panel.classList.remove("open");
  // 等动画结束再隐藏
  setTimeout(() => { overlay.style.display = "none"; }, 300);
}

async function saveSettings() {
  const provider = document.getElementById("settings-provider").value;
  const model = document.getElementById("settings-model").value;
  const temperature = parseFloat(document.getElementById("settings-temperature").value);
  const maxTokens = parseInt(document.getElementById("settings-max-tokens").value, 10);

  const modelPayload = { provider, model, temperature, maxTokens };

  // 收集 Provider 配置
  const providersPayload = {};
  const keyRows = document.querySelectorAll(".settings-provider-row");
  keyRows.forEach(row => {
    const inputs = row.querySelectorAll(".settings-input");
    inputs.forEach(input => {
      const pName = input.dataset.provider;
      const field = input.dataset.field;
      const value = input.value.trim();
      if (!providersPayload[pName]) providersPayload[pName] = {};
      if (value) {
        providersPayload[pName][field] = value;
      } else if (field === "baseUrl") {
        // 空 baseUrl 发送空字符串让后端清除
        providersPayload[pName][field] = "";
      }
    });
  });

  try {
    const payload = { model: modelPayload, providers: providersPayload };
    const res = await api("/api/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (res.success) {
      showToast("✅ 设置已保存");
      hideSettingsPanel();
    } else {
      throw new Error(res.error || "保存失败");
    }
  } catch (e) {
    showToast("保存设置失败: " + e.message);
  }
}

function toggleKeyVisibility(btn) {
  const input = btn.parentElement.querySelector("input");
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "🙈";
  } else {
    input.type = "password";
    btn.textContent = "👁️";
  }
}

// ---------- 辅助：更新流式 UI 状态 ----------
function updateStreamingUI() {
  if (state.isProcessing) {
    setStatus("processing", "任务执行中…");
    dom.btnSend.style.display = "none";
    dom.btnStop.style.display = "flex";
  } else {
    setStatus("online", "就绪");
    dom.btnSend.style.display = "flex";
    dom.btnStop.style.display = "none";
  }
}

// ---------- 重命名弹窗 ----------
function showRenameModal(id) {
  const s = state.sessions.find(x => x.id === id);
  if (!s) return;
  let modal = document.getElementById("rename-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "rename-modal";
    modal.className = "modal-overlay";
    modal.innerHTML = `<div class="modal-content">
      <h3>重命名会话</h3>
      <input type="hidden" id="rename-session-id">
      <input type="text" id="rename-input" class="modal-input" placeholder="输入新名称" maxlength="100">
      <div class="modal-actions"><button id="rename-cancel" class="btn-sm btn-ghost">取消</button><button id="rename-confirm" class="btn-sm btn-primary">确定</button></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) hideRenameModal(); });
    modal.querySelector("#rename-cancel").addEventListener("click", hideRenameModal);
    modal.querySelector("#rename-confirm").addEventListener("click", () => {
      const cid = modal.querySelector("#rename-session-id").value;
      const t = modal.querySelector("#rename-input").value.trim();
      if (t && cid) renameSession(cid, t);
      hideRenameModal();
    });
    modal.querySelector("#rename-input").addEventListener("keydown", e => {
      if (e.key === "Enter") { modal.querySelector("#rename-confirm").click(); }
      else if (e.key === "Escape") hideRenameModal();
    });
  }
  modal.querySelector("#rename-session-id").value = id;
  modal.querySelector("#rename-input").value = s.title || "";
  modal.style.display = "flex";
  modal.querySelector("#rename-input").focus();
  modal.querySelector("#rename-input").select();
}

function hideRenameModal() {
  const m = document.getElementById("rename-modal");
  if (m) m.style.display = "none";
}

// ---------- 渲染 ----------
function renderSessionList(filter = "") {
  const list = dom.sessionList;
  const filtered = filter ? state.sessions.filter(s => (s.title||"").toLowerCase().includes(filter.toLowerCase())) : state.sessions;
  if (state.sessions.length === 0) { list.innerHTML = '<div class="session-item-loading">暂无会话</div>'; return; }
  if (filtered.length === 0) { list.innerHTML = '<div class="session-item-loading">无匹配结果</div>'; return; }
  list.innerHTML = filtered.map(s => {
    const isActive = s.id === state.currentSessionId;
    return `<div class="session-item${isActive?" active":""}" data-id="${s.id}">
      <span class="session-item-title">${escapeHtml(truncate(s.title||"新会话",30))}</span>
      <span class="session-item-time">${formatTime(s.updatedAt||s.createdAt)}</span>
      <span class="session-item-actions">
        <button class="session-item-rename" data-action="rename" data-id="${s.id}" title="重命名">✏️</button>
        <button class="session-item-delete" data-action="delete" data-id="${s.id}" title="删除">×</button>
      </span>
    </div>`;
  }).join("");
  list.querySelectorAll(".session-item").forEach(item => {
    item.addEventListener("click", e => { if (!e.target.closest("[data-action]")) switchSession(item.dataset.id); });
  });
  list.querySelectorAll(".session-item-delete").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); if(confirm("确定删除此会话？")) deleteSession(btn.dataset.id); });
  });
  list.querySelectorAll(".session-item-rename").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); showRenameModal(btn.dataset.id); });
  });
}

function renderMessages() {
  const container = dom.messageList;
  if (state.messages.length === 0) {
    container.innerHTML = `<div class="welcome-message">
      <div class="welcome-icon">🤖</div><h2>欢迎使用 Try</h2><p>AI 驱动的编程助手，帮助你编码、调试和重构。</p>
      <div class="quick-actions">
        <button class="quick-btn" data-prompt="帮我分析这个项目的整体结构和架构">📂 分析项目</button>
        <button class="quick-btn" data-prompt="帮我解释这段代码的作用和原理">💡 解释代码</button>
        <button class="quick-btn" data-prompt="帮我编写一个功能函数：">✏️ 编写代码</button>
        <button class="quick-btn" data-prompt="帮我审查以下代码，找出潜在问题和改进点">🔍 代码审查</button>
      </div>
    </div>`;
    bindQuickActions();
    return;
  }
  // 将连续的 assistant+tool 消息合并为一个交错显示的 assistant 块
  const groups = [];
  let i = 0;
  while (i < state.messages.length) {
    const msg = state.messages[i];
    if (msg.role === "user") {
      groups.push({ type: "user", msg, idx: i, content: msg.content, timestamp: msg.timestamp });
      i++;
    } else if (msg.role === "assistant" || msg.role === "tool") {
      const compound = { type: "assistant", segments: [], firstIdx: i, timestamp: msg.timestamp };
      while (i < state.messages.length && state.messages[i].role !== "user") {
        const m = state.messages[i];
        if (m.role === "assistant") {
          compound.segments.push({ type: "text", content: m.content });
          compound.timestamp = compound.timestamp || m.timestamp;
        } else if (m.role === "tool") {
          compound.segments.push({
            type: "tool",
            payload: {
              tool: m.name || m.toolName || (m.metadata && m.metadata.tool) || "工具",
              arguments: m.content || "",
              result: m.result || "",
            }
          });
        }
        i++;
      }
      groups.push(compound);
    } else {
      i++;
    }
  }

  container.innerHTML = groups.map(g => {
    if (g.type === "user") {
      return `<div class="message user" data-msg-idx="${g.idx}">
        <div class="message-avatar">👤</div><div class="message-body">
          <div class="message-meta"><span class="message-role">你</span><span class="message-time">${g.timestamp?formatTime(g.timestamp):""}</span></div>
          <div class="message-content">${renderMarkdown(g.content)}</div>
          <div class="message-actions"><button class="msg-action-btn" data-action="edit" data-idx="${g.idx}" title="编辑重发">✏️</button></div>
        </div></div>`;
    }
    if (g.type === "assistant") {
      let bodyHTML = ""; let textBuf = "";
      const flush = () => { if (textBuf) { bodyHTML += renderMarkdown(textBuf); textBuf = ""; } };
      g.segments.forEach(seg => {
        if (seg.type === "text") textBuf += seg.content;
        else if (seg.type === "tool") { flush(); bodyHTML += toolCardHTML(seg.payload); }
      });
      flush();
      return `<div class="message assistant" data-msg-idx="${g.firstIdx}">
        <div class="message-avatar">🤖</div><div class="message-body">
          <div class="message-meta"><span class="message-role">Assistant</span><span class="message-time">${g.timestamp?formatTime(g.timestamp):""}</span></div>
          <div class="message-content">${bodyHTML}</div>
          <div class="message-actions">
            <button class="msg-action-btn" data-action="copy" data-idx="${g.firstIdx}" title="复制">📋</button>
            <button class="msg-action-btn" data-action="regenerate" data-idx="${g.firstIdx}" title="重新生成">🔄</button>
          </div>
        </div></div>`;
    }
    return "";
  }).join("");
  container.querySelectorAll(".msg-action-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const a = btn.dataset.action, i = parseInt(btn.dataset.idx);
      if (a === "copy") copyMessage(i);
      else if (a === "edit") editMessage(i);
      else if (a === "regenerate") regenerateMessage(i);
    });
  });
  scrollToBottom(true);
}

function bindQuickActions() {
  $$(".quick-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = btn.dataset.prompt;
      if (!state.currentSessionId) { createSession().then(() => { dom.chatInput.value = p; sendMessage(); }); }
      else { dom.chatInput.value = p; sendMessage(); }
    });
  });
}

function copyMessage(idx) {
  const msg = state.messages[idx];
  if (!msg) return;
  navigator.clipboard.writeText(msg.content||"").then(() => flashBtn(`[data-action="copy"][data-idx="${idx}"]`, "✓"));
}

function editMessage(idx) {
  const msg = state.messages[idx];
  if (!msg || state.isProcessing) return;
  dom.chatInput.value = msg.content||"";
  dom.chatInput.focus();
  dom.chatInput.setSelectionRange(dom.chatInput.value.length, dom.chatInput.value.length);
  autoResizeInput(); updateCharCount();
}

async function regenerateMessage(idx) {
  if (state.isProcessing) return;
  let userMsg = null;
  for (let i = idx-1; i >= 0; i--) { if (state.messages[i]?.role==="user") { userMsg=state.messages[i]; break; } }
  if (!userMsg) return;
  const userIdx = state.messages.indexOf(userMsg);
  state.messages = state.messages.slice(0, userIdx);
  renderMessages();
  state.isProcessing = true; state.isStreaming = true;
  setStatus("processing","重新生成中…");
  dom.btnSend.style.display="none"; dom.btnStop.style.display="flex";
  const aiMsgEl = appendAssistantPlaceholder();
  sendSSERequest(userMsg.content, aiMsgEl);
}

function flashBtn(selector, text) {
  const btn = document.querySelector(selector);
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => btn.textContent=orig, 1500);
}

// ---------- 滚动 ----------
function scrollToBottom(force=false) {
  if (!force && state.userScrolledUp) return;
  dom.messageList.scrollTop = dom.messageList.scrollHeight;
}
dom.messageList.addEventListener("scroll", () => {
  const c = dom.messageList;
  state.userScrolledUp = c.scrollTop + c.clientHeight < c.scrollHeight - 80;
});

// ---------- 消息发送 ----------
function sendMessage() {
  if (state.isProcessing) return;
  const input = dom.chatInput.value.trim();
  if (!input) return;
  if (!state.currentSessionId) { createSession().then(() => { dom.chatInput.value=input; sendMessage(); }); return; }
  startSending(input);
}

function startSending(input) {
  state.isProcessing = true; state.isStreaming = true;
  dom.chatInput.value = ""; updateCharCount(); autoResizeInput();
  setStatus("processing","处理中…");
  dom.btnSend.style.display="none"; dom.btnStop.style.display="flex";
  const welcome = dom.messageList.querySelector(".welcome-message");
  if (welcome) welcome.remove();
  state.messages.push({ role:"user", content:input, timestamp:new Date().toISOString() });
  appendUserMessage(input);
  const aiMsgEl = appendAssistantPlaceholder();
  if (state.messages.filter(m=>m.role==="user").length===1) {
    // 等 AI 回复完成后由 finishStreaming 调用 generate-title
    dom.sessionTitle.textContent = "AI 命名中…";
  }
  sendSSERequest(input, aiMsgEl);
}

function sendSSERequest(message, aiMsgEl) {
  const sessionId = state.currentSessionId;
  const controller = new AbortController();
  state.streamingAbort = controller;

  const bg = state.sessionCache[sessionId];
  bg.messages = state.messages;
  bg.abortController = controller;
  bg.aiMsgEl = aiMsgEl;
  bg.contentSoFar = "";
  bg.segments = [];
  bg.isProcessing = true;
  bg.isStreaming = true;

  let fullContent = "";
  fetch("/api/chat/stream", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ sessionId, message, agentId:state.currentAgentId }),
    signal:controller.signal,
  }).then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    function processChunk() {
      reader.read().then(({done, value}) => {
        if (done) {
          // 流已完全消费：先完成收尾，再清除控制器
          finishStreaming(sessionId, fullContent);
          const bgDone = state.sessionCache[sessionId];
          if (bgDone && bgDone.abortController === controller) {
            bgDone.abortController = null;
          }
          return;
        }
        buffer += decoder.decode(value, {stream:true});
        const lines = buffer.split("\n");
        buffer = lines.pop()||"";
        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) eventType = line.slice(7).trim();
          else if (line.startsWith("data: ")) {
            try { const p = JSON.parse(line.slice(6)); fullContent = handleSSEEvent(eventType, p, sessionId, fullContent); }
            catch(_) {}
            eventType = "";
          }
        }
        // 仅当会话的后台控制器未被清除时继续
        const bgNow = state.sessionCache[sessionId];
        if (bgNow && bgNow.abortController === controller) processChunk();
      }).catch(err => { if (err.name!=="AbortError") handleStreamError(err.message, sessionId); });
    }
    processChunk();
  }).catch(err => { if (err.name!=="AbortError") handleStreamError(err.message, sessionId); });
}

function handleSSEEvent(type, payload, sessionId, fullContent) {
  const bg = state.sessionCache[sessionId];
  if (!bg) return fullContent;

  // 始终更新缓存中的累积内容
  bg.contentSoFar = fullContent + (payload.content || "");

  // 后台会话：仅累积，不更新 DOM
  if (state.currentSessionId !== sessionId) {
    if (type === "done") finishStreaming(sessionId, fullContent);
    return fullContent + (payload.content || "");
  }

  const aiMsgEl = bg.aiMsgEl;
  switch(type) {
    case "chunk":
      bg.segments.push({ type: "text", content: payload.content });
      appendChunk(aiMsgEl, payload.content);
      return fullContent+(payload.content||"");
    case "tool_call":
      bg.segments.push({ type: "tool", payload });
      appendToolCall(aiMsgEl, payload);
      return fullContent;
    case "phase": {
      const phaseLabels = {
        initializing: "初始化中",
        thinking: "思考中",
        calling_tool: "调用工具中",
        awaiting_confirmation: "等待确认",
        processing: "处理中",
        generating: "生成回复中",
        done: "完成",
        error: "出错",
      };
      const label = phaseLabels[payload.phase] || payload.phase || "思考中";
      setStatus("processing", `执行中：${label}…`);
      if (payload.warning) appendWarning(payload.warning, aiMsgEl);
      return fullContent;
    }
    case "done":
      if (payload.sessionId&&!state.currentSessionId) state.currentSessionId=payload.sessionId;
      if (payload.warning) appendWarning(payload.warning, aiMsgEl);
      finishStreaming(sessionId, fullContent);
      return fullContent;
    case "error": appendError(payload.error||"未知错误", aiMsgEl); return fullContent;
    case "request_confirm":
      showConfirmDialog(payload);
      return fullContent;
    default: return fullContent;
  }
}

function finishStreaming(sessionId, content) {
  const bg = state.sessionCache[sessionId];
  if (!bg) return;

  const isActive = state.currentSessionId === sessionId;

  bg.isProcessing = false;
  bg.isStreaming = false;
  // 注意：不在此处清空 abortController！
  // 因为 processChunk 递归循环依赖 abortController===controller 来判断是否继续读取。
  // 如果此处清空，SSE "done" 事件处理后会立即断掉循环，
  // 导致 ReadableStream 的 close 信号（reader.read 返回 done=true）永远无法被消费。
  // abortController 的清空统一由 stopStreaming / handleStreamError 负责。

  // 将最终内容写入消息数组
  if (content && bg.messages) {
    const lastAsst = [...bg.messages].reverse().find(m => m.role === "assistant");
    if (lastAsst) { lastAsst.content = content; lastAsst.timestamp = new Date().toISOString(); }
    else bg.messages.push({ role: "assistant", content, timestamp: new Date().toISOString() });
  }

  if (isActive) {
    if (!state.isStreaming && !state.isProcessing) return;
    state.isStreaming = false; state.isProcessing = false; state.streamingAbort = null;
    setStatus("online","就绪");
    dom.btnSend.style.display="flex"; dom.btnStop.style.display="none";

    if (bg.aiMsgEl) finalizeAssistantMessage(bg.aiMsgEl, content, sessionId);

    // 首条消息完成后让 AI 总结标题
    if (bg.messages.filter(m => m.role === "user").length === 1 && sessionId) {
      api(`/api/sessions/${sessionId}/generate-title`, { method: "POST" })
        .then(res => {
          if (res.success && res.data?.title) {
            dom.sessionTitle.textContent = res.data.title;
            const s = state.sessions.find(x => x.id === sessionId);
            if (s) s.title = res.data.title;
          }
        })
        .catch(() => {
          const firstMsg = bg.messages.find(m => m.role === "user");
          const t = firstMsg ? truncate(firstMsg.content, 40) : "新会话";
          dom.sessionTitle.textContent = t;
          renameSession(sessionId, t);
        })
        .finally(() => loadSessions());
    } else {
      loadSessions();
    }
  } else {
    loadSessions();
  }
}

function handleStreamError(message, sessionId) {
  const bg = state.sessionCache[sessionId];
  if (bg) { bg.isProcessing = false; bg.isStreaming = false; bg.abortController = null; }

  if (state.currentSessionId === sessionId) {
    state.isStreaming = false; state.isProcessing = false; state.streamingAbort = null;
    setStatus("online","就绪"); dom.btnSend.style.display="flex"; dom.btnStop.style.display="none";
    if (bg && bg.aiMsgEl) appendError(message, bg.aiMsgEl);
  }
}

function stopStreaming() {
  if (state.streamingAbort) { state.streamingAbort.abort(); state.streamingAbort = null; }
  if (state.currentSessionId) {
    const bg = state.sessionCache[state.currentSessionId];
    if (bg) { bg.abortController = null; bg.isProcessing = false; bg.isStreaming = false; }
    // 通知后端取消该会话的待确认请求，避免旧 fiber 永久阻塞
    fetch("/api/chat/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: state.currentSessionId }),
    }).catch(() => { /* 静默忽略网络错误 */ });
  }
  state.isStreaming = false; state.isProcessing = false;
  setStatus("online","已停止"); dom.btnSend.style.display="flex"; dom.btnStop.style.display="none";
  const cursor = dom.messageList.querySelector(".streaming-cursor");
  if (cursor) cursor.remove();
  loadSessions();
}

// ---------- 消息 DOM ----------
function appendUserMessage(content) {
  const el = document.createElement("div");
  el.className = "message user";
  el.innerHTML = `<div class="message-avatar">👤</div><div class="message-body"><div class="message-meta"><span class="message-role">你</span><span class="message-time">刚刚</span></div><div class="message-content">${renderMarkdown(content)}</div></div>`;
  dom.messageList.appendChild(el);
  scrollToBottom(true);
}

function appendAssistantPlaceholder() {
  const el = document.createElement("div");
  el.className = "message assistant streaming";
  el.innerHTML = `<div class="message-avatar">🤖</div><div class="message-body"><div class="message-meta"><span class="message-role">Assistant</span><span class="message-time">生成中…</span></div><div class="message-content"><span class="streaming-cursor"></span></div></div>`;
  dom.messageList.appendChild(el);
  scrollToBottom(true);
  return el;
}

function appendChunk(el, content) {
  const cd = el.querySelector(".message-content");
  const cursor = cd.querySelector(".streaming-cursor");
  const tn = document.createTextNode(content);
  if (cursor) cd.insertBefore(tn, cursor); else cd.appendChild(tn);
  scrollToBottom();
}

// ---------- 工具卡片构建 ----------
function toolCardHTML(payload) {
  const name = payload.tool || "工具调用";
  const argsStr = payload.arguments ? (typeof payload.arguments==="string"?payload.arguments:JSON.stringify(payload.arguments,null,2)) : "";
  const resultStr = payload.result ? (typeof payload.result==="string"?payload.result:JSON.stringify(payload.result,null,2)) : "";
  return `<div class="tool-call-card">
    <div class="tool-call-header" onclick="toggleToolCard(this)">
      <span class="tool-call-toggle">▶</span><span class="tool-call-icon">🔧</span><span class="tool-call-name">${escapeHtml(name)}</span>
    </div>
    <div class="tool-call-body" style="display:none">
      ${argsStr?`<pre class="tool-call-detail">${escapeHtml(truncate(argsStr,1000))}</pre>`:""}
      ${resultStr?`<div class="tool-call-result"><strong>结果:</strong> ${escapeHtml(truncate(resultStr,500))}</div>`:""}
    </div>
  </div>`;
}

function buildToolCard(payload) {
  const tmp = document.createElement("div");
  tmp.innerHTML = toolCardHTML(payload);
  return tmp.firstChild;
}

function appendToolCall(el, payload) {
  const card = buildToolCard(payload);
  const cd = el.querySelector(".message-content");
  const cursor = cd?.querySelector(".streaming-cursor");
  if (cursor && cd) cd.insertBefore(card, cursor); else if (cd) cd.appendChild(card); else el.appendChild(card);
  scrollToBottom();
}

function finalizeAssistantMessage(el, content, sessionId) {
  el.classList.remove("streaming");
  const cursor = el.querySelector(".streaming-cursor");
  if (cursor) cursor.remove();
  const timeEl = el.querySelector(".message-time");
  if (timeEl) timeEl.textContent = "刚刚";
  const cd = el.querySelector(".message-content");
  const bg = sessionId ? state.sessionCache[sessionId] : null;
  if (bg && bg.segments && bg.segments.length > 0) {
    // 合并连续文字分段后交错渲染：文字与工具卡片按执行顺序排列
    let html = ""; let textBuf = "";
    const flush = () => { if (textBuf) { html += renderMarkdown(textBuf); textBuf = ""; } };
    bg.segments.forEach(seg => {
      if (seg.type === "text") textBuf += seg.content;
      else if (seg.type === "tool") { flush(); html += toolCardHTML(seg.payload); }
    });
    flush();
    cd.innerHTML = html;
  } else if (content) {
    cd.innerHTML = renderMarkdown(content);
  }
  let actions = el.querySelector(".message-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "message-actions";
    actions.innerHTML = `<button class="msg-action-btn" data-action="copy" title="复制">📋</button><button class="msg-action-btn" data-action="regenerate" title="重新生成">🔄</button>`;
    el.querySelector(".message-body").appendChild(actions);
  }
  const mi = state.messages.length-1;
  actions.querySelector('[data-action="copy"]').addEventListener("click",()=>copyMessage(mi));
  actions.querySelector('[data-action="regenerate"]').addEventListener("click",()=>regenerateMessage(mi));
  scrollToBottom(true);
}

function appendError(message, aiMsgEl) {
  const ed = document.createElement("div");
  ed.className = "error-card";
  ed.innerHTML = `<span class="error-icon">⚠️</span><span class="error-text">${escapeHtml(message)}</span><button class="error-retry-btn" onclick="retryLastMessage()">重试</button>`;
  if (aiMsgEl) aiMsgEl.appendChild(ed); else dom.messageList.appendChild(ed);
  scrollToBottom(true);
}

function appendWarning(message, aiMsgEl) {
  const wd = document.createElement("div");
  wd.className = "warning-card";
  wd.innerHTML = `<span class="warning-icon">⚠️</span><span class="warning-text">${escapeHtml(message)}</span>`;
  if (aiMsgEl) aiMsgEl.appendChild(wd); else dom.messageList.appendChild(wd);
  scrollToBottom(true);
}

// ---------- 确认对话框 ----------
function showConfirmDialog(payload) {
  // 移除已有对话框
  const existing = document.querySelector(".confirm-overlay");
  if (existing) existing.remove();

  const sensitivityLabel = payload.sensitivity === "critical" ? "严重" : "高风险";
  const sensitivityClass = payload.sensitivity === "critical" ? "sensitivity-critical" : "sensitivity-high";

  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <div class="confirm-header">
        <span class="confirm-icon">⚠️</span>
        <span class="confirm-title">确认执行工具</span>
        <span class="sensitivity-badge ${sensitivityClass}">${sensitivityLabel}</span>
      </div>
      <div class="confirm-body">
        <div class="confirm-row">
          <span class="confirm-label">工具</span>
          <span class="confirm-value"><strong>${escapeHtml(payload.toolName)}</strong></span>
        </div>
        ${payload.target ? `
        <div class="confirm-row">
          <span class="confirm-label">目标</span>
          <span class="confirm-value">${escapeHtml(payload.target)}</span>
        </div>` : ""}
        <div class="confirm-row">
          <span class="confirm-label">原因</span>
          <span class="confirm-value">${escapeHtml(payload.reason || "需要用户确认")}</span>
        </div>
      </div>
      <div class="confirm-footer">
        <button class="confirm-btn confirm-btn-deny" id="confirm-deny-btn">拒绝</button>
        <button class="confirm-btn confirm-btn-approve" id="confirm-approve-btn">允许执行</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const approveBtn = overlay.querySelector("#confirm-approve-btn");
  const denyBtn = overlay.querySelector("#confirm-deny-btn");

  async function resolve(approved) {
    overlay.remove();
    try {
      await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: payload.sessionId, approved }),
      });
    } catch (e) {
      console.error("确认请求失败:", e);
    }
  }

  approveBtn.addEventListener("click", () => resolve(true));
  denyBtn.addEventListener("click", () => resolve(false));

  // ESC 键拒绝
  function onKey(e) {
    if (e.key === "Escape") { resolve(false); document.removeEventListener("keydown", onKey); }
  }
  document.addEventListener("keydown", onKey);
}

// ---------- 状态 ----------
function setStatus(status, text) {
  dom.statusDot.className = `status-dot ${status}`;
  dom.statusText.textContent = text;
}

function autoResizeInput() {
  const el = dom.chatInput;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

function updateCharCount() { dom.charCount.textContent = dom.chatInput.value.length; }

// ---------- 事件绑定 ----------
function bindEvents() {
  dom.btnSend.addEventListener("click", sendMessage);
  dom.chatInput.addEventListener("keydown", e => { if (e.key==="Tab") { e.preventDefault(); cycleAgent(); } });
  dom.chatInput.addEventListener("keydown", e => { if (e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); sendMessage(); } });
  dom.chatInput.addEventListener("input", () => { autoResizeInput(); updateCharCount(); });
  dom.btnStop.addEventListener("click", stopStreaming);
  dom.btnNewSession.addEventListener("click", createSession);
  dom.btnToggleSidebar.addEventListener("click", () => dom.sidebar.classList.toggle("collapsed"));
  dom.btnClearChat.addEventListener("click", () => { if(state.messages.length>0&&confirm("确定清空当前对话？")) clearSession(); });
  dom.agentSelect.addEventListener("change", () => setSessionAgent(dom.agentSelect.value));
  dom.sessionSearch.addEventListener("input", debounce(e => renderSessionList(e.target.value), 200));
  dom.sessionTitle.addEventListener("dblclick", () => { if(state.currentSessionId) showRenameModal(state.currentSessionId); });
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey||e.metaKey)&&e.key==="k") { e.preventDefault(); createSession(); }
    if ((e.ctrlKey||e.metaKey)&&e.key==="l") { e.preventDefault(); if(state.messages.length>0&&confirm("确定清空？")) clearSession(); }
    if (e.key==="Escape"&&state.isStreaming) { e.preventDefault(); stopStreaming(); }
    if ((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==="s") { e.preventDefault(); dom.sidebar.classList.toggle("collapsed"); }
    // Escape 关闭设置面板（非流式状态下）
    if (e.key === "Escape" && !state.isStreaming && document.getElementById("settings-panel").classList.contains("open")) {
      hideSettingsPanel();
    }
  });

  // 设置面板事件绑��
  dom.btnSettings.addEventListener("click", showSettingsPanel);
  document.getElementById("btn-settings-close").addEventListener("click", hideSettingsPanel);
  document.getElementById("settings-overlay").addEventListener("click", hideSettingsPanel);
  document.getElementById("btn-settings-save").addEventListener("click", saveSettings);
  document.getElementById("btn-settings-reset").addEventListener("click", hideSettingsPanel);

  const settingsProvider = document.getElementById("settings-provider");
  settingsProvider.addEventListener("change", () => {
    updateModelDropdown(settingsProvider.value);
  });

  // 模型下拉按钮
  const btnModelDd = document.getElementById("btn-model-dropdown");
  const modelDd = document.getElementById("model-dropdown");
  btnModelDd.addEventListener("click", (e) => {
    e.stopPropagation();
    modelDd.style.display = modelDd.style.display === "none" ? "block" : "none";
  });
  // 点击输入框也展开，并支持键盘导航
  const modelInput = document.getElementById("settings-model");
  modelInput.addEventListener("focus", () => {
    modelDd.style.display = "block";
  });
  modelInput.addEventListener("input", () => {
    // 输入时过滤下拉项
    const filter = modelInput.value.toLowerCase();
    modelDd.querySelectorAll(".model-dropdown-item").forEach(item => {
      item.style.display = item.dataset.model.toLowerCase().includes(filter) ? "" : "none";
    });
    modelDd.style.display = "block";
  });
  modelInput.addEventListener("keydown", (e) => {
    const items = Array.from(modelDd.querySelectorAll('.model-dropdown-item')).filter(i => i.style.display !== 'none');
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const current = modelDd.querySelector(".model-dropdown-item.active");
      const idx = current ? items.indexOf(current) : -1;
      const next = items[(idx + 1) % items.length];
      items.forEach(i => i.classList.remove("active"));
      next.classList.add("active");
      next.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const current = modelDd.querySelector(".model-dropdown-item.active");
      const idx = current ? items.indexOf(current) : items.length;
      const prev = items[(idx - 1 + items.length) % items.length];
      items.forEach(i => i.classList.remove("active"));
      prev.classList.add("active");
      prev.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      const active = modelDd.querySelector(".model-dropdown-item.active");
      if (active) {
        e.preventDefault();
        modelInput.value = active.dataset.model;
        modelDd.style.display = "none";
        items.forEach(i => i.classList.remove("active"));
      }
    } else if (e.key === "Escape") {
      modelDd.style.display = "none";
    }
  });
  // 点击外部关闭
  document.addEventListener("click", (e) => {
    const wrapper = document.querySelector(".model-input-wrapper");
    if (wrapper && !wrapper.contains(e.target)) {
      modelDd.style.display = "none";
    }
  });

  const settingsTemp = document.getElementById("settings-temperature");
  settingsTemp.addEventListener("input", () => {
    document.getElementById("settings-temp-val").textContent = parseFloat(settingsTemp.value).toFixed(2);
  });

  bindQuickActions();
}

async function init() {
  bindEvents();
  await Promise.all([loadSessions(), loadAgents()]);
  if (state.sessions.length>0) await switchSession(state.sessions[0].id);
  setStatus("online","就绪");
  dom.chatInput.focus();
}
init();
