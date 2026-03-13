import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function searchTerreiros(query: string, location?: { lat: number; lng: number }) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Encontre terreiros de Umbanda ou Candomblé em ${query}. Retorne uma lista com nome, endereço e uma breve descrição se disponível.`,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: location ? { latitude: location.lat, longitude: location.lng } : undefined
          }
        }
      },
    });

    // The response text will contain the AI's natural language answer grounded in Maps.
    // We also want to extract the grounding chunks for URLs.
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    
    return {
      text: response.text,
      links: groundingChunks?.map(chunk => chunk.maps?.uri).filter(Boolean) || []
    };
  } catch (error) {
    console.error("Error searching terreiros:", error);
    return { text: "Erro ao buscar terreiros. Tente novamente.", links: [] };
  }
}
