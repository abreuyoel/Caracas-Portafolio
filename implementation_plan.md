# Implementation Plan - Release Notes & Newsletter

Create a premium "Release Notes" experience for Caracas Portafolio users, including a standalone public page, an email template for Resend, and integration into the existing app flow.

## User Review Required

> [!IMPORTANT]
> The release notes include many advanced quantitative features. I have categorized them to be "friendly" for all users while highlighting the technical power of the app.
> I will create a script in the backend to send the email to all users, but you will need to run it manually or I can provide the command.

## Proposed Changes

---

### Frontend

#### [NEW] [release-notes.component.ts](file:///c:/Users/Yoel%20Abreu/OneDrive/Desktop/CV-Yoel%20Abreu/Gestion%20Portafolio/frontend/src/app/release-notes/release-notes.component.ts)
- Create a standalone component using the existing "Premium Dark" aesthetic.
- Feature sections: **Comunidad**, **Análisis Avanzado**, **Paper Trading**, and **Aprende**.
- Publicly accessible buttons for "Iniciar Sesión" and "Registrarse".

#### [MODIFY] [dashboard.component.ts](file:///c:/Users/Yoel%20Abreu/OneDrive/Desktop/CV-Yoel%20Abreu/Gestion%20Portafolio/frontend/src/app/dashboard/dashboard.component.ts)
- Add a "What's New" banner or modal shown on first visit.
- Implement a "Descartar" button that saves the state in `localStorage` to hide it permanently.

#### [MODIFY] [app.routes.ts](file:///c:/Users/Yoel%20Abreu/OneDrive/Desktop/CV-Yoel%20Abreu/Gestion%20Portafolio/frontend/src/app/app.routes.ts)
- Add the route `/release-notes` to the public routes (before the wildcard).

#### [MODIFY] [landing.component.ts](file:///c:/Users/Yoel%20Abreu/OneDrive/Desktop/CV-Yoel%20Abreu/Gestion%20Portafolio/frontend/src/app/landing/landing.component.ts)
- Add a "Ver novedades" badge or link in the hero/navigation section.

#### [MODIFY] [login.component.html (or ts)](file:///c:/Users/Yoel%20Abreu/OneDrive/Desktop/CV-Yoel%20Abreu/Gestion%20Portafolio/frontend/src/app/auth/login/login.component.ts)
- Add a subtle link: "¿Qué hay de nuevo en esta versión?" below the login form.

---

### Backend

#### [MODIFY] [email.py](file:///c:/Users/Yoel%20Abreu/OneDrive/Desktop/CV-Yoel%20Abreu/Gestion%20Portafolio/backend/app/utils/email.py)
- Add `send_release_notes_email(to_email: str, username: str)` function.
- Create a beautiful HTML template specifically for this release, highlighting:
    - **Comunidad**: Publicaciones anónimas, ranking y torneos.
    - **Análisis Avanzado**: HMM, Cointegración, ML Prediction y todos los nuevos indicadores.
    - **Paper Trading**: Simulador con libro de órdenes real.
    - **Aprende**: Nueva sección académica expandida.

#### [NEW] [send_bulk_release.py](file:///c:/Users/Yoel%20Abreu/OneDrive/Desktop/CV-Yoel%20Abreu/Gestion%20Portafolio/backend/scripts/send_bulk_release.py)
- A utility script to fetch all users from the database and trigger the email via the existing Resend utility.

## Open Questions

- Should I include a "Dismiss" feature for users once they've seen the notes inside the dashboard? (Otherwise, a button like "Ver notas de versión" in settings or sidebar is standard).
- Do you want to highlight any specific feature from the list as the "Main Hero" for the email? (Currently planning to highlight **Google OAuth** and **Comunidad**).

## Verification Plan

### Automated Tests
- Test the `/release-notes` route without a token to ensure it's public.
- Validate that the "Register" button on the release notes page correctly redirects.

### Manual Verification
- Verify the mobile responsiveness of the new Release Notes page.
- Send a test email to a single account using the new backend utility.
