# Plan: Animații Futuriste pe Tot Site-ul

## Direcție vizuală
Estetică "sci-fi dashboard" — glow subtil pe accente, tranziții fluide, glass-morphism, pulsuri live pe date în timp real. Fără să afectez performanța (refresh la 1.1s).

## Modificări

### 1. `src/styles.css` — tokens & keyframes noi
- Adaug variabile: `--glow-primary`, `--gradient-cyber`, `--shadow-neon`
- Keyframes noi:
  - `pulse-glow` — puls neon pe elementele "live"
  - `shimmer` — trecere lucioasă pe carduri la hover
  - `scan-line` — linie orizontală pe grafice radiale
  - `fade-slide-up` — intrare carduri
  - `border-flow` — border gradient în mișcare pe pastile active
  - `data-tick` — micro-flash când o valoare se actualizează
- Utilities `@utility`: `.glass-card`, `.glow-primary`, `.animate-in-stagger`, `.live-dot`

### 2. `src/components/StatCard.tsx`
- Glass-morphism (`backdrop-blur`, border subtil translucid)
- Hover: shimmer + scale foarte discret + glow
- Intrare cu `fade-slide-up` cu delay pe index (stagger)
- Micro-flash pe valoare când se schimbă (folosind key/prev value)

### 3. `src/components/RadialGauge.tsx`
- Gradient stroke cu animare `stroke-dashoffset` fluidă (tranziție 800ms)
- Scan-line rotativă subtilă în cerc
- Glow în jurul arcului activ (SVG filter `feGaussianBlur`)
- Numeric counter animat (tween între valori)

### 4. `src/components/Meter.tsx`
- Bara cu gradient animat + shimmer în interior când e activă
- Tranziție `width` fluidă

### 5. `src/components/ServicePill.tsx`
- Border-flow gradient pe status "online"
- Live dot pulsant (verde neon)

### 6. `src/components/BottomNav.tsx`
- Iconițe cu glow pe activ
- Indicator activ animat (slide fluid între tab-uri)
- Micro-haptic vizual la tap (scale down + spring back)

### 7. `src/components/PageShell.tsx` / `AppHeader.tsx`
- Titlu cu gradient text + subtil shimmer
- Fundal cu grid subtil animat sau blur-orbs (2 gradiente radiale care se mișcă lent)
- Intrare `fade-slide-up` pe conținutul paginii

### 8. Rute (`index.tsx`, `plex.tsx`, `immich.tsx`, `qbit.tsx`, `host.tsx`)
- Aplic `animate-in-stagger` pe grid-urile de carduri
- Micro-tranziții pe butoanele qBit (Resume/Stop) — scale + glow la press
- Drawer/expandable liste — slide + fade

## Ce NU se schimbă
- Logica de refresh (rămâne 1.1s)
- Structura datelor și API-urile
- Backend/agent
- Layout-ul general

## Considerații de performanță
- Toate animațiile pe `transform` și `opacity` (GPU)
- `will-change` doar unde e necesar
- Fără JS de animație — pur CSS
- `prefers-reduced-motion` respectat (reduce durata la 0)

Apasă **Implementează planul** ca să dau drumul.