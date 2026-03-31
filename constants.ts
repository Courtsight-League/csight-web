
import { Season, Team, Game, PlayerStats, NewsItem, FAQItem, PhotoAlbum, RosterPlayer } from './types';

export const SEASONS: Season[] = [
  { id: 's1', name: 'Winter 2025', isActive: true },
  { id: 's2', name: 'Fall 2024', isActive: false },
  { id: 's3', name: 'Summer 2024', isActive: false },
];

export const TEAMS: Team[] = [
  { id: 't1', name: 'Netcast', division: 'D1', logoUrl: 'https://picsum.photos/100/100?random=1', bannerUrl: 'https://images.unsplash.com/photo-1519861531473-9200263931a2?q=80&w=1000&auto=format&fit=crop', wins: 5, losses: 1, ties: 0, pointsFor: 420, pointsAgainst: 380 },
  { id: 't2', name: 'Excommunicado', division: 'D1', logoUrl: 'https://picsum.photos/100/100?random=2', bannerUrl: 'https://images.unsplash.com/photo-1504450758481-7338eba7524a?q=80&w=1000&auto=format&fit=crop', wins: 4, losses: 2, ties: 0, pointsFor: 400, pointsAgainst: 350 },
  { id: 't3', name: 'Steel City', division: 'D1', logoUrl: 'https://picsum.photos/100/100?random=3', wins: 2, losses: 4, ties: 0, pointsFor: 360, pointsAgainst: 390 },
  { id: 't4', name: 'Bucket Getters', division: 'D2', logoUrl: 'https://picsum.photos/100/100?random=4', wins: 6, losses: 0, ties: 0, pointsFor: 500, pointsAgainst: 300 },
  { id: 't5', name: 'Brick Layers', division: 'D2', logoUrl: 'https://picsum.photos/100/100?random=5', wins: 0, losses: 6, ties: 0, pointsFor: 250, pointsAgainst: 480 },
];

export const MOCK_ROSTERS: RosterPlayer[] = [
  // Netcast
  { id: 'p1', name: 'Kade Cunningham', teamId: 't1', number: 55, isCaptain: true },
  { id: 'p1b', name: 'Jalen Green', teamId: 't1', number: 4 },
  { id: 'p1c', name: 'Evan Mobley', teamId: 't1', number: 15 },
  // Excommunicado
  { id: 'p2', name: 'Bronny J', teamId: 't2', number: 6, isCaptain: true },
  { id: 'p2b', name: 'Mikey W', teamId: 't2', number: 1 },
  // Steel City
  { id: 'p3', name: 'Shaq D', teamId: 't3', number: 34, isCaptain: true },
  // Bucket Getters
  { id: 'p4', name: 'Steph C', teamId: 't4', number: 30, isCaptain: true },
  { id: 'p4b', name: 'Klay T', teamId: 't4', number: 11 },
  // Brick Layers
  { id: 'p5', name: 'Ben S', teamId: 't5', number: 10, isCaptain: true },
];

export const GAMES: Game[] = [
  { id: 'g1', seasonId: 's1', date: '2025-02-20', time: '19:00', location: 'Central Gym Court 1', homeTeamId: 't1', awayTeamId: 't2', status: 'SCHEDULED', isPlayoff: false, homeScore: 0, awayScore: 0 },
  { id: 'g2', seasonId: 's1', date: '2025-02-20', time: '20:00', location: 'Central Gym Court 1', homeTeamId: 't3', awayTeamId: 't4', status: 'SCHEDULED', isPlayoff: false, homeScore: 0, awayScore: 0 },
  { id: 'g3', seasonId: 's1', date: '2025-02-13', time: '19:00', location: 'Central Gym Court 1', homeTeamId: 't2', awayTeamId: 't3', status: 'COMPLETED', homeScore: 65, awayScore: 58, youtubeLink: 'https://youtube.com', isPlayoff: false },
  { id: 'g4', seasonId: 's1', date: '2025-02-13', time: '20:00', location: 'Central Gym Court 2', homeTeamId: 't1', awayTeamId: 't5', status: 'COMPLETED', homeScore: 82, awayScore: 40, isPlayoff: false },
  { id: 'g5', seasonId: 's1', date: '2025-02-06', time: '19:00', location: 'Central Gym Court 1', homeTeamId: 't1', awayTeamId: 't3', status: 'COMPLETED', homeScore: 70, awayScore: 65, isPlayoff: false },
  { id: 'g6', seasonId: 's1', date: '2025-01-30', time: '19:00', location: 'Central Gym Court 1', homeTeamId: 't4', awayTeamId: 't1', status: 'COMPLETED', homeScore: 60, awayScore: 58, isPlayoff: false },
];

