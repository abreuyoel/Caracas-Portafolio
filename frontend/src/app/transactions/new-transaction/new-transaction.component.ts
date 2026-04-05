import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule, FormArray } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

interface StockOption {
  symbol: string;
  name: string;
  is_active: boolean;
}

const BVC_BROKERAGES = [
  'VALORES VENCRED CASA DE BOLSA, S.A.',
  'GRUPO BURSATIL VENEZOLANO CASA DE BOLSA, C.A',
  'ACTIVALORES CASA DE BOLSA S.A.',
  'AGRONET VALORES CASA DE BOLSA C.A.',
  'MERCANTIL MERINVEST, CASA DE BOLSA, C.A.',
  'PLATINUM CASA DE BOLSA, C.A.',
  'ACCIONA CASA DE BOLSA, S.A.',
  'CAJA CARACAS CASA DE BOLSA, C.A.',
  'INTERBURSA CASA DE BOLSA, C.A.',
  'FINANCORP VALORES CASA DE BOLSA, C.A.',
  'KAIZEN CASA DE BOLSA C.A.',
  'FIVENCA CASA DE BOLSA, C.A.',
  'PER CAPITAL SOCIEDAD DE CORRETAJE DE VALORES, C.A.',
  'INCORP CASA DE BOLSA, C.A.',
  'MULTIPLICAS CASA DE BOLSA, C.A',
  'MERCOSUR CASA DE BOLSA, S.A.',
  'INTERGLOBAL CASA DE BOLSA, C.A.',
  'MAXIMIZA CASA DE BOLSA, C.A.',
  'SOLFIN CASA DE BOLSA, C.A.',
  'INTERBONO CASA DE BOLSA, C.A.',
  'INVERAMIGA CASA DE BOLSA, C.A.',
  'RATIO CASA DE BOLSA, C.A.',
  'RENDIVALORES CASA DE BOLSA. C.A.',
  'CUADRA CASA DE BOLSA, S.A.',
  'HLB VALORES CASA DE BOLSA, C.A.',
  'MASVALOR CASA DE BOLSA, S.A.',
  'KOI INVEST CASA DE BOLSA, C.A.',
  'MULTIVALORES CASA DE BOLSA C.A.',
  'KAIROS VALORES CASA DE BOLSA, C.A.',
  'GRUPO ITALCAPITAL CASA DE BOLSA, C.A.',
  'BNCI CASA DE BOLSA, C.A.',
  'SUMA CASA DE BOLSA, C.A.',
  'WORLD TRADING CASA DE BOLSA, C.A.',
  'INVERCAPITAL CASA DE BOLSA, S.A.',
];



