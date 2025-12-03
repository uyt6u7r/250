import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, Player, Card as CardType, Suit, Rank, BoardSequence, JokerDeclaration } from './types';
import { createDeck, canPlayOnBoard, calculateHandPoints, applyFinalScores, setupTutorialGame } from './utils/gameLogic';
import { SUITS, RANKS, MAX_SCORE, getSortValue } from './constants';
import Card from './components/Card';
import Board from './components/Board';
import { getAIHint } from './services/geminiService';

// --- Helper Components ---
const Modal = ({ children, onClose, title }: { children?: React.ReactNode, onClose?: () => void, title?: string }) => (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in">
    <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full m-4 relative flex flex-col max-h-[90vh]">
        {onClose && (
            <button onClick={onClose} className="absolute top-2 right-2 text-gray-500 hover:text-black">✕</button>
        )}
        {title && <h2 className="text-xl font-bold mb-4 text-center border-b pb-2">{title}</h2>}
        <div className="flex-1 overflow-y-auto">
            {children}
        </div>
    </div>
  </div>
);

// --- Tutorial Data ---
const TUTORIAL_STEPS = [
    {
        title: "Rule 1: The Sevens",
        text: "Welcome! In this game, 7s are special. They start the board sequences. You have a Heart 7. Click it to select, then click 'Play' to place it in the center.",
        action: "PLAY_7"
    },
    {
        title: "Rule 2: Sequences",
        text: "Now that the Heart 7 is out, you can play a 6 or 8 of the same suit. Select your Heart 8 and play it.",
        action: "PLAY_8"
    },
    {
        title: "Rule 3: Drawing",
        text: "Normally you would try to play more, but let's say you're stuck or saving cards. Click 'Draw Card' to take one from the deck.",
        action: "DRAW"
    },
    {
        title: "Rule 4: Discarding",
        text: "Your turn ends by discarding. High value cards (Face cards=10, Jokers=30) are bad for your score. Discard that Diamond King!",
        action: "DISCARD_K"
    },
    {
        title: "Opponent Turn",
        text: "The Bot is playing... wait for it.",
        action: "WAIT"
    },
    {
        title: "Rule 5: Pong!",
        text: "The Bot discarded a Club 2. You have two Club 2s in hand! This is a 'Pong'. You can take the discard to form a set (Meld) of 3. Click 'PONG!'.",
        action: "PONG"
    },
    {
        title: "Rule 6: Jokers",
        text: "Jokers are Wild but worth 30 points if left in hand! You must declare what card they represent. Play your Joker now - the game will ask you to assign it to the Heart sequence (e.g., as Heart 9).",
        action: "PLAY_JOKER"
    },
    {
        title: "Rule 7: Knocking",
        text: "Your hand points are now very low (<= 5). This allows you to KNOCK. Knocking ends the round immediately. Click 'KNOCK' to win this tutorial!",
        action: "KNOCK"
    }
];

// --- New Types for Joker Logic ---
interface PendingMeldAction {
    type: 'MELD' | 'PONG';
    cards: CardType[]; // The actual card objects (from hand/discard)
    naturalRank: Rank | null; // Null if 3 Jokers
    jokersCount: number;
}

