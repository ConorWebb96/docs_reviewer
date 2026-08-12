import { buildQuery } from './format.js';
import { computeLineDiff } from './diff.js';
import { renderMarkdown, renderSourcePreview } from './preview.js';
import { readPersistedState, writePersistedState, readUrlState, writeUrlState } from './session.js';
import { requestJson } from './api.js';

export class DocsReviewerApp {
  constructor() {
    this.repoPathInput = document.getElementById('repoPath');
    this.baseRefInput = document.getElementById('baseRef');
    this.compareRefInput = document.getElementById('compareRef');
    this.loadBtn = document.getElementById('loadBtn');
    this.repoStatus = document.getElementById('repoStatus');
    this.fileStatus = document.getElementById('fileStatus');
    this.prevFileBtn = document.getElementById('prevFileBtn');
    this.layoutToggleBtn = document.getElementById('layoutToggleBtn');
    this.sourceToggleBtn = document.getElementById('sourceToggleBtn');
    this.viewFileBtn = document.getElementById('viewFileBtn');
    this.nextFileBtn = document.getElementById('nextFileBtn');
    this.fileSelect = document.getElementById('fileSelect');
    this.detailDrawer = document.getElementById('detailDrawer');
    this.fileSearchInput = document.getElementById('fileSearch');
    this.detailFileName = document.getElementById('detailFileName');
    this.detailFileType = document.getElementById('detailFileType');
    this.detailFileIndex = document.getElementById('detailFileIndex');
    this.detailFilePath = document.getElementById('detailFilePath');
    this.changeList = document.getElementById('changeList');
    this.compareGrid = document.querySelector('.compare-grid');
    this.basePreview = document.getElementById('basePreview');
    this.comparePreview = document.getElementById('comparePreview');
    this.baseTitle = document.getElementById('baseTitle');
    this.compareTitle = document.getElementById('compareTitle');

    this.state = {
      repoPath: '',
      baseRef: '',
      compareRef: '',
      changes: [],
      selectedFile: '',
      syncLock: false,
      viewOpen: false,
      searchQuery: '',
      layoutMode: 'split',
      previewMode: 'rendered',
    };

    this.persistedState = readPersistedState();
    this.urlState = readUrlState();
    this.appConfig = {
      localRepoDir: '',
      mainBranch: '',
      compareBranch: '',
    };

    this.repoPathInput.value = '';
    this.baseRefInput.value = '';
    this.compareRefInput.value = '';
    this.fileSearchInput.value = '';
    this.detailDrawer.hidden = true;
    this.viewFileBtn.textContent = 'ⓘ';
    this.viewFileBtn.setAttribute('aria-label', 'View file details');
    this.viewFileBtn.title = 'View file details';

    this.handleHashChange = this.handleHashChange.bind(this);
    this.handleSourceLineClick = this.handleSourceLineClick.bind(this);
  }

  persistState() {
    writePersistedState({
      repoPath: this.repoPathInput.value.trim(),
      baseRef: this.baseRefInput.value.trim(),
      compareRef: this.compareRefInput.value.trim(),
      selectedFile: this.state.selectedFile,
      viewOpen: this.state.viewOpen,
      searchQuery: this.state.searchQuery,
      layoutMode: this.state.layoutMode,
      previewMode: this.state.previewMode,
    });
  }

  setStatus(message, isError = false) {
    this.repoStatus.textContent = message;
    this.repoStatus.style.color = isError ? '#a61b1b' : '';
  }

  setFileStatus(message) {
    this.fileStatus.textContent = message;
  }

  async loadConfig() {
    try {
      const config = await requestJson('/api/config');
      if (config.localRepoDir && !this.repoPathInput.value.trim()) {
        this.repoPathInput.value = config.localRepoDir;
      }
      if (config.mainBranch && !this.baseRefInput.value.trim()) {
        this.baseRefInput.value = config.mainBranch;
      }
      if (config.compareBranch && !this.compareRefInput.value.trim()) {
        this.compareRefInput.value = config.compareBranch;
      }
      return config;
    } catch {
      return { localRepoDir: '', mainBranch: '', compareBranch: '' };
    }
  }

