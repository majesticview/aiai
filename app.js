const el = (id) => document.getElementById(id);

const btnMovie = el("btnMovie");
const btnBook = el("btnBook");
// btnTestKeys 삭제됨
const form = el("form");
const modePill = el("modePill");
const statusEl = el("status");

const moodGenreEl = el("moodGenre");
const themeEl = el("theme");
const watchedEl = el("watched");
const creatorNameEl = el("creatorName");
const constraintsEl = el("constraints");

const btnReset = el("btnReset");
const btnRetry = el("btnRetry");

const resultCard = el("resultCard");
const resultsEl = el("results");

let mode = null;

// 🔥 API 키 테스트 기능 삭제됨

function setMode(next) {
  mode = next;
  document.body.classList.add("is-active");

  form.classList.remove("hidden");
  resultCard.classList.add("hidden");
  resultsEl.innerHTML = "";

  modePill.textContent = `선택됨: ${mode === "movie" ? "🎬 영화" : "📚 도서"}`;
  statusEl.textContent = "";

  const watchedLabel = form.querySelector('label[for="watched"] .label');
  const creatorLabel = form.querySelector('label[for="creatorName"] .label');
  
  if (watchedLabel) {
    watchedLabel.textContent = mode === "movie" 
      ? "3) (선택) 이전에 본 영화" 
      : "3) (선택) 이전에 읽은 책";
  }
  
  if (creatorLabel) {
    creatorLabel.textContent = mode === "movie" ? "4) (선택) 감독" : "4) (선택) 저자";
  }
  
  if (watchedEl) {
    watchedEl.placeholder = mode === "movie"
      ? "예: 인터스텔라, 기생충, 라라랜드"
      : "예: 데미안, 어린왕자, 1984";
  }
  
  if (creatorNameEl) {
    creatorNameEl.placeholder = mode === "movie"
      ? "예: 크리스토퍼 놀란, 봉준호"
      : "예: 무라카미 하루키, 한강";
  }
}

btnMovie.addEventListener("click", () => setMode("movie"));
btnBook.addEventListener("click", () => setMode("book"));

btnReset.addEventListener("click", () => {
  mode = null;
  document.body.classList.remove("is-active");

  form.classList.add("hidden");
  resultCard.classList.add("hidden");
  resultsEl.innerHTML = "";
  statusEl.textContent = "";

  moodGenreEl.value = "";
  themeEl.value = "";
  watchedEl.value = "";
  creatorNameEl.value = "";
  constraintsEl.value = "";
});

btnRetry.addEventListener("click", async () => {
  if (!mode) return;
  await requestRecommendations();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await requestRecommendations();
});

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSkeleton() {
  const isMovie = mode === "movie";
  const skeletons = Array(3).fill(0).map(() => `
    <article class="skeleton-item ${isMovie ? '' : 'no-poster'}">
      ${isMovie ? '<div class="skeleton-poster"></div>' : ''}
      <div class="skeleton-info">
        <div class="skeleton-line" style="width: 70%;"></div>
        <div class="skeleton-line" style="width: 45%;"></div>
        <div class="skeleton-line" style="width: 95%; margin-top: 12px;"></div>
        <div class="skeleton-line" style="width: 85%;"></div>
        <div class="skeleton-line" style="width: 60%;"></div>
      </div>
    </article>
  `).join("");
  
  resultsEl.innerHTML = skeletons;
  resultCard.classList.remove("hidden");
}

function generateLinks(title) {
  const q = encodeURIComponent(title);
  
  if (mode === "movie") {
    return `
      <a class="link" href="https://www.youtube.com/results?search_query=${q}+예고편" target="_blank" rel="noopener">🎬 예고편</a>
      <a class="link" href="https://pedia.watcha.com/ko-KR/search?query=${q}" target="_blank" rel="noopener">📺 왓챠피디아</a>
      <a class="link" href="https://www.google.com/search?q=${q}+영화" target="_blank" rel="noopener">🔍 구글 검색</a>
    `;
  } else {
    return `
      <a class="link" href="https://search.kyobobook.co.kr/search?keyword=${q}" target="_blank" rel="noopener">📕 교보문고</a>
      <a class="link" href="http://www.yes24.com/Product/Search?domain=ALL&query=${q}" target="_blank" rel="noopener">📘 예스24</a>
      <a class="link" href="https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=All&SearchWord=${q}" target="_blank" rel="noopener">📙 알라딘</a>
    `;
  }
}