@Component({
  selector: 'app-new-transaction',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    MatCardModule,
    MatToolbarModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatCheckboxModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule
  ],
  template: `
    <div class="transaction-container">
      <div class="bg-blob blob-1"></div>
      <div class="bg-blob blob-2"></div>

      <!-- Top Toolbar -->
      <nav class="premium-nav">
        <button class="back-btn" routerLink="/transactions" matTooltip="Volver a lista">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <span class="nav-title">{{ editId ? 'Editar Transacción #' + editId : 'Registrar Operación' }}</span>
        <button class="calc-btn" (click)="calculateAll()" matTooltip="Recalcular montos">
          <mat-icon>functions</mat-icon> Calcular
        </button>
      </nav>

      <div class="layout-grid">
        <!-- Left Column: receipt / summary -->
        <div class="receipt-panel">
          <div class="receipt-glass">
            <div class="receipt-header">
              <div class="rcpt-icon">📈</div>
              <h3>Resumen de la Operación</h3>
              <p class="rcpt-sub">Vista previa en tiempo real</p>
            </div>
            
            <div class="rcpt-body">
              <div class="rcpt-row">
                <span class="rcpt-label">Acción</span>
                <span class="rcpt-val hl-sym">{{ transactionForm.get('stock_symbol')?.value || '---' }}</span>
              </div>
              <div class="rcpt-row">
                <span class="rcpt-label">Tipo</span>
                <span class="rcpt-val" [class.txt-buy]="transactionForm.get('order_type')?.value === 'Compra'" [class.txt-sell]="transactionForm.get('order_type')?.value === 'Venta'">
                  {{ transactionForm.get('order_type')?.value || '---' }}
                </span>
              </div>
              <div class="rcpt-row">
                <span class="rcpt-label">Cantidad</span>
                <span class="rcpt-val">{{ transactionForm.get('quantity')?.value || 0 | number }}</span>
              </div>
              <div class="rcpt-row">
                <span class="rcpt-label">Monto Bruto</span>
                <span class="rcpt-val">{{ transactionForm.get('gross_amount')?.value || 0 | number:'1.2-2' }} Bs</span>
              </div>
              
              <div class="rcpt-divider"></div>
              
              <div class="rcpt-row rcpt-fee">
                <span class="rcpt-label">Comisiones y Cargos</span>
                <span class="rcpt-val">{{ ((transactionForm.get('commission')?.value || 0) + (transactionForm.get('iva')?.value || 0) + (transactionForm.get('registry_fee')?.value || 0)) | number:'1.2-2' }} Bs</span>
              </div>
            </div>

            <div class="rcpt-footer">
              <div class="rcpt-total-lbl">Total Neto (Bs)</div>
              <div class="rcpt-total-val">{{ transactionForm.get('net_amount')?.value || 0 | number:'1.2-2' }}</div>
              
              <div class="rcpt-usd-box" *ngIf="transactionForm.get('amount_usd')?.value">
                <span class="usd-icon">💵</span>
                <span>≈ {{ transactionForm.get('amount_usd')?.value | currency:'USD':'symbol':'1.2-2' }}</span>
                <span class="rate-tag">Tasa: {{ transactionForm.get('bcv_rate')?.value }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Column: Form -->
        <div class="form-panel">
          <form [formGroup]="transactionForm" (ngSubmit)="onSubmit()" class="premium-form">
            
            <div class="form-card">
              <h2 class="card-title">1. Datos Generales</h2>
              <div class="grid-2">
                <div class="control-group">
                  <label>Tipo de Operación</label>
                  <mat-form-field appearance="outline" class="clean-field">
                    <mat-select formControlName="order_type" panelClass="dark-select-panel">
                      <mat-option value="Compra">🟢 Compra</mat-option>
                      <mat-option value="Venta">🔴 Venta</mat-option>
                    </mat-select>
                  </mat-form-field>
                </div>
                <div class="control-group">
                  <label>Acción / Símbolo</label>
                  <mat-form-field appearance="outline" class="clean-field">
                    <mat-select formControlName="stock_symbol" panelClass="dark-select-panel stock-select-panel" (selectionChange)="onStockSelected($event)">
                      <div class="stock-search-wrap" (click)="$event.stopPropagation()">
                        <mat-icon class="stock-search-icon">search</mat-icon>
                        <input class="stock-search-input" [ngModelOptions]="{standalone: true}" [(ngModel)]="stockInfoFilter" placeholder="Buscar acción...">
                      </div>
                      <mat-option value="" disabled *ngIf="loadingStocks">Cargando...</mat-option>
                      <mat-option *ngFor="let stock of filteredStocks" [value]="stock.symbol">
                        <strong>{{ stock.symbol }}</strong><span class="opt-sub"> - {{ stock.name | slice:0:30 }}</span>
                      </mat-option>
                    </mat-select>
                  </mat-form-field>
                </div>
              </div>

              <div class="grid-2 mt-4">
                <div class="control-group">
                  <label>Casa de Bolsa</label>
                  <mat-form-field appearance="outline" class="clean-field">
                    <mat-select formControlName="brokerage" panelClass="dark-select-panel stock-select-panel">
                      <div class="stock-search-wrap" (click)="$event.stopPropagation()">
                        <mat-icon class="stock-search-icon">search</mat-icon>
                        <input class="stock-search-input" [ngModelOptions]="{standalone: true}" [(ngModel)]="brokerageFilter" placeholder="Buscar...">
                      </div>
                      <mat-option *ngFor="let b of filteredBrokerages" [value]="b">{{ b }}</mat-option>
                    </mat-select>
                  </mat-form-field>
                </div>
                <div class="control-group">
                  <label>Fecha</label>
                  <input type="date" formControlName="transaction_date" class="custom-input input-date">
                </div>
              </div>
            </div>

            <div class="form-card">
              <h2 class="card-title">2. Detalles de Ejecución</h2>
              <div class="grid-2">
                <div class="control-group">
                  <label>Tipo Solicitud</label>
                  <mat-form-field appearance="outline" class="clean-field">
                    <mat-select formControlName="request_type" panelClass="dark-select-panel">
                      <mat-option value="Mercado">Mercado</mat-option>
                      <mat-option value="Limite">Límite</mat-option>
                    </mat-select>
                  </mat-form-field>
                </div>
                <div class="control-group">
                  <label>N° Orden (Opc.)</label>
                  <input type="text" formControlName="order_number" class="custom-input" placeholder="Ej: 145982">
                </div>
              </div>

              <div *ngIf="transactionForm.get('request_type')?.value === 'Mercado'" class="slippage-toggle mt-4">
                <label class="custom-checkbox-wrap">
                  <input type="checkbox" formControlName="slippage_enabled">
                  <span class="custom-chk-text">Ejecutada en múltiples partes (Slippage)</span>
                </label>
              </div>

              <div *ngIf="!slippageEnabled" class="grid-2 mt-4">
                <div class="control-group">
                  <label>Cantidad de Acciones</label>
                  <input type="number" formControlName="quantity" class="custom-input" placeholder="0">
                </div>
                <div class="control-group">
                  <label>Precio Unitario (Bs)</label>
                  <input type="number" formControlName="avg_price" class="custom-input" placeholder="0.00" step="0.0001">
                </div>
              </div>

              <div *ngIf="slippageEnabled" class="slippage-box mt-4">
                <div class="slip-hdr">
                  <span>Partes Ejecutadas</span>
                  <button type="button" class="btn-micro" (click)="addSlippageEntry()">+ Añadir</button>
                </div>
                <div formArrayName="slippage_entries" class="slip-list">
                  <div *ngFor="let entry of slippageEntries.controls; let i = index" [formGroupName]="i" class="slip-row">
                    <input type="number" formControlName="quantity" class="custom-input" placeholder="Cant.">
                    <input type="number" formControlName="price" class="custom-input" placeholder="Precio (Bs)">
                    <button type="button" class="btn-del" (click)="removeSlippageEntry(i)"><mat-icon>close</mat-icon></button>
                  </div>
                </div>
              </div>
            </div>

            <div class="form-card">
              <h2 class="card-title">3. Cargos y Comisiones</h2>
              <div class="grid-3">
                <div class="control-group">
                  <label>Comisión (Bs)</label>
                  <input type="number" formControlName="commission" class="custom-input" placeholder="0.00">
                </div>
                <div class="control-group">
                  <label>IVA (Bs)</label>
                  <input type="number" formControlName="iva" class="custom-input" placeholder="0.00">
                </div>
                <div class="control-group">
                  <label>Registro (Bs)</label>
                  <input type="number" formControlName="registry_fee" class="custom-input" placeholder="0.00">
                </div>
              </div>
            </div>

            <div class="form-card">
              <h2 class="card-title">4. Tasa de Cambio (BCV)</h2>
              <div class="grid-2 align-bottom">
                <div class="control-group">
                  <label>Tasa Bs/$ (auto-calculada) <mat-icon class="sm-icon" matTooltip="La tasa se buscará al seleccionar la fecha.">info</mat-icon></label>
                  <input type="number" formControlName="bcv_rate" class="custom-input highlight-inp" placeholder="0.0000">
                </div>
                <div class="control-group">
                  <label>Total USD ($)</label>
                  <input type="number" formControlName="amount_usd" class="custom-input readonly-inp" readonly>
                </div>
              </div>
            </div>

            <div class="form-actions-bar">
              <button type="button" class="btn-cancel" routerLink="/transactions">Cancelar</button>
              <button type="submit" class="btn-submit" [disabled]="transactionForm.invalid || loading">
                {{ loading ? 'Procesando...' : (editId ? 'Guardar Cambios' : 'Registrar Operación') }}
                <mat-icon *ngIf="!loading">arrow_forward</mat-icon>
              </button>
            </div>

          </form>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      --bg-deep: #050810;
      --primary: #4c62ff;
      --primary-l: #6b80ff;
      --accent: #00e5c3;
      --up: #2DD994;
      --dn: #FF4D6A;
      --glass-bg: rgba(18, 25, 43, 0.65);
      --glass-border: rgba(255, 255, 255, 0.08);
      --glass-border-hi: rgba(76, 98, 255, 0.4);
      --text-1: #ffffff;
      --text-2: rgba(255, 255, 255, 0.7);
      --radius: 20px;
    }

    .transaction-container {
      min-height: 100vh;
      background: var(--bg-deep);
      font-family: 'Space Grotesk', sans-serif;
      position: relative;
      overflow: hidden;
      color: var(--text-1);
    }

    .bg-blob {
      position: absolute;
      border-radius: 50%;
      filter: blur(100px);
      z-index: 0;
      opacity: 0.15;
    }
    .blob-1 { width: 600px; height: 600px; background: var(--primary); top: -200px; left: -100px; }
    .blob-2 { width: 500px; height: 500px; background: var(--accent); bottom: -100px; right: -100px; }

    .premium-nav {
      position: relative;
      z-index: 10;
      display: flex;
      align-items: center;
      padding: 0 40px;
      height: 72px;
      background: rgba(5, 8, 16, 0.4);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--glass-border);
    }

    .back-btn {
      background: transparent; color: var(--text-2); border: none; font-size: 24px; cursor: pointer; transition: 0.2s;
    }
    .back-btn:hover { color: #fff; transform: translateX(-4px); }

    .nav-title { margin-left: 16px; font-weight: 700; font-size: 1.1rem; flex-grow: 1; opacity: 0.9; }

    .calc-btn {
      background: rgba(76, 98, 255, 0.15);
      border: 1px solid rgba(76, 98, 255, 0.3);
      color: var(--primary-l);
      padding: 8px 18px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      cursor: pointer;
      font-family: 'Space Grotesk';
      transition: all 0.2s;
    }
    .calc-btn:hover { background: rgba(76, 98, 255, 0.25); color: #fff; border-color: var(--primary-l); }
    .calc-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .layout-grid {
      position: relative;
      z-index: 10;
      max-width: 1200px;
      margin: 40px auto;
      padding: 0 24px;
      display: grid;
      grid-template-columns: 340px 1fr;
      gap: 32px;
    }

    @media(max-width: 900px) {
      .layout-grid { grid-template-columns: 1fr; max-width: 600px; }
    }

    /* Left panel */
    .receipt-panel { position: sticky; top: 100px; align-self: start; }
    
    .receipt-glass {
      background: var(--glass-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      padding: 28px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.4);
    }

    .receipt-header { text-align: center; margin-bottom: 24px; }
    .rcpt-icon { font-size: 2.5rem; margin-bottom: 8px; }
    .receipt-header h3 { font-size: 1.3rem; margin: 0; font-weight: 700; }
    .rcpt-sub { margin: 4px 0 0; font-size: 0.85rem; color: var(--text-2); }

    .rcpt-body { display: flex; flex-direction: column; gap: 14px; }
    .rcpt-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.95rem; }
    .rcpt-label { color: var(--text-2); }
    .rcpt-val { font-weight: 600; font-family: 'JetBrains Mono', monospace; }
    .hl-sym { color: var(--primary-l); font-size: 1.1rem; }
    .txt-buy { color: var(--up); }
    .txt-sell { color: var(--dn); }

    .rcpt-divider { height: 1px; background: var(--glass-border); margin: 6px 0; }
    .rcpt-fee .rcpt-label { font-size: 0.85rem; }
    .rcpt-fee .rcpt-val { font-size: 0.85rem; opacity: 0.8; }

    .rcpt-footer {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px dashed rgba(255,255,255,0.2);
    }
    .rcpt-total-lbl { font-size: 0.85rem; color: var(--text-2); text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
    .rcpt-total-val { font-size: 2.2rem; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--accent); margin-top: 4px; }

    .rcpt-usd-box {
      margin-top: 16px;
      background: rgba(0, 229, 195, 0.08);
      border: 1px solid rgba(0, 229, 195, 0.2);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.9rem;
      font-weight: 600;
      color: rgba(0, 229, 195, 0.9);
    }
    .usd-icon { font-size: 1.2rem; }
    .rate-tag { margin-left: auto; font-size: 0.75rem; background: rgba(0,229,195,0.2); padding: 2px 6px; border-radius: 4px; }

    /* Right panel (Form) */
    .premium-form { display: flex; flex-direction: column; gap: 24px; }
    
    .form-card {
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 24px;
      transition: border-color 0.3s;
    }
    .form-card:hover { border-color: rgba(255,255,255,0.1); }

    .card-title { font-size: 1.1rem; color: #fff; margin: 0 0 20px; font-weight: 600; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
    .card-title::before { content: ''; width: 4px; height: 16px; background: var(--primary); border-radius: 2px; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
    .mt-4 { margin-top: 20px; }
    .align-bottom { align-items: flex-end; }
    
    @media(max-width: 600px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } }

    .control-group { display: flex; flex-direction: column; gap: 8px; }
    .control-group label { font-size: 0.85rem; color: var(--text-2); font-weight: 500; display:flex; align-items:center; }
    .sm-icon { font-size: 16px; width: 16px; height: 16px; margin-left: 6px; opacity: 0.6; }

    /* Custom Inputs */
    .custom-input {
      background: rgba(0,0,0,0.2) !important;
      border: 1px solid rgba(255,255,255,0.1) !important;
      border-radius: 8px !important;
      color: #fff !important;
      padding: 12px 14px !important;
      font-size: 0.95rem !important;
      font-family: inherit !important;
      outline: none !important;
      transition: all 0.2s !important;
      width: 100%; box-sizing: border-box;
      height: 48px;
    }
    .custom-input:focus { border-color: var(--primary-l) !important; box-shadow: 0 0 0 3px rgba(76,98,255,0.15) !important; }
    .custom-input::placeholder { color: rgba(255,255,255,0.2) !important; }

    .highlight-inp { border-color: rgba(0,229,195,0.3) !important; background: rgba(0,229,195,0.03) !important; }
    .readonly-inp { opacity: 0.7; pointer-events: none; }
    .input-date { color-scheme: dark; }

    /* Custom Material Field using Form Field to prevent collapse */
    ::ng-deep .clean-field {
      width: 100%;
    }
    ::ng-deep .clean-field .mat-mdc-text-field-wrapper {
      background: rgba(0,0,0,0.2) !important;
      border-radius: 8px !important;
      height: 48px !important;
    }
    ::ng-deep .clean-field .mdc-notched-outline__leading,
    ::ng-deep .clean-field .mdc-notched-outline__notch,
    ::ng-deep .clean-field .mdc-notched-outline__trailing {
      border-top: none !important; border-bottom: none !important; border-right: none !important; border-left: none !important;
    }
    ::ng-deep .clean-field .mat-mdc-text-field-wrapper {
      border: 1px solid rgba(255, 255, 255, 0.1) !important;
    }
    ::ng-deep .clean-field.mat-focused .mat-mdc-text-field-wrapper {
      border-color: var(--primary-l) !important;
      box-shadow: 0 0 0 3px rgba(76,98,255,0.15) !important;
    }
    ::ng-deep .clean-field .mat-mdc-select-value { color: #fff !important; }
    ::ng-deep .clean-field .mat-mdc-select-arrow { color: rgba(255,255,255,0.5) !important; }
    ::ng-deep .clean-field .mat-mdc-form-field-flex { height: 48px !important; align-items: center; padding: 0 14px !important; }
    ::ng-deep .clean-field .mat-mdc-form-field-infix { padding-top: 0 !important; padding-bottom: 0 !important; border-top: none !important; }
    ::ng-deep .clean-field .mat-mdc-form-field-subscript-wrapper { display: none !important; }
    
    .opt-sub { font-size: 0.8em; opacity: 0.6; font-weight: normal; }

    /* Custom native checkbox to avoid material rendering issues */
    .custom-checkbox-wrap {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      color: var(--text-2);
      font-size: 0.95rem;
      user-select: none;
    }
    .custom-checkbox-wrap input[type="checkbox"] {
      appearance: none;
      width: 20px;
      height: 20px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.2);
      cursor: pointer;
      position: relative;
      transition: all 0.2s;
    }
    .custom-checkbox-wrap input[type="checkbox"]:checked {
      background: var(--primary);
      border-color: var(--primary);
    }
    .custom-checkbox-wrap input[type="checkbox"]:checked::after {
      content: '';
      position: absolute;
      left: 6px; top: 2px;
      width: 4px; height: 10px;
      border: solid white;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .custom-checkbox-wrap:hover input[type="checkbox"] { border-color: var(--primary-l); }
    .custom-chk-text { margin-top: 1px; }

    /* Inner Search */
    .stock-search-wrap { display: flex; align-items: center; padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2); }
    .stock-search-wrap mat-icon { font-size: 20px; color: rgba(255,255,255,0.4); margin-right: 8px; }
    .stock-search-input { border: none; background: transparent; color: #fff; width: 100%; outline: none; font-size: 0.9rem; }

    /* Slippage */
    .slippage-box { padding: 16px; background: rgba(255,0,0,0.03); border: 1px dashed rgba(255,255,255,0.1); border-radius: 8px; }
    .slip-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 0.85rem; color: var(--text-2); }
    .btn-micro { background: rgba(76,98,255,0.15); border: 1px solid var(--primary); color: #fff; padding: 4px 10px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; }
    .slip-list { display: flex; flex-direction: column; gap: 10px; }
    .slip-row { display: flex; gap: 10px; }
    .btn-del { background: rgba(255,77,106,0.15); color: var(--dn); border: none; border-radius: 4px; width: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .btn-del:hover { background: var(--dn); color: #fff; }

    /* Bottom actions */
    .form-actions-bar {
      display: flex;
      justify-content: flex-end;
      gap: 16px;
      margin-top: 10px;
    }
    .btn-cancel {
      background: transparent;
      border: 1px solid var(--glass-border);
      color: var(--text-2);
      padding: 14px 28px;
      border-radius: 12px;
      font-size: 1rem;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-cancel:hover { background: rgba(255,255,255,0.05); color: #fff; }
    
    .btn-submit {
      background: linear-gradient(135deg, var(--primary), #8b5cf6);
      border: none;
      color: #fff;
      padding: 14px 32px;
      border-radius: 12px;
      font-size: 1rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 8px 24px rgba(76,98,255,0.3);
      transition: all 0.25s;
    }
    .btn-submit:hover:not(:disabled) { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(76,98,255,0.5); }
    .btn-submit:disabled { opacity: 0.6; cursor: not-allowed; filter: grayscale(50%); }
  `]
})
export class NewTransactionComponent implements OnInit {
  transactionForm: FormGroup;
  loading = false;
  loadingStocks = false;
  loadingBrokerages = false;
  loadingRate = false;
  stocks: StockOption[] = [];
  editId: number | null = null;
  brokerageFilter = '';
  stockInfoFilter = '';
  readonly allBrokerages = BVC_BROKERAGES;
  private bcvRates: Record<string, number> = {};

