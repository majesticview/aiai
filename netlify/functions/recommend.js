// netlify/functions/recommend.js
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async (req) => {
  // 1. 기본 설정 및 검증
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const apiKey = process.env.GEMINI_API_KEY; // 서버에서는 process.env 사용
  const tmdbApiKey = process.env.TMDB_API_KEY;

  if (!apiKey) {
    return new Response("Missing GEMINI_API_KEY", { status: 500 });
  }

  // 2. 요청 본문 파싱
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const mode = body.mode === "movie" ? "movie" : body.mode === "book" ? "book" : null;
  if (!mode) return new Response("mode must be 'movie' or 'book'", { status: 400 });

  // 3. 사용자 입력 정리
  const moodGenre = (body.moodGenre ?? "").trim();
  const theme = (body.theme ?? "").trim();
  const watched = (body.watched ?? "").trim();
  const creatorName = (body.creatorName ?? "").trim();
  const constraints = (body.constraints ?? "").trim();

  const watchedLabel = mode === "movie" ? "이전에 봤던 영화" : "이전에 읽었던 책";
  const creatorLabel = mode === "movie" ? "감독" : "저자";

  // 4. URL 및 TMDB 헬퍼 함수
  const makeExternalUrl = (query) => {
    if (!query) return "";
    if (mode === "movie") return `https://www.youtube.com/results?search_query=${encodeURIComponent(query + " 예고편")}`;
    return `https://search.kyobobook.co.kr/search?keyword=${encodeURIComponent(query)}`;
  };

  const makeDetailUrl = (query) => {
    return query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : "";
  };

  const fetchTmdbPoster = async (title) => {
    if (!tmdbApiKey || !title) return null;
    try {
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(title)}&language=ko-KR&page=1`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return data.results?.[0]?.poster_path ? `https://image.tmdb.org/t/p/w500${data.results[0].poster_path}` : null;
    } catch (e) {
      console.error("TMDB Error:", e);
      return null;
    }
  };

  // 5. 프롬프트 작성
  const prompt = `
너는 ${mode === "movie" ? "영화" : "도서"} 추천 전문가다.
사용자의 취향에 맞춰 **실존하는 작품** 3개를 추천해줘.

[사용자 입력]
- 장르: ${moodGenre}, 주제: ${theme}, ${watchedLabel}: ${watched}, ${creatorLabel}: ${creatorName}, 기타: ${constraints}

[출력 형식]
반드시 아래 JSON Array 포맷만 출력해. (줄바꿈 없이)
[
  { "title": "제목", "reason": "이유", "creator": "감독/저자", "year": "연도" },
  { "title": "제목", "reason": "이유", "creator": "감독/저자", "year": "연도" },
  { "title": "제목", "reason": "이유", "creator": "감독/저자", "year": "연도" }
]
한국어로 출력해.
`.trim();

  try {
    // ★ 여기가 질문하신 SDK 사용 부분입니다 ★
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // 모델 선택: 1.5-flash가 가성비/속도가 제일 좋습니다.
    // 만약 503 에러가 계속 뜨면 "gemini-pro"로 변경하세요.
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-09-2025" });

    // 요청 보내기
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    // JSON 클리닝
    text = text.replace(/```json/g, "").replace(/```/g, "").replace(/\n/g, " ").trim();
    
    let recommendations = [];
    try {
      recommendations = JSON.parse(text);
    } catch (e) {
      console.error("JSON Parse Error:", e);
      // 파싱 실패 시 빈 배열 처리 (아래에서 fallback으로 이동)
      recommendations = [];
    }

    if (recommendations.length === 0) throw new Error("No items parsed");

    // 데이터 가공 및 TMDB 병렬 처리
    let items = recommendations.map(item => {
      const q = [item.title, item.creator].filter(Boolean).join(" ");
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

    if (mode === "movie" && tmdbApiKey) {
      items = await Promise.all(items.map(async (item) => {
        const posterUrl = await fetchTmdbPoster(item.title);
        return { ...item, posterUrl };
      }));
    }

    return new Response(JSON.stringify({ mode, items }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });

  } catch (error) {
    console.error("SDK Error:", error);
    
    // 에러 발생 시 Fallback (기본 추천)
    const fallbackTitles = mode === "movie" 
      ? ["쇼생크 탈출", "인셉션", "라라랜드"] 
      : ["데미안", "어린왕자", "미움받을 용기"];
      
    const fallbackItems = fallbackTitles.map(title => ({
      title: title,
      reason: "시스템 연결 지연으로 인한 기본 추천입니다.",
      externalUrl: makeExternalUrl(title),
      detailUrl: makeDetailUrl(title),
      posterUrl: null
    }));

    return new Response(JSON.stringify({ mode, items: fallbackItems, note: "fallback" }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
};