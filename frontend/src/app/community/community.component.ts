import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom, Subscription } from 'rxjs';
import { environment } from '../../environments/environment';
import { LegalModalComponent } from '../auth/legal-modal/legal-modal.component';
import { BvcSocketService } from '../core/services/bvc-socket.service';

/* ── Interfaces ───────────────────────────────────────────────────────── */

interface SocialProfile {
  alias: string; bio: string; avatar_url: string; is_public: boolean;
  show_capital_initial: boolean; show_current_value: boolean;
  show_pnl: boolean; show_transactions: boolean; show_holdings: boolean;
  show_top_positions: boolean; notify_on_transaction: boolean;
  accepted_terms: boolean; visible_symbols: string[];
  reputation_points?: number; level?: string;
  show_in_leaderboard?: boolean; created_at?: string;
}

interface FeedPost {
  id: string; alias: string; avatar_url: string; post_type: string;
  content: string; image_url: string | null; is_anonymous: boolean;
  fire_count: number; save_count: number; comment_count: number;
  my_reactions: string[]; poll: any; is_mine: boolean; created_at: string;
}

interface Poll {
  id: string; poll_type: string; title: string; symbol: string | null;
  options: string[]; correct_option: number | null; closes_at: string;
  is_resolved: boolean; total_votes: number; created_at: string;
  creator_alias?: string; my_vote?: number | null;
  vote_counts?: Record<number, number>;
}

interface LeaderEntry {
  rank: number; alias: string; avatar_url: string; value: number;
  level: string; is_me: boolean; total?: number; correct?: number;
}

interface MoodData {
  today: { bull: number; bear: number; neutral: number; total: number;
    bull_pct: number; bear_pct: number; neutral_pct: number; };
  my_vote: string | null;
  history: { date: string; bull_pct: number; bear_pct: number; neutral_pct: number; total_votes: number }[];
}

interface NetworkStock {
  symbol: string; name: string; buyers: number; sellers: number;
  buy_pct: number; sell_pct: number; net_sentiment: string;
}

interface Tournament {
  id: string; title: string; description: string; initial_balance: number;
  starts_at: string; ends_at: string; is_active: boolean;
  participants: number; max_participants: number;
  joined: boolean; my_roi: number | null;
}

interface TournamentStanding {
  rank: number; alias: string; avatar_url: string;
  current_value: number; roi_pct: number; trades_count: number; is_me: boolean;
}

interface PublicProfile {
  alias: string; bio: string; avatar_url: string;
  is_public: boolean; is_followed?: boolean; created_at?: string;
}

@Component({
  selector: 'app-community',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, RouterLinkActive,
    MatIconModule, MatButtonModule, MatProgressSpinnerModule,
    MatTooltipModule, MatSnackBarModule, MatMenuModule,
    MatSlideToggleModule, MatCheckboxModule, MatDialogModule,
  ],
  templateUrl: './community.component.html',
  styleUrls: ['./community.component.scss'],
})
export class CommunityComponent implements OnInit, OnDestroy {

