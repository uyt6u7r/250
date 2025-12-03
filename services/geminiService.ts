import { GoogleGenAI } from "@google/genai";
import { GameState, Suit } from "../types";

const getGeminiClient = () => {
  // Support both Vite's import.meta.env and standard process.env
  // Note: For GitHub Pages/Vite, use VITE_API_KEY in your .env file or build secrets
  const apiKey = (import.meta as any).env?.VITE_API_KEY || process.env.API_KEY;
  
  if (!apiKey) {
    console.warn("API Key not found. Please set VITE_API_KEY environment variable.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const getAIHint = async (gameState: GameState): Promise<string> => {
  const client = getGeminiClient();
  if (!client) return "Please configure the API Key to use AI hints.";

  const player = gameState.players[0]; // Assume human is index 0
  const handStr = player.hand.map(c => `${c.rank}${c.suit}`).join(', ');
  
  const boardStr = Object.entries(gameState.boardSequences)
    .filter(([_, seq]) => seq.hasSeven)
    .map(([suit, seq]) => `${suit}: ${seq.low}-${seq.high}`)
    .join(' | ');

  const prompt = `
    You are an expert card game strategist. 
    Game Rules: 
    1. Goal: Lowest score. Knock when hand points <= 5.
    2. Play 7s to center.
    3. Build on sequences (e.g. if Heart 7 is out, play Heart 6 or 8).
    4. Melds: 3-of-a-kind can be played to remove from hand.
    5. Discard one card to end turn.
    
    Current Hand: ${handStr}
    Board State: ${boardStr || "Empty"}
    Current Hand Points: ${player.hand.reduce((acc, c) => acc + c.value, 0)}
    
    Analyze the situation and suggest the best move. Be concise (max 2 sentences).
    Prioritize getting rid of high value cards (Jokers=30, 7s=15, Face=10).
    If points are <= 5, suggest Knocking.
  `;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text || "AI could not generate a hint.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error connecting to AI strategist.";
  }
};