  async loadMeta(repoPath) {
    const meta = await requestJson(`/api/meta?${buildQuery({ repoPath })}`);
    if (!this.compareRefInput.value) {
      this.compareRefInput.value = meta.currentBranch;
    }
    return meta;
  }

  getVisibleChanges() {
    const query = this.state.searchQuery.trim().toLowerCase();
    if (!query) return this.state.changes;
    return this.state.changes.filter((change) => change.file.toLowerCase().includes(query));
  }

  getSelectedFileIndex() {
    return this.getVisibleChanges().findIndex((change) => change.file === this.state.selectedFile);
  }

  updateNavState() {
    const visibleChanges = this.getVisibleChanges();
    const hasFiles = visibleChanges.length > 0;
    const index = this.getSelectedFileIndex();
    this.prevFileBtn.disabled = !hasFiles || index <= 0;
    this.nextFileBtn.disabled = !hasFiles || index === -1 || index >= visibleChanges.length - 1;
    this.renderFileSelect();
  }

  renderFileSelect() {
    const visibleChanges = this.getVisibleChanges();

    this.fileSelect.replaceChildren();
    this.fileSelect.disabled = visibleChanges.length === 0;

    if (!visibleChanges.length) {
      this.fileSelect.append(new Option('No files loaded', ''));
      return;
    }

    visibleChanges.forEach((change) => {
      const option = new Option(change.file, change.file);
      option.selected = change.file === this.state.selectedFile;
      this.fileSelect.append(option);
    });
  }

  setViewOpen(open) {
    this.state.viewOpen = open;
    this.detailDrawer.hidden = !open;
    this.viewFileBtn.textContent = open ? '✕' : 'ⓘ';
    this.viewFileBtn.setAttribute('aria-label', open ? 'Close file changes' : 'View file changes');
    this.viewFileBtn.title = open ? 'Close file changes' : 'View file changes';
    this.persistState();
  }

  setLayoutMode(mode) {
    this.state.layoutMode = mode === 'unified' ? 'unified' : 'split';
    this.compareGrid.classList.toggle('unified', this.state.layoutMode === 'unified');
    this.layoutToggleBtn.textContent = this.state.layoutMode === 'unified' ? '⇉' : '⇄';
    this.layoutToggleBtn.setAttribute(
      'aria-label',
      this.state.layoutMode === 'unified' ? 'Switch to side-by-side view' : 'Switch to unified view',
    );
    this.layoutToggleBtn.title = this.state.layoutMode === 'unified' ? 'Switch to side-by-side view' : 'Switch to unified view';
    this.persistState();
  }

  setPreviewMode(mode) {
    this.state.previewMode = mode === 'rendered' ? 'rendered' : 'source';
    this.sourceToggleBtn.textContent = this.state.previewMode === 'source' ? '</>' : 'RAW';
    this.sourceToggleBtn.setAttribute(
      'aria-label',
      this.state.previewMode === 'source' ? 'Show rendered preview' : 'Show raw source',
    );
    this.sourceToggleBtn.title = this.state.previewMode === 'source' ? 'Show rendered preview' : 'Show raw source';
    this.persistState();
  }

