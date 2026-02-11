/**
 * FileBrowser - Searchable project folder selector component
 * Provides fuzzy search, recent projects, keyboard navigation, and native dialog support
 */

export class FileBrowser {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`[FILE-BROWSER] Container element #${containerId} not found`);
    }

    this.options = {
      placeholder: 'Search or select project folder...',
      maxRecent: 5,
      showHidden: false,
      ...options
    };

    this.searchInput = null;
    this.dropdown = null;
    this.recentProjects = this._loadRecent();
    this.currentPath = '';
  }

  /**
   * Render the file browser UI
   */
  render() {
    // Create search input + dropdown container
    this.container.innerHTML = `
      <div class="file-browser">
        <div class="search-container">
          <input type="text"
                 class="search-input"
                 placeholder="${this.options.placeholder}"
                 autocomplete="off">
          <button class="browse-btn" title="Browse folders">📁</button>
        </div>
        <div class="dropdown hidden">
          <div class="recent-section">
            <div class="section-header">Recent Projects</div>
            <div class="recent-list"></div>
          </div>
          <div class="search-results">
            <div class="section-header">Search Results</div>
            <div class="results-list"></div>
          </div>
        </div>
      </div>
    `;

    this.searchInput = this.container.querySelector('.search-input');
    this.dropdown = this.container.querySelector('.dropdown');

    this._attachEventListeners();
    this._renderRecentProjects();
  }

  /**
   * Attach event listeners for search, keyboard nav, and browse button
   */
  _attachEventListeners() {
    // Show dropdown on focus
    this.searchInput.addEventListener('focus', () => {
      this.dropdown.classList.remove('hidden');
      if (!this.searchInput.value) {
        this._renderRecentProjects();
      }
    });

    // Filter on input (debounced 300ms)
    this.searchInput.addEventListener('input', debounce(() => {
      const query = this.searchInput.value.trim();
      if (query.length >= 2) {
        this._performSearch(query);
      } else {
        this._renderRecentProjects();
      }
    }, 300));

    // Keyboard navigation
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._selectNextItem();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._selectPreviousItem();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this._confirmSelection();
      } else if (e.key === 'Escape') {
        this.dropdown.classList.add('hidden');
      }
    });

    // Browse button → native file dialog (Electron only)
    this.container.querySelector('.browse-btn').addEventListener('click', () => {
      this._openNativeDialog();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) {
        this.dropdown.classList.add('hidden');
      }
    });
  }

  /**
   * Perform fuzzy search through recent projects and API (if available)
   */
  async _performSearch(query) {
    // Fuzzy search through recent projects first
    const recentMatches = this.recentProjects.filter(p =>
      p.toLowerCase().includes(query.toLowerCase())
    );

    // If API endpoint exists, fetch more results
    let apiMatches = [];
    try {
      const res = await fetch(`/api/projects/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        apiMatches = await res.json();
      }
    } catch (err) {
      console.warn('[FILE-BROWSER] API search unavailable:', err.message);
    }

    const allMatches = [...new Set([...recentMatches, ...apiMatches])];
    this._renderSearchResults(allMatches, query);
  }

  /**
   * Render recent projects list
   */
  _renderRecentProjects() {
    const recentList = this.dropdown.querySelector('.recent-list');
    const searchResults = this.dropdown.querySelector('.search-results');

    searchResults.style.display = 'none';
    this.dropdown.querySelector('.recent-section').style.display = 'block';

    if (this.recentProjects.length === 0) {
      recentList.innerHTML = '<div class="empty-state">No recent projects</div>';
      return;
    }

    recentList.innerHTML = this.recentProjects.map((path, idx) => `
      <div class="project-item ${idx === 0 ? 'selected' : ''}" data-path="${this._escapeHtml(path)}">
        <span class="project-icon">📂</span>
        <span class="project-path">${this._escapeHtml(this._truncatePath(path))}</span>
      </div>
    `).join('');

    this._attachItemListeners();
  }

  /**
   * Render search results
   */
  _renderSearchResults(matches, query) {
    const resultsList = this.dropdown.querySelector('.results-list');
    const searchResults = this.dropdown.querySelector('.search-results');

    searchResults.style.display = 'block';

    if (matches.length === 0) {
      resultsList.innerHTML = '<div class="empty-state">No matches found</div>';
      this.dropdown.querySelector('.recent-section').style.display = 'none';
      return;
    }

    this.dropdown.querySelector('.recent-section').style.display = 'block';
    resultsList.innerHTML = matches.slice(0, 20).map((path, idx) => `
      <div class="project-item ${idx === 0 ? 'selected' : ''}" data-path="${this._escapeHtml(path)}">
        <span class="project-icon">🔍</span>
        <span class="project-path">${this._highlightMatch(path, query)}</span>
      </div>
    `).join('');

    this._attachItemListeners();
  }

  /**
   * Attach click listeners to all project items
   */
  _attachItemListeners() {
    this.dropdown.querySelectorAll('.project-item').forEach(item => {
      item.addEventListener('click', () => {
        this.selectProject(item.dataset.path);
      });
    });
  }

  /**
   * Select a project path
   */
  selectProject(path) {
    this.currentPath = path;
    this.searchInput.value = path;
    this.dropdown.classList.add('hidden');

    this._addToRecent(path);
    this._emit('select', { path });
  }

  /**
   * Open native file dialog (Electron only)
   */
  async _openNativeDialog() {
    // Only works in Electron context
    if (!window.electronAPI) {
      alert('Native file dialog is only available in the desktop app.\n\nPlease use the search box or type the full path manually.');
      return;
    }

    try {
      const result = await window.electronAPI.selectFolder();
      if (result) {
        this.selectProject(result);
      }
    } catch (err) {
      console.error('[FILE-BROWSER] Native dialog error:', err);
      alert('Failed to open file dialog. Please type the path manually.');
    }
  }

  /**
   * Load recent projects from localStorage
   */
  _loadRecent() {
    try {
      const stored = localStorage.getItem('llcapp-recent-projects');
      return stored ? JSON.parse(stored) : [];
    } catch (err) {
      console.warn('[FILE-BROWSER] Failed to load recent projects:', err);
      return [];
    }
  }

  /**
   * Add path to recent projects (max 5)
   */
  _addToRecent(path) {
    this.recentProjects = [
      path,
      ...this.recentProjects.filter(p => p !== path)
    ].slice(0, this.options.maxRecent);

    localStorage.setItem('llcapp-recent-projects', JSON.stringify(this.recentProjects));
  }

  /**
   * Truncate long paths for display
   */
  _truncatePath(path, maxLength = 50) {
    if (path.length <= maxLength) return path;

    const parts = path.split(/[/\\]/);
    if (parts.length <= 3) return path;

    return `...${parts.slice(-2).join('\\')}`;
  }

  /**
   * Highlight search query matches in text
   */
  _highlightMatch(text, query) {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return this._escapeHtml(text).replace(regex, '<mark>$1</mark>');
  }

  /**
   * Escape HTML special characters
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Select next item in dropdown
   */
  _selectNextItem() {
    const items = Array.from(this.dropdown.querySelectorAll('.project-item'));
    if (items.length === 0) return;

    const currentIdx = items.findIndex(i => i.classList.contains('selected'));
    if (currentIdx < items.length - 1) {
      items[currentIdx]?.classList.remove('selected');
      items[currentIdx + 1]?.classList.add('selected');
      items[currentIdx + 1]?.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * Select previous item in dropdown
   */
  _selectPreviousItem() {
    const items = Array.from(this.dropdown.querySelectorAll('.project-item'));
    if (items.length === 0) return;

    const currentIdx = items.findIndex(i => i.classList.contains('selected'));
    if (currentIdx > 0) {
      items[currentIdx]?.classList.remove('selected');
      items[currentIdx - 1]?.classList.add('selected');
      items[currentIdx - 1]?.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * Confirm selection (Enter key)
   */
  _confirmSelection() {
    const selected = this.dropdown.querySelector('.project-item.selected');
    if (selected) {
      this.selectProject(selected.dataset.path);
    }
  }

  /**
   * Emit custom event
   */
  _emit(eventName, data) {
    this.container.dispatchEvent(new CustomEvent(`filebrowser:${eventName}`, {
      detail: data,
      bubbles: true
    }));
  }

  /**
   * Get current selected path
   */
  getValue() {
    return this.currentPath;
  }

  /**
   * Set current path programmatically
   */
  setValue(path) {
    this.currentPath = path;
    this.searchInput.value = path;
    if (path && !this.recentProjects.includes(path)) {
      this._addToRecent(path);
    }
  }
}

/**
 * Debounce utility function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
