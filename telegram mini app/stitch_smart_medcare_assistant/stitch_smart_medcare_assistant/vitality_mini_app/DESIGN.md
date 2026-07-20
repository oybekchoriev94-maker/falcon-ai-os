---
name: Vitality Mini-App
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#434655'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#4d661c'
  on-secondary: '#ffffff'
  secondary-container: '#ceee93'
  on-secondary-container: '#536d22'
  tertiary: '#4d556b'
  on-tertiary: '#ffffff'
  tertiary-container: '#656d84'
  on-tertiary-container: '#eef0ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#ceee93'
  secondary-fixed-dim: '#b3d17a'
  on-secondary-fixed: '#131f00'
  on-secondary-fixed-variant: '#364e03'
  tertiary-fixed: '#dae2fd'
  tertiary-fixed-dim: '#bec6e0'
  on-tertiary-fixed: '#131b2e'
  on-tertiary-fixed-variant: '#3f465c'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-padding: 1.25rem
  element-gap: 1rem
  section-margin: 2rem
  gutter: 1rem
  radius-inner: 0.75rem
---

## Brand & Style

The brand personality is **clinical yet compassionate**, prioritizing clarity and speed of action. This design system bridges the gap between professional healthcare software and the casual, accessible nature of the Telegram interface. It targets users seeking immediate health information, appointment booking, and routine tracking.

The visual style is **Corporate / Modern** with a lean toward **Minimalism**. It utilizes expansive white space to reduce cognitive load during health-related stress. The aesthetic is characterized by soft, high-radius surfaces, subtle depth through tonal layering, and a vibrant accent color to signal life, health, and system "readiness."

**Emotional Response:**
- **Security:** Established through deep blues and stable, professional typography.
- **Optimism:** Evoked by bright accent greens and high-key backgrounds.
- **Simplicity:** Achieved through a mobile-first, single-column focus.

## Colors

The palette is anchored by "Trustworthy Blue" to establish medical authority, balanced by "Vitality Green" for status indicators and specific calls to action.

- **Primary (Trustworthy Blue):** Used for primary actions, active states, and branding headers.
- **Secondary (Vitality Green):** A high-visibility accent used for health indicators (e.g., UV index, fitness goals) and "Success" states. It should be used sparingly to maintain its impact.
- **Tertiary (Deep Slate):** Reserved for high-contrast typography and essential iconography to ensure legibility.
- **Neutral (Soft Slate/White):** The foundation of the UI. `F8FAFC` is the primary background to reduce eye strain compared to pure white.

**Telegram Integration:** Ensure the `neutral` color blends seamlessly with the Telegram Mini App background tokens (`--tg-theme-bg-color`).

## Typography

This design system uses **Inter** exclusively for its utilitarian precision and high legibility at small sizes, which is critical for mobile healthcare data.

- **Headlines:** Use tight letter spacing (-0.02em) and bold weights to create a strong information hierarchy.
- **Body:** Standardized at 16px for primary reading and 14px for secondary descriptions to ensure accessibility for a wide demographic.
- **Labels:** Uppercase or semi-bold 12px type is used for categories, timestamps, and metadata.

All type should utilize `OptimizeLegibility` and be rendered with high contrast against background surfaces.

## Layout & Spacing

The layout follows a **Fluid Grid** model optimized for the narrow aspect ratios of Telegram's webview.

- **Safe Zones:** A 20px (1.25rem) horizontal margin is maintained globally to prevent content from touching the device edges.
- **Vertical Rhythm:** Elements are grouped using a base 4px/8px scale. A 16px (1rem) gap is used between cards in a list, while 32px (2rem) separates distinct functional sections (e.g., "Upcoming Appointments" vs "Find a Doctor").
- **Telegram Context:** Top navigation should account for the Telegram "Close" and "More" buttons. Content should be padded at the bottom to avoid interference with the Telegram "Main Button" or gesture navigation bars.

## Elevation & Depth

Visual hierarchy is established through **Tonal Layers** rather than heavy shadows.

- **Base Layer:** The application background (`#F8FAFC`).
- **Surface Layer:** White (`#FFFFFF`) cards with a very soft, 15% opacity blue-tinted shadow (`0px 4px 12px rgba(37, 99, 235, 0.05)`).
- **Interactive Layer:** Active states and "Primary" cards (like the appointment reminder) use the primary blue as a solid fill, lifting them to the top of the visual stack.
- **Overlays:** Modals and bottom sheets use a 40% backdrop blur to maintain context with the screen below, following the glassmorphism style seen in modern mobile OS patterns.

## Shapes

The shape language is **Rounded**, reflecting the friendly and approachable nature of modern health-tech.

- **Standard Cards:** 1rem (16px) corner radius.
- **Buttons:** 0.75rem (12px) for standard buttons, though CTA buttons can scale to "Pill" (3rem) to emphasize clickability.
- **Avatars:** Strictly circular for medical professionals to create a "personal" feel.
- **Input Fields:** 0.75rem (12px) to match button styling, creating a cohesive form experience.

## Components

### Buttons
- **Primary:** Solid `primary_color_hex` with white text. High-contrast, full-width on mobile.
- **Secondary:** Light blue tint background with `primary_color_hex` text for less urgent actions like "View Profile."
- **Ghost:** No background, blue text. Used for "See All" or secondary navigation.

### Cards
- **Appointment Card:** Uses the primary blue background to stand out. Contains white text and high-contrast sub-components (like a white button for "Reschedule").
- **Doctor Card:** White background, subtle border or shadow, featuring a circular avatar, star rating in `secondary_color_hex`, and a clear "Book" CTA.

### Inputs & Search
- **Search Bar:** Large, rounded (12px), with a light neutral fill. Includes a magnifying glass icon and clear placeholder text.
- **Filters/Chips:** Small rounded containers (pill-shaped) used for categories like "Cardiology" or "Dermatology." Active chips use the primary blue fill.

### Progress & Status
- **Health Indicators:** Use horizontal progress bars with the `secondary_color_hex` (Vitality Green) for positive metrics (e.g., Daily Routine 50%).
- **Badges:** Small, high-contrast dots on icons (e.g., notification bell) to signal unread status.

### List Items
- Clean, 1px horizontal dividers or 12px vertical spacing between cards. Each item must have a clear chevron or "arrow" icon if it leads to a new screen.