function renderResults(payload) {
  const items = payload?.items ?? [];
  
  if (!Array.isArray(items) || items.length === 0) {
    resultsEl.innerHTML = `
      <div class="item" style="justify-content: center; text-align: center; padding: 40px;">
        <p style="color: var(--text-muted); font-size: 15px;">
          추천 결과가 없습니다. 다른 조건으로 다시 시도해주세요. 🔄
        </p>
      </div>
    `;
    return;
  }

  const isMovie = mode === "movie";

  resultsEl.innerHTML = items.map((it, idx) => {
    const title = escapeHtml(it.title ?? `추천 ${idx + 1}`);
    const creator = escapeHtml(it.creator ?? "");
    const year = escapeHtml(it.year ?? "");
    const reason = escapeHtml(it.reason ?? "");
    
    // 영화일 때만 포스터 HTML 생성
    let posterHtml = "";
    if (isMovie) {
      if (it.posterUrl) {
        posterHtml = `
          <div class="poster-wrapper">
            <img src="${it.posterUrl}" alt="${title}" class="poster" loading="lazy" 
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
            <div class="poster-placeholder" style="display: none;">🎬</div>
          </div>`;
      } else {
        posterHtml = `<div class="poster-wrapper"><div class="poster-placeholder">🎬</div></div>`;
      }
    }

    const linksHtml = generateLinks(it.title || "");

    return `
      <article class="item ${isMovie ? '' : 'item-text-only'}">
        ${posterHtml}
        <div class="info-wrapper">
          <div class="itemTop">
            <h3 class="title">${title}</h3>
            ${creator || year ? `<div class="meta">${creator}${creator && year ? " · " : ""}${year}</div>` : ""}
          </div>
          ${reason ? `<p class="desc">${reason}</p>` : ""}
          <div class="links">
            ${linksHtml}
          </div>
        </div>
      </article>
    `;
  }).join("");

  resultCard.classList.remove("hidden");
}
async function requestRecommendations() {
  if (!mode) {
    statusEl.textContent = "⚠️ 먼저 영화/도서 중 하나를 선택해주세요.";
    return;
  }

  const moodGenre = moodGenreEl.value.trim();
  const theme = themeEl.value.trim();
  const watched = watchedEl.value.trim();
  const creatorName = creatorNameEl.value.trim();
  const constraints = constraintsEl.value.trim();

  if (!moodGenre && !theme) {
    statusEl.textContent = "⚠️ 최소한 '장르/분위기' 또는 '주제' 중 하나는 입력해주세요.";
    return;
  }

  console.log("=".repeat(50));
  console.log("🚀 추천 요청");
  console.log({ mode, moodGenre, theme, watched, creatorName, constraints });

  statusEl.textContent = "🤖 AI가 맞춤 추천을 준비하고 있습니다...";
  renderSkeleton();

  const startTime = Date.now();

  try {
    const res = await fetch("/.netlify/functions/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        moodGenre,
        theme,
        watched,
        creatorName,
        constraints
      })
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!res.ok) {
      const text = await res.text();
      console.error(`❌ 서버 오류 (${res.status}):`, text);
      throw new Error(`서버 오류 (${res.status})`);
    }

    const data = await res.json();
    console.log("✅ 응답 받음:", data);
    console.log("=".repeat(50));

    renderResults(data);

    if (data?.note === "fallback") {
      statusEl.textContent = `⚡ AI 응답 지연으로 인기 작품을 추천했습니다 (${elapsed}초)`;
    } else {
      statusEl.textContent = `✅ 추천 완료! (${elapsed}초)`;
    }
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error("❌ 오류:", err);
    console.log("=".repeat(50));
    
    statusEl.textContent = `❌ 오류 발생: ${err.message}`;
    resultsEl.innerHTML = `
      <div class="item" style="justify-content: center; text-align: center; padding: 40px;">
        <div>
          <p style="color: var(--text-muted); font-size: 15px; margin-bottom: 12px;">
            일시적인 오류가 발생했습니다. 😥
          </p>
          <p style="color: var(--text-muted); font-size: 13px;">
            ${err.message}<br>
            (${elapsed}초 소요)
          </p>
          <button onclick="location.reload()" style="margin-top: 16px; padding: 8px 16px; border-radius: 8px; border: 1px solid #ddd; background: #f9f9f9; cursor: pointer;">
            🔄 페이지 새로고침
          </button>
        </div>
      </div>
    `;
  }
}