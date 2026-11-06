export interface Post {
  userId: number;
  id: number;
  title: string;
  body: string;
}

export interface DashboardStats {
  totalPosts: number;
  uniqueAuthors: number;
  avgWordsPerPost: number;
  visiblePosts: number;
}

type SortOption = "id-asc" | "id-desc" | "title-asc" | "length-desc";

const API_URL = "https://jsonplaceholder.typicode.com/posts";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Runtime check so untyped JSON is narrowed to Post safely. */
export function isPost(v: unknown): v is Post {
  if (!isRecord(v)) return false;
  return (
    typeof v.userId === "number" &&
    typeof v.id === "number" &&
    typeof v.title === "string" &&
    typeof v.body === "string"
  );
}

export async function fetchPosts(signal?: AbortSignal): Promise<Post[]> {
  const res = await fetch(API_URL, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status} ${res.statusText})`);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data) || !data.every(isPost)) {
    throw new Error("The API returned data in an unexpected format.");
  }
  return data;
}

function countWords(str: string): number {
  const words = str.trim().split(/\s+/);
  return words.length === 1 && words[0] === "" ? 0 : words.length;
}

export function computeStats(allPosts: Post[], visiblePosts: Post[]): DashboardStats {
  const totalPosts = allPosts.length;
  const authorsSet = new Set(allPosts.map((p) => p.userId));
  const uniqueAuthors = authorsSet.size;

  const totalWords = allPosts.reduce(
    (acc, p) => acc + countWords(p.title) + countWords(p.body),
    0,
  );
  const avgWordsPerPost = totalPosts > 0 ? Math.round(totalWords / totalPosts) : 0;

  return {
    totalPosts,
    uniqueAuthors,
    avgWordsPerPost,
    visiblePosts: visiblePosts.length,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function renderPostCard(post: Post): HTMLLIElement {
  const li = el("li");
  const card = el("article", undefined, "post-card");
  card.setAttribute("aria-labelledby", `post-title-${post.id}`);

  // Header badges
  const header = el("div", undefined, "post-header");
  const authorBadge = el("span", `Author #${post.userId}`, "badge");
  const idBadge = el("span", `#${post.id}`, "badge badge-id");
  header.append(authorBadge, idBadge);

  // Title
  const title = el("h3", post.title);
  title.id = `post-title-${post.id}`;

  // Body
  const body = el("p", post.body, "post-body");

  // Footer with reading estimate
  const words = countWords(post.title) + countWords(post.body);
  const estReadTime = Math.max(1, Math.ceil(words / 40));
  const footer = el("div", undefined, "post-footer");
  const wordCountSpan = el("span", `${words} words`);
  const readTimeSpan = el("span", `~${estReadTime} min read`);
  footer.append(wordCountSpan, readTimeSpan);

  card.append(header, title, body, footer);
  li.append(card);
  return li;
}

