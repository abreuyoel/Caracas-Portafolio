import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-release-notes',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './release-notes.component.html',
  styleUrl: './release-notes.component.scss'
})
export class ReleaseNotesComponent implements OnInit {
  ngOnInit() {
    console.log('🚀 ReleaseNotesComponent initialized');
  }
}
