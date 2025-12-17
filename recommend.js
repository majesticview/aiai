// netlify/functions/recommend.js

export default async (req) => {
  // 1. 요청 메서드 확인
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // 2. 환경 변수 로드 및 확인
  const apiKey = process.env.GEMINI_API_KEY;
  const tmdbApiKey = process.env.TMDB_API_KEY; // TMDB 키 확인

  console.log("Function Start. Gemini Key Exists:", !!apiKey, "TMDB Key Exists:", !!tmdbApiKey);

  if (!apiKey) {
    console.error("Critical: Gemini API Key is missing.");
    return new Response("Missing GEMINI_API_KEY", { status: 500 });
  }

  // 3. Body 파싱
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const mode = body.mode === "movie" ? "movie" : body.mode === "book" ? "book" : null;
  if (!mode) return new Response("mode must be 'movie' or 'book'", { status: 400 });

  // 사용자 입력 정리
  const moodGenre = (body.moodGenre ?? "").trim();
  const theme = (body.theme ?? "").trim();
  const watched = (body.watched ?? "").trim();
  const creatorName = (body.creatorName ?? "").trim();
  const constraints = (body.constraints ?? "").trim();

  // URL 생성 헬퍼
  const makeExternalUrl = (query) => {
    if (!query) return "";
    if (mode === "movie") return `https://www.youtube.com/results?search_query=${encodeURIComponent(query + " 예고편")}`;
    return `https://search.kyobobook.co.kr/search?keyword=${encodeURIComponent(query)}`;
  };

  const makeDetailUrl = (query) => {
    if (!query) return "";
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  };

  // TMDB 포스터 함수 (에러 발생 시 null 반환하여 전체 로직 보호)
  const fetchTmdbPoster = async (title) => {
    if (!tmdbApiKey || !title) return null;
    try {
      // 쿼리 인코딩 확실하게 적용
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(title)}&language=ko-KR&page=1`;
      const res = await fetch(url);
      if (!res.ok) return null; // 응답이 200이 아니면 무시
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const posterPath = data.results[0].poster_path;
        return posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null;
      }
    } catch (err) {
      console.error(`TMDB Error for ${title}:`, err); // 로그만 남기고 null 반환
      return null;
    }
    return null;
  };

  const watchedLabel = mode === "movie" ? "이전에 봤던 영화" : "이전에 읽었던 책";
  const creatorLabel = mode === "movie" ? "감독" : "저자";

  // 프롬프트 구성
  const prompt = `
너는 ${mode === "movie" ? "영화" : "도서"} 추천 전문가다.
사용자의 취향에 맞춰 **실존하는 작품** 3개를 추천해줘.

[사용자 입력]
- 장르/분위기: ${moodGenre || "(없음)"}
- 주제: ${theme || "(없음)"}
- ${watchedLabel}: ${watched || "(없음)"}
- ${creatorLabel}: ${creatorName || "(없음)"}
- 자유 조건: ${constraints || "(없음)"}

[출력 형식]
반드시 아래와 같은 **JSON Array** 포맷으로 출력해. 
**중요: JSON 문자열 안에 절대 줄바꿈(엔터)을 넣지 마. 모든 텍스트는 한 줄로 작성해.**

[
  { "title": "작품제목", "reason": "추천 이유(한 줄로 짧게)", "creator": "감독또는저자", "year": "2023" },
  { "title": "작품제목", "reason": "추천 이유(한 줄로 짧게)", "creator": "감독또는저자", "year": "2020" },
  { "title": "작품제목", "reason": "추천 이유(한 줄로 짧게)", "creator": "감독또는저자", "year": "2019" }
]

[규칙]
1. ${watchedLabel}와 유사한 결을 가진 작품을 우선 추천.
2. 없는 작품을 지어내지 말 것.
3. 한국어로 출력할 것.
`.trim();

  try {
    const model = "models/gemini-1.5-flash"; // 모델명 유지
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;

    console.log("Sending request to Gemini..."); // 로그 추가

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ],
        generationConfig: { 
          temperature: 0.7, 
          maxOutputTokens: 3000,
          responseMimeType: "application/json" 
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error: ${errText}`);
    }

    const json = await res.json();
    let rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    
    // JSON 클리닝
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "");
    rawText = rawText.replace(/\n/g, " ");
    rawText = rawText.trim();

    console.log("Gemini Response Received."); // 로그 추가

    let recommendations = [];
    try {
      recommendations = JSON.parse(rawText);
    } catch (e) {
      console.error("JSON Parse Error:", e);
      recommendations = [];
    }

    // 1차 매핑
    let items = recommendations.map((item) => {
      const q = [item.title, item.creator].filter(Boolean).join(" ").trim();
      return {
        title: item.title,
        creator: item.creator || "",
        year: item.year || "",
        reason: item.reason || "추천 작품입니다.",
        externalUrl: makeExternalUrl(q),
        detailUrl: makeDetailUrl(q),
        posterUrl: null 
      };
    });

    if (items.length === 0) {
      throw new Error("No items returned from AI");
    }

    // TMDB 포스터 가져오기 (병렬 처리)
    if (mode === "movie" && tmdbApiKey) {
      console.log("Fetching TMDB posters...");
      // Promise.allSettled를 쓰면 하나가 실패해도 나머지는 살릴 수 있지만, 
      // 여기선 fetchTmdbPoster 내부에서 catch하므로 Promise.all도 안전함
      items = await Promise.all(items.map(async (item) => {
        const posterUrl = await fetchTmdbPoster(item.title);
        return { ...item, posterUrl };
      }));
      console.log("TMDB fetch complete.");
    } else {
      console.log("Skipping TMDB (Mode is book or API Key missing)");
    }

    return new Response(JSON.stringify({ mode, items }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });

  } catch (error) {
    console.error("Final Error Handler:", error);
    
    const fallbackTitles = mode === "movie" 
      ? ["쇼생크 탈출", "인셉션", "라라랜드"] 
      : ["데미안", "어린왕자", "미움받을 용기"];

    const fallbackItems = fallbackTitles.map(title => ({
      title: title,
      creator: "",
      year: "",
      reason: "AI 응답 지연으로 기본 추천을 표시합니다.",
      externalUrl: makeExternalUrl(title),
      detailUrl: makeDetailUrl(title),
      posterUrl: null
    }));

    // 에러 발생 시에도 200 OK로 폴백 데이터를 보냄
    return new Response(JSON.stringify({ mode, items: fallbackItems, note: "fallback", error: error.toString() }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};