  renderChangeList() {
    const total = this.state.changes.length;
    const visibleChanges = this.getVisibleChanges();
    this.detailFileName.textContent = total ? 'Change summary' : 'No changes';
    this.detailFileType.textContent = `${visibleChanges.length}/${total}`;
    this.detailFileIndex.textContent = visibleChanges.length
      ? `File ${Math.max(1, this.getSelectedFileIndex() + 1)} of ${visibleChanges.length}`
      : 'File 0 of 0';
    this.detailFilePath.textContent = this.state.searchQuery.trim()
      ? `Filter: ${this.state.searchQuery.trim()}`
      : total
        ? `${this.state.baseRef} -> ${this.state.compareRef}`
        : 'Line changes';

    if (!total) {
      this.changeList.innerHTML = '<p class="empty-note">No markdown files changed between these refs.</p>';
      return;
    }

    if (!visibleChanges.length) {
      this.changeList.innerHTML = '<p class="empty-note">No files match the current filter.</p>';
      return;
    }

    this.changeList.innerHTML = visibleChanges
      .map((change, index) => {
        const active = change.file === this.state.selectedFile ? 'active' : '';
        const additions = change.additions > 0 ? `+${change.additions}` : '+0';
        const deletions = change.deletions > 0 ? `-${change.deletions}` : '-0';
        return `
          <button class="change-item ${active}" data-file="${change.file}" data-index="${index}" type="button">
            <div class="change-path">${change.file}</div>
            <div class="change-stats">
              <span class="change-add">${additions}</span>
              <span class="change-del">${deletions}</span>
            </div>
          </button>`;
      })
      .join('');

    this.changeList.querySelectorAll('[data-file]').forEach((button) => {
      button.addEventListener('click', async () => {
        this.state.selectedFile = button.getAttribute('data-file');
        writeUrlState({ selectedFile: this.state.selectedFile }, this);
        this.renderChangeList();
        this.updateNavState();
        this.persistState();
        await this.loadSelectedFile();
      });
    });
  }

  selectFileByIndex(index) {
    const visibleChanges = this.getVisibleChanges();
    if (!visibleChanges.length) return;
    const clamped = Math.max(0, Math.min(index, visibleChanges.length - 1));
    this.state.selectedFile = visibleChanges[clamped].file;
    writeUrlState({ selectedFile: this.state.selectedFile }, this);
    this.updateNavState();
    this.renderChangeList();
    this.loadSelectedFile().catch((error) => {
      this.setStatus(error.message, true);
      this.setFileStatus('Load failed.');
    });
  }

  async loadFiles() {
    await this.configReady;
    this.state.repoPath = this.repoPathInput.value.trim();
    this.state.baseRef = this.baseRefInput.value.trim() || this.appConfig.mainBranch;
    this.state.compareRef = this.compareRefInput.value.trim() || this.appConfig.compareBranch;
    this.state.searchQuery = this.fileSearchInput.value.trim();

    if (!this.state.repoPath) {
      throw new Error('Repo path is required.');
    }

    this.setStatus('Inspecting refs and loading changed markdown files...');
    const meta = await this.loadMeta(this.state.repoPath);
    this.state.baseRef = this.baseRefInput.value.trim() || this.appConfig.mainBranch || meta.defaultBase;
    this.state.compareRef = this.compareRefInput.value.trim() || this.appConfig.compareBranch || meta.currentBranch;

    if (!this.state.baseRef || !this.state.compareRef) {
      throw new Error('Base ref and compare ref are required.');
    }

    const payload = await requestJson(
      `/api/files?${buildQuery({
        repoPath: this.state.repoPath,
        base: this.state.baseRef,
        compare: this.state.compareRef,
      })}`,
    );

    this.state.changes = payload.changes || [];
    const visibleChanges = this.getVisibleChanges();
    const searchActive = this.state.searchQuery.trim().length > 0;
    const preferredChange =
      visibleChanges.find((change) => change.file === this.state.selectedFile) ||
      visibleChanges[0] ||
      (!searchActive ? this.state.changes[0] : null) ||
      null;
    this.state.selectedFile = preferredChange?.file || '';
    writeUrlState({ selectedFile: this.state.selectedFile }, this);
    this.updateNavState();
    this.renderChangeList();
    this.setStatus(`Loaded ${this.state.changes.length} changed markdown file${this.state.changes.length === 1 ? '' : 's'} from ${meta.defaultBase}.`);
    this.setFileStatus(
      this.state.selectedFile
        ? `Showing file 1 of ${this.state.changes.length}`
        : 'No markdown files changed between these refs.',
    );

    if (this.state.selectedFile) {
      await this.loadSelectedFile();
    } else {
      this.basePreview.innerHTML = '<p class="empty-note">No markdown files changed between these refs.</p>';
      this.comparePreview.innerHTML = '<p class="empty-note">No markdown files changed between these refs.</p>';
      this.baseTitle.textContent = this.state.baseRef;
      this.compareTitle.textContent = this.state.compareRef;
    }

    writeUrlState({ selectedFile: this.state.selectedFile }, this);
    this.persistState();
  }