export const PLAYER_STATS: PlayerStats[] = [
  { playerId: 'p1', playerName: 'Kade Cunningham', teamId: 't1', teamName: 'Netcast', gp: 6, ppg: 24.5, rpg: 8.2, apg: 7.1, spg: 2.1, fgPct: 48.5 },
  { playerId: 'p2', playerName: 'Bronny J', teamId: 't2', teamName: 'Excommunicado', gp: 6, ppg: 18.2, rpg: 4.5, apg: 3.2, spg: 1.5, fgPct: 42.1 },
  { playerId: 'p3', playerName: 'Shaq D', teamId: 't3', teamName: 'Steel City', gp: 5, ppg: 28.4, rpg: 12.1, apg: 1.5, spg: 0.8, fgPct: 62.0 },
  { playerId: 'p4', playerName: 'Steph C', teamId: 't4', teamName: 'Bucket Getters', gp: 6, ppg: 32.1, rpg: 3.2, apg: 5.5, spg: 2.5, fgPct: 51.2 },
];

// Mock Data for My Season View
export const MY_GAME_LOGS = [
  { id: 'gl1', date: 'Feb 13', opponent: 'Brick Layers', result: 'W 82-40', pts: 28, reb: 10, ast: 8, stl: 3, fg: '10/18' },
  { id: 'gl2', date: 'Feb 06', opponent: 'Steel City', result: 'W 70-65', pts: 22, reb: 6, ast: 12, stl: 1, fg: '8/15' },
  { id: 'gl3', date: 'Jan 30', opponent: 'Bucket Getters', result: 'L 58-60', pts: 30, reb: 5, ast: 4, stl: 2, fg: '11/22' },
];

export const NEWS_ITEMS: NewsItem[] = [
  { id: 'n1', title: 'Winter Season Tip-Off', summary: 'The 2025 Winter season begins this Friday with a rematch of last year\'s finals.', imageUrl: 'https://images.unsplash.com/photo-1519861531473-9200263931a2?q=80&w=1000&auto=format&fit=crop', date: 'Jan 15, 2025' },
  { id: 'n2', title: 'Registration Extended', summary: 'We have opened up 2 more slots for D2 teams. Register before spots fill up!', imageUrl: 'https://images.unsplash.com/photo-1504450758481-7338eba7524a?q=80&w=1000&auto=format&fit=crop', date: 'Jan 20, 2025' },
  { id: 'n3', title: 'Play of the Week', summary: 'Check out this buzzer beater from the D1 semi-finals.', imageUrl: 'https://images.unsplash.com/photo-1574623452334-1e012fc0eb29?q=80&w=1000&auto=format&fit=crop', date: 'Feb 01, 2025' },
];

export const FAQ_ITEMS: FAQItem[] = [
  { id: 'f1', category: 'Registration', question: 'How do I register a team?', answer: 'You can register a team by creating a captain account and paying the deposit fee on the Registration page.' },
  { id: 'f2', category: 'Game Rules', question: 'How long are the games?', answer: 'Games consist of two 20-minute halves with a running clock, stopping in the last 2 minutes of the second half.' },
  { id: 'f3', category: 'General', question: 'Where are games played?', answer: 'All games are played at the Central City Gymnasium on Courts 1 & 2.' },
  { id: 'f4', category: 'Registration', question: 'Can I join as a free agent?', answer: 'Yes! Select "Join Myself" during registration and we will place you on a team looking for players.' },
];

export const PHOTO_ALBUMS: PhotoAlbum[] = [
  {
    id: 'a1',
    gameId: 'g4',
    title: 'Netcast vs Brick Layers',
    date: 'Feb 13, 2025',
    coverImageUrl: 'https://images.unsplash.com/photo-1546519638-68e109498ffc?q=80&w=1000&auto=format&fit=crop',
    teamIds: ['t1', 't5'],
    photoUrls: [
      'https://images.unsplash.com/photo-1546519638-68e109498ffc?q=80&w=1000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1519861531473-9200263931a2?q=80&w=1000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1504450758481-7338eba7524a?q=80&w=1000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1574623452334-1e012fc0eb29?q=80&w=1000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1518407613690-d9fc990e795f?q=80&w=1000&auto=format&fit=crop'
    ]
  },
  {
    id: 'a2',
    gameId: 'g5',
    title: 'Netcast vs Steel City',
    date: 'Feb 06, 2025',
    coverImageUrl: 'https://images.unsplash.com/photo-1519861531473-9200263931a2?q=80&w=1000&auto=format&fit=crop',
    teamIds: ['t1', 't3'],
    photoUrls: [
      'https://images.unsplash.com/photo-1519861531473-9200263931a2?q=80&w=1000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1608245449230-6a6a9f213f76?q=80&w=1000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1533561052663-b816d6e84d8d?q=80&w=1000&auto=format&fit=crop'
    ]
  },
  {
    id: 'a3',
    gameId: 'g6',
    title: 'Netcast vs Bucket Getters',
    date: 'Jan 30, 2025',
    coverImageUrl: 'https://images.unsplash.com/photo-1628891890377-571b40d778e5?q=80&w=1000&auto=format&fit=crop',
    teamIds: ['t1', 't4'],
    photoUrls: [
      'https://images.unsplash.com/photo-1628891890377-571b40d778e5?q=80&w=1000&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1574623452334-1e012fc0eb29?q=80&w=1000&auto=format&fit=crop'
    ]
  }
];

export const DEFAULT_PLAYER_AVATAR = '/player-placeholder.svg';
