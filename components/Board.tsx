import React from 'react';
import { BoardSequence, Suit, Rank, Card as CardType } from '../types';
import Card from './Card';
import { SUITS, RANKS } from '../constants';

interface BoardProps {
  sequences: Record<Suit, BoardSequence>;
  onPlaceCard: (suit: Suit, end: 'low' | 'high') => void;
  playAreaCards: CardType[]; // Cards currently being played for animation/visual context
}

// Helper to create a visual-only card object
const createVisualCard = (suit: Suit, val: number): CardType | null => {
  if (val < 1 || val > 13) return null;
  const rank = RANKS[val - 1]; // RANKS is 0-indexed, val is 1-13
  return {
    id: `visual-${suit}-${rank}`,
    suit,
    rank,
    value: 0,
    sortValue: val,
    isJoker: false
  };
};

const Board: React.FC<BoardProps> = ({ sequences, onPlaceCard, playAreaCards }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-green-900/40 p-4 rounded-xl border border-green-700 w-full max-w-5xl">
      {SUITS.filter(s => s !== Suit.JOKER).map(suit => {
        const seq = sequences[suit];
        const lowCard = seq.hasSeven ? createVisualCard(suit, seq.low) : null;
        const highCard = seq.hasSeven ? createVisualCard(suit, seq.high) : null;

        return (
          <div key={suit} className="flex flex-col items-center min-h-[200px] justify-center relative bg-white/5 rounded-lg p-2">
             {/* Base Suit Indicator / 7 Placeholder */}
             {!seq.hasSeven && (
                <div className="border-2 border-dashed border-white/30 w-16 h-24 rounded flex items-center justify-center">
                    <span className="text-3xl text-white/30">{suit}</span>
                    <span className="text-xs text-white/50 absolute bottom-2">Waiting for 7</span>
                </div>
             )}

             {/* Sequence Display */}
             {seq.hasSeven && (
               <div className="flex flex-col items-center gap-2 w-full">
                  {/* High End */}
                  <div className="relative">
                    {highCard && highCard.rank !== Rank.SEVEN ? (
                        <>
                            <span className="absolute -left-8 top-1/2 -translate-y-1/2 text-xs text-white/70 rotate-[-90deg]">MAX</span>
                            <Card card={highCard} className="scale-90" />
                        </>
                    ) : (
                        <div className="h-8"></div> // Spacer
                    )}
                  </div>
                  
                  {/* The 7 (Center) */}
                  <div className="relative z-10 shadow-xl ring-2 ring-yellow-500/50 rounded-lg">
                    <Card card={createVisualCard(suit, 7)!} />
                  </div>

                  {/* Low End */}
                  <div className="relative">
                     {lowCard && lowCard.rank !== Rank.SEVEN ? (
                        <>
                             <span className="absolute -left-8 top-1/2 -translate-y-1/2 text-xs text-white/70 rotate-[-90deg]">MIN</span>
                             <Card card={lowCard} className="scale-90" />
                        </>
                     ) : (
                        <div className="h-8"></div>
                     )}
                  </div>
               </div>
             )}
          </div>
        );
      })}
    </div>
  );
};

export default Board;