  async loadSelectedFile() {
    if (!this.state.selectedFile) return;
    const file = this.state.selectedFile;
    this.setFileStatus(`Rendering ${file}`);

    const [baseDoc, compareDoc] = await Promise.all([
      requestJson(`/api/file?${buildQuery({ repoPath: this.state.repoPath, ref: this.state.baseRef, file })}`),
      requestJson(`/api/file?${buildQuery({ repoPath: this.state.repoPath, ref: this.state.compareRef, file })}`),
    ]);

    const lineDiff = computeLineDiff(baseDoc.content || '', compareDoc.content || '');

    this.baseTitle.textContent = `${this.state.baseRef} · ${file}`;
    this.compareTitle.textContent = `${this.state.compareRef} · ${file}`;
    this.basePreview.innerHTML = baseDoc.exists
      ? this.state.previewMode === 'source'
        ? renderSourcePreview(baseDoc.content, lineDiff.base, { side: 'base', linePrefix: 'base' })
        : renderMarkdown(baseDoc.content, 'base', lineDiff.base)
      : '<p class="empty-note">File does not exist on the base ref.</p>';
    this.comparePreview.innerHTML = compareDoc.exists
      ? this.state.previewMode === 'source'
        ? renderSourcePreview(compareDoc.content, lineDiff.compare, { side: 'compare', linePrefix: 'compare' })
        : renderMarkdown(compareDoc.content, 'compare', lineDiff.compare)
      : '<p class="empty-note">File does not exist on the compare ref.</p>';
    this.renderChangeList();
    this.setFileStatus(`Showing file ${this.getSelectedFileIndex() + 1} of ${this.state.changes.length}`);
    this.wireScrollSync();
    writeUrlState({ selectedFile: this.state.selectedFile }, this);
    this.persistState();
    this.syncLineAnchorsFromHash();
  }

  wireScrollSync() {
    const panes = [this.basePreview, this.comparePreview];
    panes.forEach((pane, index) => {
      pane.onscroll = () => {
        if (this.state.syncLock) return;
        const other = panes[1 - index];
        const ratio = pane.scrollTop / Math.max(1, pane.scrollHeight - pane.clientHeight);
        this.state.syncLock = true;
        other.scrollTop = ratio * Math.max(1, other.scrollHeight - other.clientHeight);
        window.requestAnimationFrame(() => {
          this.state.syncLock = false;
        });
      };
    });
  }