const App: React.FC = () => {
  // --- State ---
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  
  // Pong State
  const [showPongModal, setShowPongModal] = useState(false);
  const [pongTimer, setPongTimer] = useState(10);
  
  // Joker & Meld State
  const [showSingleJokerModal, setShowSingleJokerModal] = useState(false);
  const [pendingSingleJokerMove, setPendingSingleJokerMove] = useState<{
      card: CardType;
      context: 'SEQUENCE'; // Joker cannot be 7, so only SEQUENCE is valid context
  } | null>(null);

  const [pendingMeldAction, setPendingMeldAction] = useState<PendingMeldAction | null>(null);

  // Round/Game State
  const [roundSummary, setRoundSummary] = useState<{
      roundPoints: number[];
      previousScores: number[];
      updatedPlayers: Player[];
      knockerIndex: number;
  } | null>(null);

  const [aiHint, setAiHint] = useState<string | null>(null);
  const [isLoadingHint, setIsLoadingHint] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [playerCount, setPlayerCount] = useState(4);

  // --- Initialization ---
  const startGame = () => {
    const deck = createDeck(playerCount);
    const players: Player[] = Array.from({ length: playerCount }).map((_, i) => ({
      id: i,
      name: i === 0 ? "You" : `Bot ${i}`,
      isHuman: i === 0,
      hand: [],
      score: 0,
      hasKnocked: false,
      melds: []
    }));

    // Deal 7 cards
    players.forEach(p => {
      p.hand = deck.splice(0, 7);
      p.hand.sort((a, b) => a.sortValue - b.sortValue);
    });

    const initialSequences: Record<Suit, BoardSequence> = {
        [Suit.HEARTS]: { suit: Suit.HEARTS, low: 7, high: 7, hasSeven: false },
        [Suit.DIAMONDS]: { suit: Suit.DIAMONDS, low: 7, high: 7, hasSeven: false },
        [Suit.CLUBS]: { suit: Suit.CLUBS, low: 7, high: 7, hasSeven: false },
        [Suit.SPADES]: { suit: Suit.SPADES, low: 7, high: 7, hasSeven: false },
        [Suit.JOKER]: { suit: Suit.JOKER, low: 0, high: 0, hasSeven: false }
    };

    setGameState({
      players,
      currentPlayerIndex: 0,
      deck,
      discardPile: [],
      boardSequences: initialSequences,
      turnPhase: 'ACTION',
      round: 1,
      winner: null,
      logs: ["Game started! Good luck."],
      pendingPong: null,
      jokerDeclarations: []
    });
    setGameStarted(true);
    setAiHint(null);
    setRoundSummary(null);
  };

  const startTutorial = () => {
      setGameState(setupTutorialGame());
      setGameStarted(true);
      setAiHint(null);
      setRoundSummary(null);
  };

  const addLog = (msg: string) => {
    setGameState(prev => prev ? ({ ...prev, logs: [...prev.logs.slice(-4), msg] }) : null);
  };

  const handleCardClick = (card: CardType) => {
    if (!gameState || (gameState.turnPhase !== 'ACTION' && gameState.turnPhase !== 'DISCARD')) return;
    if (gameState.currentPlayerIndex !== 0) return; // Not human turn

    // Toggle selection
    if (selectedCards.includes(card.id)) {
      setSelectedCards(prev => prev.filter(id => id !== card.id));
    } else {
        // If phase is discard, only allow 1
        if (gameState.turnPhase === 'DISCARD') {
            setSelectedCards([card.id]);
        } else {
            setSelectedCards(prev => [...prev, card.id]);
        }
    }
  };

  // --- 3-1: Play Cards (Single & Melds) ---
  const playSelectedCards = () => {
    if (!gameState || selectedCards.length === 0) return;

    // --- TUTORIAL INTERCEPTION ---
    if (gameState.isTutorial) {
        const step = TUTORIAL_STEPS[gameState.tutorialStep || 0];
        const card = gameState.players[0].hand.find(c => c.id === selectedCards[0]);
        if (!card) return;

        if (step.action === "PLAY_7") {
            if (card.rank !== Rank.SEVEN || card.suit !== Suit.HEARTS) {
                addLog("Tutorial: Please play the Heart 7.");
                return;
            }
        } else if (step.action === "PLAY_8") {
             if (card.rank !== Rank.EIGHT || card.suit !== Suit.HEARTS) {
                addLog("Tutorial: Please play the Heart 8.");
                return;
            }
        } else if (step.action === "PLAY_JOKER") {
            if (!card.isJoker) {
                addLog("Tutorial: Please play the Joker.");
                return;
            }
        } else {
            addLog("Tutorial: Follow the instructions!");
            return;
        }
    }

    const player = gameState.players[0];
    const cardsToPlay = player.hand.filter(c => selectedCards.includes(c.id));

    // Case A: Single Card
    if (cardsToPlay.length === 1) {
        const card = cardsToPlay[0];
        
        // JOKER HANDLING
        if (card.isJoker) {
             const playableSuits = SUITS.filter(s => s !== Suit.JOKER && gameState.boardSequences[s].hasSeven);
             if (playableSuits.length === 0) {
                 addLog("Jokers cannot be played as 7s. No sequences to extend.");
                 return;
             }
             setPendingSingleJokerMove({ card, context: 'SEQUENCE' }); 
             setShowSingleJokerModal(true);
             return;
        }

        // Standard Card Handling
        let valid = false;
        let newSequences = { ...gameState.boardSequences };

        if (card.rank === Rank.SEVEN && !newSequences[card.suit].hasSeven) {
            newSequences[card.suit].hasSeven = true;
            valid = true;
        } else if (canPlayOnBoard(card, newSequences)) {
             const seq = newSequences[card.suit];
             if (card.sortValue === seq.high + 1) seq.high = card.sortValue;
             if (card.sortValue === seq.low - 1) seq.low = card.sortValue;
             valid = true;
        }

        if (valid) {
            const newHand = player.hand.filter(c => c.id !== card.id);
            // Increment tutorial step if needed
            const nextStep = gameState.isTutorial ? (gameState.tutorialStep || 0) + 1 : gameState.tutorialStep;
            
            setGameState({
                ...gameState,
                players: gameState.players.map((p, i) => i === 0 ? { ...p, hand: newHand } : p),
                boardSequences: newSequences,
                logs: [...gameState.logs, `You played ${card.rank} of ${card.suit}`],
                tutorialStep: nextStep
            });
            setSelectedCards([]);
            return;
        }
    }

    // Case B: Meld (3 of a kind)
    if (cardsToPlay.length === 3) {
        if (gameState.isTutorial) {
             addLog("Tutorial: Let's stick to single cards for now.");
             return;
        }

        const nonJokers = cardsToPlay.filter(c => !c.isJoker);
        const jokers = cardsToPlay.filter(c => c.isJoker);
        
        if (nonJokers.length > 0) {
            const targetRank = nonJokers[0].rank;
            if (!nonJokers.every(c => c.rank === targetRank)) {
                 addLog("Invalid Meld: ranks do not match.");
                 return;
            }
            if (targetRank === Rank.SEVEN && jokers.length > 0) {
                addLog("Invalid Meld: Joker cannot be used as a 7.");
                return;
            }
            if (jokers.length > 0) {
                setPendingMeldAction({
                    type: 'MELD',
                    cards: cardsToPlay,
                    naturalRank: targetRank,
                    jokersCount: jokers.length
                });
                return;
            }
            const newHand = player.hand.filter(c => !selectedCards.includes(c.id));
            const newMelds = [...player.melds, cardsToPlay];
            setGameState({
                ...gameState,
                players: gameState.players.map((p, i) => i === 0 ? { ...p, hand: newHand, melds: newMelds } : p),
                logs: [...gameState.logs, `You melded three ${targetRank}s`]
            });
            setSelectedCards([]);
            return;
        } else {
             setPendingMeldAction({
                 type: 'MELD',
                 cards: cardsToPlay,
                 naturalRank: null,
                 jokersCount: 3
             });
             return;
        }
    }
    
    addLog("Invalid move!");
  };

  // --- Confirm Logic for Single Joker Play ---
  const confirmSingleJokerMove = (declaredSuit: Suit, declaredRank: Rank) => {
      if (!gameState || !pendingSingleJokerMove) return;
      const { card } = pendingSingleJokerMove;
      
      if (declaredRank === Rank.SEVEN) return;

      let newSequences = { ...gameState.boardSequences };
      const seq = newSequences[declaredSuit];
      
      const val = getSortValue(declaredRank);
      if (val === seq.high + 1) seq.high = val;
      if (val === seq.low - 1) seq.low = val;

      const player = gameState.players[0];
      const newHand = player.hand.filter(c => c.id !== card.id);
      
      const newDeclaration: JokerDeclaration = {
          cardId: card.id,
          representedSuit: declaredSuit,
          representedRank: declaredRank
      };

      // Tutorial Step Advance
      const nextStep = gameState.isTutorial ? (gameState.tutorialStep || 0) + 1 : gameState.tutorialStep;

      setGameState({
          ...gameState,
          players: gameState.players.map((p, i) => i === 0 ? { ...p, hand: newHand } : p),
          boardSequences: newSequences,
          jokerDeclarations: [...gameState.jokerDeclarations, newDeclaration],
          logs: [...gameState.logs, `You played Joker as ${declaredRank} ${declaredSuit}`],
          tutorialStep: nextStep
      });
      
      setShowSingleJokerModal(false);
      setPendingSingleJokerMove(null);
      setSelectedCards([]);
  };

  // --- Confirm Logic for Melds/Pong with Jokers ---
  const confirmMeldWithJokers = (declarations: {suit: Suit, rank: Rank}[]) => {
      if (!gameState || !pendingMeldAction) return;

      const { type, cards, jokersCount } = pendingMeldAction;
      const player = gameState.players[0];
      
      let newHand: CardType[] = [];
      let newMelds = [...player.melds];
      let newDiscardPile = [...gameState.discardPile];
      let nextPhase = gameState.turnPhase;
      let nextPlayerIdx = gameState.currentPlayerIndex;
      let logs = [...gameState.logs];
      let pendingPong = gameState.pendingPong;
      
      const jokersInMeld = cards.filter(c => c.isJoker);
      const newJokerDeclarations: JokerDeclaration[] = jokersInMeld.map((joker, idx) => ({
          cardId: joker.id,
          representedSuit: declarations[idx].suit,
          representedRank: declarations[idx].rank
      }));
      
      if (type === 'MELD') {
          newHand = player.hand.filter(c => !cards.some(played => played.id === c.id));
          newMelds.push(cards);
          logs.push(`You melded ${cards.length} cards with Jokers.`);
      } else if (type === 'PONG') {
          const discardCard = cards.find(c => !player.hand.some(h => h.id === c.id));
          if (!discardCard) return; 
          
          newHand = player.hand.filter(c => !cards.some(played => played.id === c.id)); 
          newMelds.push(cards);
          newDiscardPile = newDiscardPile.slice(1);
          
          nextPhase = 'ACTION';
          nextPlayerIdx = 0; 
          pendingPong = null;
          logs.push(`You Ponged with Jokers! Turn is yours.`);
      }
      
      setGameState({
          ...gameState,
          players: gameState.players.map((p, i) => i === 0 ? { ...p, hand: newHand, melds: newMelds } : p),
          discardPile: newDiscardPile,
          turnPhase: nextPhase as any,
          currentPlayerIndex: nextPlayerIdx,
          pendingPong: pendingPong,
          jokerDeclarations: [...gameState.jokerDeclarations, ...newJokerDeclarations],
          logs: logs
      });

      setPendingMeldAction(null);
      setSelectedCards([]);
      setShowPongModal(false); 
  };

  // --- Draw & Discard ---
  const drawCard = () => {
      if (!gameState || gameState.turnPhase !== 'ACTION') return;
      
      if (gameState.isTutorial) {
          const step = TUTORIAL_STEPS[gameState.tutorialStep || 0];
          if (step.action !== "DRAW") {
              addLog("Tutorial: Do not draw yet.");
              return;
          }
      }

      const deck = [...gameState.deck];
      if (deck.length === 0) {
          addLog("Deck empty! Skipping draw.");
          setGameState({ ...gameState, turnPhase: 'DISCARD' });
          return;
      }
      const card = deck.shift()!;
      const player = { ...gameState.players[gameState.currentPlayerIndex] };
      player.hand = [...player.hand, card].sort((a, b) => a.sortValue - b.sortValue);

      const nextStep = gameState.isTutorial ? (gameState.tutorialStep || 0) + 1 : gameState.tutorialStep;

      setGameState({
          ...gameState,
          deck,
          players: gameState.players.map((p, i) => i === gameState.currentPlayerIndex ? player : p),
          turnPhase: 'DISCARD',
          logs: [...gameState.logs, `You drew a card.`],
          tutorialStep: nextStep
      });
  };

  const discardCard = () => {
      if (!gameState || selectedCards.length !== 1 || gameState.turnPhase !== 'DISCARD') return;
      const cardId = selectedCards[0];
      const player = gameState.players[0];
      const card = player.hand.find(c => c.id === cardId);
      if (!card) return;

      if (gameState.isTutorial) {
          const step = TUTORIAL_STEPS[gameState.tutorialStep || 0];
          if (step.action === "DISCARD_K" && card.rank !== Rank.KING) {
              addLog("Tutorial: Discard the King of Diamonds!");
              return;
          }
      }

      const newHand = player.hand.filter(c => c.id !== cardId);
      const nextPlayerIdx = (gameState.currentPlayerIndex + 1) % gameState.players.length;
      const nextStep = gameState.isTutorial ? (gameState.tutorialStep || 0) + 1 : gameState.tutorialStep;

      setGameState({
          ...gameState,
          players: gameState.players.map((p, i) => i === 0 ? { ...p, hand: newHand } : p),
          discardPile: [card, ...gameState.discardPile],
          currentPlayerIndex: nextPlayerIdx,
          turnPhase: 'ACTION',
          logs: [...gameState.logs, `You discarded ${card.rank} ${card.suit}`],
          pendingPong: { card, discarderIndex: 0 },
          tutorialStep: nextStep
      });
      setSelectedCards([]);
  };

  // --- Round End Logic ---
  const processRoundEnd = useCallback((currentPlayers: Player[], knockerIdx: number) => {
      if (!gameState) return;
      
      const previousScores = currentPlayers.map(p => p.score);
      const updatedPlayers = applyFinalScores(currentPlayers, knockerIdx, gameState.jokerDeclarations);
      const roundPoints = updatedPlayers.map((p, i) => p.score - previousScores[i]);

      setGameState(prev => prev ? ({
          ...prev,
          players: updatedPlayers,
          turnPhase: 'ROUND_OVER',
          logs: [...prev.logs, `${currentPlayers[knockerIdx].name} knocked with ${calculateHandPoints(currentPlayers[knockerIdx].hand)} points!`]
      }) : null);

      setRoundSummary({
          roundPoints,
          previousScores,
          updatedPlayers,
          knockerIndex: knockerIdx
      });
  }, [gameState]);

  const startNextRound = () => {
      if (!gameState || !roundSummary) return;
      
      // If Tutorial, just end it
      if (gameState.isTutorial) {
          setGameState(null);
          setGameStarted(false);
          return;
      }

      const { updatedPlayers } = roundSummary;
      const isGameOver = updatedPlayers.some(p => p.score >= MAX_SCORE);
      
      if (isGameOver) {
          const winner = updatedPlayers.reduce((prev, curr) => prev.score < curr.score ? prev : curr);
          setGameState({
              ...gameState,
              winner,
              turnPhase: 'GAME_OVER',
              logs: [...gameState.logs, `Game Over! Winner: ${winner.name}`]
          });
          setRoundSummary(null);
      } else {
           const newDeck = createDeck(updatedPlayers.length);
           updatedPlayers.forEach(p => {
               p.hand = newDeck.splice(0, 7).sort((a,b) => a.sortValue - b.sortValue);
               p.melds = [];
           });
           
           const initialSequences: Record<Suit, BoardSequence> = {
                [Suit.HEARTS]: { suit: Suit.HEARTS, low: 7, high: 7, hasSeven: false },
                [Suit.DIAMONDS]: { suit: Suit.DIAMONDS, low: 7, high: 7, hasSeven: false },
                [Suit.CLUBS]: { suit: Suit.CLUBS, low: 7, high: 7, hasSeven: false },
                [Suit.SPADES]: { suit: Suit.SPADES, low: 7, high: 7, hasSeven: false },
                [Suit.JOKER]: { suit: Suit.JOKER, low: 0, high: 0, hasSeven: false }
            };

           setGameState({
               players: updatedPlayers,
               currentPlayerIndex: (gameState.round) % updatedPlayers.length,
               deck: newDeck,
               discardPile: [],
               boardSequences: initialSequences,
               turnPhase: 'ACTION',
               round: gameState.round + 1,
               winner: null,
               logs: [...gameState.logs, `--- Round ${gameState.round + 1} Started ---`],
               pendingPong: null,
               jokerDeclarations: []
           });
           setRoundSummary(null);
      }
  };

  const handleKnock = () => {
    if (!gameState) return;
    const player = gameState.players[0];
    const points = calculateHandPoints(player.hand);
    
    if (gameState.isTutorial) {
         const step = TUTORIAL_STEPS[gameState.tutorialStep || 0];
         if (step.action !== "KNOCK") {
             addLog("Tutorial: Not time to knock yet.");
             return;
         }
    } else if (points > 5) {
        addLog(`Cannot knock! You have ${points} points.`);
        return;
    }
    processRoundEnd(gameState.players, 0);
  };

  // --- Pong Logic ---
  useEffect(() => {
    if (showPongModal && pongTimer > 0) {
        const timer = setTimeout(() => setPongTimer(t => t - 1), 1000);
        return () => clearTimeout(timer);
    } else if (showPongModal && pongTimer === 0) {
        cancelPong();
    }
  }, [showPongModal, pongTimer]);

  useEffect(() => {
    if (showPongModal) setPongTimer(10);
  }, [showPongModal]);

  useEffect(() => {
      if (!gameState || !gameState.pendingPong) return;
      
      // Force PONG detection in Tutorial
      if (gameState.isTutorial && gameState.pendingPong.discarderIndex !== 0) {
           // We know setup ensures a pair of Club 2s
           setShowPongModal(true);
           return;
      }

      if (gameState.pendingPong.discarderIndex !== 0) {
          const human = gameState.players[0];
          const rank = gameState.pendingPong.card.rank;
          const naturalMatches = human.hand.filter(c => c.rank === rank && !c.isJoker);
          const jokers = human.hand.filter(c => c.isJoker);
          
          if (naturalMatches.length + jokers.length >= 2) {
              setShowPongModal(true);
          } else {
              setGameState(prev => prev ? ({ ...prev, pendingPong: null }) : null);
          }
      } else {
          setGameState(prev => prev ? ({ ...prev, pendingPong: null }) : null);
      }
  }, [gameState?.pendingPong]);

  const doPong = () => {
    if (!gameState || !gameState.pendingPong) return;
    const human = gameState.players[0];
    const discard = gameState.pendingPong.card;
    
    const naturalMatches = human.hand.filter(c => c.rank === discard.rank && !c.isJoker);
    const jokers = human.hand.filter(c => c.isJoker);
    
    let cardsToUse: CardType[] = [];
    if (naturalMatches.length >= 2) {
        cardsToUse = naturalMatches.slice(0, 2);
    } else if (naturalMatches.length === 1) {
        cardsToUse = [naturalMatches[0], jokers[0]];
    } else {
        cardsToUse = jokers.slice(0, 2);
    }

    const jokersInvolved = cardsToUse.filter(c => c.isJoker);
    const totalCards = [...cardsToUse, discard];

    if (discard.rank === Rank.SEVEN && jokersInvolved.length > 0) {
        addLog("Cannot use Joker to Pong a 7.");
        cancelPong();
        return;
    }

    if (jokersInvolved.length > 0) {
        setPendingMeldAction({
            type: 'PONG',
            cards: totalCards, 
            naturalRank: discard.rank,
            jokersCount: jokersInvolved.length
        });
        setShowPongModal(false); 
        return;
    }
    
    // Clean Pong
    const newHand = human.hand.filter(c => !cardsToUse.includes(c));
    const newMeld = totalCards;
    
    // Tutorial Step Advance
    const nextStep = gameState.isTutorial ? (gameState.tutorialStep || 0) + 1 : gameState.tutorialStep;

    setGameState({
        ...gameState,
        players: gameState.players.map((p, i) => i === 0 ? { ...p, hand: newHand, melds: [...p.melds, newMeld] } : p),
        discardPile: gameState.discardPile.slice(1), 
        currentPlayerIndex: 0,
        turnPhase: 'ACTION',
        pendingPong: null,
        logs: [...gameState.logs, `You Ponged the ${discard.rank}! Turn is yours.`],
        tutorialStep: nextStep
    });
    setShowPongModal(false);
  };

  const cancelPong = () => {
     setShowPongModal(false);
     if (!gameState) return;
     if (gameState.isTutorial) {
         addLog("Tutorial: You should Pong to clear your hand!");
         // Re-trigger
         setTimeout(() => setShowPongModal(true), 1000);
         return;
     }
     setGameState(prev => prev ? ({ ...prev, pendingPong: null }) : null);
  };

  // --- Bot AI ---
  useEffect(() => {
    if (!gameState || gameState.turnPhase === 'GAME_OVER' || gameState.turnPhase === 'ROUND_OVER' || !gameStarted) return;
    if (gameState.currentPlayerIndex === 0) return; 
    if (gameState.pendingPong) return;

    const botTurn = async () => {
        await new Promise(r => setTimeout(r, 1000));
        if (gameState.turnPhase !== 'ACTION' && gameState.turnPhase !== 'DISCARD') return;
        if (gameState.pendingPong) return;

        // --- TUTORIAL SCRIPTED BOT ---
        if (gameState.isTutorial) {
            const botIdx = 1;
            const bot = gameState.players[botIdx];
            let deck = [...gameState.deck];
            let newHand = [...bot.hand];

            // Bot Draws
            const drawn = deck.shift();
            if (drawn) newHand.push(drawn);
            
            // Bot Discards Club 2 (Specific for Pong tutorial)
            const discardCard = newHand.find(c => c.rank === Rank.TWO && c.suit === Suit.CLUBS) || newHand[0];
            newHand = newHand.filter(c => c.id !== discardCard.id);
            
            setGameState(prev => prev ? ({
                ...prev,
                deck,
                players: prev.players.map((p, i) => i === botIdx ? { ...p, hand: newHand } : p),
                discardPile: [discardCard, ...prev.discardPile],
                turnPhase: 'ACTION', // Hand back to user (but via pending pong)
                currentPlayerIndex: 0, // In normal flow, moves to next. But pong check intervenes.
                // We set current player to 0 because if pong is skipped, it would be 0's turn in 2 player game? 
                // Actually, standard rule: P1 -> P2 -> P1.
                // If P2 discards, it becomes P1's turn. 
                // Pong logic will intercept.
                pendingPong: { card: discardCard, discarderIndex: botIdx },
                logs: [...prev.logs, "Bot discarded Club 2"],
                tutorialStep: (prev.tutorialStep || 0) + 1
            }) : null);
            return;
        }

        // --- NORMAL BOT AI ---
        const botIdx = gameState.currentPlayerIndex;
        const bot = gameState.players[botIdx];
        
        let newHand = [...bot.hand];
        let newMelds = [...bot.melds];
        let newSequences = { ...gameState.boardSequences };
        let newJokerDeclarations = [...gameState.jokerDeclarations];
        let played = true;
        let movesMade = 0;

        while(played) {
            played = false;

            // 1. Meld Naturals
            const rankCounts: Record<string, CardType[]> = {};
            newHand.forEach(c => {
                if (!c.isJoker) {
                    if (!rankCounts[c.rank]) rankCounts[c.rank] = [];
                    rankCounts[c.rank].push(c);
                }
            });
            for (const r in rankCounts) {
                if (rankCounts[r].length >= 3) {
                    const meldCards = rankCounts[r].slice(0, 3);
                    newMelds.push(meldCards);
                    const idsToRemove = meldCards.map(c => c.id);
                    newHand = newHand.filter(c => !idsToRemove.includes(c.id));
                    addLog(`${bot.name} melded three ${r}s`);
                    played = true; movesMade++;
                    break; 
                }
            }
            if (played) continue;

            // 2. Play Individual Cards
            for (let i = 0; i < newHand.length; i++) {
                const c = newHand[i];

                if (!c.isJoker) {
                    if (c.rank === Rank.SEVEN && !newSequences[c.suit].hasSeven) {
                        newSequences[c.suit].hasSeven = true;
                        newHand.splice(i, 1);
                        played = true; movesMade++;
                        addLog(`${bot.name} played 7 of ${c.suit}`);
                        break;
                    }
                    if (canPlayOnBoard(c, newSequences)) {
                         const seq = newSequences[c.suit];
                         if (c.sortValue === seq.high + 1) seq.high = c.sortValue;
                         if (c.sortValue === seq.low - 1) seq.low = c.sortValue;
                         newHand.splice(i, 1);
                         played = true; movesMade++;
                         addLog(`${bot.name} played ${c.rank} of ${c.suit}`);
                         break;
                    }
                } else {
                    const validSuits = SUITS.filter(s => s !== Suit.JOKER && newSequences[s].hasSeven);
                    let playedJoker = false;
                    
                    for (const suit of validSuits) {
                        const seq = newSequences[suit];
                        let targetRank: Rank | null = null;
                        
                        if (seq.high < 13) {
                            targetRank = RANKS[seq.high]; 
                        } else if (seq.low > 1) {
                            targetRank = RANKS[seq.low - 2]; 
                        }

                        if (targetRank && targetRank !== Rank.SEVEN) {
                            if (getSortValue(targetRank) > seq.high) seq.high = getSortValue(targetRank);
                            else seq.low = getSortValue(targetRank);

                            newJokerDeclarations.push({
                                cardId: c.id,
                                representedSuit: suit,
                                representedRank: targetRank
                            });

                            newHand.splice(i, 1);
                            addLog(`${bot.name} played Joker as ${targetRank} ${suit}`);
                            playedJoker = true;
                            break;
                        }
                    }

                    if (playedJoker) {
                        played = true; movesMade++;
                        break;
                    }
                }
            }
        }

        const currentPoints = calculateHandPoints(newHand);
        if (currentPoints <= 5) {
             const tempPlayers = gameState.players.map((p, i) => i === botIdx ? { ...p, hand: newHand, melds: newMelds } : p);
             const updatedPlayers = applyFinalScores(tempPlayers, botIdx, newJokerDeclarations);
             const previousScores = gameState.players.map(p => p.score);
             const roundPoints = updatedPlayers.map((p, i) => p.score - previousScores[i]);

             setGameState(prev => prev ? ({
                 ...prev,
                 players: updatedPlayers,
                 boardSequences: newSequences,
                 jokerDeclarations: newJokerDeclarations,
                 turnPhase: 'ROUND_OVER',
                 logs: [...prev.logs, `${bot.name} Knocked! (Points: ${currentPoints})`]
             }) : null);
             
             setRoundSummary({
                 roundPoints,
                 previousScores,
                 updatedPlayers,
                 knockerIndex: botIdx
             });
             return;
        }

        // Draw
        let deck = [...gameState.deck];
        let drawnCard: CardType | null = null;
        if (deck.length > 0) {
            drawnCard = deck.shift()!;
            newHand.push(drawnCard);
            newHand.sort((a, b) => a.sortValue - b.sortValue);
            addLog(`${bot.name} drew a card.`);
        } else {
             addLog("Deck empty.");
        }

        // Discard
        let discardIndex = 0;
        let maxVal = -1;
        newHand.forEach((c, i) => {
            if (c.value > maxVal) { maxVal = c.value; discardIndex = i; }
        });
        const discardedCard = newHand[discardIndex];
        newHand.splice(discardIndex, 1);

        const nextPlayer = (botIdx + 1) % gameState.players.length;
        
        setGameState(prev => prev ? ({
            ...prev,
            players: prev.players.map((p, i) => i === botIdx ? { ...p, hand: newHand, melds: newMelds } : p),
            boardSequences: newSequences,
            jokerDeclarations: newJokerDeclarations,
            deck,
            discardPile: [discardedCard, ...prev.discardPile],
            currentPlayerIndex: nextPlayer,
            logs: [...prev.logs, `${bot.name} discarded ${discardedCard.rank} ${discardedCard.suit}`],
            pendingPong: { card: discardedCard, discarderIndex: botIdx }
        }) : null);
    };

    botTurn();
  }, [gameState?.currentPlayerIndex, gameState?.turnPhase, gameState?.pendingPong, processRoundEnd, gameStarted]);


  const askAI = async () => {
      if (!gameState) return;
      setIsLoadingHint(true);
      const hint = await getAIHint(gameState);
      setAiHint(hint);
      setIsLoadingHint(false);
  };

  // --- Render Components for Declaration ---
  const JokerDeclarationContent = () => {
      if (!pendingMeldAction) return null;
      
      const { jokersCount, naturalRank, cards } = pendingMeldAction;
      const naturalCards = cards.filter(c => !c.isJoker);
      const usedSuits = naturalCards.map(c => c.suit);

      const [selectedRank, setSelectedRank] = useState<Rank>(naturalRank || Rank.ACE);
      const [declarations, setDeclarations] = useState<{suit: Suit | null, rank: Rank}[]>(
          Array(jokersCount).fill({ suit: null, rank: naturalRank || Rank.ACE })
      );

      useEffect(() => {
          if (naturalRank) {
              setDeclarations(Array(jokersCount).fill({ suit: null, rank: naturalRank }));
          } else {
              setDeclarations(Array(jokersCount).fill({ suit: null, rank: selectedRank }));
          }
      }, [naturalRank, selectedRank, jokersCount]);

      const toggleSuit = (jokerIdx: number, suit: Suit) => {
          const newDecls = [...declarations];
          newDecls[jokerIdx] = { ...newDecls[jokerIdx], suit };
          setDeclarations(newDecls);
      };

      const canConfirm = declarations.every(d => d.suit !== null) && selectedRank !== Rank.SEVEN;

      return (
          <div className="flex flex-col gap-4">
              <div className="text-sm text-gray-600 mb-2">
                  Please declare the identity of the Joker(s) for scoring penalties.
                  <br/>
                  <span className="text-red-500 font-bold">Note: Joker cannot be declared as a 7.</span>
              </div>

              {!naturalRank && (
                  <div>
                      <label className="block font-bold mb-1">Select Rank for Meld:</label>
                      <select 
                        value={selectedRank} 
                        onChange={(e) => setSelectedRank(e.target.value as Rank)}
                        className="w-full border p-2 rounded"
                      >
                          {RANKS.filter(r => r !== Rank.SEVEN && r !== Rank.JOKER).map(r => (
                              <option key={r} value={r}>{r}</option>
                          ))}
                      </select>
                  </div>
              )}
              {naturalRank && <div className="font-bold">Meld Rank: {naturalRank}</div>}

              {declarations.map((decl, idx) => {
                  const otherJokerSuits = declarations.filter((_, i) => i !== idx && declarations[i].suit).map(d => d.suit!);
                  const forbidden = [...usedSuits, ...otherJokerSuits];
                  
                  return (
                      <div key={idx} className="border p-3 rounded bg-gray-50">
                          <p className="mb-2 font-bold text-sm">Joker {idx + 1} represents:</p>
                          <div className="flex gap-2 justify-center">
                              {SUITS.filter(s => s !== Suit.JOKER).map(s => {
                                  const disabled = forbidden.includes(s);
                                  const isSelected = decl.suit === s;
                                  return (
                                      <button 
                                        key={s}
                                        disabled={disabled}
                                        onClick={() => toggleSuit(idx, s)}
                                        className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-xl transition-all
                                            ${isSelected ? 'bg-blue-600 text-white border-blue-600 scale-110' : ''}
                                            ${disabled ? 'opacity-20 cursor-not-allowed bg-gray-200' : 'hover:bg-gray-100'}
                                        `}
                                      >
                                          <span className={s === Suit.HEARTS || s === Suit.DIAMONDS ? (isSelected ? 'text-white' : 'text-red-500') : (isSelected ? 'text-white' : 'text-black')}>{s}</span>
                                      </button>
                                  );
                              })}
                          </div>
                      </div>
                  );
              })}

              <button 
                  disabled={!canConfirm}
                  onClick={() => confirmMeldWithJokers(declarations as {suit: Suit, rank: Rank}[])}
                  className="w-full bg-green-600 text-white py-3 rounded font-bold disabled:bg-gray-400 mt-4"
              >
                  Confirm Declaration
              </button>
          </div>
      );
  };

  if (!gameStarted) {
      return (
          <div className="min-h-screen bg-green-900 flex flex-col items-center justify-center text-white font-sans p-4">
              <h1 className="text-6xl font-bold mb-4 text-yellow-400 drop-shadow-lg">Sevens & Melds</h1>
              <div className="bg-green-800 p-6 rounded-xl shadow-lg border border-green-600 w-full max-w-sm flex flex-col gap-4">
                  <div>
                    <label className="block mb-2 font-bold">Number of Players:</label>
                    <div className="flex gap-2 justify-center mb-6">
                        {[2,3,4,5,6].map(n => (
                            <button key={n} onClick={() => setPlayerCount(n)} className={`w-10 h-10 rounded-full font-bold ${playerCount === n ? 'bg-yellow-400 text-black' : 'bg-green-700 text-white'}`}>{n}</button>
                        ))}
                    </div>
                    <button onClick={startGame} className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-lg text-xl shadow-lg mb-2">Start Game</button>
                    <button onClick={startTutorial} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xl shadow-lg">Tutorial Mode</button>
                  </div>
              </div>
          </div>
      );
  }

  const human = gameState!.players[0];

  return (
    <div className="min-h-screen bg-green-800 flex flex-col font-sans overflow-hidden">
      {/* HUD */}
      <div className="flex justify-between items-start p-2 bg-green-900/50">
        <div className="flex gap-4 overflow-x-auto pb-2">
            {gameState!.players.slice(1).map(p => (
                <div key={p.id} className={`flex flex-col items-center p-2 rounded ${gameState?.currentPlayerIndex === p.id ? 'bg-yellow-500/20 border border-yellow-500' : 'bg-green-900/40'}`}>
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-green-900 font-bold mb-1">{p.name[0]}</div>
                    <span className="text-white text-xs font-bold">{p.name}</span>
                    <span className="text-green-300 text-xs">{p.hand.length} cards</span>
                    <span className="text-yellow-200 text-xs">{p.score} pts</span>
                </div>
            ))}
        </div>
        <div className="text-right text-white text-sm opacity-70">Round: {gameState!.round}<br/>Deck: {gameState!.deck.length}</div>
      </div>

      {/* Tutorial Overlay */}
      {gameState?.isTutorial && TUTORIAL_STEPS[gameState.tutorialStep || 0] && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-blue-600/90 text-white p-4 rounded-xl shadow-2xl z-40 max-w-lg border-2 border-yellow-400 animate-bounce-short">
              <h3 className="font-bold text-lg text-yellow-300 mb-1">{TUTORIAL_STEPS[gameState.tutorialStep || 0].title}</h3>
              <p>{TUTORIAL_STEPS[gameState.tutorialStep || 0].text}</p>
          </div>
      )}

      {/* Board */}
      <div className="flex-1 flex flex-col items-center justify-center p-2 relative">
          <Board sequences={gameState!.boardSequences} onPlaceCard={() => {}} playAreaCards={[]} />
          
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center">
              <span className="text-white text-xs mb-1 opacity-50 uppercase tracking-widest">Discard</span>
              <div className="relative">
                {gameState!.discardPile.length > 0 ? <Card card={gameState!.discardPile[0]} /> : <div className="w-20 h-28 border-2 border-dashed border-white/20 rounded flex items-center justify-center text-white/20">Empty</div>}
              </div>
          </div>
          <div className="absolute left-4 bottom-32 max-w-xs pointer-events-none">
              {gameState?.logs.slice(-3).map((log, i) => <div key={i} className="text-white/80 text-sm drop-shadow-md bg-black/20 p-1 rounded mb-1 animate-fade-in">{log}</div>)}
          </div>
      </div>

      {/* Controls */}
      <div className="bg-green-900 shadow-[0_-5px_15px_rgba(0,0,0,0.3)] pt-4 pb-6 px-4 flex flex-col items-center z-10 relative">
          <div className="w-full max-w-5xl flex justify-between items-end mb-4 px-2">
               <div className="text-white">
                   <div className="text-sm opacity-70">Your Score</div>
                   <div className="text-2xl font-bold text-yellow-400">{human.score} pts</div>
               </div>
               
               <div className="flex gap-2">
                   {gameState!.turnPhase === 'ACTION' && gameState?.currentPlayerIndex === 0 && (
                       <>
                         <button onClick={playSelectedCards} disabled={selectedCards.length === 0} className="bg-blue-600 disabled:bg-gray-600 text-white px-4 py-2 rounded shadow hover:bg-blue-500 transition-colors">Play {selectedCards.length > 0 ? `(${selectedCards.length})` : ''}</button>
                         {(calculateHandPoints(human.hand) <= 5 || gameState.isTutorial) && (
                             <button onClick={handleKnock} className="bg-red-600 text-white px-4 py-2 rounded shadow hover:bg-red-500 animate-pulse">KNOCK</button>
                         )}
                         <button onClick={drawCard} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded shadow">Draw Card</button>
                       </>
                   )}
                   {gameState!.turnPhase === 'DISCARD' && gameState?.currentPlayerIndex === 0 && (
                       <button onClick={discardCard} disabled={selectedCards.length !== 1} className="bg-orange-600 disabled:bg-gray-600 text-white px-6 py-2 rounded shadow hover:bg-orange-500">Discard Selected</button>
                   )}
                   {!gameState?.isTutorial && (
                      <button onClick={askAI} disabled={isLoadingHint} className="bg-purple-700 hover:bg-purple-600 text-white px-3 py-2 rounded shadow flex items-center gap-2">{isLoadingHint ? '...' : 'AI Hint ✨'}</button>
                   )}
               </div>
          </div>
          
          {aiHint && (
              <div className="absolute bottom-full mb-2 bg-purple-900/90 text-white p-3 rounded-lg max-w-md shadow-xl border border-purple-400">
                  <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-xs uppercase tracking-wide text-purple-200">Strategist</span>
                      <button onClick={() => setAiHint(null)} className="text-xs hover:text-white">✕</button>
                  </div>
                  <p className="text-sm">{aiHint}</p>
              </div>
          )}

          <div className="flex -space-x-8 sm:-space-x-10 overflow-x-auto p-4 w-full justify-center min-h-[140px]">
              {human.hand.map((card) => (
                  <Card key={card.id} card={card} onClick={() => handleCardClick(card)} isSelected={selectedCards.includes(card.id)} isPlayable={gameState?.currentPlayerIndex === 0} className="hover:z-20 transform origin-bottom hover:rotate-2" />
              ))}
          </div>
      </div>

      {/* MODALS */}
      {showPongModal && !pendingMeldAction && (
          <Modal title="Pong Opportunity!">
              <div className="mb-4">
                  <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700 mb-2">
                      <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-1000 ease-linear" style={{ width: `${(pongTimer / 10) * 100}%` }}></div>
                  </div>
                  <p className="text-center text-sm text-gray-500">Closing in {pongTimer}s...</p>
              </div>

              <div className="flex justify-center mb-4"><Card card={gameState!.pendingPong!.card} /></div>
              <p className="text-center mb-6">Take this card to complete a set.</p>
              <div className="flex gap-4 justify-center">
                  <button onClick={doPong} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-500">PONG!</button>
                  <button onClick={cancelPong} className="bg-gray-300 text-gray-800 px-6 py-3 rounded-lg font-bold hover:bg-gray-200">Pass</button>
              </div>
          </Modal>
      )}

      {showSingleJokerModal && (
          <Modal onClose={() => setShowSingleJokerModal(false)} title="Declare Joker">
              <div className="flex flex-col gap-3">
                  <div className="text-sm text-gray-500 mb-2">Select which card this Joker represents:</div>
                  <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                      {SUITS.filter(s => s !== Suit.JOKER && gameState!.boardSequences[s].hasSeven).map(s => {
                          const seq = gameState!.boardSequences[s];
                          const lowVal = seq.low - 1;
                          const highVal = seq.high + 1;
                          const opts = [];
                          if (lowVal >= 1) opts.push({ rank: RANKS[lowVal-1], type: 'Low' });
                          if (highVal <= 13) opts.push({ rank: RANKS[highVal-1], type: 'High' });
                          
                          // Filter out 7s
                          const validOpts = opts.filter(o => o.rank !== Rank.SEVEN);

                          return validOpts.map(opt => (
                              <button key={`${s}-${opt.rank}`} onClick={() => confirmSingleJokerMove(s, opt.rank)} className="p-3 border rounded hover:bg-gray-100 flex justify-between items-center">
                                    <span>{opt.type} End of {s}</span>
                                    <span className={`font-bold ${s === Suit.HEARTS || s === Suit.DIAMONDS ? 'text-red-500' : 'text-black'}`}>{opt.rank} {s}</span>
                              </button>
                          ));
                      })}
                  </div>
              </div>
          </Modal>
      )}

      {pendingMeldAction && (
          <Modal onClose={() => setPendingMeldAction(null)} title="Joker Declaration">
              <JokerDeclarationContent />
          </Modal>
      )}

      {roundSummary && (
          <Modal title="Round Summary">
              <p className="text-center mb-4 text-gray-600">{roundSummary.updatedPlayers[roundSummary.knockerIndex].name} Knocked!</p>
              
              <div className="w-full mb-6">
                  <div className="grid grid-cols-4 font-bold border-b pb-2 mb-2 text-sm">
                      <span>Player</span>
                      <span className="text-right">Prev</span>
                      <span className="text-right">Round</span>
                      <span className="text-right">Total</span>
                  </div>
                  {roundSummary.updatedPlayers.map((p, i) => (
                      <div key={p.id} className="grid grid-cols-4 py-1 text-sm border-b border-gray-100 last:border-0">
                          <span className={`${p.id === 0 ? 'font-bold text-blue-600' : ''}`}>{p.name}</span>
                          <span className="text-right text-gray-500">{roundSummary.previousScores[i]}</span>
                          <span className="text-right font-medium text-red-500">+{roundSummary.roundPoints[i]}</span>
                          <span className="text-right font-bold">{p.score}</span>
                      </div>
                  ))}
              </div>
              
              <button onClick={startNextRound} className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-500">
                  {roundSummary.updatedPlayers.some(p => p.score >= MAX_SCORE) && !gameState?.isTutorial ? 'See Winner' : 'Next'}
              </button>
          </Modal>
      )}

      {gameState?.turnPhase === 'GAME_OVER' && (
          <Modal title="Game Over!">
             <div className="text-center text-xl mb-6">{gameState.winner?.id === 0 ? "You Won! 🏆" : `${gameState.winner?.name} Wins!`}</div>
             <div className="space-y-2 mb-6">
                 {gameState.players.slice().sort((a,b) => a.score - b.score).map((p, i) => (
                     <div key={p.id} className="flex justify-between border-b border-gray-200 pb-1">
                         <span className={p.id === 0 ? "font-bold" : ""}>{i+1}. {p.name}</span>
                         <span>{p.score} pts</span>
                     </div>
                 ))}
             </div>
             <button onClick={startGame} className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-500">Play Again</button>
          </Modal>
      )}
    </div>
  );
};

export default App;