import { atom } from 'nanostores';
import { logStore } from './logs';

/*
 * This build of AlphaCode is DARK-ONLY..
 *
 * The light theme has been completely removed: the app always uses the dark
 * theme, the theme toggle button has been removed from the sidebar, and any
 * previously-persisted `bolt_theme=light` value is migrated to `dark` on load.
 *
 * `Theme` still includes `'light'` for type compatibility with upstream code
 * that references it, but the value `'light'` is never produced at runtime.
 *
 * On top of the fixed dark theme, the user can pick a "color scheme" — one of
 * eight accent palettes. Seven are GREEN shades (forest / emerald / lime /
 * mint / teal / jade / sage) and one — `classic` — restores the ORIGINAL
 * bolt.diy purple accent (#9C7DFF). Each palette recolours only the accent
 * (background rays, active borders, buttons, links, the dashed prompt
 * border, the Export-to-GitHub FAB, the sidebar's Start-new-chat button, …)
 * while the rest of the dark UI stays the same. The active scheme is stored
 * in `colorSchemeStore`, persisted to localStorage under
 * `bolt_color_scheme`, and applied to `<html data-color-scheme="…">` so the
 * CSS variable overrides in variables.scss recolour those accents.
 *
 * Note: the previous multi-hue schemes (blue / orange / pink / cyan / slate)
 * and the old 'green' name have been removed. The original purple accent has
 * been RESTORED as the `classic` scheme. Any persisted value that isn't one
 * of the 8 valid IDs is migrated to 'forest' (the default) on load.
 */
export type Theme = 'dark' | 'light';

export const kTheme = 'bolt_theme';

/** The one and only theme this build uses. */
export const DEFAULT_THEME = 'dark' as const;

/** All available dark color schemes (seven green shades + the original purple). */
export type ColorScheme =
  | 'forest'
  | 'emerald'
  | 'lime'
  | 'mint'
  | 'teal'
  | 'jade'
  | 'sage'
  | 'classic';

export const COLOR_SCHEMES: ColorScheme[] = [
  'forest',
  'emerald',
  'lime',
  'mint',
  'teal',
  'jade',
  'sage',
  'classic',
];

export const kColorScheme = 'bolt_color_scheme';

/** The default green palette (matches the original Forest Green look). */
export const DEFAULT_COLOR_SCHEME: ColorScheme = 'forest';

/*
 * Previously-persisted scheme IDs that have been removed. If the user has one
 * of these in localStorage, we migrate them to the default 'forest' scheme so
 * they don't get stuck on an invalid value.
 *
 * The original purple accent has been RESTORED under the new `classic` ID
 * (the old ID was named 'purple', which is still treated as legacy here, so
 * anyone with the old persisted 'purple' value lands on 'forest' and can then
 * re-select the purple look via the `classic` option in the theme panel).
 */
const LEGACY_SCHEME_IDS = new Set([
  'purple',
  'blue',
  'green', // old name for what is now 'forest'
  'orange',
  'pink',
  'cyan',
  'slate',
]);

/** Human-readable metadata for each scheme — used by the theme picker UI. */
export const COLOR_SCHEME_META: Record<
  ColorScheme,
  { name: string; swatch: string; description: string }
> = {
  forest: { name: 'Forest Green', swatch: '#4ade80', description: 'Bright default green glow' },
  emerald: { name: 'Emerald', swatch: '#10b981', description: 'Deep emerald green' },
  lime: { name: 'Lime', swatch: '#bef264', description: 'Yellow-green lime zest' },
  mint: { name: 'Mint', swatch: '#6ee7b7', description: 'Soft pastel mint' },
  teal: { name: 'Teal Green', swatch: '#2dd4bf', description: 'Cool teal-cyan green' },
  jade: { name: 'Jade', swatch: '#00d68f', description: 'Vivid jade green' },
  sage: { name: 'Sage', swatch: '#9ae6b4', description: 'Muted sage green' },
  classic: { name: 'Classic Purple', swatch: '#9c7dff', description: 'Original bolt.diy purple accent' },
};

export function themeIsDark() {
  return true;
}

export const themeStore = atom<Theme>(initStore());

/** Active color scheme store. Subscribe with `useStore(colorSchemeStore)`. */
export const colorSchemeStore = atom<ColorScheme>(initColorSchemeStore());

function initStore(): Theme {
  if (!import.meta.env.SSR) {
    const persistedTheme = localStorage.getItem(kTheme) as Theme | undefined;

    // Migrate any previously-persisted light theme to dark (one-time).
    if (persistedTheme && persistedTheme !== 'dark') {
      localStorage.setItem(kTheme, 'dark');
    }

    // Always force the <html data-theme> attribute to dark.
    document.querySelector('html')?.setAttribute('data-theme', 'dark');

    // Also normalise the user profile if it references light.
    try {
      const userProfile = localStorage.getItem('bolt_user_profile');

      if (userProfile) {
        const profile = JSON.parse(userProfile);

        if (profile?.theme && profile.theme !== 'dark') {
          profile.theme = 'dark';
          localStorage.setItem('bolt_user_profile', JSON.stringify(profile));
        }
      }
    } catch (error) {
      console.error('Error normalising user profile theme:', error);
    }
  }

  return 'dark';
}

function initColorSchemeStore(): ColorScheme {
  if (!import.meta.env.SSR) {
    const persisted = localStorage.getItem(kColorScheme) as ColorScheme | null;

    /*
     * Migrate any legacy (now-removed) scheme ID to the default 'forest'
     * scheme so users with an old persisted value land on a valid green.
     */
    let scheme: ColorScheme;

    if (persisted && COLOR_SCHEMES.includes(persisted)) {
      scheme = persisted;
    } else {
      if (persisted && LEGACY_SCHEME_IDS.has(persisted as string)) {
        localStorage.setItem(kColorScheme, DEFAULT_COLOR_SCHEME);
      }

      scheme = DEFAULT_COLOR_SCHEME;
    }

    document.querySelector('html')?.setAttribute('data-color-scheme', scheme);
    return scheme;
  }

  return DEFAULT_COLOR_SCHEME;
}

/**
 * Switch the active dark color scheme. Applies the `data-color-scheme`
 * attribute to `<html>` (which triggers the CSS variable overrides) and
 * persists the choice to localStorage so it survives reloads.
 */
export function setColorScheme(scheme: ColorScheme) {
  colorSchemeStore.set(scheme);

  if (!import.meta.env.SSR) {
    localStorage.setItem(kColorScheme, scheme);
    document.querySelector('html')?.setAttribute('data-color-scheme', scheme);
  }

  logStore.logSystem('Color scheme changed', { scheme });
}

/**
 * Previously toggled between dark and light. With the light theme removed this
 * is now a no-op that keeps the app on the dark theme. Kept so the
 * Cmd+Alt+Shift+D keyboard shortcut and any existing callers don't break.
 */
export function toggleTheme() {
  themeStore.set('dark');

  if (!import.meta.env.SSR) {
    localStorage.setItem(kTheme, 'dark');
    document.querySelector('html')?.setAttribute('data-theme', 'dark');
  }

  logStore.logSystem('Theme is fixed to dark mode');
}