  get filteredBrokerages() {
    if (!this.brokerageFilter) return this.allBrokerages;
    const q = this.brokerageFilter.toLowerCase();
    return this.allBrokerages.filter(b => b.toLowerCase().includes(q));
  }

  get filteredStocks() {
    if (!this.stockInfoFilter) return this.stocks;
    const q = this.stockInfoFilter.toLowerCase();
    return this.stocks.filter(s => 
      s.symbol.toLowerCase().includes(q) || 
      s.name.toLowerCase().includes(q)
    );
  }

  get bcvMinDate(): string {
    const dates = Object.keys(this.bcvRates).sort();
    return dates.length > 0 ? dates[0] : '2020-01-01';
  }

  get bcvMaxDate(): string {
    const dates = Object.keys(this.bcvRates).sort();
    return dates.length > 0 ? dates[dates.length - 1] : new Date().toISOString().split('T')[0];
  }

  private apiUrl = environment.apiUrl;

  constructor(
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private router: Router,
    private http: HttpClient,
    private route: ActivatedRoute
  ) {
    this.transactionForm = this.fb.group({
      order_type: ['Compra', Validators.required],
      request_type: ['Mercado', Validators.required],
      stock_symbol: ['', Validators.required],
      quantity: ['', [Validators.required, Validators.min(1)]],
      avg_price: ['', [Validators.min(0)]], // optional if slippage enabled
      gross_amount: [{ value: '', disabled: true }],
      commission: [''],
      iva: [''],
      registry_fee: [''],
      net_amount: [{ value: '', disabled: true }],
      bcv_rate: [''],
      amount_usd: [{ value: '', disabled: true }],
      transaction_date: [new Date().toISOString().split('T')[0], Validators.required],
      order_number: [''],
      brokerage: [''],
      notes: [''],
      slippage_enabled: [false],
      slippage_entries: this.fb.array([])
    });

    // Escuchar cambios en quantity y slippage_enabled
    this.transactionForm.get('quantity')?.valueChanges.subscribe(() => this.calculateAll());
    this.transactionForm.get('slippage_enabled')?.valueChanges.subscribe(enabled => {
      if (enabled) {
        this.transactionForm.get('avg_price')?.clearValidators();
        this.transactionForm.get('avg_price')?.updateValueAndValidity();
        // Si no hay entradas, agregar una por defecto
        if (this.slippageEntries.length === 0) {
          this.addSlippageEntry();
        }
      } else {
        this.transactionForm.get('avg_price')?.setValidators([Validators.required, Validators.min(0)]);
        this.transactionForm.get('avg_price')?.updateValueAndValidity();
        // Limpiar entradas
        while (this.slippageEntries.length) {
          this.slippageEntries.removeAt(0);
        }
      }
      this.calculateAll();
    });

    // Escuchar cambios en los campos de slippage
    this.transactionForm.get('slippage_entries')?.valueChanges.subscribe(() => this.calculateAll());

    // Escuchar cambios para recálculo automático
    this.transactionForm.get('commission')?.valueChanges.subscribe(() => this.calculateAll());
    this.transactionForm.get('iva')?.valueChanges.subscribe(() => this.calculateAll());
    this.transactionForm.get('registry_fee')?.valueChanges.subscribe(() => this.calculateAll());
    this.transactionForm.get('bcv_rate')?.valueChanges.subscribe(() => this.calculateAll());

    // Auto-rellenar tasa BCV al cambiar la fecha (siempre, no solo si vacío)
    this.transactionForm.get('transaction_date')?.valueChanges.subscribe(date => {
      if (date && Object.keys(this.bcvRates).length > 0) {
        this.autoFillRateForDate(date, true);
      }
    });
  }

