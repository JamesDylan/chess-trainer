// Public surface of the persistence layer.
export type { GameRepository, SavedGame, NewSavedGame } from './types';
export { IndexedDbGameRepository } from './indexedDbGameRepository';
export { InMemoryGameRepository } from './inMemoryGameRepository';
