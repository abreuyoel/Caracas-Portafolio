import { Routes } from '@angular/router';
import { ProfileComponent } from './profile/profile.component';
import { LibrosComponent } from './libros/libros.component';


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
  { path: 'social', loadComponent: () => import('./social/social-profile.component').then(m => m.SocialProfileComponent) },
  { path: '**', redirectTo: '/auth/login' }
];