  ngOnInit(): void {
    this.loadStocks();
    this.loadBcvRates();
    this.route.queryParams.subscribe(params => {
      if (params['edit']) {
        this.editId = parseInt(params['edit'], 10);
        this.loadTransactionForEdit(this.editId);
      }
    });
  }

  async loadBcvRates(): Promise<void> {
    try {
      const token = localStorage.getItem('access_token');
      const rates = await firstValueFrom(this.http.get<Record<string, number>>(
        `${this.apiUrl}/stocks/bcv-rates`,
        { headers: { Authorization: `Bearer ${token}` } }
      ));
      this.bcvRates = rates || {};
      // Auto-rellenar con la fecha actual al cargar
      const currentDate = this.transactionForm.get('transaction_date')?.value;
      if (currentDate) this.autoFillRateForDate(currentDate);
    } catch (error) {
      console.error('Error loading BCV rates:', error);
    }
  }

  private autoFillRateForDate(date: string, force = false): void {
    // Solo auto-rellena si el campo está vacío, o si force=true (al cambiar la fecha)
    const existing = this.transactionForm.get('bcv_rate')?.value;
    if (existing && !force) return;

    const rate = this.findRateForDate(date);
    if (rate) {
      this.transactionForm.patchValue({ bcv_rate: rate }, { emitEvent: false });
      this.calculateAll();
    }
  }

