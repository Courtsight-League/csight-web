import { GoogleGenAI } from "@google/genai";

// Initialize the Gemini API client
// Note: In a production environment, ensure API_KEY is set in your .env file
const apiKey = process.env.API_KEY || '';
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({ apiKey });
}

/**
 * Example function to generate a game recap based on box score data.
 * This is a placeholder to demonstrate where Gemini integration would live.
 */
export const generateGameRecap = async (gameData: any): Promise<string> => {
  if (!ai) return "AI Service not initialized. Missing API Key.";

  try {
    const model = ai.models;
    const prompt = `
      Write a high-energy, 100-word sports news recap for a basketball game.
      Home Team: ${gameData.homeTeam} (${gameData.homeScore})
      Away Team: ${gameData.awayTeam} (${gameData.awayScore})
      Key Stats: ${JSON.stringify(gameData.topPerformers)}
      Tone: Exciting, ESPN-style.
    `;

    const response = await model.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "No recap generated.";
  } catch (error) {
    console.error("Error generating recap:", error);
    return "Failed to generate recap.";
  }
};
