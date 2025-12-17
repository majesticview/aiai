// netlify/functions/test-keys.js
// API 키 테스트용 함수

export default async (req) => {
  const geminiKey = process.env.GEMINI_API_KEY;
  const tmdbKey = process.env.TMDB_API_KEY;

  const result = {
    timestamp: new Date().toISOString(),
    gemini: {
      exists: !!geminiKey,
      preview: geminiKey ? `${geminiKey.substring(0, 10)}...` : null,
      length: geminiKey?.length || 0
    },
    tmdb: {
      exists: !!tmdbKey,
      preview: tmdbKey ? `${tmdbKey.substring(0, 10)}...` : null,
      length: tmdbKey?.length || 0
    }
  };

  // Gemini API 실제 테스트
  if (geminiKey) {
    try {
      const testEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      
      const res = await fetch(testEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{ text: "Hello" }]
          }]
        })
      });

      result.gemini.apiTest = {
        status: res.status,
        ok: res.ok,
        message: res.ok ? "✅ API 키 유효" : `❌ API 오류: ${res.status}`
      };

      if (!res.ok) {
        const errorText = await res.text();
        result.gemini.apiTest.error = errorText.substring(0, 200);
      }
    } catch (e) {
      result.gemini.apiTest = {
        status: "error",
        message: `❌ 네트워크 오류: ${e.message}`
      };
    }
  }

  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};