  private api = environment.apiUrl;
  private headers() { return { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` }; }

  // Real-time market data
  marketBoard: Record<string, any> = {};
  private wsSub: Subscription | null = null;

  /* ── Main tabs ──────────────────────────────────────────────────────── */
  activeTab: 'feed' | 'polls' | 'ranking' | 'mood' | 'network' | 'tournaments' | 'config' = 'feed';

  /* ── Feed ────────────────────────────────────────────────────────────── */
  posts: FeedPost[] = [];
  feedLoading = false;
  newPostContent = '';
  newPostAnonymous = false;
  posting = false;
  showComments: Record<string, boolean> = {};
  comments: Record<string, any[]> = {};
  commentInput: Record<string, string> = {};

  /* ── Polls ──────────────────────────────────────────────────────────── */
  polls: Poll[] = [];
  pollsLoading = false;
  showCreatePoll = false;
  newPoll = { title: '', poll_type: 'free' as string, symbol: '', options: ['', ''], closes_in_hours: 48 };
  creatingPoll = false;

  /* ── Leaderboard ────────────────────────────────────────────────────── */
  leaderboard: LeaderEntry[] = [];
  leaderLoading = false;
  leaderType: 'roi' | 'reputation' | 'followers' | 'predictions' = 'reputation';

  /* ── Mood ────────────────────────────────────────────────────────────── */
  mood: MoodData | null = null;
  moodLoading = false;

  /* ── Network activity ──────────────────────────────────────────────── */
  networkStocks: NetworkStock[] = [];
  networkLoading = false;
  networkTotalUsers = 0;

  /* ── Tournaments ────────────────────────────────────────────────────── */
  tournaments: Tournament[] = [];
  tournamentsLoading = false;
  selectedTournament: string | null = null;
  standings: TournamentStanding[] = [];
  standingsLoading = false;

  /* ── Social Profile Config (merged from social) ────────────────────── */
  profileLoading = true;
  profileSaving = false;
  profile: SocialProfile | null = null;
  form: SocialProfile = this.blankForm();
  editMode = false;
  aliasError = '';
  allStocks: string[] = [];

  // Network people
  networkFeed: PublicProfile[] = [];
  followers: { alias: string; bio: string; avatar_url: string }[] = [];
  following: { alias: string; bio: string; avatar_url: string }[] = [];
  networkPeopleLoading = false;
  configSubTab: 'profile' | 'people' | 'followers' | 'following' = 'profile';

  constructor(private http: HttpClient, private snack: MatSnackBar, private dialog: MatDialog, private bvcSocket: BvcSocketService) {}

  ngOnInit() {
    this.bvcSocket.connect();
    this.wsSub = this.bvcSocket.stocksMap$.subscribe(board => this.marketBoard = board);
    this.loadMyProfile();
    this.loadFeed();
  }

  ngOnDestroy() {
    this.wsSub?.unsubscribe();
  }

  /** Get live price for a symbol from the WS feed */
  livePrice(symbol: string | null): number | null {
    if (!symbol) return null;
    const tick = this.marketBoard[symbol];
    return tick?.PRECIO ?? null;
  }

  selectTab(tab: typeof this.activeTab) {
    this.activeTab = tab;
    switch (tab) {
      case 'feed': this.loadFeed(); break;
      case 'polls': this.loadPolls(); break;
      case 'ranking': this.loadLeaderboard(); break;
      case 'mood': this.loadMood(); break;
      case 'network': this.loadNetworkActivity(); break;
      case 'tournaments': this.loadTournaments(); break;
      case 'config': break; // already loaded
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     SOCIAL PROFILE (config tab)
     ══════════════════════════════════════════════════════════════════════ */

  private blankForm(): SocialProfile {
    return {
      alias: '', bio: '', avatar_url: '', is_public: false,
      show_capital_initial: false, show_current_value: false,
      show_pnl: false, show_transactions: false, show_holdings: false,
      show_top_positions: false, notify_on_transaction: false,
      accepted_terms: false, visible_symbols: [], show_in_leaderboard: true,
    };
  }

  async loadMyProfile() {
    this.profileLoading = true;
    try {
      const [p] = await Promise.all([
        firstValueFrom(this.http.get<SocialProfile | null>(`${this.api}/social/me`, { headers: this.headers() })),
        this.loadMyHoldings(),
      ]);
      this.profile = p;
      if (p) {
        this.form = { ...p };
        if (!this.form.visible_symbols) this.form.visible_symbols = [];
      } else { this.editMode = true; }
    } catch { this.profile = null; this.editMode = true; }
    finally { this.profileLoading = false; }
  }

  async saveProfile() {
    this.aliasError = '';
    if (!this.form.alias.trim()) { this.aliasError = 'El alias es obligatorio'; return; }
    if (!this.form.accepted_terms && !this.profile) {
      this.snack.open('Debes aceptar los términos', 'Cerrar', { duration: 4000 }); return;
    }
    const re = /^[a-zA-Z0-9_.-]{3,40}$/;
    if (!re.test(this.form.alias)) { this.aliasError = 'Solo letras, números, _ . - (3–40 chars)'; return; }
    this.profileSaving = true;
    try {
      const saved = await firstValueFrom(
        this.http.put<SocialProfile>(`${this.api}/social/me`, this.form, { headers: this.headers() })
      );
      this.profile = saved; this.form = { ...saved };
      if (!this.form.visible_symbols) this.form.visible_symbols = [];
      this.editMode = false;
      this.snack.open('Perfil guardado ✓', 'OK', { duration: 3000 });
    } catch (err: any) {
      this.snack.open(err?.error?.detail ?? 'Error al guardar', 'Cerrar', { duration: 4000 });
    } finally { this.profileSaving = false; }
  }

  async deleteProfile() {
    if (!confirm('¿Eliminar tu perfil? No se puede deshacer.')) return;
    try {
      await firstValueFrom(this.http.delete(`${this.api}/social/me`, { headers: this.headers() }));
      this.profile = null; this.form = this.blankForm(); this.editMode = true;
      this.snack.open('Perfil eliminado', 'OK', { duration: 3000 });
    } catch { this.snack.open('Error al eliminar', 'Cerrar', { duration: 3000 }); }
  }

  async loadMyHoldings() {
    try {
      const data: any = await firstValueFrom(
        this.http.get(`${this.api}/portfolio/analytics`, { headers: this.headers() })
      );
      this.allStocks = data.performance.map((p: any) => p.symbol);
    } catch { this.allStocks = []; }
  }

  toggleStock(symbol: string) {
    const idx = this.form.visible_symbols.indexOf(symbol);
    if (idx > -1) this.form.visible_symbols.splice(idx, 1);
    else this.form.visible_symbols.push(symbol);
  }
  isStockVisible(s: string) { return this.form.visible_symbols?.includes(s) ?? false; }
  avatarLetter(alias: string) { return alias?.[0]?.toUpperCase() ?? '?'; }

  showTerms(e: Event) { e.preventDefault(); this.dialog.open(LegalModalComponent, { data: { type: 'terms' }, maxWidth: '600px' }); }
  showPrivacy(e: Event) { e.preventDefault(); this.dialog.open(LegalModalComponent, { data: { type: 'privacy' }, maxWidth: '600px' }); }

  // Network people (explore, followers, following)
  selectConfigSub(sub: typeof this.configSubTab) {
    this.configSubTab = sub;
    if (sub === 'people') this.loadNetworkPeople();
    if (sub === 'followers') this.loadFollowers();
    if (sub === 'following') this.loadFollowing();
  }

  async loadNetworkPeople() {
    this.networkPeopleLoading = true;
    try {
      this.networkFeed = await firstValueFrom(
        this.http.get<PublicProfile[]>(`${this.api}/social/feed`, { headers: this.headers() })
      );
    } catch { this.networkFeed = []; }
    finally { this.networkPeopleLoading = false; }
  }

  async loadFollowers() {
    try { this.followers = await firstValueFrom(this.http.get<any[]>(`${this.api}/social/me/followers`, { headers: this.headers() })); }
    catch { this.followers = []; }
  }
  async loadFollowing() {
    try { this.following = await firstValueFrom(this.http.get<any[]>(`${this.api}/social/me/following`, { headers: this.headers() })); }
    catch { this.following = []; }
  }
  async follow(alias: string) {
    try {
      const r: any = await firstValueFrom(this.http.post(`${this.api}/social/${alias}/follow`, {}, { headers: this.headers() }));
      this.snack.open(r.status === 'pending' ? `Solicitud enviada a @${alias}` : `Sigues a @${alias}`, 'OK', { duration: 3000 });
      const p = this.networkFeed.find(f => f.alias === alias);
      if (p) p.is_followed = true;
    } catch { this.snack.open('Error al seguir', 'Cerrar', { duration: 3000 }); }
  }
  async unfollow(alias: string) {
    try {
      await firstValueFrom(this.http.delete(`${this.api}/social/${alias}/follow`, { headers: this.headers() }));
      this.following = this.following.filter(f => f.alias !== alias);
      this.snack.open(`Dejaste de seguir a @${alias}`, 'OK', { duration: 2000 });
    } catch { this.snack.open('Error', 'Cerrar', { duration: 3000 }); }
  }

  /* ══════════════════════════════════════════════════════════════════════
     FEED
     ══════════════════════════════════════════════════════════════════════ */

  loadFeed() {
    this.feedLoading = true;
    this.http.get<any>(`${this.api}/community/feed`, { headers: this.headers() }).subscribe({
      next: (r) => { this.posts = r.posts || []; this.feedLoading = false; },
      error: () => { this.feedLoading = false; },
    });
  }

  submitPost() {
    if (!this.newPostContent.trim()) return;
    this.posting = true;
    this.http.post(`${this.api}/community/posts`, {
      content: this.newPostContent.trim(), post_type: 'text', is_anonymous: this.newPostAnonymous,
    }, { headers: this.headers() }).subscribe({
      next: () => {
        this.newPostContent = ''; this.newPostAnonymous = false; this.posting = false;
        this.loadFeed(); this.snack.open('Post publicado 🔥', 'OK', { duration: 2000 });
      },
      error: (err) => { this.posting = false; this.snack.open(err.error?.detail || 'Error', 'Cerrar', { duration: 3000 }); },
    });
  }

  deletePost(id: string) {
    if (!confirm('¿Eliminar?')) return;
    this.http.delete(`${this.api}/community/posts/${id}`, { headers: this.headers() }).subscribe({
      next: () => this.posts = this.posts.filter(p => p.id !== id),
    });
  }

  react(postId: string, reaction: 'fire' | 'save') {
    this.http.post(`${this.api}/community/posts/${postId}/react?reaction=${reaction}`, {}, { headers: this.headers() }).subscribe({
      next: (r: any) => {
        const post = this.posts.find(p => p.id === postId);
        if (post) {
          post.fire_count = r.fire_count; post.save_count = r.save_count;
          if (r.status === 'added') post.my_reactions = [...post.my_reactions, reaction];
          else post.my_reactions = post.my_reactions.filter(x => x !== reaction);
        }
      },
    });
  }

  toggleComments(postId: string) {
    this.showComments[postId] = !this.showComments[postId];
    if (this.showComments[postId] && !this.comments[postId]) {
      this.http.get<any[]>(`${this.api}/community/posts/${postId}/comments`, { headers: this.headers() }).subscribe({
        next: (r) => this.comments[postId] = r,
      });
    }
  }
  submitComment(postId: string) {
    const text = this.commentInput[postId]?.trim();
    if (!text) return;
    this.http.post(`${this.api}/community/posts/${postId}/comments`, { content: text }, { headers: this.headers() }).subscribe({
      next: (r: any) => {
        if (!this.comments[postId]) this.comments[postId] = [];
        this.comments[postId].push(r); this.commentInput[postId] = '';
        const post = this.posts.find(p => p.id === postId);
        if (post) post.comment_count++;
      },
    });
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }

  /* ══════════════════════════════════════════════════════════════════════
     POLLS
     ══════════════════════════════════════════════════════════════════════ */

  loadPolls() {
    this.pollsLoading = true;
    this.http.get<any>(`${this.api}/community/polls`, { headers: this.headers() }).subscribe({
      next: (r) => { this.polls = r.polls || []; this.pollsLoading = false; },
      error: () => this.pollsLoading = false,
    });
  }
  addPollOption() { if (this.newPoll.options.length < 6) this.newPoll.options.push(''); }
  removePollOption(i: number) { if (this.newPoll.options.length > 2) this.newPoll.options.splice(i, 1); }

  createPoll() {
    const opts = this.newPoll.options.filter(o => o.trim());
    if (opts.length < 2 || !this.newPoll.title.trim()) { this.snack.open('Título + 2 opciones mín.', 'OK', { duration: 3000 }); return; }
    this.creatingPoll = true;
    this.http.post(`${this.api}/community/polls`, { ...this.newPoll, options: opts, symbol: this.newPoll.symbol || null }, { headers: this.headers() }).subscribe({
      next: () => {
        this.creatingPoll = false; this.showCreatePoll = false;
        this.newPoll = { title: '', poll_type: 'free', symbol: '', options: ['', ''], closes_in_hours: 48 };
        this.loadPolls(); this.snack.open('Encuesta creada 📊', 'OK', { duration: 2000 });
      },
      error: (e) => { this.creatingPoll = false; this.snack.open(e.error?.detail || 'Error', 'Cerrar', { duration: 3000 }); },
    });
  }
  votePoll(pollId: string, idx: number) {
    this.http.post(`${this.api}/community/polls/${pollId}/vote`, { option_index: idx }, { headers: this.headers() }).subscribe({
      next: () => { this.loadPolls(); this.snack.open('Voto registrado ✓', 'OK', { duration: 2000 }); },
      error: (e) => this.snack.open(e.error?.detail || 'Error', 'Cerrar', { duration: 3000 }),
    });
  }
  pollPct(poll: Poll, idx: number): number {
    const total = poll.total_votes || 1;
    return Math.round((poll.vote_counts?.[idx] || 0) / total * 100);
  }

  /* ══════════════════════════════════════════════════════════════════════
     LEADERBOARD
     ══════════════════════════════════════════════════════════════════════ */

  loadLeaderboard() {
    this.leaderLoading = true;
    this.http.get<any>(`${this.api}/community/leaderboard?ranking_type=${this.leaderType}`, { headers: this.headers() }).subscribe({
      next: (r) => { this.leaderboard = r.entries || []; this.leaderLoading = false; },
      error: () => this.leaderLoading = false,
    });
  }
  switchLeaderType(t: typeof this.leaderType) { this.leaderType = t; this.loadLeaderboard(); }
  levelIcon(l: string) { return ({'novato':'🥉','trader':'🥈','experto':'🥇','elite':'💎','leyenda':'👑'} as any)[l] || '🥉'; }

  /* ══════════════════════════════════════════════════════════════════════
     MOOD
     ══════════════════════════════════════════════════════════════════════ */

  loadMood() {
    this.moodLoading = true;
    this.http.get<MoodData>(`${this.api}/community/mood`, { headers: this.headers() }).subscribe({
      next: (r) => { this.mood = r; this.moodLoading = false; },
      error: () => this.moodLoading = false,
    });
  }
  voteMood(s: 'bull' | 'bear' | 'neutral') {
    this.http.post(`${this.api}/community/mood`, { sentiment: s }, { headers: this.headers() }).subscribe({
      next: () => { this.loadMood(); this.snack.open('Voto registrado', 'OK', { duration: 1500 }); },
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     NETWORK ACTIVITY
     ══════════════════════════════════════════════════════════════════════ */

  loadNetworkActivity() {
    this.networkLoading = true;
    this.http.get<any>(`${this.api}/community/network-activity`, { headers: this.headers() }).subscribe({
      next: (r) => { this.networkStocks = r.stocks || []; this.networkTotalUsers = r.total_users || 0; this.networkLoading = false; },
      error: () => this.networkLoading = false,
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     TOURNAMENTS
     ══════════════════════════════════════════════════════════════════════ */

  loadTournaments() {
    this.tournamentsLoading = true;
    this.http.get<Tournament[]>(`${this.api}/community/tournaments`, { headers: this.headers() }).subscribe({
      next: (r) => { this.tournaments = r || []; this.tournamentsLoading = false; },
      error: () => this.tournamentsLoading = false,
    });
  }
  joinTournament(id: string) {
    this.http.post(`${this.api}/community/tournaments/${id}/join`, {}, { headers: this.headers() }).subscribe({
      next: () => { this.loadTournaments(); this.snack.open('¡Te uniste! 🏆', 'OK', { duration: 3000 }); },
      error: (e) => this.snack.open(e.error?.detail || 'Error', 'Cerrar', { duration: 3000 }),
    });
  }
  viewStandings(id: string) {
    this.selectedTournament = this.selectedTournament === id ? null : id;
    if (!this.selectedTournament) return;
    this.standingsLoading = true;
    this.http.get<TournamentStanding[]>(`${this.api}/community/tournaments/${id}/standings`, { headers: this.headers() }).subscribe({
      next: (r) => { this.standings = r || []; this.standingsLoading = false; },
      error: () => this.standingsLoading = false,
    });
  }
}
