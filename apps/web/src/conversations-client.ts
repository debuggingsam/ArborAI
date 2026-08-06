// The browser script is serialized intentionally; its DOM globals are evaluated in the browser.
// @ts-nocheck
export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ConversationApi {
  list(): Promise<Conversation[]>;
  create(title: string): Promise<Conversation>;
  update(id: string, title: string): Promise<Conversation>;
  remove(id: string): Promise<void>;
}

export function createConversationApi(baseUrl: string, request: typeof fetch = fetch): ConversationApi {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await request(`${baseUrl.replace(/\/$/, '')}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try { message = ((await response.json()) as { error?: { message?: string } }).error?.message ?? message; } catch { /* use status */ }
      throw new Error(message);
    }
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }
  return {
    list: () => call<Conversation[]>('/conversations'),
    create: (title) => call<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ title }) }),
    update: (id, title) => call<Conversation>(`/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
    remove: (id) => call<void>(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}

export const browserScript = String.raw`(${function arborAiApp() {
  const call = async (path, init) => { const response = await fetch(window.arborAiApiBaseUrl.replace(/\/$/, '') + path, { headers: { 'Content-Type': 'application/json' }, ...init }); if (!response.ok) { let message = 'Request failed (' + response.status + ')'; try { message = (await response.json()).error?.message || message; } catch {} throw Error(message); } return response.status === 204 ? undefined : response.json(); };
  const api = { list: () => call('/conversations'), create: title => call('/conversations', { method: 'POST', body: JSON.stringify({ title }) }), update: (id, title) => call('/conversations/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ title }) }), remove: id => call('/conversations/' + encodeURIComponent(id), { method: 'DELETE' }) };
  const state = { conversations: [], selectedId: new URLSearchParams(location.search).get('conversation'), loading: true, error: '' };
  const list = document.querySelector('#conversation-list');
  const status = document.querySelector('#connection-status');
  const title = document.querySelector('#workspace-title');
  const render = () => {
    list.innerHTML = state.loading ? '<p class="muted">Loading conversations…</p>' : state.error ? '<p class="error">' + state.error + '</p>' : state.conversations.length ? state.conversations.map(c => '<button class="conversation ' + (c.id === state.selectedId ? 'selected' : '') + '" data-id="' + c.id + '">' + escapeHtml(c.title) + '</button>').join('') : '<p class="muted">No conversations yet. Start one above.</p>';
    const selected = state.conversations.find(c => c.id === state.selectedId);
    title.textContent = selected ? selected.title : 'Graph workspace';
    status.textContent = state.error ? 'Backend disconnected' : 'Backend connected';
    status.className = state.error ? 'connection disconnected' : 'connection';
    document.querySelectorAll('[data-id]').forEach(button => button.addEventListener('click', () => select(button.dataset.id)));
  };
  const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const select = id => { state.selectedId = id; history.pushState({}, '', '?conversation=' + encodeURIComponent(id)); render(); };
  const refresh = async () => { state.loading = true; state.error = ''; render(); try { state.conversations = await api.list(); if (state.selectedId && !state.conversations.some(c => c.id === state.selectedId)) state.selectedId = null; } catch (error) { state.error = error.message || 'Unable to reach the backend.'; } finally { state.loading = false; render(); } };
  document.querySelector('#new-conversation').addEventListener('click', async () => { const value = prompt('Conversation name', 'New conversation'); if (!value?.trim()) return; try { const conversation = await api.create(value.trim()); state.conversations.unshift(conversation); select(conversation.id); } catch (error) { state.error = error.message; render(); } });
  document.querySelector('#rename-conversation').addEventListener('click', async () => { const selected = state.conversations.find(c => c.id === state.selectedId); if (!selected) return; const value = prompt('Rename conversation', selected.title); if (!value?.trim() || value.trim() === selected.title) return; try { const updated = await api.update(selected.id, value.trim()); Object.assign(selected, updated); render(); } catch (error) { state.error = error.message; render(); } });
  document.querySelector('#delete-conversation').addEventListener('click', async () => { if (!state.selectedId || !confirm('Delete this conversation?')) return; try { await api.remove(state.selectedId); state.conversations = state.conversations.filter(c => c.id !== state.selectedId); state.selectedId = null; history.pushState({}, '', location.pathname); render(); } catch (error) { state.error = error.message; render(); } });
  window.addEventListener('popstate', () => { state.selectedId = new URLSearchParams(location.search).get('conversation'); render(); });
  refresh();
}}` + `)();`;
