import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly KEY = 'cp_theme';

  isDark$ = new BehaviorSubject<boolean>(true);

  constructor() {
    const saved = localStorage.getItem(this.KEY);
    const dark = saved ? saved === 'dark' : true;
    this.isDark$.next(dark);
    this._apply(dark);
  }

  toggle(): void {
    const dark = !this.isDark$.getValue();
    this.isDark$.next(dark);
    this._apply(dark);
    localStorage.setItem(this.KEY, dark ? 'dark' : 'light');
  }

  private _apply(dark: boolean): void {
    document.body.classList.toggle('light-theme', !dark);
    document.body.classList.toggle('dark-theme', dark);
  }
}
