import { Card, GameState, Player, Rank, Suit, BoardSequence, JokerDeclaration } from '../types';
import { getPoints, getSortValue, RANKS, SUITS } from '../constants';

// --- Deck Management ---

export const createDeck = (playerCount: number): Card[] => {
  const numDecks = playerCount >= 4 ? 2 : 1;
  let deck: Card[] = [];

  for (let d = 0; d < numDecks; d++) {
    // Standard cards
    SUITS.forEach(suit => {
      if (suit === Suit.JOKER) return;
      RANKS.forEach(rank => {
        deck.push({
          id: `${suit}-${rank}-${d}-${Math.random().toString(36).substr(2, 9)}`,
          suit,
          rank,
          value: getPoints(rank),
          sortValue: getSortValue(rank),
          isJoker: false
        });
      });
    });

    // 2 Jokers per deck
    deck.push({ id: `JOKER-1-${d}-${Math.random()}`, suit: Suit.JOKER, rank: Rank.JOKER, value: 30, sortValue: 99, isJoker: true });
    deck.push({ id: `JOKER-2-${d}-${Math.random()}`, suit: Suit.JOKER, rank: Rank.JOKER, value: 30, sortValue: 99, isJoker: true });
  }

  return shuffle(deck);
};

const shuffle = (array: Card[]) => {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
};

// --- Tutorial Setup ---
export const setupTutorialGame = (): GameState => {
  // Construct specific cards
  const mkCard = (suit: Suit, rank: Rank, isJoker = false): Card => ({
    id: `tut-${suit}-${rank}-${Math.random()}`,
    suit,
    rank,
    value: getPoints(rank),
    sortValue: getSortValue(rank),
    isJoker
  });

  // Human Hand:
  // 1. Heart 7 (To start board)
  // 2. Heart 8 (To extend board)
  // 3. Club 2 (Pair 1)
  // 4. Club 2 (Pair 2 - to demonstrate Pong)
  // 5. Joker (To demonstrate Joker)
  // 6. Diamond King (High points to discard)
  // 7. Spade 3 (Low point filler)
  const humanHand = [
    mkCard(Suit.HEARTS, Rank.SEVEN),
    mkCard(Suit.HEARTS, Rank.EIGHT),
    mkCard(Suit.CLUBS, Rank.TWO),
    mkCard(Suit.CLUBS, Rank.TWO),
    mkCard(Suit.JOKER, Rank.JOKER, true),
    mkCard(Suit.DIAMONDS, Rank.KING),
    mkCard(Suit.SPADES, Rank.THREE),
  ].sort((a, b) => a.sortValue - b.sortValue);

  // Bot Hand: Needs a Club 2 to discard for Pong
  const botHand = [
    mkCard(Suit.CLUBS, Rank.TWO), 
    mkCard(Suit.SPADES, Rank.TEN),
    mkCard(Suit.DIAMONDS, Rank.FIVE),
    mkCard(Suit.HEARTS, Rank.ACE),
    mkCard(Suit.CLUBS, Rank.NINE),
    mkCard(Suit.SPADES, Rank.KING),
    mkCard(Suit.DIAMONDS, Rank.FOUR),
  ];

  const deck = [
      mkCard(Suit.HEARTS, Rank.ACE), // Card drawn by user (Changed to ACE so total points end up being 4)
      mkCard(Suit.SPADES, Rank.ACE), // Card drawn by bot
      ...createDeck(2) // Rest is random
  ];

  const players: Player[] = [
    { id: 0, name: "You (Student)", isHuman: true, hand: humanHand, score: 0, hasKnocked: false, melds: [] },
    { id: 1, name: "Sensei Bot", isHuman: false, hand: botHand, score: 0, hasKnocked: false, melds: [] }
  ];

  const initialSequences: Record<Suit, BoardSequence> = {
      [Suit.HEARTS]: { suit: Suit.HEARTS, low: 7, high: 7, hasSeven: false },
      [Suit.DIAMONDS]: { suit: Suit.DIAMONDS, low: 7, high: 7, hasSeven: false },
      [Suit.CLUBS]: { suit: Suit.CLUBS, low: 7, high: 7, hasSeven: false },
      [Suit.SPADES]: { suit: Suit.SPADES, low: 7, high: 7, hasSeven: false },
      [Suit.JOKER]: { suit: Suit.JOKER, low: 0, high: 0, hasSeven: false }
  };

  return {
    players,
    currentPlayerIndex: 0,
    deck,
    discardPile: [],
    boardSequences: initialSequences,
    turnPhase: 'ACTION',
    round: 1,
    winner: null,
    logs: ["Tutorial Started! Follow the instructions."],
    pendingPong: null,
    jokerDeclarations: [],
    isTutorial: true,
    tutorialStep: 0
  };
};

