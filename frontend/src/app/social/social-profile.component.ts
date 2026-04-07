import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { LegalModalComponent } from '../auth/legal-modal/legal-modal.component';

interface SocialProfile {
  alias: string;
  bio: string;
  avatar_url: string;
  is_public: boolean;
  show_capital_initial: boolean;
  show_current_value: boolean;
  show_pnl: boolean;
  show_transactions: boolean;
  show_holdings: boolean;
  show_top_positions: boolean;
  notify_on_transaction: boolean;
  accepted_terms: boolean;
  visible_symbols: string[];
  created_at?: string;
}

interface PublicProfile {
  alias: string;
  bio: string;
  avatar_url: string;
  is_public: boolean;
  is_followed?: boolean;
  created_at?: string;
}

@Component({
  selector: 'app-social-profile',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatSnackBarModule, MatTooltipModule, MatSlideToggleModule,
    MatCheckboxModule, MatDialogModule
  ],
  templateUrl: './social-profile.component.html',
  styleUrls: ['./social-profile.component.scss']
})
export class SocialProfileComponent implements OnInit {
  private api = environment.apiUrl;

  loading = true;
  saving  = false;

  // My profile
  profile: SocialProfile | null = null;
  form: SocialProfile = this.blankForm();

  // Edit mode
  editMode = false;
  aliasError = '';

  // Tabs: 'my-profile' | 'feed' | 'followers' | 'following'
  activeTab: 'my-profile' | 'feed' | 'followers' | 'following' = 'my-profile';

  // Network
  feed:      PublicProfile[] = [];
  followers: { alias: string; bio: string; avatar_url: string }[] = [];
  following: { alias: string; bio: string; avatar_url: string }[] = [];
  feedLoading = false;

  // Selective visibility
  allStocks: string[] = []; // Símbolos disponibles en mi portafolio

