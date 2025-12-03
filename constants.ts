import { Suit, Rank } from './types';

export const CARD_WIDTH = "w-16 sm:w-20 md:w-24";
export const CARD_HEIGHT = "h-24 sm:h-28 md:h-36";

export const MAX_SCORE = 250;

export const SUITS = [Suit.HEARTS, Suit.DIAMONDS, Suit.CLUBS, Suit.SPADES];
export const RANKS = [
  Rank.ACE, Rank.TWO, Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX,
  Rank.SEVEN, Rank.EIGHT, Rank.NINE, Rank.TEN, Rank.JACK, Rank.QUEEN, Rank.KING
];

export const getSortValue = (rank: Rank): number => {
  if (rank === Rank.JOKER) return 99;
  const index = RANKS.indexOf(rank);
  return index + 1; // Ace = 1, King = 13
};

export const getPoints = (rank: Rank): number => {
  if (rank === Rank.JOKER) return 30;
  if (rank === Rank.SEVEN) return 15;
  if ([Rank.JACK, Rank.QUEEN, Rank.KING].includes(rank)) return 10;
  if (rank === Rank.ACE) return 1;
  return parseInt(rank);
};
