import { Routes } from '@angular/router';
import { ProfileComponent } from './profile/profile.component';
import { LibrosComponent } from './libros/libros.component';
import { ReleaseNotesComponent } from './release-notes/release-notes.component';


export const routes: Routes = [
  { path: '', loadComponent: () => import('./landing/landing.component').then(m => m.LandingComponent) },
  { path: 'auth', loadChildren: () => import('./auth/auth.module').then(m => m.AuthModule) },
  { path: 'libros', component: LibrosComponent },
  { path: 'dashboard', loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'portfolio', loadComponent: () => import('./portfolio/portfolio.component').then(m => m.PortfolioComponent) },
  { path: 'transactions', loadComponent: () => import('./transactions/transactions.component').then(m => m.TransactionsComponent) },
  { path: 'transactions/new', loadComponent: () => import('./transactions/new-transaction/new-transaction.component').then(m => m.NewTransactionComponent) },
  { path: 'goals', loadComponent: () => import('./goals/goals.component').then(m => m.GoalsComponent) },
  { path: 'settings', loadComponent: () => import('./settings/settings.component').then(m => m.SettingsComponent) },
  { path: 'ai-chat', loadComponent: () => import('./ai-chat/ai-chat.component').then(m => m.AiChatComponent) },
  { path: 'graficos', loadComponent: () => import('./graficos/graficos.component').then(m => m.GraficosComponent) },
  { path: 'profile', component: ProfileComponent },
  { path: 'social', redirectTo: '/community', pathMatch: 'full' },
  { path: 'aprende', loadComponent: () => import('./aprende/aprende.component').then(m => m.AprendeComponent) },
  { path: 'paper-trading', loadComponent: () => import('./paper-trading/paper-trading.component').then(m => m.PaperTradingComponent) },
  { path: 'montecarlo', loadComponent: () => import('./montecarlo/montecarlo.component').then(m => m.MontecarloComponent) },
  { path: 'analisis', loadComponent: () => import('./analisis/analisis.component').then(m => m.AnalisisComponent) },
  { path: 'indices-bvc', loadComponent: () => import('./indices-bvc/indices-bvc.component').then(m => m.IndicesBvcComponent) },
  { path: 'community', loadComponent: () => import('./community/community.component').then(m => m.CommunityComponent) },
  { path: 'release-notes', component: ReleaseNotesComponent },
  { path: '**', redirectTo: '/auth/login' }
];