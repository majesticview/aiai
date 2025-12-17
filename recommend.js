// netlify/functions/recommend.js

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const apiKey = process.env.GEMINI_API_KEY;
  // 추가: TMDB API 키 가져오기
  const tmdbApiKey = process.env.TMDB_API_KEY; 

  if (!apiKey) {
    console.error("API Key missing");
    return new Response("Missing GEMINI_API_KEY", { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const mode = body.mode === "movie" ? "movie" : body.mode === "book" ? "book" : null;
  if (!mode) return new Response("mode must be 'movie' or 'book'", { status: 400 });

  const moodGenre = (body.moodGenre ?? "").trim();
  const theme = (body.theme ?? "").trim();
  const watched = (body.watched ?? "").trim();
  const creatorName = (body.creatorName ?? "").trim();
  const constraints = (body.constraints ?? "").trim();

  // 링크 생성 헬퍼
  const makeExternalUrl = (query) => {
    if (!query) return "";
    if (mode === "movie") {
      return `https://www.youtube.com/results?search_query=${encodeURIComponent(query + " 예고편")}`;
    }
    return `https://search.kyobobook.co.kr/search?keyword=${encodeURIComponent(query)}`;
  };

  const makeDetailUrl = (query) => {
    if (!query) return "";
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  };

  // ---------------------------------------------------------
  // [추가된 함수] TMDB에서 포스터 이미지 URL 가져오기
  // ---------------------------------------------------------
  const fetchTmdbPoster = async (title) => {
    if (!tmdbApiKey || !title) return null;

    try {
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(title)}&language=ko-KR&page=1`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.results && data.results.length > 0) {
        const posterPath = data.results[0].poster_path;
        // w500 사이즈의 이미지 URL 반환
        return posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null;
      }
    } catch (err) {
      console.error(`TMDB Error for ${title}:`, err);
    }
    return null;
  };
  // ---------------------------------------------------------

  const watchedLabel = mode === "movie" ? "이전에 봤던 영화" : "이전에 읽었던 책";
  const creatorLabel = mode === "movie" ? "감독" : "저자";

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
    const model = "models/gemini-2.5-flash";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;

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
    
    // 마크다운 제거 및 줄바꿈 처리
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "");
    rawText = rawText.replace(/\n/g, " ");
    rawText = rawText.trim();

    console.log("AI Response (Cleaned):", rawText); 

    let recommendations = [];
    try {
      recommendations = JSON.parse(rawText);
    } catch (e) {
      console.error("JSON Parse Error:", e);
      recommendations = [];
    }

    // 1차적으로 아이템 매핑
    let items = recommendations.map((item) => {
      const q = [item.title, item.creator].filter(Boolean).join(" ").trim();
      return {
        title: item.title,
        creator: item.creator || "",
        year: item.year || "",
        reason: item.reason || "추천 작품입니다.",
        externalUrl: makeExternalUrl(q),
        detailUrl: makeDetailUrl(q),
        // 기본적으로 posterUrl은 null로 시작
        posterUrl: null 
      };
    });

    if (items.length === 0) {
      throw new Error("No items returned from AI");
    }

    // ---------------------------------------------------------
    // [추가된 로직] 모드가 영화이고 TMDB 키가 있으면 포스터 검색 병렬 실행
    // ---------------------------------------------------------
    if (mode === "movie" && tmdbApiKey) {
      console.log("🎬 Fetching posters from TMDB...");
      
      // Promise.all을 사용하여 병렬로 이미지를 가져옴 (속도 저하 최소화)
      items = await Promise.all(items.map(async (item) => {
        const posterUrl = await fetchTmdbPoster(item.title);
        return {
          ...item,
          posterUrl: posterUrl // 찾았으면 URL, 없으면 null
        };
      }));
    }
    // ---------------------------------------------------------

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
      detailUrl: makeDetailUrl(title)
      // 폴백의 경우 이미지를 따로 가져오지 않음 (필요하면 여기도 추가 가능)
    }));

    return new Response(JSON.stringify({ mode, items: fallbackItems, note: "fallback" }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};