  private findRateForDate(date: string): number | null {
    if (this.bcvRates[date]) return this.bcvRates[date];
    // Buscar la fecha más cercana anterior
    const dates = Object.keys(this.bcvRates).sort();
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] <= date) return this.bcvRates[dates[i]];
    }
    // Si no hay fecha anterior, tomar la más cercana posterior
    return dates.length > 0 ? this.bcvRates[dates[0]] : null;
  }

  async loadTransactionForEdit(id: number): Promise<void> {
    try {
      const token = localStorage.getItem('access_token');
      const tx = await firstValueFrom(this.http.get<any>(
        `${this.apiUrl}/transactions/${id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      ));

      if (!tx) return;

      this.transactionForm.patchValue({
        order_type: tx.order_type,
        request_type: tx.request_type || 'Mercado',
        stock_symbol: tx.stock_symbol,
        quantity: tx.quantity,
        avg_price: tx.avg_price,
        gross_amount: tx.gross_amount,
        commission: tx.commission,
        iva: tx.iva,
        registry_fee: tx.registry_fee,
        net_amount: tx.net_amount,
        bcv_rate: tx.bcv_rate,
        amount_usd: tx.amount_usd,
        transaction_date: tx.transaction_date,
        order_number: tx.order_number,
        brokerage: tx.brokerage,
        notes: tx.notes
      });
    } catch (error) {
      console.error('Error loading transaction for edit:', error);
      this.snackBar.open('Error al cargar la transacción', 'Cerrar', { duration: 3000 });
    }
  }

  // Getters
  get slippageEnabled(): boolean {
    return this.transactionForm.get('slippage_enabled')?.value || false;
  }

  get slippageEntries(): FormArray {
    return this.transactionForm.get('slippage_entries') as FormArray;
  }

  get mainQuantity(): number {
    return Number(this.transactionForm.get('quantity')?.value) || 0;
  }

  get totalSlippageQuantity(): number {
    let total = 0;
    for (const entry of this.slippageEntries.controls) {
      total += Number(entry.get('quantity')?.value) || 0;
    }
    return total;
  }

  // Cargar acciones
  async loadStocks(): Promise<void> {
    this.loadingStocks = true;
    try {
      const token = localStorage.getItem('access_token');
      const response = await firstValueFrom(this.http.get<StockOption[]>(
        `${this.apiUrl}/stocks/bvc/active`,
        { headers: { Authorization: `Bearer ${token}` } }
      ));
      this.stocks = response || [];
    } catch (error) {
      console.error('Error loading stocks:', error);
      this.snackBar.open('Error al cargar acciones', 'Cerrar', { duration: 3000 });
    } finally {
      this.loadingStocks = false;
    }
  }

  async refreshStocks(): Promise<void> {
    this.loadingStocks = true;
    try {
      const token = localStorage.getItem('access_token');
      await firstValueFrom(this.http.post(`${this.apiUrl}/stocks/bvc/refresh`, {}, { headers: { Authorization: `Bearer ${token}` } }));
      await this.loadStocks();
      this.snackBar.open('✅ Lista de acciones actualizada', 'Cerrar', { duration: 2000 });
    } catch (error) {
      console.error('Error refreshing stocks:', error);
      this.snackBar.open('Error al actualizar acciones', 'Cerrar', { duration: 3000 });
    } finally {
      this.loadingStocks = false;
    }
  }

  

  

  onStockSelected(event: any): void {
    const selectedSymbol = event.value;
    console.log('Stock selected:', selectedSymbol);
  }

  // Slippage management
  addSlippageEntry(): void {
    const entry = this.fb.group({
      quantity: ['', [Validators.required, Validators.min(1)]],
      price: ['', [Validators.required, Validators.min(0.0001)]]
    });
    this.slippageEntries.push(entry);
  }

  removeSlippageEntry(index: number): void {
    this.slippageEntries.removeAt(index);
  }

  calculateAll(): void {
    const quantity = this.mainQuantity;
    let grossAmount = 0;
    let avgPrice = 0;

    if (this.slippageEnabled && this.slippageEntries.length > 0) {
      // Calcular promedio ponderado y monto bruto desde las entradas
      let totalQty = 0;
      let totalValue = 0;
      for (const entry of this.slippageEntries.controls) {
        const qty = Number(entry.get('quantity')?.value) || 0;
        const price = Number(entry.get('price')?.value) || 0;
        totalQty += qty;
        totalValue += qty * price;
      }
      grossAmount = totalValue;
      avgPrice = totalQty > 0 ? totalValue / totalQty : 0;

      // Actualizar campo avg_price (readonly)
      this.transactionForm.patchValue({ avg_price: avgPrice.toFixed(6) }, { emitEvent: false });
    } else {
      // Sin slippage: usar quantity y avg_price directamente
      const avgPriceManual = Number(this.transactionForm.get('avg_price')?.value) || 0;
      grossAmount = quantity * avgPriceManual;
      avgPrice = avgPriceManual;
    }

    // Montos adicionales
    const commission = Number(this.transactionForm.get('commission')?.value) || 0;
    const iva = Number(this.transactionForm.get('iva')?.value) || 0;
    const registryFee = Number(this.transactionForm.get('registry_fee')?.value) || 0;
    const bcvRate = Number(this.transactionForm.get('bcv_rate')?.value) || 0;

    const netAmount = grossAmount + commission + iva + registryFee;
    const amountUsd = bcvRate > 0 ? netAmount / bcvRate : 0;

    this.transactionForm.patchValue({
      gross_amount: grossAmount.toFixed(2),
      net_amount: netAmount.toFixed(2),
      amount_usd: amountUsd.toFixed(6)
    }, { emitEvent: false });
  }

  resetForm(): void {
    this.transactionForm.reset({
      order_type: 'Compra',
      request_type: 'Mercado',
      transaction_date: new Date().toISOString().split('T')[0],
      commission: '',
      iva: '',
      registry_fee: '',
      brokerage: '',
      slippage_enabled: false
    });
    while (this.slippageEntries.length) {
      this.slippageEntries.removeAt(0);
    }
  }

  async onSubmit(): Promise<void> {
    // Validaciones adicionales para slippage
    if (this.slippageEnabled) {
      if (this.totalSlippageQuantity !== this.mainQuantity) {
        this.snackBar.open(`La suma de las cantidades de slippage (${this.totalSlippageQuantity}) debe ser igual a la cantidad total (${this.mainQuantity})`, 'Cerrar', { duration: 5000 });
        return;
      }
      if (this.slippageEntries.length === 0) {
        this.snackBar.open('Debe agregar al menos una ejecución parcial', 'Cerrar', { duration: 3000 });
        return;
      }
    }

    if (this.transactionForm.valid && !this.loading) {
      this.loading = true;

      const formValue = this.transactionForm.getRawValue();
      // Construir payload
      const payload: any = {
        stock_symbol: formValue.stock_symbol.toUpperCase(),
        order_type: formValue.order_type,
        request_type: formValue.request_type,
        quantity: formValue.quantity,
        avg_price: formValue.avg_price,
        gross_amount: parseFloat(formValue.gross_amount) || 0,
        commission: parseFloat(formValue.commission) || 0,
        iva: parseFloat(formValue.iva) || 0,
        registry_fee: parseFloat(formValue.registry_fee) || 0,
        net_amount: parseFloat(formValue.net_amount) || 0,
        bcv_rate: formValue.bcv_rate ? parseFloat(formValue.bcv_rate) : null,
        amount_usd: formValue.amount_usd ? parseFloat(formValue.amount_usd) : null,
        transaction_date: formValue.transaction_date,
        order_number: formValue.order_number || null,
        brokerage: formValue.brokerage || null,
        notes: formValue.notes || null
      };

      // Si hay slippage, incluir los detalles en el payload
      if (this.slippageEnabled) {
        payload.slippage_entries = this.slippageEntries.controls.map(entry => ({
          quantity: entry.get('quantity')?.value,
          price: entry.get('price')?.value
        }));
      }

      console.log('📤 Enviando transacción:', payload);

      try {
        const token = localStorage.getItem('access_token');
        const request$ = this.editId
          ? this.http.put(`${this.apiUrl}/transactions/${this.editId}`, payload, { headers: { Authorization: `Bearer ${token}` } })
          : this.http.post(`${this.apiUrl}/transactions`, payload, { headers: { Authorization: `Bearer ${token}` } });

        await firstValueFrom(request$);

        this.loading = false;
        this.snackBar.open(this.editId ? '✅ Transacción actualizada' : '✅ Transacción guardada exitosamente', 'Cerrar', { duration: 3000 });
        this.router.navigate(['/transactions']);
      } catch (error: any) {
        this.loading = false;
        console.error('❌ Error:', error);
        this.snackBar.open(error.error?.detail || 'Error al guardar la transacción', 'Cerrar', { duration: 5000 });
      }
    }
  }
}