// --- Move Validation ---

export const canPlayOnBoard = (card: Card, sequences: Record<Suit, BoardSequence>): boolean => {
  if (card.isJoker) return true; // Jokers are wild
  
  if (card.rank === Rank.SEVEN) {
    return !sequences[card.suit].hasSeven; 
  }

  const seq = sequences[card.suit];
  if (!seq.hasSeven) return false; // Must have 7 first

  const val = card.sortValue;
  // Can play directly above high or directly below low
  return val === seq.high + 1 || val === seq.low - 1;
};

export const getPlayableCards = (hand: Card[], sequences: Record<Suit, BoardSequence>): Card[] => {
  return hand.filter(c => canPlayOnBoard(c, sequences));
};

export const calculateHandPoints = (hand: Card[]): number => {
  return hand.reduce((sum, card) => sum + card.value, 0);
};

export const resolveRoundScores = (
  players: Player[], 
  knockerIndex: number,
  jokerDeclarations: JokerDeclaration[]
): Player[] => {
  const newPlayers = [...players];
  const knocker = newPlayers[knockerIndex];
  
  // Base Hand Points
  const playerBasePoints = newPlayers.map(p => calculateHandPoints(p.hand));
  const knockerBasePoints = playerBasePoints[knockerIndex];

  let undercut = false;
  
  // 1. Calculate Base Scores & Check Undercut
  newPlayers.forEach((p, idx) => {
    if (idx === knockerIndex) return;
    const pScore = playerBasePoints[idx];
    if (pScore <= knockerBasePoints) {
      undercut = true;
    }
  });

  // 2. Apply Scores
  newPlayers.forEach((p, idx) => {
    let roundPoints = playerBasePoints[idx];

    // Joker Penalty Rule
    p.hand.forEach(card => {
       const isDeclared = jokerDeclarations.some(decl => 
         decl.representedRank === card.rank && decl.representedSuit === card.suit
       );
       if (isDeclared && !card.isJoker) {
         roundPoints += 30;
       }
    });

    if (idx !== knockerIndex) {
      p.score += roundPoints;
    } else {
        // Knocker
        if (undercut) {
            // Knocker takes penalty: Sum of all other players' points
            let penalty = 0;
            newPlayers.forEach((otherP, otherIdx) => {
               if (otherIdx !== knockerIndex) {
                 let otherRoundPoints = playerBasePoints[otherIdx];
                 otherP.hand.forEach(card => {
                    const isDeclared = jokerDeclarations.some(decl => 
                         decl.representedRank === card.rank && decl.representedSuit === card.suit
                    );
                    if (isDeclared && !card.isJoker) otherRoundPoints += 30;
                 });
                 penalty += otherRoundPoints;
               }
            });
            p.score += penalty;
        } else {
            p.score += roundPoints;
        }
    }
  });

  return newPlayers;
};

// Re-implementation of score application to be cleaner for Undercut logic
export const applyFinalScores = (
    players: Player[], 
    knockerIndex: number,
    jokerDeclarations: JokerDeclaration[]
): Player[] => {
    const roundScores = players.map(p => {
        let pts = calculateHandPoints(p.hand);
        // Joker Penalty
        p.hand.forEach(card => {
            if (!card.isJoker) {
                const isDeclared = jokerDeclarations.some(decl => 
                    decl.representedRank === card.rank && decl.representedSuit === card.suit
                );
                if (isDeclared) pts += 30;
            }
        });
        return pts;
    });

    const knockerScore = roundScores[knockerIndex];
    let undercut = false;
    
    // Check undercut
    players.forEach((p, i) => {
        if (i !== knockerIndex && roundScores[i] <= knockerScore) undercut = true;
    });

    const newPlayers = players.map(p => ({ ...p }));

    if (undercut) {
        // Knocker takes ALL points
        const totalPoints = roundScores.reduce((a, b) => a + b, 0);
        newPlayers[knockerIndex].score += totalPoints;
    } else {
        // Everyone takes their own points
        newPlayers.forEach((p, i) => {
            p.score += roundScores[i];
        });
    }

    return newPlayers;
};