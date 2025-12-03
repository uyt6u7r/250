export enum Suit {
  HEARTS = '♥',
  DIAMONDS = '♦',
  CLUBS = '♣',
  SPADES = '♠',
  JOKER = '★'
}

export enum Rank {
  ACE = 'A',
  TWO = '2',
  THREE = '3',
  FOUR = '4',
  FIVE = '5',
  SIX = '6',
  SEVEN = '7',
  EIGHT = '8',
  NINE = '9',
  TEN = '10',
  JACK = 'J',
  QUEEN = 'Q',
  KING = 'K',
  JOKER = 'JOKER'
}

export interface Card {
  id: string; // Unique ID for React keys
  suit: Suit;
  rank: Rank;
  value: number; // For scoring (Face value, A=1, JQK=10, 7=15, Joker=30)
  sortValue: number; // For sorting hand (1-13)
  isJoker: boolean;
  representedCard?: { suit: Suit; rank: Rank }; // If joker is played as something else
}

export interface Player {
  id: number;
  name: string;
  hand: Card[];
  isHuman: boolean;
  score: number;
  hasKnocked: boolean;
  melds: Card[][]; // Array of melds (3 of a kind)
}

export interface BoardSequence {
  suit: Suit;
  low: number; // The lowest rank played (e.g., 6)
  high: number; // The highest rank played (e.g., 8)
  hasSeven: boolean;
}

export interface JokerDeclaration {
  cardId: string;
  representedSuit: Suit;
  representedRank: Rank;
}

export interface GameState {
  players: Player[];
  currentPlayerIndex: number;
  deck: Card[];
  discardPile: Card[];
  boardSequences: Record<Suit, BoardSequence>;
  turnPhase: 'ACTION' | 'DRAW' | 'DISCARD' | 'GAME_OVER' | 'ROUND_OVER';
  round: number;
  winner: Player | null;
  logs: string[];
  pendingPong: {
    card: Card;
    discarderIndex: number;
  } | null;
  jokerDeclarations: JokerDeclaration[];
  isTutorial?: boolean;
  tutorialStep?: number;
}