  constructor(
    private http: HttpClient, 
    private snack: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit() { this.loadMyProfile(); }

  private blankForm(): SocialProfile {
    return {
      alias: '', bio: '', avatar_url: '', is_public: false,
      show_capital_initial: false, show_current_value: false,
      show_pnl: false, show_transactions: false, show_holdings: false,
      show_top_positions: false, notify_on_transaction: false,
      accepted_terms: false, visible_symbols: []
    };
  }

  private token() { return localStorage.getItem('access_token') ?? ''; }
  private headers() { return { Authorization: `Bearer ${this.token()}` }; }

  async loadMyProfile() {
    this.loading = true;
    try {
      // Parallelizar ambas llamadas en lugar de secuenciarlas
      const [p] = await Promise.all([
        firstValueFrom(
          this.http.get<SocialProfile | null>(`${this.api}/social/me`, { headers: this.headers() })
        ),
        this.loadMyHoldings()
      ]);
      this.profile = p;
      if (p) {
        this.form = { ...p };
        if (!this.form.visible_symbols) this.form.visible_symbols = [];
      } else {
        this.editMode = true;
      }
    } catch { this.profile = null; this.editMode = true; }
    finally  { this.loading = false; }
  }

  async saveProfile() {
    this.aliasError = '';
    if (!this.form.alias.trim()) { this.aliasError = 'El alias es obligatorio'; return; }
    if (!this.form.accepted_terms && !this.profile) { 
      this.snack.open('Debes aceptar los términos y condiciones', 'Cerrar', { duration: 4000 });
      return; 
    }
    
    const aliasRe = /^[a-zA-Z0-9_.-]{3,40}$/;
    if (!aliasRe.test(this.form.alias)) {
      this.aliasError = 'Solo letras, números, _ . - (3–40 caracteres)';
      return;
    }
    this.saving = true;
    try {
      const saved = await firstValueFrom(
        this.http.put<SocialProfile>(`${this.api}/social/me`, this.form, { headers: this.headers() })
      );
      this.profile  = saved;
      this.form     = { ...saved };
      if (!this.form.visible_symbols) this.form.visible_symbols = [];
      this.editMode = false;
      this.snack.open('Perfil guardado correctamente', 'OK', { duration: 3000 });
    } catch (err: any) {
      const msg = err?.error?.detail ?? 'Error al guardar el perfil';
      this.snack.open(msg, 'Cerrar', { duration: 4000 });
    } finally { this.saving = false; }
  }

  async deleteProfile() {
    if (!confirm('¿Eliminar tu perfil de la red? Esta acción no se puede deshacer.')) return;
    try {
      await firstValueFrom(
        this.http.delete(`${this.api}/social/me`, { headers: this.headers() })
      );
      this.profile = null;
      this.form = this.blankForm();
      this.editMode = true;
      this.snack.open('Perfil eliminado', 'OK', { duration: 3000 });
    } catch {
      this.snack.open('Error al eliminar', 'Cerrar', { duration: 3000 });
    }
  }

  async loadFeed() {
    this.feedLoading = true;
    try {
      this.feed = await firstValueFrom(
        this.http.get<PublicProfile[]>(`${this.api}/social/feed`, { headers: this.headers() })
      );
    } catch { this.feed = []; }
    finally { this.feedLoading = false; }
  }

  async loadFollowers() {
    try {
      this.followers = await firstValueFrom(
        this.http.get<any[]>(`${this.api}/social/me/followers`, { headers: this.headers() })
      );
    } catch { this.followers = []; }
  }

  async loadFollowing() {
    try {
      this.following = await firstValueFrom(
        this.http.get<any[]>(`${this.api}/social/me/following`, { headers: this.headers() })
      );
    } catch { this.following = []; }
  }

  async unfollow(alias: string) {
    try {
      await firstValueFrom(
        this.http.delete(`${this.api}/social/${alias}/follow`, { headers: this.headers() })
      );
      this.following = this.following.filter(f => f.alias !== alias);
      this.snack.open(`Dejaste de seguir a @${alias}`, 'OK', { duration: 2000 });
    } catch { this.snack.open('Error al dejar de seguir', 'Cerrar', { duration: 3000 }); }
  }

  async follow(alias: string) {
    try {
      const r: any = await firstValueFrom(
        this.http.post(`${this.api}/social/${alias}/follow`, {}, { headers: this.headers() })
      );
      const msg = r.status === 'pending'
        ? `Solicitud enviada a @${alias} (perfil privado)`
        : `Ahora sigues a @${alias}`;
      this.snack.open(msg, 'OK', { duration: 3000 });
      
      const p = this.feed.find(f => f.alias === alias);
      if (p) p.is_followed = true;
    } catch { this.snack.open('Error al seguir', 'Cerrar', { duration: 3000 }); }
  }

  selectTab(tab: 'my-profile' | 'feed' | 'followers' | 'following') {
    this.activeTab = tab;
    if (tab === 'feed')      this.loadFeed();
    if (tab === 'followers') this.loadFollowers();
    if (tab === 'following') this.loadFollowing();
  }

  avatarLetter(alias: string) { return alias?.[0]?.toUpperCase() ?? '?'; }

  toggleStock(symbol: string) {
    const idx = this.form.visible_symbols.indexOf(symbol);
    if (idx > -1) {
      this.form.visible_symbols.splice(idx, 1);
    } else {
      this.form.visible_symbols.push(symbol);
    }
  }

  isStockVisible(symbol: string): boolean {
    return this.form.visible_symbols?.includes(symbol) ?? false;
  }
  
  async loadMyHoldings() {
    try {
      const data: any = await firstValueFrom(
        this.http.get(`${this.api}/portfolio/analytics`, { headers: this.headers() })
      );
      this.allStocks = data.performance.map((p: any) => p.symbol);
    } catch {
      this.allStocks = [];
    }
  }

  showTerms(event: Event) {
    event.preventDefault();
    this.dialog.open(LegalModalComponent, { data: { type: 'terms' }, maxWidth: '600px' });
  }

  showPrivacy(event: Event) {
    event.preventDefault();
    this.dialog.open(LegalModalComponent, { data: { type: 'privacy' }, maxWidth: '600px' });
  }
}