function initDashboard(): void {
  // Elements
  const list = byId<HTMLUListElement>("list");
  const status = byId<HTMLElement>("status");
  const errorBox = byId<HTMLElement>("error");
  const errorMsg = byId<HTMLElement>("error-message");
  const retryBtn = byId<HTMLButtonElement>("retry");
  const refreshBtn = byId<HTMLButtonElement>("refresh-btn");
  const resetBtn = byId<HTMLButtonElement>("reset-filters");

  const queryInput = byId<HTMLInputElement>("filter-query");
  const authorSelect = byId<HTMLSelectElement>("filter-author");
  const sortSelect = byId<HTMLSelectElement>("sort-order");

  // Metric displays
  const statTotalPosts = byId<HTMLElement>("stat-total-posts");
  const statAuthors = byId<HTMLElement>("stat-authors");
  const statAvgWords = byId<HTMLElement>("stat-avg-words");
  const statVisiblePosts = byId<HTMLElement>("stat-visible-posts");
  const statVisibleSubtext = byId<HTMLElement>("stat-visible-subtext");
  const connectionStatus = byId<HTMLElement>("connection-status");

  let allPosts: Post[] = [];
  let abortController: AbortController | null = null;

  const setControlsDisabled = (disabled: boolean): void => {
    queryInput.disabled = disabled;
    authorSelect.disabled = disabled;
    sortSelect.disabled = disabled;
    refreshBtn.disabled = disabled;
    resetBtn.disabled = disabled;
  };

  const updateAuthorOptions = (posts: Post[]): void => {
    const currentVal = authorSelect.value;
    const authorIds = Array.from(new Set(posts.map((p) => p.userId))).sort((a, b) => a - b);

    authorSelect.replaceChildren();

    const allOption = el("option", "All Authors");
    allOption.value = "all";
    authorSelect.append(allOption);

    for (const id of authorIds) {
      const opt = el("option", `Author ${id}`);
      opt.value = String(id);
      authorSelect.append(opt);
    }

    if (authorIds.some((id) => String(id) === currentVal)) {
      authorSelect.value = currentVal;
    } else {
      authorSelect.value = "all";
    }
  };

  const updateStats = (visible: Post[]): void => {
    const stats = computeStats(allPosts, visible);
    statTotalPosts.textContent = stats.totalPosts.toLocaleString();
    statAuthors.textContent = stats.uniqueAuthors.toLocaleString();
    statAvgWords.textContent = stats.avgWordsPerPost.toLocaleString();
    statVisiblePosts.textContent = stats.visiblePosts.toLocaleString();

    if (stats.visiblePosts === stats.totalPosts) {
      statVisibleSubtext.textContent = "100% of posts displayed";
    } else {
      const pct = Math.round((stats.visiblePosts / (stats.totalPosts || 1)) * 100);
      statVisibleSubtext.textContent = `${pct}% of total matching`;
    }
  };

  const render = (): void => {
    const query = queryInput.value.trim().toLowerCase();
    const selectedAuthor = authorSelect.value;
    const sort = sortSelect.value as SortOption;

    // Filter
    let filtered = allPosts.filter((post) => {
      const matchesQuery =
        !query ||
        post.title.toLowerCase().includes(query) ||
        post.body.toLowerCase().includes(query);

      const matchesAuthor =
        selectedAuthor === "all" || String(post.userId) === selectedAuthor;

      return matchesQuery && matchesAuthor;
    });

    // Sort
    filtered.sort((a, b) => {
      switch (sort) {
        case "id-asc":
          return a.id - b.id;
        case "id-desc":
          return b.id - a.id;
        case "title-asc":
          return a.title.localeCompare(b.title);
        case "length-desc":
          return (b.title.length + b.body.length) - (a.title.length + a.body.length);
      }
    });

    // Render list
    list.replaceChildren(...filtered.map(renderPostCard));

    // Update KPIs & Status
    updateStats(filtered);

    if (filtered.length === 0) {
      status.textContent = "No posts match the selected criteria.";
    } else {
      status.textContent = `Showing ${filtered.length} of ${allPosts.length} posts.`;
    }

    // Reset button state
    resetBtn.disabled = query === "" && selectedAuthor === "all" && sort === "id-asc";
  };

  const loadData = async (): Promise<void> => {
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();

    errorBox.hidden = true;
    setControlsDisabled(true);
    list.replaceChildren();
    status.textContent = "Fetching posts from API…";
    connectionStatus.innerHTML = '<span class="dot" aria-hidden="true"></span> Fetching…';

    try {
      allPosts = await fetchPosts(abortController.signal);
      updateAuthorOptions(allPosts);
      setControlsDisabled(false);
      connectionStatus.innerHTML = '<span class="dot" aria-hidden="true"></span> Live';
      render();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      connectionStatus.innerHTML = '<span class="dot" style="background:var(--danger)" aria-hidden="true"></span> Offline';
      status.textContent = "";
      errorMsg.textContent =
        err instanceof Error ? `Could not load posts: ${err.message}` : "Could not load posts.";
      errorBox.hidden = false;
      refreshBtn.disabled = false;
    }
  };

  const resetFilters = (): void => {
    queryInput.value = "";
    authorSelect.value = "all";
    sortSelect.value = "id-asc";
    render();
    queryInput.focus();
  };

  // Event Listeners
  queryInput.addEventListener("input", render);
  authorSelect.addEventListener("change", render);
  sortSelect.addEventListener("change", render);
  resetBtn.addEventListener("click", resetFilters);
  refreshBtn.addEventListener("click", () => void loadData());
  retryBtn.addEventListener("click", () => void loadData());

  // Initial load
  void loadData();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDashboard);
} else {
  initDashboard();
}
