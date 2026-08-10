export const STORAGE_KEY = 'docs-preview-diff:last-session';

export function readPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePersistedState(snapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore persistence failures.
  }
}

export function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  return {
    repoPath: params.get('repoPath') || '',
    baseRef: params.get('baseRef') || '',
    compareRef: params.get('compareRef') || '',
    selectedFile: params.get('selectedFile') || '',
  };
}

export function writeUrlState(overrides, context) {
  const params = new URLSearchParams(window.location.search);
  const nextRepoPath = overrides.repoPath ?? context.repoPathInput.value.trim();
  const nextBaseRef = overrides.baseRef ?? context.baseRefInput.value.trim();
  const nextCompareRef = overrides.compareRef ?? context.compareRefInput.value.trim();
  const nextSelectedFile = overrides.selectedFile ?? context.state.selectedFile;

  if (nextRepoPath) params.set('repoPath', nextRepoPath);
  else params.delete('repoPath');

  if (nextBaseRef) params.set('baseRef', nextBaseRef);
  else params.delete('baseRef');

  if (nextCompareRef) params.set('compareRef', nextCompareRef);
  else params.delete('compareRef');

  if (nextSelectedFile) params.set('selectedFile', nextSelectedFile);
  else params.delete('selectedFile');

  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', nextUrl);
}
