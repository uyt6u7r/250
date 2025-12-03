import React from 'react';
import { Card as CardType, Suit } from '../types';
import { CARD_HEIGHT, CARD_WIDTH } from '../constants';

interface CardProps {
  card: CardType;
  onClick?: () => void;
  isSelected?: boolean;
  isPlayable?: boolean;
  className?: string;
  hidden?: boolean; // Back of card
}

const Card: React.FC<CardProps> = ({ card, onClick, isSelected, isPlayable, className, hidden }) => {
  const isRed = card.suit === Suit.HEARTS || card.suit === Suit.DIAMONDS;
  
  const baseClasses = `${CARD_WIDTH} ${CARD_HEIGHT} rounded-lg shadow-md border-2 relative flex flex-col justify-between p-1 transition-all duration-200 select-none`;
  const colorClasses = isRed ? "text-red-600 border-gray-300" : "text-black border-gray-300";
  const stateClasses = isSelected ? "-translate-y-4 ring-2 ring-yellow-400 z-10" : "hover:-translate-y-2";
  const bgClass = hidden ? "bg-blue-700 pattern-grid" : "bg-white";

  if (hidden) {
    return (
      <div className={`${baseClasses} ${bgClass} ${className || ''}`}>
        <div className="w-full h-full rounded border border-blue-500 bg-blue-800 flex items-center justify-center">
            <span className="text-white opacity-20 text-2xl">♠</span>
        </div>
      </div>
    );
  }

  return (
    <div 
      onClick={onClick}
      className={`${baseClasses} ${colorClasses} ${stateClasses} ${bgClass} ${className || ''} ${isPlayable ? 'cursor-pointer' : 'cursor-default opacity-90'}`}
    >
      <div className="text-sm font-bold leading-none">
        <div>{card.rank}</div>
        <div>{card.suit}</div>
      </div>
      
      <div className="absolute inset-0 flex items-center justify-center text-4xl opacity-20 pointer-events-none">
        {card.suit}
      </div>

      <div className="text-sm font-bold leading-none self-end rotate-180">
        <div>{card.rank}</div>
        <div>{card.suit}</div>
      </div>
    </div>
  );
};

export default Card;
