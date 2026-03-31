
export enum Role {
  PUBLIC = 'PUBLIC',
  MEMBER = 'MEMBER',
  ADMIN_FULL = 'ADMIN_FULL',
  ADMIN_MEDIA = 'ADMIN_MEDIA',
  ADMIN_SCOREKEEPER = 'ADMIN_SCOREKEEPER',
  ADMIN_COMMISSIONER = 'ADMIN_COMMISSIONER'
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl?: string;
}

export interface Season {
  id: string;
  name: string;
  isActive: boolean;
  isPublic?: boolean;
}

export interface Division {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
  logoUrl: string;
  bannerUrl?: string;
  division: string;
  seasonId?: string; // Optional for now to support legacy mock data
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface Game {
  id: string;
  seasonId: string;
  date: string; // ISO Date string
  time: string;
  location: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore?: number;
  awayScore?: number;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELED' | 'FORFEITED';
  youtubeLink?: string;
  isPlayoff: boolean;
}

export interface PlayerStats {
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  avatarUrl?: string;
  gp: number; // Games Played
  ppg: number; // Points Per Game
  rpg: number; // Rebounds
  apg: number; // Assists
  spg: number; // Steals
  fgPct: number;
  bpg: number; // Blocks Per Game
  division?: string;
}

export interface PlayerGameStats {
  id: string; // unique ID for this stat line
  gameId: string;
  playerId: string;
  teamId: string;
  playerName: string; // Denormalized for ease
  pts: number;
  reb: number;
  oreb?: number;
  dreb?: number;
  ast: number;
  stl: number;
  blk: number;
  fouls: number;
  turnovers?: number;
  minutes?: number;
  fgm?: number;
  fga?: number;
  tpm?: number;
  tpa?: number;
  ftm?: number;
  fta?: number;
  plusMinus?: number;
  fgPct?: number;
  threePct?: number;
  ftPct?: number;
  twoPm?: number;
  twoPa?: number;
  manualPts?: boolean;
}

export interface RosterPlayer {
  id: string;
  name: string;
  teamId: string;
  seasonId?: string | null;
  number: string | number;
  isCaptain?: boolean;
  position?: string | null;
  userId?: string | null;
  email?: string | null;
  isGuest?: boolean;
  avatarUrl?: string | null;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  imageUrl: string;
  date: string;
}

export interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: string;
}

export interface PhotoAlbum {
  id: string;
  gameId: string;
  title: string;
  date: string;
  coverImageUrl: string;
  photoUrls: string[];
  teamIds: string[]; // IDs of teams in this game for easy filtering
}

export interface Notification {
  id: string;
  userId: string | null;
  role: string | null;
  teamId?: string | null;
  type?: string | null;
  title: string;
  body: string;
  link?: string | null;
  metadata?: Record<string, any> | null;
  readAt?: string | null;
  createdAt?: string | null;
}