  getHashLineState() {
    const raw = window.location.hash.replace(/^#/, '').trim();
    if (!raw) return null;
    const match = /^(?:(base|compare)-)?L(\d+)$/.exec(raw);
    if (!match) return null;
    return {
      side: match[1] || null,
      line: Number(match[2]),
    };
  }

  clearLineTargets() {
    this.basePreview.querySelectorAll('.source-line.is-target').forEach((element) => {
      element.classList.remove('is-target');
    });
    this.comparePreview.querySelectorAll('.source-line.is-target').forEach((element) => {
      element.classList.remove('is-target');
    });
  }

  syncLineAnchorsFromHash() {
    if (this.state.previewMode !== 'source') {
      this.clearLineTargets();
      return;
    }

    const target = this.getHashLineState();
    if (!target) {
      this.clearLineTargets();
      return;
    }

    const lineNumber = Math.max(1, target.line);
    const baseLine = this.basePreview.querySelector(`#base-L${lineNumber}`);
    const compareLine = this.comparePreview.querySelector(`#compare-L${lineNumber}`);

    this.clearLineTargets();

    if (baseLine) {
      baseLine.classList.add('is-target');
    }

    if (compareLine) {
      compareLine.classList.add('is-target');
    }
  }

  handleHashChange() {
    this.syncLineAnchorsFromHash();
  }

  async handleSourceLineClick(event) {
    const button = event.target.closest('.source-line-number');
    if (!button) return;

    const lineId = button.getAttribute('data-line-id');
    if (!lineId) return;

    const url = new URL(window.location.href);
    url.hash = lineId;
    history.replaceState(null, '', url);
    this.syncLineAnchorsFromHash();

    try {
      await navigator.clipboard.writeText(url.toString());
      this.setFileStatus(`Copied ${lineId} to clipboard.`);
    } catch {
      this.setFileStatus(`Updated URL to ${lineId}.`);
    }
  }

  bindEvents() {
    this.loadBtn.addEventListener('click', async () => {
      this.loadBtn.disabled = true;
      try {
        await this.loadFiles();
      } catch (error) {
        this.setStatus(error.message, true);
        this.fileStatus.textContent = 'Load failed.';
        this.basePreview.innerHTML = '<p class="empty-note">No preview loaded.</p>';
        this.comparePreview.innerHTML = '<p class="empty-note">No preview loaded.</p>';
        this.renderChangeList();
      } finally {
        this.loadBtn.disabled = false;
      }
    });

    this.compareRefInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.loadBtn.click();
    });
    this.baseRefInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.loadBtn.click();
    });
    this.repoPathInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.loadBtn.click();
    });

    this.repoPathInput.addEventListener('input', () => {
      writeUrlState({ repoPath: this.repoPathInput.value.trim(), selectedFile: '' }, this);
    });
    this.baseRefInput.addEventListener('input', () => {
      writeUrlState({ baseRef: this.baseRefInput.value.trim(), selectedFile: '' }, this);
    });
    this.compareRefInput.addEventListener('input', () => {
      writeUrlState({ compareRef: this.compareRefInput.value.trim(), selectedFile: '' }, this);
    });

    this.fileSearchInput.addEventListener('input', async () => {
      this.state.searchQuery = this.fileSearchInput.value;
      const visibleChanges = this.getVisibleChanges();
      if (visibleChanges.length && !visibleChanges.some((change) => change.file === this.state.selectedFile)) {
        this.state.selectedFile = visibleChanges[0].file;
        this.updateNavState();
        this.renderChangeList();
        this.persistState();
        await this.loadSelectedFile();
        return;
      }

      this.updateNavState();
      this.renderChangeList();
      if (!visibleChanges.length) {
        this.setFileStatus('No files match the current filter.');
      }
      this.persistState();
    });

    this.prevFileBtn.addEventListener('click', () => {
      const index = this.getSelectedFileIndex();
      if (index > 0) this.selectFileByIndex(index - 1);
    });

    this.nextFileBtn.addEventListener('click', () => {
      const index = this.getSelectedFileIndex();
      const visibleChanges = this.getVisibleChanges();
      if (index >= 0 && index < visibleChanges.length - 1) {
        this.selectFileByIndex(index + 1);
      }
    });

    this.fileSelect.addEventListener('change', () => {
      const visibleChanges = this.getVisibleChanges();
      const index = visibleChanges.findIndex((change) => change.file === this.fileSelect.value);
      if (index >= 0) this.selectFileByIndex(index);
    });

    this.viewFileBtn.addEventListener('click', () => {
      this.setViewOpen(!this.state.viewOpen);
    });

    this.layoutToggleBtn.addEventListener('click', () => {
      this.setLayoutMode(this.state.layoutMode === 'unified' ? 'split' : 'unified');
    });

    this.sourceToggleBtn.addEventListener('click', () => {
      this.setPreviewMode(this.state.previewMode === 'source' ? 'rendered' : 'source');
      if (this.state.selectedFile) {
        this.loadSelectedFile().catch((error) => {
          this.setStatus(error.message, true);
          this.setFileStatus('Load failed.');
        });
      }
    });

    this.basePreview.addEventListener('click', this.handleSourceLineClick);
    this.comparePreview.addEventListener('click', this.handleSourceLineClick);

    window.addEventListener('beforeunload', () => {
      this.persistState();
    });

    window.addEventListener('hashchange', this.handleHashChange);
  }

  async bootstrap() {
    this.configReady = this.loadConfig().then((config) => {
      this.appConfig.localRepoDir = config.localRepoDir || '';
      this.appConfig.mainBranch = config.mainBranch || '';
      this.appConfig.compareBranch = config.compareBranch || '';

      if (this.appConfig.localRepoDir && !this.repoPathInput.value.trim()) {
        this.repoPathInput.value = this.appConfig.localRepoDir;
      }
      if (this.appConfig.mainBranch && !this.baseRefInput.value.trim()) {
        this.baseRefInput.value = this.appConfig.mainBranch;
      }
      if (this.appConfig.compareBranch && !this.compareRefInput.value.trim()) {
        this.compareRefInput.value = this.appConfig.compareBranch;
      }
      return config;
    });

    this.bindEvents();

    this.configReady.then(() => {
      const hasUrlSession = Boolean(this.urlState.repoPath || this.urlState.baseRef || this.urlState.compareRef || this.urlState.selectedFile);

      if (this.urlState.repoPath) this.repoPathInput.value = this.urlState.repoPath;
      else if (this.persistedState?.repoPath) this.repoPathInput.value = this.persistedState.repoPath;

      if (this.urlState.baseRef) this.baseRefInput.value = this.urlState.baseRef;
      else if (this.persistedState?.baseRef) this.baseRefInput.value = this.persistedState.baseRef;

      if (this.urlState.compareRef) this.compareRefInput.value = this.urlState.compareRef;
      else if (this.persistedState?.compareRef) this.compareRefInput.value = this.persistedState.compareRef;

      if (hasUrlSession) {
        this.state.searchQuery = '';
        this.fileSearchInput.value = '';
      } else if (typeof this.persistedState?.searchQuery === 'string') {
        this.state.searchQuery = this.persistedState.searchQuery;
        this.fileSearchInput.value = this.persistedState.searchQuery;
      }

      if (typeof this.persistedState?.viewOpen === 'boolean') {
        this.state.viewOpen = this.persistedState.viewOpen;
      }
      if (this.persistedState?.layoutMode === 'unified' || this.persistedState?.layoutMode === 'split') {
        this.state.layoutMode = this.persistedState.layoutMode;
      }
      if (this.persistedState?.previewMode === 'source' || this.persistedState?.previewMode === 'rendered') {
        this.state.previewMode = this.persistedState.previewMode;
      }

      if (this.urlState.selectedFile) {
        this.state.selectedFile = this.urlState.selectedFile;
      } else if (this.persistedState?.selectedFile) {
        this.state.selectedFile = this.persistedState.selectedFile;
      }

      this.setViewOpen(this.state.viewOpen);
      this.setLayoutMode(this.state.layoutMode);
      this.setPreviewMode(this.state.previewMode);
    });

    this.configReady.then(async () => {
      const hasUrlSession = Boolean(this.urlState.repoPath || this.urlState.baseRef || this.urlState.compareRef || this.urlState.selectedFile);
      const shouldAutoLoad =
        (this.urlState.repoPath && this.urlState.baseRef && this.urlState.compareRef) ||
        (!hasUrlSession && this.persistedState?.repoPath && this.persistedState?.baseRef && this.persistedState?.compareRef);

      if (shouldAutoLoad) {
        try {
          await this.loadFiles();
        } catch (error) {
          this.setStatus(error.message, true);
        }
      }
    });

    this.setStatus('Ready. Enter the repo path and refs, then load changes.');
  }
}
